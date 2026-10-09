"use strict";
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { AppError, requireObject, requireId } = require("./errors");
function createTransfers(
  db,
  devices,
  pairings,
  library,
  storage,
  { timeout = 15000 } = {},
) {
  function row(id) {
    requireId(id);
    return db.prepare("SELECT * FROM transfers WHERE id=?").get(id);
  }
  function present(t) {
    return {
      id: t.id,
      requestKey: t.request_key,
      pairId: t.pair_id,
      senderTrackId: t.sender_track_id,
      receiverTrackId: t.receiver_track_id,
      status: t.status,
      playbackStatus: t.playback_status,
      currentTime: t.current_time,
      isPlaying: !!t.is_playing,
      direction: t.direction,
      interaction: t.interaction === 'motion' ? 'motion' : 'swipe',
      expiresAt: t.expires_at,
      message: t.message,
      reused: !t.created_receiver_track,
    };
  }
  function notify(t, event) {
    devices.to(t.sender_id, event, present(t));
  }
  function finish(id, playback, message, successful = false) {
    const t = row(id);
    if (!t || !["offered", "delivered"].includes(t.status)) return t;
    if (t.status === "offered") {
      db.transaction(() => {
        db.prepare(
          "UPDATE transfers SET status='failed',playback_status=?,completed_at=?,message=? WHERE id=?",
        ).run(playback, Date.now(), message, id);
        if (t.created_receiver_track)
          db.prepare("DELETE FROM library_tracks WHERE id=? AND visible=0").run(
            t.receiver_track_id,
          );
      })();
    } else
      db.prepare(
        "UPDATE transfers SET status='completed',playback_status=?,completed_at=?,message=? WHERE id=?",
      ).run(playback, Date.now(), message, id);
    const final = row(id);
    notify(
      final,
      final.status === "failed"
        ? "transfer:failed"
        : successful
          ? "transfer:handoff"
          : "transfer:complete",
    );
    if (
      !successful &&
      (t.status === "offered" || ["timeout", "cancelled"].includes(playback))
    )
      devices.to(t.receiver_id, "transfer:cancelled", present(final));
    storage.collect();
    return final;
  }
  function request(socket, data) {
    requireObject(data);
    const senderId = devices.guard(socket);
    requireId(data.requestKey);
    requireId(data.trackId);
    requireId(data.pairId);
    if (!["left", "right"].includes(data.direction))
      throw new AppError("Invalid swipe direction");
    if (data.interaction !== undefined && !["motion", "swipe"].includes(data.interaction))
      throw new AppError("Invalid transfer interaction");
    const currentTime = data.isPlaying === true ? data.currentTime : 0;
    if (
      !Number.isFinite(currentTime) ||
      currentTime < 0 ||
      currentTime > 8640000
    )
      throw new AppError("Invalid playback position");
    const pair = pairings.row(senderId);
    if (!pair || pair.id !== data.pairId)
      throw new AppError("请先与另一台设备完成配对。");
    const receiverId = pair.a_id === senderId ? pair.b_id : pair.a_id;
    const receiverSocket = devices.primary(receiverId);
    if (!receiverSocket)
      throw new AppError("对方设备已离线，当前音乐继续播放。");
    // Pairing permits negotiation; receiving music requires a separate,
    // explicit opt-in on the CURRENT receiver control socket. This check is
    // before allocating an invisible receiver library record.
    if (!devices.canReceive(receiverId))
      throw new AppError("对方尚未启用音频接收。请对方点击「启用音频接收」后重试。", 409);
    const old = db
      .prepare("SELECT * FROM transfers WHERE sender_id=? AND request_key=?")
      .get(senderId, data.requestKey);
    if (old) {
      if (old.pair_id !== pair.id || old.sender_track_id !== data.trackId)
        throw new AppError("Idempotency key does not match this transfer");
      return { ...present(old), duplicate: true };
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM transfers WHERE status IN ('offered','delivered') AND (sender_id IN (?,?) OR receiver_id IN (?,?))",
        )
        .get(senderId, receiverId, senderId, receiverId)
    )
      throw new AppError("当前有传输进行中，请稍后再试。");
    const source = library.track(data.trackId, senderId);
    if (!fs.existsSync(storage.filePath(source)))
      throw new AppError("音频文件不存在，请重新上传。", 404);
    const id = randomUUID(),
      now = Date.now();
    const t = db.transaction(() => {
      let target = db
        .prepare(
          "SELECT * FROM library_tracks WHERE owner_device_id=? AND blob_id=?",
        )
        .get(receiverId, source.blob_id);
      const created = !target;
      if (!target) {
        target = { id: randomUUID() };
        db.prepare(
          "INSERT INTO library_tracks(id,owner_device_id,blob_id,display_name,original_filename,source_device_id,visible,created_at) VALUES(?,?,?,?,?,?,0,?)",
        ).run(
          target.id,
          receiverId,
          source.blob_id,
          source.display_name,
          source.original_filename,
          senderId,
          now,
        );
      }
      db.prepare(
        `INSERT INTO transfers(id,request_key,pair_id,sender_id,receiver_id,sender_track_id,receiver_track_id,blob_id,track_name,status,playback_status,current_time,is_playing,direction,interaction,sender_socket_id,receiver_socket_id,created_receiver_track,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,'offered',?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        data.requestKey,
        pair.id,
        senderId,
        receiverId,
        source.id,
        target.id,
        source.blob_id,
        source.display_name,
        data.isPlaying === true ? "awaiting" : "not-requested",
        currentTime,
        data.isPlaying === true ? 1 : 0,
        data.direction,
        data.interaction === "motion" ? "motion" : "swipe",
        socket.id,
        receiverSocket.id,
        created ? 1 : 0,
        now,
        now + timeout,
      );
      return row(id);
    })();
    receiverSocket.emit("transfer:incoming", {
      ...present(t),
      trackName: source.display_name,
      sender: devices.device(senderId),
      timeout,
    });
    return present(t);
  }
  function stored(socket, data) {
    requireObject(data);
    const receiverId = devices.guard(socket),
      t = row(data.transferId);
    if (
      !t ||
      t.receiver_id !== receiverId ||
      t.receiver_socket_id !== socket.id
    )
      throw new AppError("Transfer is not authorized for this connection", 403);
    if (!devices.canReceive(receiverId))
      throw new AppError("音频接收权限未启用，本次文件不能保存。", 409);
    if (t.status !== "offered") {
      if (["delivered", "completed"].includes(t.status))
        return {
          transfer: present(t),
          track: library.present(
            library.track(t.receiver_track_id, receiverId),
          ),
          duplicate: true,
        };
      throw new AppError("Transfer expired");
    }
    if (
      t.expires_at <= Date.now() ||
      pairings.row(receiverId)?.id !== t.pair_id
    ) {
      finish(t.id, "cancelled", "配对或传输已过期。");
      throw new AppError("Transfer expired");
    }
    db.transaction(() => {
      db.prepare(
        "UPDATE library_tracks SET visible=1 WHERE id=? AND owner_device_id=?",
      ).run(t.receiver_track_id, receiverId);
      db.prepare(
        "UPDATE transfers SET status='delivered',delivered_at=? WHERE id=?",
      ).run(Date.now(), t.id);
    })();
    const delivered = row(t.id),
      track = library.present(library.track(t.receiver_track_id, receiverId));
    devices.to(receiverId, "library:changed", { addedId: track.id });
    notify(delivered, "transfer:delivered");
    if (!t.is_playing)
      finish(t.id, "not-requested", "歌曲已添加到对方的私人曲库。");
    return { transfer: present(row(t.id)), track };
  }
  function playback(socket, data) {
    requireObject(data);
    const receiverId = devices.guard(socket),
      t = row(data.transferId);
    if (
      !t ||
      t.receiver_id !== receiverId ||
      t.receiver_socket_id !== socket.id ||
      t.status !== "delivered" ||
      t.expires_at <= Date.now()
    )
      throw new AppError(
        "Playback acknowledgement expired or unauthorized",
        403,
      );
    if (
      pairings.row(receiverId)?.id !== t.pair_id ||
      !devices.isOnline(t.sender_id)
    ) {
      finish(t.id, "cancelled", "配对已断开，发送端继续播放。");
      throw new AppError("Pair is no longer active");
    }
    if (data.success === true) {
      library.track(t.receiver_track_id, receiverId);
      if (
        !t.is_playing ||
        !Number.isFinite(data.currentTime) ||
        data.currentTime < 0
      )
        throw new AppError("Invalid playback acknowledgement");
      return present(finish(t.id, "playing", "播放接力成功。", true));
    }
    const reason = ["blocked", "busy", "not-ready", "failed"].includes(
      data.reason,
    )
      ? data.reason
      : "failed";
    return present(
      finish(t.id, reason, "文件已发送；对方未自动播放，当前设备继续播放。"),
    );
  }
  function cancel(socket, data) {
    const senderId = devices.guard(socket, false),
      t = row(data?.transferId);
    if (!t || t.sender_id !== senderId)
      throw new AppError("Transfer not found", 404);
    return present(
      finish(t.id, "cancelled", "播放接力已取消；已交付的歌曲保留。") || t,
    );
  }
  function expire() {
    for (const t of db
      .prepare(
        "SELECT * FROM transfers WHERE status IN ('offered','delivered') AND expires_at<=?",
      )
      .all(Date.now()))
      finish(
        t.id,
        "timeout",
        t.status === "offered"
          ? "传输超时，当前音乐继续播放。"
          : "文件已发送；播放确认超时，当前设备继续播放。",
      );
  }
  function cancelDevice(id, message) {
    for (const t of db
      .prepare(
        "SELECT * FROM transfers WHERE status IN ('offered','delivered') AND (sender_id=? OR receiver_id=?)",
      )
      .all(id, id))
      finish(t.id, "cancelled", message);
  }
  function cancelPair(id, message) {
    for (const t of db
      .prepare(
        "SELECT * FROM transfers WHERE status IN ('offered','delivered') AND pair_id=?",
      )
      .all(id))
      finish(t.id, "cancelled", message);
  }
  function status(id, deviceId) {
    const t = row(id);
    if (!t || ![t.sender_id, t.receiver_id].includes(deviceId))
      throw new AppError("Transfer not found", 404);
    return present(t);
  }
  return {
    request,
    stored,
    playback,
    cancel,
    expire,
    cancelDevice,
    cancelPair,
    status,
    finish,
  };
}
module.exports = { createTransfers };
