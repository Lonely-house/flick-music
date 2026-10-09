"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { io } = require("socket.io-client");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const { harness, ack, waitEvent, delay, wav } = require("./helpers");

test("HTTP authorization, media Range and atomic library mutations", async (t) => {
  const h = await harness(t, { maxFileSize: 50000 });
  const a = await h.client("A"),
    b = await h.client("B");
  let x, y, z;
  await t.test(
    "Cookie is HttpOnly; tokens are hashed and device IDs are not credentials",
    async () => {
      const r = await fetch(h.base + "/api/session");
      assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
      assert.equal(
        (await fetch(h.base + "/api/tracks?deviceId=" + a.session.device.id))
          .status,
        401,
      );
      assert.equal(
        (
          await fetch(h.base + "/api/tracks", {
            headers: { Cookie: "flick_session=" + "a".repeat(64) },
          })
        ).status,
        401,
      );
      assert.ok(
        !h.demo.db
          .prepare("SELECT token_hash FROM sessions")
          .all()
          .some((s) => a.cookie.includes(s.token_hash)),
      );
      const registered = await ack(b.socket, "device:register", {
        deviceId: a.session.device.id,
        audioReady: false,
      });
      assert.equal(registered.device.id, b.session.device.id);
      assert.equal(
        (await h.fetchAs(b, "/api/tracks?deviceId=" + a.session.device.id))
          .status,
        200,
      );
      const denied = io(h.base, { forceNew: true, reconnection: false });
      try {
        const error = await waitEvent(denied, "connect_error");
        assert.match(error.message, /Unauthorized/);
      } finally {
        denied.disconnect();
      }
    },
  );
  await t.test(
    "write requests require CSRF and a matching Origin",
    async () => {
      const headers = { Cookie: a.cookie, "Content-Type": "application/json" },
        body = JSON.stringify({ nickname: "stolen" });
      assert.equal(
        (await fetch(h.base + "/api/device", { method: "POST", headers, body }))
          .status,
        403,
      );
      assert.equal(
        (
          await h.fetchAs(a, "/api/device", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://evil.example",
            },
            body,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await h.fetchAs(a, "/api/device", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": "é".repeat(64),
            },
            body,
          })
        ).status,
        403,
      );
      assert.equal(h.demo.devices.device(a.session.device.id).nickname, "A");
    },
  );
  await t.test(
    "uploads validate real headers, extension and size; temp files are cleaned",
    async () => {
      assert.equal(
        (
          await h.upload(
            a,
            Buffer.from("<script>".repeat(100)),
            "fake.mp3",
            "audio/mpeg",
          )
        ).response.status,
        415,
      );
      assert.equal(
        (await h.upload(a, wav(), "song.exe", "audio/wav")).response.status,
        415,
      );
      assert.equal(
        (await h.upload(a, wav(440, 4), "large.wav")).response.status,
        413,
      );
      assert.equal(
        (await h.upload(a, Buffer.alloc(0), "empty.wav")).response.status,
        415,
      );
      assert.deepEqual(fs.readdirSync(h.demo.storage.tmpDir), []);
      // Browser MIME is not trusted: legitimate bytes still work with a generic MIME.
      x = (
        await h.upload(
          a,
          wav(440),
          "../../unsafe.wav",
          "application/octet-stream",
        )
      ).data.track;
      y = (await h.upload(a, wav(550), "second.wav")).data.track;
      z = (await h.upload(b, wav(660), "private.wav")).data.track;
      assert.equal(x.displayName, "unsafe.wav");
      assert.ok(
        fs
          .readdirSync(h.demo.storage.blobsDir)
          .every((f) => /^[a-f0-9]{64}\.wav$/.test(f)),
      );
    },
  );
  await t.test(
    "Range bounded/open/suffix and HEAD produce valid lengths and 416",
    async () => {
      const bytes = wav(440),
        size = bytes.length;
      const full = await h.fetchAs(a, x.audioUrl);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get("content-length"), String(size));
      for (const [range, start, end] of [
        ["bytes=0-9", 0, 9],
        ["bytes=10-", 10, size - 1],
        ["bytes=-12", size - 12, size - 1],
        ["bytes=0-999999", 0, size - 1],
      ]) {
        const r = await h.fetchAs(a, x.audioUrl, { headers: { Range: range } });
        assert.equal(r.status, 206);
        assert.equal(
          r.headers.get("content-range"),
          `bytes ${start}-${end}/${size}`,
        );
        assert.deepEqual(
          Buffer.from(await r.arrayBuffer()),
          bytes.subarray(start, end + 1),
        );
      }
      const head = await h.fetchAs(a, x.audioUrl, {
        method: "HEAD",
        headers: { Range: "bytes=0-19" },
      });
      assert.equal(head.status, 206);
      assert.equal(head.headers.get("content-length"), "20");
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      for (const range of [
        "bytes=999999-",
        "bytes=20-10",
        "bytes=-0",
        "bytes=0-1,3-4",
        "bytes=-",
        "items=0-2",
      ]) {
        const r = await h.fetchAs(a, x.audioUrl, { headers: { Range: range } });
        assert.equal(r.status, 416);
        assert.equal(r.headers.get("content-range"), "bytes */" + size);
      }
      assert.equal(
        (
          await h.fetchAs(a, x.audioUrl, {
            headers: { Range: "bytes=0-9", "If-Range": '"outdated"' },
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "Chinese multipart filenames round-trip without corrupting display names",
    async () => {
      const uploaded = await h.upload(a, wav(777), "青柠之夏.wav");
      assert.equal(uploaded.data.track.displayName, "青柠之夏.wav");
      assert.equal(uploaded.data.track.originalFilename, "青柠之夏.wav");
      await h.fetchAs(a, "/api/tracks/" + uploaded.data.track.id, {
        method: "DELETE",
      });
    },
  );
  await t.test(
    "pairing never exposes peer library; forged paths and deletes are denied",
    async () => {
      await h.pair(a, b);
      assert.equal((await h.tracks(b)).length, 1);
      assert.equal((await h.fetchAs(b, x.audioUrl)).status, 404);
      assert.equal(
        (await h.fetchAs(b, "/api/tracks/" + x.id, { method: "DELETE" }))
          .status,
        404,
      );
      assert.equal(
        (
          await h.fetchAs(b, "/api/tracks/" + x.id + "/metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: '{"duration":1}',
          })
        ).status,
        404,
      );
      for (const url of [
        "/uploads/unsafe.wav",
        "/storage/music.db",
        "/api/tracks/..%2F..%2Fstorage%2Fmusic.db/stream",
        "/storage/%2e%2e/server.js",
      ])
        assert.ok((await h.fetchAs(a, url)).status >= 400);
      const publicData = JSON.stringify(h.demo.devices.list());
      assert.ok(!publicData.includes(x.id));
      assert.ok(!publicData.includes("audioUrl"));
      assert.ok(!publicData.includes("csrf"));
    },
  );
  await t.test(
    "mixed-owner batch rolls back entirely; valid repeated IDs delete only once",
    async () => {
      const invalid = await h.fetchAs(a, "/api/tracks/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [x.id, z.id] }),
      });
      assert.equal(invalid.status, 404);
      assert.equal((await h.tracks(a)).length, 2);
      const valid = await h.fetchAs(a, "/api/tracks/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [x.id, y.id, x.id] }),
      });
      assert.equal(valid.status, 200);
      assert.equal((await valid.json()).deletedIds.length, 2);
      assert.equal((await h.tracks(a)).length, 0);
      assert.equal((await h.tracks(b)).length, 1);
    },
  );
  await t.test(
    "missing physical file returns 404 instead of crashing the server",
    async () => {
      const row = h.demo.library.track(z.id, b.session.device.id);
      fs.unlinkSync(h.demo.storage.filePath(row));
      assert.equal((await h.fetchAs(b, z.audioUrl)).status, 404);
      assert.equal((await fetch(h.base + "/api/health")).status, 200);
      // Reupload repairs a missing physical file while retaining the same library identity.
      const repaired = await h.upload(b, wav(660), "private.wav");
      assert.equal(repaired.data.track.id, z.id);
      assert.equal((await h.fetchAs(b, z.audioUrl)).status, 200);
    },
  );
});

