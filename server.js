"use strict";
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { openDatabase } = require("./server/database");
const { createAuth } = require("./server/auth");
const { createStorage, extensions } = require("./server/storageService");
const { createLibrary } = require("./server/libraryService");
const { createDevices } = require("./server/deviceManager");
const { createPairings } = require("./server/pairingManager");
const { createTransfers } = require("./server/transferService");
const { createSoundService, MAX_CUE_BYTES, checkKind } = require("./server/soundService");
const { AppError, requireObject } = require("./server/errors");
function createDemoServer({
  storageDir = path.join(__dirname, "storage"),
  transferTimeout = 15000,
  requestTimeout = 30000,
  offlineGrace = 5000,
  maxFileSize = 50 * 1024 * 1024,
  tlsKeyPath = process.env.FLICK_TLS_KEY || null,
  tlsCertPath = process.env.FLICK_TLS_CERT || null,
  secureCookie = process.env.SECURE_COOKIE === "1" || (!!tlsKeyPath && !!tlsCertPath),
} = {}) {
  if (!!tlsKeyPath !== !!tlsCertPath)
    throw new Error("Set both FLICK_TLS_KEY and FLICK_TLS_CERT to enable HTTPS");
  const db = openDatabase(storageDir),
    auth = createAuth(db, { secureCookie }),
    storage = createStorage(db, storageDir),
    sounds = createSoundService(storageDir);
  db.transaction(() => {
    db.prepare(
      "UPDATE pairings SET status='disconnected',ended_at=?,reason='Server restarted' WHERE status='active'",
    ).run(Date.now());
    db.prepare("DELETE FROM pair_members").run();
    db.prepare(
      "UPDATE pairing_requests SET status='expired' WHERE status='pending'",
    ).run();
    db.prepare(
      "UPDATE transfers SET status=CASE WHEN status='offered' THEN 'failed' ELSE 'completed' END,playback_status='cancelled',completed_at=?,message='Server restarted' WHERE status IN ('offered','delivered')",
    ).run(Date.now());
    db.prepare("DELETE FROM library_tracks WHERE visible=0").run();
  })();
  storage.reconcile();
  const app = express(),
    server = tlsKeyPath
      ? https.createServer({
          key: fs.readFileSync(tlsKeyPath),
          cert: fs.readFileSync(tlsCertPath),
        }, app)
      : http.createServer(app),
    io = new Server(server, {
      maxHttpBufferSize: 16384,
      allowRequest: (req, cb) => cb(null, auth.allowedOrigin(req)),
    });
  const devices = createDevices(io, db, auth);
  const library = createLibrary(db, storage, (id, data) =>
    devices.to(id, "library:changed", data),
  );
  let transfers;
  const pairings = createPairings(db, devices, {
    requestTimeout,
    offlineGrace,
    onDisconnect: (id, message) => transfers?.cancelPair(id, message),
  });
  transfers = createTransfers(db, devices, pairings, library, storage, {
    timeout: transferTimeout,
  });
  devices.hooks.primaryChanged = (id) =>
    transfers.cancelDevice(id, "设备连接已改变；当前音乐继续播放。");
  const sweep = setInterval(
    () => {
      pairings.expire();
      transfers.expire();
    },
    Math.max(10, Math.min(500, requestTimeout / 4, transferTimeout / 4)),
  );
  sweep.unref();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, version: "3.0.0" }),
  );
  app.get("/api/config", (req, res) =>
    res.json({ maxFileSize, transferTimeout, requestTimeout }),
  );
  app.get("/api/session", (req, res) => res.json(auth.session(req, res)));
  app.use("/api", auth.required);
  app.post("/api/device", auth.csrf, (req, res) => {
    requireObject(req.body);
    const nickname =
      typeof req.body.nickname === "string" ? req.body.nickname.trim() : "";
    if (!nickname || [...nickname].length > 40)
      throw new AppError("设备昵称需要 1–40 个字符。");
    db.prepare("UPDATE devices SET nickname=? WHERE id=?").run(
      nickname,
      req.session.device_id,
    );
    devices.publish();
    res.json({ device: devices.device(req.session.device_id) });
  });
  // Shared soundpack: any authenticated LAN demo device can configure the four
  // global cues; changes are broadcast to every connected browser.
  app.get("/api/sounds", (req, res) => res.json({ sounds: sounds.list() }));
  const cueUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_CUE_BYTES, files: 1, fields: 0, parts: 1 },
  });
  app.post("/api/sounds/:kind", auth.csrf, (req, res, next) => {
    try { checkKind(req.params.kind); } catch (err) { return next(err); }
    cueUpload.single("audio")(req, res, (err) => {
      if (err) return next(err);
      try {
        const sound = sounds.put(req.params.kind, req.file);
        io.emit("sounds:updated", { kind: req.params.kind, revision: sound.revision });
        res.json({ sound });
      } catch (error) { next(error); }
    });
  });
  app.delete("/api/sounds/:kind", auth.csrf, (req, res) => {
    sounds.reset(req.params.kind);
    io.emit("sounds:updated", { kind: req.params.kind, revision: null });
    res.json({ sound: null });
  });
  app.get("/api/sounds/:kind/file", (req, res, next) => {
    try {
      const sound = sounds.file(req.params.kind);
      res.type(sound.mimeType).sendFile(sound.filename, { cacheControl: false }, next);
    } catch (err) { next(err); }
  });
  app.get("/api/tracks", (req, res) =>
    res.json({ tracks: library.list(req.session.device_id) }),
  );
  const upload = multer({
    storage: multer.diskStorage({
      destination: storage.tmpDir,
      filename: (req, file, cb) => cb(null, randomUUID() + ".part"),
    }),
    limits: { fileSize: maxFileSize, files: 1, fields: 0, parts: 1 },
    fileFilter: (req, file, cb) =>
      cb(
        extensions.has(path.extname(file.originalname).toLowerCase())
          ? null
          : new AppError("Unsupported audio extension", 415),
        true,
      ),
  });
  app.post("/api/tracks", auth.csrf, (req, res, next) => {
    upload.single("audio")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return next(new AppError("No audio file supplied"));
      try {
        // Multipart filenames from browsers use UTF-8; Busboy's unextended
        // filename parameter defaults to Latin-1. Preserve genuine legacy names
        // when the original bytes are not valid UTF-8.
        let name = req.file.originalname;
        if ([...name].every((c) => c.codePointAt(0) <= 255)) {
          try {
            name = new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.from(name, "latin1"),
            );
          } catch {}
        }
        const result = await storage.ingest(
          req.file.path,
          name,
          req.session.device_id,
        );
        const track = library.present(
          library.track(result.trackId, req.session.device_id),
        );
        devices.to(req.session.device_id, "library:changed", {
          addedId: track.id,
        });
        res
          .status(result.reused ? 200 : 201)
          .json({ track, reused: result.reused });
      } catch (error) {
        fs.rmSync(req.file.path, { force: true });
        next(error);
      }
    });
  });
  app.post("/api/tracks/batch-delete", auth.csrf, (req, res) => {
    requireObject(req.body);
    res.json({
      deletedIds: library.remove(req.session.device_id, req.body.ids),
    });
  });
  app.delete("/api/tracks/:id", auth.csrf, (req, res) =>
    res.json({
      deletedIds: library.remove(req.session.device_id, [req.params.id]),
    }),
  );
  app.post("/api/tracks/:id/metadata", auth.csrf, (req, res) => {
    const track = library.track(req.params.id, req.session.device_id);
    const duration = req.body?.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 8640000)
      throw new AppError("Invalid duration");
    db.prepare("UPDATE library_tracks SET duration=? WHERE id=?").run(
      duration,
      track.id,
    );
    res.json({ ok: true });
  });
  app.get("/api/tracks/:id/stream", library.stream);
  app.get("/api/transfers/:id", (req, res) =>
    res.json({
      transfer: transfers.status(req.params.id, req.session.device_id),
    }),
  );
  app.use(["/uploads", "/storage"], (req, res) =>
    res.status(404).json({ error: "Public audio paths are disabled in V2" }),
  );
  app.use(
    express.static(path.join(__dirname, "public"), {
      dotfiles: "deny",
      maxAge: 0,
    }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err.code === "LIMIT_FILE_SIZE"
        ? 413
        : err.status || (err instanceof multer.MulterError ? 400 : 500);
    res.status(status).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "Audio exceeds the upload size limit"
          : status < 500
            ? err.message
            : "Server could not complete this request",
    });
  });
  io.use(auth.socketMiddleware);
  io.on("connection", (socket) => {
    const handle = (name, fn) =>
      socket.on(name, async (data, ack) => {
        if (typeof ack !== "function") ack = () => {};
        try {
          const result = await fn(data);
          ack({ ok: true, ...(result || {}) });
        } catch (err) {
          ack({
            ok: false,
            message:
              err instanceof AppError
                ? err.message
                : "Server could not complete this action",
          });
        }
      });
    handle("device:register", (data) => devices.register(socket, data));
    handle("device:ready", (data) =>
      devices.ready(socket, requireObject(data).audioReady),
    );
    handle("pair:request", (data) => ({
      request: pairings.request(
        devices.guard(socket),
        requireObject(data).targetId,
      ),
    }));
    handle("pair:accept", (data) => ({
      pairing: pairings.accept(
        devices.guard(socket),
        requireObject(data).requestId,
      ),
    }));
    handle("pair:reject", (data) => {
      pairings.reject(devices.guard(socket), requireObject(data).requestId);
    });
    handle("pair:disconnect", () => pairings.disconnect(devices.guard(socket)));
    handle("transfer:request", (data) => ({
      transfer: transfers.request(socket, data),
    }));
    handle("transfer:stored", (data) => transfers.stored(socket, data));
    handle("transfer:playback", (data) => ({
      transfer: transfers.playback(socket, data),
    }));
    handle("transfer:cancel", (data) => ({
      transfer: transfers.cancel(socket, data),
    }));
    socket.on("disconnect", () => devices.disconnect(socket));
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(sweep);
    await new Promise((resolve) => io.close(resolve));
    pairings.close();
    storage.collect();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
  }
  return {
    app,
    server,
    tlsEnabled: !!tlsKeyPath,
    io,
    db,
    auth,
    storage,
    sounds,
    library,
    devices,
    pairings,
    transfers,
    close,
  };
}
if (require.main === module) {
  const demo = createDemoServer({
    storageDir: process.env.FLICK_STORAGE_DIR
      ? path.resolve(process.env.FLICK_STORAGE_DIR)
      : undefined,
  });
  const port = Number(process.env.PORT || 3000);
  demo.server.on("error", (err) => {
    console.error("Could not start:", err.message);
    demo.close().finally(() => {
      process.exitCode = 1;
    });
  });
  demo.server.listen(port, "0.0.0.0", () => {
    const scheme = demo.tlsEnabled ? "https" : "http";
    console.log(`Flick Music V2.3: ${scheme}://localhost:${port}`);
    try {
      for (const addresses of Object.values(os.networkInterfaces()))
        for (const ip of addresses || [])
          if (ip.family === "IPv4" && !ip.internal)
            console.log(`LAN: ${scheme}://${ip.address}:${port}`);
    } catch {
      console.log("Listening on 0.0.0.0; use your computer LAN IP.");
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => demo.close().then(() => process.exit(0)));
}
module.exports = { createDemoServer };
