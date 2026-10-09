"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { direction, singleLeft, attach } = require("../public/gesture");
const { clampTime, prepare, play } = require("../public/media");
const { OutgoingTransfer } = require("../public/transfer");
const { parseRange } = require("../server/libraryService");
const start = [
  { x: 250, y: 100 },
  { x: 270, y: 160 },
];
const end = (x1, x2, y1 = 0, y2 = 0) => [
  { x: 250 + x1, y: 100 + y1 },
  { x: 270 + x2, y: 160 + y2 },
];
for (const [name, points, ms, expected] of [
  ["left swipe", end(-130, -110), 300, "left"],
  ["right swipe", end(130, 110), 300, "right"],
  ["boundary accepted", end(-100, -100), 800, "left"],
  ["vertical rejected", end(-130, -130, 120, 120), 200, null],
  ["short rejected", end(-20, -20), 200, null],
  ["slow rejected", end(-150, -150), 801, null],
  ["stationary finger rejected", end(-220, 0), 300, null],
  ["opposite directions rejected", end(-200, 200), 300, null],
  ["opposite vertical offsets rejected", end(-120, -120, 100, -100), 300, null],
])
  test(name, () => assert.equal(direction(start, points, ms), expected));
test("one touch is rejected", () =>
  assert.equal(direction([start[0]], [end(-200, 0)[0]], 200), null));