test("transfer authorization, interruption and persistent delivery without play ACK", async (t) => {
  const h = await harness(t, { transferTimeout: 160, offlineGrace: 300 });
  const a = await h.client("A"),
    b = await h.client("B"),
    c = await h.client("C");
  const track = (await h.upload(a)).data.track;
  let pair, payload;
  await t.test("unpaired requests cannot grant media access", async () => {
    const r = await ack(a.socket, "transfer:request", {
      requestKey: randomUUID(),
      pairId: randomUUID(),
      trackId: track.id,
      direction: "left",
      isPlaying: true,
      currentTime: 0.2,
    });
    assert.equal(r.ok, false);
    assert.equal((await h.tracks(b)).length, 0);
    pair = await h.pair(a, b);
    assert.ok((await ack(b.socket, "device:ready", {audioReady:true})).ok);
    assert.ok((await ack(a.socket, "device:ready", {audioReady:true})).ok);
    payload = () => ({
      requestKey: randomUUID(),
      pairId: pair.id,
      trackId: track.id,
      direction: "left",
      isPlaying: true,
      currentTime: 0.2,
    });
  });
  await t.test(
    "sender can neither use a foreign track nor override the paired target",
    async () => {
      const foreign = (await h.upload(c, wav(999))).data.track;
      assert.equal(
        (
          await ack(a.socket, "transfer:request", {
            ...payload(),
            trackId: foreign.id,
          })
        ).ok,
        false,
      );
      const incoming = waitEvent(b.socket, "transfer:incoming");
      assert.ok(
        (
          await ack(a.socket, "transfer:request", {
            ...payload(),
            receiverId: c.session.device.id,
            audioUrl: "/storage/music.db",
          })
        ).ok,
      );
      const transfer = await incoming;
      assert.equal(
        (await ack(c.socket, "transfer:stored", { transferId: transfer.id }))
          .ok,
        false,
      );
      assert.equal(
        (
          await ack(a.socket, "transfer:playback", {
            transferId: transfer.id,
            success: true,
            currentTime: 1,
          })
        ).ok,
        false,
      );
      assert.equal(
        (await h.fetchAs(c, "/api/transfers/" + transfer.id)).status,
        404,
      );
      assert.ok(
        (await ack(a.socket, "transfer:cancel", { transferId: transfer.id }))
          .ok,
      );
      assert.ok(!c.events.some((e) => e.name.startsWith("transfer:")));
    },
  );
  await t.test(
    "simultaneous reverse send is rejected until the existing transfer ends",
    async () => {
      const own = (await h.upload(b, wav(777))).data.track;
      const incoming = waitEvent(b.socket, "transfer:incoming");
      await ack(a.socket, "transfer:request", payload());
      const transfer = await incoming;
      assert.equal(
        (
          await ack(b.socket, "transfer:request", {
            ...payload(),
            trackId: own.id,
          })
        ).ok,
        false,
      );
      assert.ok(
        (await ack(a.socket, "transfer:cancel", { transferId: transfer.id }))
          .ok,
      );
    },
  );
  await t.test(
    "lost playback ACK times out; saved receiver ownership remains valid",
    async () => {
      const incoming = waitEvent(b.socket, "transfer:incoming");
      await ack(a.socket, "transfer:request", payload());
      const transfer = await incoming;
      const saved = await ack(b.socket, "transfer:stored", {
        transferId: transfer.id,
      });
      assert.ok(saved.ok);
      const complete = await waitEvent(a.socket, "transfer:complete");
      assert.equal(complete.playbackStatus, "timeout");
      assert.equal((await h.fetchAs(b, saved.track.audioUrl)).status, 200);
      assert.ok(!a.events.some((e) => e.name === "transfer:handoff"));
      assert.equal(
        (
          await ack(b.socket, "transfer:playback", {
            transferId: transfer.id,
            success: true,
            currentTime: 0.2,
          })
        ).ok,
        false,
      );
    },
  );
  await t.test(
    "source deletion after authorization still permits a legitimate delivery",
    async () => {
      const other = (await h.upload(a, wav(888))).data.track;
      const incoming = waitEvent(b.socket, "transfer:incoming");
      await ack(a.socket, "transfer:request", {
        ...payload(),
        trackId: other.id,
      });
      const transfer = await incoming;
      assert.equal(
        (await h.fetchAs(a, "/api/tracks/" + other.id, { method: "DELETE" }))
          .status,
        200,
      );
      const saved = await ack(b.socket, "transfer:stored", {
        transferId: transfer.id,
      });
      assert.ok(saved.ok, saved.message);
      assert.equal((await h.fetchAs(b, saved.track.audioUrl)).status, 200);
      await ack(b.socket, "transfer:playback", {
        transferId: transfer.id,
        success: false,
        reason: "not-ready",
      });
    },
  );
  await t.test(
    "offline receiver is rejected; reconnect registers the same identity",
    async () => {
      b.socket.disconnect();
      await delay(20);
      assert.equal(
        (await ack(a.socket, "transfer:request", payload())).ok,
        false,
      );
      await h.connect(b);
      assert.equal(h.demo.pairings.view(b.session.device.id).id, pair.id);
      assert.equal(h.demo.devices.canReceive(b.session.device.id), false,
        "socket reconnection must require explicit receiver re-arming");
      assert.ok((await ack(b.socket, "device:ready", {audioReady:true})).ok);
    },
  );
  await t.test(
    "incomplete transfers are invalidated on restart; delivered songs persist",
    async () => {
      const incoming = waitEvent(b.socket, "transfer:incoming");
      await ack(a.socket, "transfer:request", payload());
      const pending = await incoming;
      const count = (await h.tracks(b)).length;
      await h.restart();
      assert.equal((await h.tracks(b)).length, count);
      const status = h.demo.transfers.status(pending.id, a.session.device.id);
      assert.equal(status.status, "failed");
      assert.equal(status.playbackStatus, "cancelled");
      assert.equal(
        h.demo.db
          .prepare("SELECT count(*) n FROM library_tracks WHERE visible=0")
          .get().n,
        0,
      );
      assert.deepEqual(h.demo.db.pragma("foreign_key_check"), []);
    },
  );
});

