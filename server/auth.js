"use strict";
const {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} = require("node:crypto");
const { AppError } = require("./errors");
const COOKIE = "flick_session";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function createAuth(db, { secureCookie = false } = {}) {
  function resolve(req) {
    const item = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + "="));
    const token = item?.slice(COOKIE.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      db
        .prepare(
          "SELECT s.*, d.nickname FROM sessions s JOIN devices d ON d.id=s.device_id WHERE token_hash=? AND expires_at>?",
        )
        .get(hash(token), Date.now()) || null
    );
  }
  function session(req, res) {
    let s = resolve(req);
    const restored = !!s;
    if (!s) {
      const token = randomBytes(32).toString("hex"),
        id = randomUUID(),
        csrf = randomBytes(32).toString("hex"),
        now = Date.now();
      const nickname = "设备 " + id.slice(0, 4).toUpperCase();
      db.transaction(() => {
        db.prepare("INSERT INTO devices VALUES(?,?,?,?)").run(
          id,
          nickname,
          now,
          now,
        );
        db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(
          hash(token),
          id,
          csrf,
          now,
          now + 365 * 86400000,
        );
      })();
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secureCookie || req.secure ? "; Secure" : ""}`,
      );
      s = { device_id: id, nickname, csrf_token: csrf };
    }
    db.prepare("UPDATE devices SET last_seen_at=? WHERE id=?").run(
      Date.now(),
      s.device_id,
    );
    return {
      device: { id: s.device_id, nickname: s.nickname },
      csrfToken: s.csrf_token,
      restored,
    };
  }
  function required(req, res, next) {
    req.session = resolve(req);
    if (!req.session)
      return res
        .status(401)
        .json({ error: "Device session expired. Refresh this page." });
    next();
  }
  function csrf(req, res, next) {
    const supplied = req.get("X-CSRF-Token") || "";
    const expected = req.session?.csrf_token || "";
    const suppliedBytes = Buffer.from(supplied),
      expectedBytes = Buffer.from(expected);
    const same =
      suppliedBytes.length === expectedBytes.length &&
      suppliedBytes.length > 0 &&
      timingSafeEqual(suppliedBytes, expectedBytes);
    if (!same || !allowedOrigin(req))
      return res
        .status(403)
        .json({ error: "Request verification failed. Refresh this page." });
    next();
  }
  function allowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // scripts still require a valid cookie + CSRF token
    try {
      return (
        new URL(origin).host === req.headers.host &&
        ["http:", "https:"].includes(new URL(origin).protocol)
      );
    } catch {
      return false;
    }
  }
  function socketMiddleware(socket, next) {
    const s = resolve(socket.request);
    if (!s || !allowedOrigin(socket.request))
      return next(new Error("Unauthorized device session"));
    socket.data.deviceId = s.device_id;
    next();
  }
  function verifySocket(socket) {
    const s = resolve(socket.request);
    if (!s || s.device_id !== socket.data.deviceId)
      throw new AppError("Device session expired", 401);
    return s;
  }
  return {
    session,
    required,
    csrf,
    resolve,
    allowedOrigin,
    socketMiddleware,
    verifySocket,
  };
}
module.exports = { createAuth };
