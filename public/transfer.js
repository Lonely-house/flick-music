(function (root) {
  "use strict";
  class OutgoingTransfer {
    constructor({
      socket,
      player,
      notify,
      changed = () => {},
      delivered = () => {},
      failed = () => {},
      makeId,
      timeout = 17000,
    }) {
      Object.assign(this, {
        socket,
        player,
        notify,
        changed,
        delivered,
        failed,
        makeId,
        timeout,
      });
      this.pending = null;
    }
    request(track, dir, state, { interaction = 'swipe' } = {}) {
      if (this.pending) {
        this.notify("已有传输进行中，请稍后再试。", "info");
        return false;
      }
      if (!this.socket.connected || !state.deviceRegistered || !state.primary) {
        this.notify("设备尚未注册或另一标签页正在控制。", "error");
        return false;
      }
      if (!state.pairing || !state.pairing.peer.online) {
        this.notify("请先完成配对，并确认对方在线。", "error");
        return false;
      }
      if (!track) {
        this.notify("歌曲已不在本设备曲库中。", "error");
        return false;
      }
      const snapshot = this.player.snapshot(),
        playing = snapshot.trackId === track.id && snapshot.isPlaying;
      const p = {
        requestKey: this.makeId(),
        id: null,
        trackId: track.id,
        dir,
        interaction: interaction === 'motion' ? 'motion' : 'swipe',
        snapshot,
        playing,
        delivered: false,
      };
      this.pending = p;
      this.changed("requested", p);
      this.notify("Transfer requested · " + track.displayName);
      p.timer = setTimeout(
        () =>
          this.cancel(
            p.delivered
              ? "文件已发送；播放确认超时，当前设备继续播放。"
              : "传输超时，当前设备继续播放。",
          ),
        this.timeout,
      );
      this.socket.timeout(5000).emit(
        "transfer:request",
        {
          requestKey: p.requestKey,
          pairId: state.pairing.id,
          trackId: track.id,
          direction: dir,
          interaction: p.interaction,
          isPlaying: playing,
          currentTime: playing ? snapshot.currentTime : 0,
        },
        (err, result) => {
          if (this.pending !== p) return;
          if (err || !result?.ok)
            return this.reject(
              p,
              result?.message || "传输请求未获确认，当前音乐继续播放。",
            );
          p.id = result.transfer.id;
          this.notify("Transfer authorized · " + p.id.slice(0, 8));
          if (!p.delivered) this.changed("authorized", p);
          if (
            result.transfer.duplicate &&
            !["offered", "delivered"].includes(result.transfer.status)
          )
            this.complete(result.transfer);
        },
      );
      return true;
    }
    matches(data) {
      return (
        this.pending &&
        (this.pending.id === data.id ||
          this.pending.requestKey === data.requestKey) &&
        this.pending.trackId === data.senderTrackId
      );
    }
    saved(data) {
      if (!this.matches(data)) return;
      const p = this.pending;
      p.id = data.id;
      if (!p.delivered) {
        p.delivered = true;
        this.delivered(p.trackId, p.dir, data.id);
        this.notify(
          "Transfer delivered · 歌曲已保存到对方私人曲库。",
          "success",
        );
      }
      this.changed("delivered", p);
    }
    handoff(data) {
      if (!this.matches(data) || data.playbackStatus !== "playing")
        return false;
      const p = this.pending,
        now = this.player.snapshot();
      // A delivered file alone NEVER pauses the sender. Only this valid playback ACK does.
      const pause =
        p.delivered &&
        p.playing &&
        now.trackId === p.snapshot.trackId &&
        now.generation === p.snapshot.generation &&
        now.src === p.snapshot.src;
      this.clear();
      if (pause) this.player.audio.pause();
      this.notify(
        pause
          ? "Handoff completed · 播放已交给对方。"
          : "对方已播放；本机播放器已改变，保持当前状态。",
        "success",
      );
      return pause;
    }
    complete(data) {
      if (!this.matches(data)) return;
      if (data.status === "completed" && !this.pending.delivered)
        this.saved(data);
      const p = this.pending;
      if (data.status === "failed") this.failed(p.trackId);
      this.clear();
      this.notify(
        data.message || "文件已发送。",
        data.status === "failed"
          ? "error"
          : data.playbackStatus === "not-requested"
            ? "success"
            : "warning",
      );
    }
    reject(p, message) {
      if (this.pending !== p) return;
      if (!p.delivered) this.failed(p.trackId);
      this.clear();
      this.notify(message, "error");
    }
    clear() {
      clearTimeout(this.pending?.timer);
      this.pending = null;
      this.changed("idle", null);
    }
    cancel(message = "播放接力已取消；当前音乐继续播放。") {
      const p = this.pending;
      if (!p) return;
      if (p.id && this.socket.connected)
        this.socket.emit("transfer:cancel", { transferId: p.id }, () => {});
      if (!p.delivered) this.failed(p.trackId);
      this.clear();
      this.notify(message, p.delivered ? "warning" : "error");
    }
  }
  function formatTime(time) {
    const n = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0));
    return (
      String(Math.floor(n / 60)).padStart(2, "0") +
      ":" +
      String(n % 60).padStart(2, "0")
    );
  }
  const api = { OutgoingTransfer, formatTime };
  if (typeof module !== "undefined") module.exports = api;
  else root.FlickTransfer = api;
})(typeof window === "undefined" ? globalThis : window);
