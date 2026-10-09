"use strict";
const { AppError } = require("./errors");
function createDevices(io, db, auth) {
  const online = new Map(),
    hooks = {};
  const primary = (id) => [...(online.get(id)?.values() || [])].at(-1) || null;
  const isOnline = (id) => !!online.get(id)?.size;
  const device = (id) =>
    db.prepare("SELECT id,nickname FROM devices WHERE id=?").get(id);
  function to(id, event, data) {
    io.to("device:" + id).emit(event, data);
  }
  function snapshot(socket) {
    const id = socket.data.deviceId;
    return {
      device: device(id),
      deviceRegistered: true,
      primary: primary(id)?.id === socket.id,
      audioReady: socket.data.audioReady === true,
      pairing: hooks.pairView?.(id) || null,
      requests: hooks.requests?.(id) || { outgoing: null, incoming: [] },
    };
  }
  function states() {
    for (const sockets of online.values())
      for (const socket of sockets.values())
        socket.emit("device:state", snapshot(socket));
  }
  function list() {
    return db
      .prepare(
        "SELECT id,nickname,last_seen_at FROM devices ORDER BY last_seen_at DESC LIMIT 100",
      )
      .all()
      .map((d) => {
        const paired = !!db
          .prepare("SELECT 1 FROM pair_members WHERE device_id=?")
          .get(d.id);
        return {
          id: d.id,
          nickname: d.nickname,
          online: isOnline(d.id),
          paired,
          available: isOnline(d.id) && !paired,
          audioReady: primary(d.id)?.data.audioReady === true,
        };
      });
  }
  function publish() {
    io.to("discovery").emit("devices:updated", list());
    states();
  }
  function guard(socket, requirePrimary = true) {
    auth.verifySocket(socket);
    if (
      !socket.data.registered ||
      !online.get(socket.data.deviceId)?.has(socket.id)
    )
      throw new AppError("Device is not registered. Reconnect and retry.");
    if (requirePrimary && primary(socket.data.deviceId)?.id !== socket.id)
      throw new AppError("另一标签页正在控制此设备，请在该标签页操作。");
    return socket.data.deviceId;
  }
  function register(socket, data = {}) {
    auth.verifySocket(socket);
    const id = socket.data.deviceId,
      old = primary(id);
    if (!online.has(id)) online.set(id, new Map());
    socket.data.registered = true;
    // Readiness is opt-in and tied to the active controlling Socket.
    // Never trust device:register({audioReady:true}); only the separate
    // device:ready action can enable incoming file delivery.
    socket.data.audioReady = false;
    online.get(id).delete(socket.id);
    online.get(id).set(socket.id, socket);
    socket.join("device:" + id);
    socket.join("discovery");
    db.prepare("UPDATE devices SET last_seen_at=? WHERE id=?").run(
      Date.now(),
      id,
    );
    if (old?.id !== socket.id) hooks.primaryChanged?.(id);
    hooks.online?.(id);
    publish();
    return snapshot(socket);
  }
  function disconnect(socket) {
    if (!socket.data.registered) return;
    const id = socket.data.deviceId,
      sockets = online.get(id),
      old = primary(id);
    if (!sockets?.delete(socket.id)) return;
    if (!sockets.size) online.delete(id);
    db.prepare("UPDATE devices SET last_seen_at=? WHERE id=?").run(
      Date.now(),
      id,
    );
    if (old?.id !== primary(id)?.id) hooks.primaryChanged?.(id);
    if (!isOnline(id)) hooks.offline?.(id);
    publish();
  }
  function ready(socket, value) {
    const id = guard(socket);
    socket.data.audioReady = value === true;
    publish();
    return snapshot(socket);
  }
  return {
    primary,
    isOnline,
    canReceive: (id) => {
      const active = primary(id);
      return !!active && active.data.registered === true &&
        active.data.audioReady === true;
    },
    device,
    to,
    snapshot,
    states,
    list,
    publish,
    guard,
    register,
    disconnect,
    ready,
    hooks,
    online,
  };
}
module.exports = { createDevices };