test("Blob journal recovery and live stream pins prevent premature collection", async (t) => {
  const h = await harness(t),
    a = await h.client("A");
  const track = (await h.upload(a)).data.track,
    row = h.demo.library.track(track.id, a.session.device.id),
    file = h.demo.storage.filePath(row);
  const release = h.demo.storage.pin(row.blob_id);
  await h.fetchAs(a, "/api/tracks/" + track.id, { method: "DELETE" });
  assert.ok(fs.existsSync(file));
  release();
  assert.ok(!fs.existsSync(file));
  release(); // idempotent release
  const repaired = (await h.upload(a, wav(880))).data.track,
    blob = h.demo.library.track(repaired.id, a.session.device.id);
  h.demo.db
    .prepare("UPDATE audio_blobs SET state='gc_pending' WHERE id=?")
    .run(blob.blob_id);
  await h.upload(a, wav(880));
  assert.equal((await h.fetchAs(a, repaired.audioUrl)).status, 200);
  const orphan = path.join(h.demo.storage.blobsDir, "a".repeat(64) + ".wav"),
    oldTemp = path.join(h.demo.storage.tmpDir, "old.part");
  fs.writeFileSync(orphan, wav());
  fs.writeFileSync(oldTemp, "incomplete");
  await h.restart();
  assert.ok(!fs.existsSync(orphan));
  assert.ok(!fs.existsSync(oldTemp));
  assert.equal((await h.fetchAs(a, repaired.audioUrl)).status, 200);
});