for (const [label, dx, dy, ms, expected] of [
  ["single-left delete", -140, 0, 180, true],
  ["threshold inclusive", -105, 0, 1100, true],
  ["short left does not delete", -104, 0, 200, false],
  ["single right never deletes", 150, 0, 150, false],
  ["diagonal scroll never deletes", -130, 90, 150, false],
  ["vertical movement never deletes", -20, 150, 150, false],
  ["slow touch does not delete", -170, 0, 1101, false],
  ["negative elapsed is invalid", -170, 0, -1, false],
]) test(label, () => assert.equal(singleLeft({x:10,y:20},{x:10+dx,y:20+dy},ms),expected));
test("single swipe triggers confirmation only; adding a second finger transfers instead", async () => {
  const handlers = {}, actions = [], movements = [];
  let time = 0;
  const card = {
    addEventListener: (name, fn) => {handlers[name] = fn;},
    removeEventListener: () => {},
  };
  const attachCard = attach(card, (direction) => actions.push("send:" + direction), {
    clock: () => time,
    onDeleteSwipe: () => actions.push("delete-confirm"),
    move: (x, dragging, mode, armed) => movements.push({x, dragging, mode, armed}),
  });
  const touch = (id, x, y=40) => ({identifier:id,clientX:x,clientY:y});
  const event = (touches, changed = touches) => ({
    touches, changedTouches:changed, cancelable:true,
    preventDefault: () => {}, target: {closest: () => false},
  });
  handlers.touchstart(event([touch(1,195)]));
  time = 80;
  handlers.touchmove(event([touch(1,50)]));
  await new Promise((r) => setTimeout(r, 3));
  handlers.touchend(event([], [touch(1,50)]));
  assert.deepEqual(actions,["delete-confirm"]);
  time = 1000;
  handlers.touchstart(event([touch(1,240)]));
  handlers.touchstart(event([touch(1,240),touch(2,260,80)]));
  time = 1080;
  handlers.touchmove(event([touch(1,100),touch(2,120,80)]));
  handlers.touchend(event([], [touch(1,100),touch(2,120,80)]));
  assert.deepEqual(actions,["delete-confirm","send:left"]);
  assert.ok(movements.some((m) => m.mode === "single" && m.x < -50));
  attachCard();
});
test("touch identifiers, following, third-touch recovery, cancellation and controls", () => {
  const handlers = {},
    moves = [],
    calls = [];
  let now = 0,
    enabled = true;
  const card = {
    addEventListener: (name, fn) => {
      handlers[name] = fn;
    },
    removeEventListener() {},
  };
  const detach = attach(
    card,
    (d) => {
      calls.push(d);
      return true;
    },
    { clock: () => now, enabled: () => enabled, move: (x) => moves.push(x) },
  );
  const t = (id, x) => ({ identifier: id, clientX: x, clientY: id * 30 });
  const e = (touches, changed = touches, interactive = false) => ({
    touches,
    changedTouches: changed,
    cancelable: true,
    preventDefault() {},
    target: { closest: () => interactive },
  });
  handlers.touchstart(e([t(1, 260), t(2, 270)]));
  handlers.touchcancel(e([]));
  now = 200;
  handlers.touchend(e([], [t(1, 100), t(2, 100)]));
  assert.equal(calls.length, 0);
  handlers.touchstart(e([t(1, 260), t(2, 270)]));
  handlers.touchstart(e([t(1, 260), t(2, 270), t(3, 280)]));
  handlers.touchend(e([], [t(1, 100), t(2, 100), t(3, 100)]));
  now = 500;
  handlers.touchstart(e([t(1, 260), t(2, 270)]));
  now = 700;
  handlers.touchmove(e([t(2, 100), t(1, 100)]));
  handlers.touchend(e([t(1, 100)], [t(2, 100)]));
  handlers.touchend(e([], [t(1, 100)]));
  assert.deepEqual(calls, ["left"]);
  assert.ok(moves.some((x) => x < 0));
  now = 800;
  handlers.touchstart(e([t(1, 260), t(2, 270)]));
  handlers.touchend(e([], [t(1, 100), t(2, 100)]));
  assert.equal(calls.length, 1);
  now = 2000;
  handlers.touchstart(e([t(1, 100), t(2, 100)], undefined, true));
  handlers.touchend(e([], [t(1, 260), t(2, 270)]));
  assert.equal(calls.length, 1);
  enabled = false;
  handlers.touchstart(e([t(1, 100), t(2, 100)]));
  handlers.touchend(e([], [t(1, 260), t(2, 270)]));
  assert.equal(calls.length, 1);
  detach();
});
class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.src = "/api/tracks/song/stream";
    this.currentTime = 3;
    this.duration = 10;
    this.readyState = 1;
    this.paused = false;
    this.ended = false;
    this.seeking = false;
    this.pauses = 0;
  }
  getAttribute() {
    return this.src;
  }
  load() {
    this.readyState = 1;
  }
  pause() {
    this.paused = true;
    this.pauses++;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
}
function outgoing() {
  const audio = new FakeAudio(),
    emitted = [],
    notices = [],
    saved = [];
  const snapshot = {
    trackId: "song",
    generation: 1,
    src: audio.src,
    currentTime: 3,
    isPlaying: true,
  };
  const player = {
    audio,
    snapshot: () => ({ ...snapshot, isPlaying: !audio.paused }),
  };
  const socket = {
    connected: true,
    timeout() {
      return this;
    },
    emit(...args) {
      emitted.push(args);
    },
  };
  const coordinator = new OutgoingTransfer({
    socket,
    player,
    notify: (...a) => notices.push(a),
    delivered: (...a) => saved.push(a),
    makeId: () => "request-key",
    timeout: 40,
  });
  const state = {
      deviceRegistered: true,
      primary: true,
      pairing: { id: "pair", peer: { online: true } },
    },
    track = { id: "song", displayName: "Song" };
  const event = {
    id: "transfer",
    requestKey: "request-key",
    senderTrackId: "song",
    status: "delivered",
    playbackStatus: "awaiting",
  };
  return {
    audio,
    emitted,
    notices,
    saved,
    snapshot,
    socket,
    coordinator,
    state,
    track,
    event,
  };
}
test("file delivery never pauses; only playback success pauses the matching player", () => {
  const f = outgoing();
  assert.ok(f.coordinator.request(f.track, "left", f.state));
  f.emitted[0][2](null, { ok: true, transfer: { id: "transfer" } });
  assert.equal(f.audio.pauses, 0);
  f.coordinator.saved(f.event);
  assert.equal(f.audio.pauses, 0);
  assert.equal(f.saved.length, 1);
  assert.equal(
    f.coordinator.handoff({ ...f.event, playbackStatus: "playing" }),
    true,
  );
  assert.equal(f.audio.pauses, 1);
  assert.equal(
    f.coordinator.handoff({ ...f.event, playbackStatus: "playing" }),
    false,
  );
  assert.equal(f.audio.pauses, 1);
});
for (const reason of ["blocked", "busy", "not-ready", "timeout"])
  test(reason + " keeps A playing after successful file delivery", () => {
    const f = outgoing();
    f.coordinator.request(f.track, "right", f.state);
    f.coordinator.saved(f.event);
    f.coordinator.complete({
      ...f.event,
      status: "completed",
      playbackStatus: reason,
    });
    assert.equal(f.audio.pauses, 0);
    assert.equal(f.audio.paused, false);
  });
