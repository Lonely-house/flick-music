"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { harness, ack, waitEvent, delay, wav } = require("./helpers");
test("three devices, confirmed pairing and bidirectional private library delivery", async (t) => {
  const h = await harness(t, {
    transferTimeout: 240,
    requestTimeout: 160,
    offlineGrace: 180,
  });
  const a = await h.client("手机 A"),
    b = await h.client("手机 B"),
    c = await h.client("手机 C");
  await t.test(
    "three stable server identities register without fixed roles",
    async () => {
      assert.equal(new Set([a, b, c].map((d) => d.session.device.id)).size, 3);
      assert.ok([a, b, c].every((d) => d.state.deviceRegistered));
      assert.equal(h.demo.devices.list().filter((d) => d.online).length, 3);
      const r = await h.fetchAs(a, "/api/session");
      assert.equal((await r.json()).device.id, a.session.device.id);
    },
  );
  await t.test(
    "request is directed, rejection does not create a pair",
    async () => {
      const r = await ack(b.socket, "pair:request", {
        targetId: a.session.device.id,
      });
      assert.ok(r.ok);
      assert.equal(h.demo.pairings.view(a.session.device.id), null);
      assert.equal(h.demo.pairings.view(b.session.device.id), null);
      assert.ok(a.events.some((e) => e.name === "pair:incoming"));
      assert.ok(!c.events.some((e) => e.name === "pair:incoming"));
      const rejected = waitEvent(b.socket, "pair:rejected");
      assert.ok(
        (await ack(a.socket, "pair:reject", { requestId: r.request.id })).ok,
      );
      await rejected;
      assert.equal(h.demo.pairings.view(b.session.device.id), null);
    },
  );
  await t.test("request expiration is explicit", async () => {
    const expired = waitEvent(b.socket, "pair:expired");
    assert.ok(
      (await ack(b.socket, "pair:request", { targetId: a.session.device.id }))
        .ok,
    );
    await expired;
    assert.equal(h.demo.pairings.view(b.session.device.id), null);
  });
  let pair;
  await t.test(
    "reciprocal requests, multiple invitations and duplicate accept are consistent",
    async () => {
      const r = await ack(b.socket, "pair:request", {
        targetId: a.session.device.id,
      });
      assert.ok(r.ok);
      const repeat = await ack(b.socket, "pair:request", {
        targetId: a.session.device.id,
      });
      assert.equal(repeat.request.id, r.request.id);
      assert.equal(
        (await ack(a.socket, "pair:request", { targetId: b.session.device.id }))
          .ok,
        false,
      );
      assert.ok(
        (await ack(c.socket, "pair:request", { targetId: a.session.device.id }))
          .ok,
      );
      const accepted = await ack(a.socket, "pair:accept", {
        requestId: r.request.id,
      });
      assert.ok(accepted.ok);
      pair = accepted.pairing;
      const repeated = await ack(a.socket, "pair:accept", {
        requestId: r.request.id,
      });
      assert.equal(repeated.pairing.id, pair.id);
      assert.equal(
        h.demo.db.prepare("SELECT count(*) n FROM pair_members").get().n,
        2,
      );
      assert.equal(
        (await ack(c.socket, "pair:request", { targetId: a.session.device.id }))
          .ok,
        false,
      );
      assert.ok(!c.events.some((e) => e.name === "pair:established"));
    },
  );
  let x, y;
  await t.test(
    "personal libraries isolate uploads and same names retain different content",
    async () => {
      x = (await h.upload(a, wav(440), "song.wav")).data.track;
      y = (await h.upload(b, wav(600), "song.wav")).data.track;
      assert.equal((await h.tracks(a)).length, 1);
      assert.equal((await h.tracks(b)).length, 1);
      assert.equal((await h.tracks(c)).length, 0);
      assert.equal((await h.fetchAs(b, x.audioUrl)).status, 404);
      assert.equal((await h.fetchAs(c, y.audioUrl)).status, 404);
      const duplicate = await h.upload(a, wav(440), "different-name.wav");
      assert.ok(duplicate.data.reused);
      assert.equal(duplicate.data.track.id, x.id);
      assert.equal(
        h.demo.db.prepare("SELECT count(*) n FROM audio_blobs").get().n,
        2,
      );
    },
  );
  const request = (track, direction = "left", playing = true) => ({
    requestKey: randomUUID(),
    pairId: pair.id,
    trackId: track.id,
    direction,
    isPlaying: playing,
    currentTime: playing ? 0.7 : 99,
  });
  await t.test("pairing alone cannot deliver: explicit receiver readiness is mandatory", async () => {
    const spoof = await ack(b.socket, "device:register", {audioReady: true});
    assert.ok(spoof.ok);
    assert.equal(spoof.audioReady, false,
      "client may not assert readiness through device registration");
    const denied = await ack(a.socket, "transfer:request", request(x));
    assert.equal(denied.ok, false);
    assert.match(denied.message, /尚未启用音频接收/);
    assert.equal((await h.tracks(b)).length, 1);
    assert.equal(h.demo.db.prepare("SELECT count(*) n FROM transfers").get().n, 0,
      "no hidden transfer metadata should be created on rejection");

    // B opts in, but A has not. A->B is now permitted, B->A is still denied.
    const receiverReady = await ack(b.socket, "device:ready", { audioReady: true });
    assert.ok(receiverReady.ok);
    assert.equal(receiverReady.audioReady, true);
    const reverseDenied = await ack(b.socket, "transfer:request",
      request(y, "right", false));
    assert.equal(reverseDenied.ok, false);
    assert.match(reverseDenied.message, /尚未启用音频接收/);

    const senderReady = await ack(a.socket, "device:ready", { audioReady: true });
    assert.ok(senderReady.ok);
    assert.equal(senderReady.audioReady, true);
  });
  let bx;
  await t.test(
    "file delivery acknowledgement cannot be confused with playback acknowledgement",
    async () => {
      const incoming = waitEvent(b.socket, "transfer:incoming"),
        payload = request(x);
      const r = await ack(a.socket, "transfer:request", payload);
      assert.ok(r.ok, r.message);
      const received = await incoming;
      assert.equal((await h.tracks(b)).length, 1); // pending metadata is not yet a visible library grant
      assert.ok(!c.events.some((e) => e.name === "transfer:incoming"));
      const delivered = waitEvent(a.socket, "transfer:delivered");
      const stored = await ack(b.socket, "transfer:stored", {
        transferId: received.id,
      });
      assert.ok(stored.ok, stored.message);
      bx = stored.track;
      assert.equal((await delivered).playbackStatus, "awaiting");
      assert.equal((await h.tracks(b)).length, 2);
      assert.equal((await h.fetchAs(b, bx.audioUrl)).status, 200);
      assert.equal((await h.fetchAs(b, x.audioUrl)).status, 404);
      const done = waitEvent(a.socket, "transfer:handoff");
      assert.ok(
        (
          await ack(b.socket, "transfer:playback", {
            transferId: received.id,
            success: true,
            currentTime: 0.7,
          })
        ).ok,
      );
      assert.equal((await done).playbackStatus, "playing");
      const replay = await ack(a.socket, "transfer:request", payload);
      assert.ok(replay.transfer.duplicate);
      assert.equal((await h.tracks(b)).length, 2);
      assert.equal(
        (
          await ack(b.socket, "transfer:playback", {
            transferId: received.id,
            success: true,
            currentTime: 0.7,
          })
        ).ok,
        false,
      );
    },
  );
  await t.test(
    "rightward reverse send of non-playing song copies ownership without autoplay",
    async () => {
      const incoming = waitEvent(a.socket, "transfer:incoming"),
        r = await ack(b.socket, "transfer:request", request(y, "right", false));
      assert.ok(r.ok);
      const received = await incoming;
      assert.equal(received.currentTime, 0);
      const saved = await ack(a.socket, "transfer:stored", {
        transferId: received.id,
      });
      assert.ok(saved.ok);
      assert.equal(saved.transfer.playbackStatus, "not-requested");
      assert.equal((await h.tracks(a)).length, 2);
      assert.equal((await h.tracks(b)).length, 2);
    },
  );
  await t.test(
    "already-owned content reuses metadata; autoplay failure still delivers",
    async () => {
      const incoming = waitEvent(b.socket, "transfer:incoming"),
        r = await ack(a.socket, "transfer:request", request(x));
      assert.ok(r.ok);
      const received = await incoming;
      const saved = await ack(b.socket, "transfer:stored", {
        transferId: received.id,
      });
      assert.equal(saved.track.id, bx.id);
      assert.ok(saved.transfer.reused);
      const complete = waitEvent(a.socket, "transfer:complete");
      assert.ok(
        (
          await ack(b.socket, "transfer:playback", {
            transferId: received.id,
            success: false,
            reason: "blocked",
          })
        ).ok,
      );
      assert.equal((await complete).playbackStatus, "blocked");
      assert.equal((await h.tracks(b)).length, 2);
    },
  );
  await t.test(
    "timeout, source deletion and live transfer references are safe",
    async () => {
      const extra = (await h.upload(a, wav(800), "temporary.wav")).data.track;
      const incoming = waitEvent(b.socket, "transfer:incoming");
      const sent = await ack(a.socket, "transfer:request", request(extra));
      assert.ok(sent.ok);
      const received = await incoming;
      const blob = h.demo.library.track(extra.id, a.session.device.id);
      const file = h.demo.storage.filePath(blob);
      assert.equal(
        (await h.fetchAs(a, "/api/tracks/" + extra.id, { method: "DELETE" }))
          .status,
        200,
      );
      assert.ok(fs.existsSync(file));
      const failed = waitEvent(a.socket, "transfer:failed");
      await failed;
      assert.ok(!fs.existsSync(file));
      assert.equal(
        (await ack(b.socket, "transfer:stored", { transferId: received.id }))
          .ok,
        false,
      );
    },
  );
  await t.test(
    "deleting A reference preserves B playback; final reference permits GC",
    async () => {
      const blob = h.demo.library.track(x.id, a.session.device.id),
        file = h.demo.storage.filePath(blob);
      assert.equal(
        (await h.fetchAs(a, "/api/tracks/" + x.id, { method: "DELETE" }))
          .status,
        200,
      );
      assert.equal((await h.fetchAs(b, bx.audioUrl)).status, 200);
      assert.ok(fs.existsSync(file));
      assert.equal(
        (await h.fetchAs(b, "/api/tracks/" + bx.id, { method: "DELETE" }))
          .status,
        200,
      );
      assert.ok(!fs.existsSync(file));
    },
  );
  await t.test(
    "a newer tab becomes primary; closing an old socket leaves the device online",
    async () => {
      const old = a.socket;
      await h.connect(a);
      await delay(20);
      assert.equal(h.demo.devices.primary(a.session.device.id).id, a.socket.id);
      old.disconnect();
      await delay(20);
      assert.ok(h.demo.devices.isOnline(a.session.device.id));
      assert.equal(h.demo.pairings.view(a.session.device.id).id, pair.id);
    },
  );
  await t.test(
    "reconnect re-registers and validates device-level pairing",
    async () => {
      const old = b.socket.id,
        connected = waitEvent(b.socket, "device:state");
      b.socket.io.engine.close();
      await connected;
      assert.notEqual(b.socket.id, old);
      assert.equal(h.demo.pairings.view(b.session.device.id).id, pair.id);
    },
  );
  await t.test(
    "manual disconnect permits a new pair; closing the peer expires it",
    async () => {
      assert.ok((await ack(a.socket, "pair:disconnect", {})).ok);
      assert.equal(h.demo.pairings.view(b.session.device.id), null);
      await h.pair(a, c);
      c.socket.disconnect();
      await delay(220);
      assert.equal(h.demo.pairings.view(a.session.device.id), null);
    },
  );
  await t.test(
    "restart preserves identity and private songs, but clears presence and active pairs",
    async () => {
      const before = await h.tracks(a);
      await h.restart();
      assert.equal(h.demo.devices.list().filter((d) => d.online).length, 0);
      assert.equal(
        h.demo.db.prepare("SELECT count(*) n FROM pair_members").get().n,
        0,
      );
      assert.deepEqual(
        (await h.tracks(a)).map((t) => t.id),
        before.map((t) => t.id),
      );
      assert.equal(
        (await (await h.fetchAs(a, "/api/session")).json()).device.id,
        a.session.device.id,
      );
      assert.equal(h.demo.db.pragma("foreign_key_check").length, 0);
    },
  );
});
