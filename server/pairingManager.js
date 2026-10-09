"use strict";
const { randomUUID } = require("node:crypto");
const { AppError, requireId } = require("./errors");
function createPairings(
  db,
  devices,
  { requestTimeout = 30000, offlineGrace = 5000, onDisconnect = () => {} } = {},
) {
  const offlineTimers = new Map();
  function row(id) {
    return db
      .prepare(
        "SELECT p.* FROM pair_members m JOIN pairings p ON p.id=m.pair_id WHERE m.device_id=? AND p.status='active'",
      )
      .get(id);
  }
  function view(id) {
    const pair = row(id);
    if (!pair) return null;
    const peer = devices.device(pair.a_id === id ? pair.b_id : pair.a_id);
    return {
      id: pair.id,
      peer: { ...peer, online: devices.isOnline(peer.id) },
      status: devices.isOnline(peer.id) ? "paired" : "peer-offline",
    };
  }
  function requestView(r) {
    return {
      id: r.id,
      requester: devices.device(r.requester_id),
      target: devices.device(r.target_id),
      expiresAt: r.expires_at,
    };
  }
  function requests(id) {
    const rows = db
      .prepare(
        "SELECT * FROM pairing_requests WHERE status='pending' AND expires_at>? AND (requester_id=? OR target_id=?)",
      )
      .all(Date.now(), id, id);
    return {
      outgoing: rows.find((r) => r.requester_id === id)
        ? requestView(rows.find((r) => r.requester_id === id))
        : null,
      incoming: rows.filter((r) => r.target_id === id).map(requestView),
    };
  }
  function request(from, target) {
    requireId(target);
    if (target === from) throw new AppError("不能连接本设备。");
    if (!devices.isOnline(target)) throw new AppError("目标设备已离线。");
    if (row(from) || row(target))
      throw new AppError("设备忙碌：请先断开当前配对。");
    expire();
    const existing = db
      .prepare(
        "SELECT * FROM pairing_requests WHERE status='pending' AND requester_id=?",
      )
      .get(from);
    if (existing) {
      if (existing.target_id === target) return requestView(existing);
      throw new AppError("已有连接请求等待确认。");
    }
    const reciprocal = db
      .prepare(
        "SELECT * FROM pairing_requests WHERE status='pending' AND requester_id=? AND target_id=?",
      )
      .get(target, from);
    if (reciprocal)
      throw new AppError("对方已经向你发出请求，请接受或拒绝该请求。");
    const id = randomUUID(),
      now = Date.now();
    db.prepare(
      "INSERT INTO pairing_requests(id,requester_id,target_id,status,created_at,expires_at) VALUES(?,?,?,'pending',?,?)",
    ).run(id, from, target, now, now + requestTimeout);
    const r = requestView(
      db.prepare("SELECT * FROM pairing_requests WHERE id=?").get(id),
    );
    devices.to(target, "pair:incoming", r);
    devices.to(from, "pair:requested", r);
    devices.states();
    return r;
  }
  function accept(target, requestId) {
    requireId(requestId);
    expire();
    let affected = [];
    const pair = db.transaction(() => {
      const r = db
        .prepare("SELECT * FROM pairing_requests WHERE id=? AND target_id=?")
        .get(requestId, target);
      if (!r) throw new AppError("连接请求不存在。", 404);
      if (r.status === "accepted") {
        const p = row(target);
        if (p?.id === r.pair_id) return p;
      }
      if (r.status !== "pending")
        throw new AppError("连接请求已过期或处理完毕。");
      if (!devices.isOnline(r.requester_id) || !devices.isOnline(target))
        throw new AppError("目标设备已离线。");
      if (row(target) || row(r.requester_id))
        throw new AppError("设备忙碌：已有其他配对。");
      const id = randomUUID(),
        now = Date.now();
      db.prepare(
        "INSERT INTO pairings(id,a_id,b_id,status,created_at) VALUES(?,?,?,'active',?)",
      ).run(id, r.requester_id, target, now);
      db.prepare("INSERT INTO pair_members VALUES(?,?)").run(
        r.requester_id,
        id,
      );
      db.prepare("INSERT INTO pair_members VALUES(?,?)").run(target, id);
      db.prepare(
        "UPDATE pairing_requests SET status='accepted',pair_id=? WHERE id=?",
      ).run(id, requestId);
      affected = db
        .prepare(
          "SELECT * FROM pairing_requests WHERE status='pending' AND (requester_id IN (?,?) OR target_id IN (?,?))",
        )
        .all(target, r.requester_id, target, r.requester_id);
      for (const other of affected)
        db.prepare(
          "UPDATE pairing_requests SET status='cancelled' WHERE id=?",
        ).run(other.id);
      return db.prepare("SELECT * FROM pairings WHERE id=?").get(id);
    })();
    for (const r of affected) {
      devices.to(r.requester_id, "pair:cancelled", {
        requestId: r.id,
        message: "对方已建立其他配对。",
      });
      devices.to(r.target_id, "pair:cancelled", {
        requestId: r.id,
        message: "请求已取消。",
      });
    }
    devices.to(pair.a_id, "pair:established", view(pair.a_id));
    devices.to(pair.b_id, "pair:established", view(pair.b_id));
    devices.publish();
    return view(target);
  }
  function reject(target, requestId) {
    requireId(requestId);
    const r = db
      .prepare(
        "SELECT * FROM pairing_requests WHERE id=? AND target_id=? AND status='pending'",
      )
      .get(requestId, target);
    if (!r) throw new AppError("连接请求已过期或处理完毕。");
    db.prepare("UPDATE pairing_requests SET status='rejected' WHERE id=?").run(
      requestId,
    );
    devices.to(r.requester_id, "pair:rejected", {
      requestId,
      message: "对方拒绝了连接请求。",
    });
    devices.states();
  }
  function disconnect(id, reason = "已主动断开配对。") {
    const p = row(id);
    if (!p) return;
    db.transaction(() => {
      db.prepare("DELETE FROM pair_members WHERE pair_id=?").run(p.id);
      db.prepare(
        "UPDATE pairings SET status='disconnected',ended_at=?,reason=? WHERE id=?",
      ).run(Date.now(), reason, p.id);
    })();
    onDisconnect(p.id, reason);
    devices.to(p.a_id, "pair:disconnected", { pairId: p.id, message: reason });
    devices.to(p.b_id, "pair:disconnected", { pairId: p.id, message: reason });
    devices.publish();
  }
  function expire() {
    const expired = db
      .prepare(
        "SELECT * FROM pairing_requests WHERE status='pending' AND expires_at<=?",
      )
      .all(Date.now());
    for (const r of expired) {
      db.prepare("UPDATE pairing_requests SET status='expired' WHERE id=?").run(
        r.id,
      );
      const payload = { requestId: r.id, message: "连接请求已过期。" };
      devices.to(r.requester_id, "pair:expired", payload);
      devices.to(r.target_id, "pair:expired", payload);
    }
    if (expired.length) devices.states();
  }
  function online(id) {
    clearTimeout(offlineTimers.get(id));
    offlineTimers.delete(id);
  }
  function offline(id) {
    for (const r of db
      .prepare(
        "SELECT * FROM pairing_requests WHERE status='pending' AND (requester_id=? OR target_id=?)",
      )
      .all(id, id)) {
      db.prepare("UPDATE pairing_requests SET status='expired' WHERE id=?").run(
        r.id,
      );
      devices.to(r.requester_id, "pair:expired", {
        requestId: r.id,
        message: "目标设备已离线。",
      });
      devices.to(r.target_id, "pair:expired", {
        requestId: r.id,
        message: "对方已离线。",
      });
    }
    online(id);
    offlineTimers.set(
      id,
      setTimeout(() => {
        offlineTimers.delete(id);
        if (!devices.isOnline(id)) disconnect(id, "对方离线，配对已断开。");
      }, offlineGrace),
    );
  }
  function close() {
    for (const timer of offlineTimers.values()) clearTimeout(timer);
    offlineTimers.clear();
  }
  devices.hooks.pairView = view;
  devices.hooks.requests = requests;
  devices.hooks.online = online;
  devices.hooks.offline = offline;
  return { row, view, request, accept, reject, disconnect, expire, close };
}
module.exports = { createPairings };