test("schema migration retains ownership and adds optional duration idempotently", async (t) => {
  const h = await harness(t),
    a = await h.client("A");
  const track = (await h.upload(a)).data.track;
  h.demo.db.exec(
    "ALTER TABLE library_tracks DROP COLUMN duration; PRAGMA user_version=1;",
  );
  await h.restart();
  assert.equal(h.demo.db.pragma("user_version", { simple: true }), 3);
  assert.equal((await h.tracks(a))[0].id, track.id);
  assert.equal((await h.tracks(a))[0].duration, null);
  await h.restart();
  assert.equal((await h.tracks(a)).length, 1);
});

test("admin inspection, SQLite backup and manual legacy claim preserve private source files", async (t) => {
  const h = await harness(t),
    a = await h.client("A"),
    b = await h.client("B");
  const legacyDir = path.join(h.dir, "legacy"),
    backupFile = path.join(h.dir, "backup.db");
  fs.mkdirSync(legacyDir);
  const source = path.join(legacyDir, "原曲.wav"),
    bytes = wav(1234);
  fs.writeFileSync(source, bytes);
  fs.writeFileSync(
    path.join(legacyDir, "broken.mp3"),
    "<html>not audio</html>",
  );
  const run = (args) =>
    execFileAsync(
      process.execPath,
      [path.join(__dirname, "..", "scripts", "admin.js"), ...args],
      { env: { ...process.env, FLICK_STORAGE_DIR: h.dir } },
    );
  await run(["claim-legacy", legacyDir, a.session.device.id]);
  await run(["claim-legacy", legacyDir, a.session.device.id]);
  assert.deepEqual(fs.readFileSync(source), bytes);
  assert.equal((await h.tracks(a)).length, 1);
  assert.equal((await h.tracks(b)).length, 0);
  assert.equal((await h.tracks(a))[0].displayName, "原曲.wav");
  const inspected = (await run(["inspect"])).stdout;
  assert.match(inspected, /原曲.wav/);
  assert.ok(!inspected.includes("flick_session"));
  assert.ok(!inspected.includes("csrf"));
  await run(["backup", backupFile]);
  const backup = new (require("better-sqlite3"))(backupFile, {
    readonly: true,
  });
  try {
    assert.equal(
      backup.prepare("SELECT count(*) n FROM library_tracks").get().n,
      1,
    );
    assert.deepEqual(backup.pragma("foreign_key_check"), []);
  } finally {
    backup.close();
  }
});
