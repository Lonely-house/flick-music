"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { joinDecision, enableAudioV1 } = require("./fixtures/v1-registration");
test("V1 reproduction: a connected sender can be rejected because another browser owns the role", () => {
  const devices = new Map([
    ["old-socket", { role: "sender", deviceId: "old-device" }],
  ]);
  const response = joinDecision(devices, "new-socket", {
    role: "sender",
    deviceId: "new-device",
  });
  assert.equal(response.ok, false);
  assert.match(response.message, /role is already/);
});
test("V1 reproduction: audio readiness does not require a successful join", () => {
  const state = { joined: false, audioReady: false },
    events = [];
  assert.equal(
    enableAudioV1(
      state,
      { connected: true, emit: (...args) => events.push(args) },
      true,
    ),
    "Audio receiver ready",
  );
  assert.equal(state.audioReady, true);
  assert.equal(state.joined, false);
  assert.equal(events.length, 0);
});
