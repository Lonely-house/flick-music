"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { harness, waitEvent, wav } = require("./helpers");

test("shared soundpack syncs to both devices without becoming a private music track", async (t) => {
  const h = await harness(t);
  const a = await h.client("手机 A");
  const b = await h.client("手机 B");
  const before = await (await h.fetchAs(a, "/api/sounds")).json();
  assert.equal(before.sounds.paired, null);
  assert.equal((await h.tracks(a)).length, 0);
  const body = new FormData();
  body.append("audio", new Blob([wav(440, 0.3)], { type: "audio/wav" }), "success.wav");
  const notice = waitEvent(b.socket, "sounds:updated");
  const posted = await h.fetchAs(a, "/api/sounds/paired", { method: "POST", body });
  assert.equal(posted.status, 200);
  const event = await notice;
  assert.equal(event.kind, "paired");
  const listed = (await (await h.fetchAs(b, "/api/sounds")).json()).sounds;
  assert.equal(listed.paired.name, "success.wav");
  const file = await h.fetchAs(b, listed.paired.url);
  assert.equal(file.status, 200);
  assert.equal((await file.arrayBuffer()).byteLength, wav(440, 0.3).length);
  assert.equal((await h.tracks(a)).length, 0);
  assert.equal((await h.tracks(b)).length, 0);
  await h.restart();
  const persisted = await h.fetchAs(b, "/api/sounds");
  assert.equal((await persisted.json()).sounds.paired.name, "success.wav");
  const cleared = await h.fetchAs(a, "/api/sounds/paired", { method: "DELETE" });
  assert.equal(cleared.status, 200);
  assert.equal((await (await h.fetchAs(b, "/api/sounds")).json()).sounds.paired, null);
});

test("soundpack media is session-protected and updates require CSRF", async (t) => {
  const h = await harness(t);
  const a = await h.client("手机 A");
  const anon = await fetch(h.base + "/api/sounds");
  assert.equal(anon.status, 401);
  const file = new FormData();
  file.append("audio", new Blob([wav(330, 0.1)], { type: "audio/wav" }), "one.wav");
  const withoutCsrf = await fetch(h.base + "/api/sounds/paired", {
    method: "POST", headers: { Cookie: a.cookie }, body: file,
  });
  assert.equal(withoutCsrf.status, 403);
  const invalid = new FormData();
  invalid.append("audio", new Blob([Buffer.from("not really an audio")]), "fake.wav");
  const rejected = await h.fetchAs(a, "/api/sounds/paired", { method: "POST", body: invalid });
  assert.equal(rejected.status, 415);
  assert.equal((await (await h.fetchAs(a, "/api/sounds")).json()).sounds.paired, null);
  const body = new FormData();
  body.append("audio", new Blob([wav()]), "cue.wav");
  const saved = await h.fetchAs(a, "/api/sounds/paired", { method: "POST", body });
  assert.equal(saved.status, 200);
  const publicFile = await fetch(h.base + "/api/sounds/paired/file");
  assert.equal(publicFile.status, 401);
  const invalidKind = await h.fetchAs(a, "/api/sounds/not-a-kind", { method: "DELETE" });
  assert.equal(invalidKind.status, 404);
});
