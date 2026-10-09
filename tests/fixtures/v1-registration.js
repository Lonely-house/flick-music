"use strict";
// Historical fixture copied from V1 registration decisions. Never imported by V2 runtime.
function joinDecision(devices, socketId, data) {
  const occupied = [...devices.entries()].find(
    ([id, d]) =>
      id !== socketId && d.role === data.role && d.deviceId !== data.deviceId,
  );
  if (occupied)
    return {
      ok: false,
      message: "This role is already in use. Choose the other role.",
    };
  devices.set(socketId, { deviceId: data.deviceId, role: data.role });
  return { ok: true };
}
function enableAudioV1(state, socket, playSucceeded) {
  if (!playSucceeded) return;
  state.audioReady = true;
  if (socket.connected && state.joined)
    socket.emit("device-status", { audioReady: true });
  return "Audio receiver ready";
}
module.exports = { joinDecision, enableAudioV1 };