test("non-playing song sends its own position zero without stopping the current song", () => {
  const f = outgoing();
  f.coordinator.request(
    { id: "different", displayName: "Other" },
    "right",
    f.state,
  );
  assert.equal(f.emitted[0][1].currentTime, 0);
  assert.equal(f.emitted[0][1].isPlaying, false);
  f.coordinator.clear();
});
test("unpaired, unregistered, passive tab, offline and duplicate triggers are blocked", () => {
  const f = outgoing();
  assert.equal(
    f.coordinator.request(f.track, "left", { ...f.state, pairing: null }),
    false,
  );
  assert.equal(
    f.coordinator.request(f.track, "left", {
      ...f.state,
      deviceRegistered: false,
    }),
    false,
  );
  assert.equal(
    f.coordinator.request(f.track, "left", { ...f.state, primary: false }),
    false,
  );
  f.socket.connected = false;
  assert.equal(f.coordinator.request(f.track, "left", f.state), false);
  f.socket.connected = true;
  f.coordinator.request(f.track, "left", f.state);
  assert.equal(f.coordinator.request(f.track, "left", f.state), false);
  assert.equal(f.emitted.length, 1);
  f.coordinator.clear();
});
test("new playback generation and stale ACK cannot pause a different playback", () => {
  const f = outgoing();
  f.coordinator.request(f.track, "left", f.state);
  f.coordinator.saved(f.event);
  f.snapshot.generation++;
  assert.equal(
    f.coordinator.handoff({ ...f.event, playbackStatus: "playing" }),
    false,
  );
  assert.equal(f.audio.pauses, 0);
});
test("timeout and disconnect do not pause A; late callback cannot revive the transfer", async () => {
  const f = outgoing();
  f.coordinator.request(f.track, "left", f.state);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.audio.pauses, 0);
  assert.equal(f.coordinator.pending, null);
  f.emitted[0][2](null, { ok: true, transfer: { id: "transfer" } });
  assert.equal(f.coordinator.pending, null);
  f.coordinator.request(f.track, "left", f.state);
  f.socket.connected = false;
  f.coordinator.cancel("disconnect");
  assert.equal(f.audio.pauses, 0);
});
test("metadata is awaited and end-of-track seeks remain finite", async () => {
  const a = new FakeAudio();
  a.readyState = 0;
  a.duration = NaN;
  const pending = prepare(a, a.src, 7, new AbortController().signal);
  assert.equal(a.currentTime, 3);
  a.readyState = 1;
  a.duration = 10;
  a.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(await pending, 7);
  for (const duration of [0.02, 0.1, 1, 120])
    for (const time of [
      -1,
      0,
      duration - 0.01,
      duration,
      duration + 100,
      Infinity,
      NaN,
    ]) {
      const target = clampTime(time, duration);
      assert.ok(target >= 0 && target < duration);
    }
  assert.throws(() => clampTime(1, 0));
});
test("missing audio, autoplay rejection and cancellation propagate without success", async () => {
  const a = new FakeAudio();
  a.readyState = 0;
  a.duration = NaN;
  const pending = prepare(a, a.src, 7, new AbortController().signal);
  a.dispatchEvent(new Event("error"));
  await assert.rejects(pending, /unavailable/);
  a.play = () =>
    Promise.reject(
      Object.assign(new Error("Blocked"), { name: "NotAllowedError" }),
    );
  await assert.rejects(play(a), { name: "NotAllowedError" });
  a.play = () => new Promise(() => {});
  const c = new AbortController(),
    p = play(a, c.signal);
  c.abort();
  await assert.rejects(p, /cancelled/);
});
test("Range parsing supports open, suffix, bounded and rejects invalid ranges", () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-999", 100), { start: 90, end: 99 });
  for (const value of [
    "bytes=100-",
    "bytes=9-2",
    "bytes=-0",
    "bytes=0-1,3-4",
    "bytes=",
    "none",
    "bytes=99999999999999999999-",
  ])
    assert.throws(() => parseRange(value, 100), { status: 416 });
});
