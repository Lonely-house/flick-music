(function (root) {
  "use strict";
  // V2 server accepts one outstanding transfer per pair. A motion "batch" is
  // intentionally a sequential queue of existing authorized single transfers.
  // The receiving library ACK, never the sensor gesture, is delivery success.
  class MotionBatch {
    constructor({
      sender, getState, getTrack,
      onDelivered = () => {}, onFailed = () => {},
      onProgress = () => {}, onFinish = () => {},
      pauseMs = 130
    }) {
      Object.assign(this, {
        sender, getState, getTrack, onDelivered, onFailed, onProgress, onFinish, pauseMs
      });
      this.active = false;
      this.queue = [];
      this.current = null;
      this.timer = null;
      this.total = 0;
      this.success = 0;
      this.failed = 0;
      this.direction = "left";
    }
    snapshot() {
      return {
        active: this.active, currentId: this.current?.id || null,
        total: this.total, success: this.success, failed: this.failed,
        remaining: this.queue.length
      };
    }
    start(ids, direction) {
      if (this.active || this.sender.pending ||
          !["left", "right"].includes(direction) || !Array.isArray(ids)) return false;
      const queue = [...new Set(ids)].filter(id => typeof id === "string" && id);
      const state = this.getState();
      if (!queue.length || !state.primary || !state.deviceRegistered ||
          !state.pairing?.peer.online || !this.sender.socket.connected) return false;
      this.queue = queue;
      this.direction = direction;
      this.total = queue.length; this.success = 0; this.failed = 0;
      this.active = true; this.current = null;
      this.onProgress(this.snapshot());
      this.advance();
      return true;
    }
    advance() {
      this.timer = null;
      if (!this.active || this.current) return;
      const state = this.getState();
      if (!state.primary || !state.deviceRegistered ||
          !state.pairing?.peer.online || !this.sender.socket.connected) {
        this.failed += this.queue.length;
        this.queue = [];
        this.finish();
        return;
      }
      const id = this.queue.shift();
      if (!id) { this.finish(); return; }
      const track = this.getTrack(id);
      if (!track) {
        this.failed++;
        this.onFailed(id);
        this.onProgress(this.snapshot());
        this.timer = setTimeout(() => this.advance(), this.pauseMs);
        return;
      }
      this.current = { id, delivered: false };
      this.onProgress(this.snapshot());
      const started = this.sender.request(track, this.direction, state, { interaction: "motion" });
      if (!started) {
        this.current = null;
        this.failed++;
        this.onFailed(id);
        this.timer = setTimeout(() => this.advance(), this.pauseMs);
      }
    }
    delivered(id, direction, transferId) {
      if (!this.active || this.current?.id !== id || this.current.delivered) return false;
      this.current.delivered = true;
      this.success++;
      this.onDelivered(id, direction, transferId);
      this.onProgress(this.snapshot());
      return true;
    }
    idle() {
      if (!this.active || !this.current) return;
      const item = this.current;
      this.current = null;
      if (!item.delivered) {
        this.failed++;
        this.onFailed(item.id);
      }
      this.onProgress(this.snapshot());
      this.timer = setTimeout(() => this.advance(), this.pauseMs);
    }
    stop() {
      if (!this.active) return;
      clearTimeout(this.timer);
      this.failed += this.queue.length + (this.current && !this.current.delivered ? 1 : 0);
      this.queue = []; this.current = null;
      this.active = false; this.timer = null;
      if (this.sender.pending) this.sender.cancel("Motion 传输中断；已交付的歌曲仍保留在接收方。");
      this.onFinish(this.snapshot());
    }
    finish() {
      if (!this.active) return;
      this.active = false;
      clearTimeout(this.timer);
      this.timer = null;
      this.onProgress(this.snapshot());
      this.onFinish(this.snapshot());
    }
  }
  const api = { MotionBatch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FlickMotionBatch = api;
})(typeof window === "undefined" ? globalThis : window);
