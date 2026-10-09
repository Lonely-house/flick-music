(function (root) {
  "use strict";

  const MIN_THRESHOLD = 8;
  const MAX_THRESHOLD = 30;
  const DEFAULT_THRESHOLD = 13;
  const COOLDOWN_MS = 2300;

  function portraitAxes(a, degrees = 0) {
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
    let x = a.x, y = a.y;
    const angle = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
    if (angle === 90) [x, y] = [-a.y, a.x];
    else if (angle === 180) [x, y] = [-a.x, -a.y];
    else if (angle === 270) [x, y] = [a.y, -a.x];
    return { x, y, z: Number.isFinite(a.z) ? a.z : 0 };
  }

  // DeviceMotion acceleration is measured in m/s². Estimating true velocity
  // would integrate noisy acceleration and drift; we intentionally trigger on
  // a repeated, lateral-dominant acceleration impulse instead.
  class FlickDetector {
    constructor({ threshold = DEFAULT_THRESHOLD, direction = "both", inverted = false } = {}) {
      this.threshold = threshold;
      this.direction = direction;
      this.inverted = inverted;
      this.gravity = null;
      this.lastFlick = -Infinity;
      this.candidate = null;
    }
    configure({ threshold = this.threshold, direction = this.direction,
                inverted = this.inverted } = {}) {
      this.threshold = Number.isFinite(Number(threshold))
        ? Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, Number(threshold)))
        : DEFAULT_THRESHOLD;
      this.direction = ["left", "right", "both"].includes(direction) ? direction : "both";
      this.inverted = !!inverted;
    }
    reset() { this.gravity = null; this.candidate = null; this.lastFlick = -Infinity; }
    axes(event, angle = 0) {
      let acceleration = event.acceleration;
      if (!acceleration || !Number.isFinite(acceleration.x) ||
          !Number.isFinite(acceleration.y)) {
        const raw = event.accelerationIncludingGravity;
        if (!raw || !["x","y","z"].every(axis => Number.isFinite(raw[axis]))) return null;
        if (!this.gravity) {
          this.gravity = { x: raw.x, y: raw.y, z: raw.z };
          return null;
        }
        const g = this.gravity;
        acceleration = { x: raw.x - g.x, y: raw.y - g.y, z: raw.z - g.z };
        for (const key of ["x","y","z"]) g[key] = g[key] * .92 + raw[key] * .08;
      }
      const axes = portraitAxes(acceleration, angle);
      if (axes && this.inverted) axes.x *= -1;
      return axes;
    }
    feed(event, now, angle = 0) {
      const axes = this.axes(event, angle);
      if (!axes || !Number.isFinite(now)) return { direction: null, axes };
      const { x, y, z } = axes;
      const dominant = Math.abs(x) >= this.threshold &&
        Math.abs(x) > Math.abs(y) * 1.3 &&
        Math.abs(x) > Math.abs(z) * .8;
      const dir = x < 0 ? "left" : "right";
      if (!dominant || (this.direction !== "both" && dir !== this.direction)) {
        this.candidate = null;
        return { direction: null, axes };
      }
      if (now - this.lastFlick < COOLDOWN_MS) {
        this.candidate = null;
        return { direction: null, axes };
      }
      const previous = this.candidate;
      if (previous && previous.dir === dir && now > previous.at &&
          now - previous.at <= 280) {
        this.candidate = null;
        this.lastFlick = now;
        return { direction: dir, axes };
      }
      this.candidate = { dir, at: now };
      return { direction: null, axes };
    }
  }

  function createMotionControl({
    onFlick = () => {}, onDebug = () => {}, onStatus = () => {},
    canTrigger = () => true
  } = {}) {
    const detector = new FlickDetector();
    let enabled = false, validSamples = 0, lastDebug = 0, dataTimer = null;
    const clock = () => root.performance?.now?.() || Date.now();
    const angle = () => {
      const value = Number(root.screen?.orientation?.angle);
      return Number.isFinite(value) ? value : (Number(root.orientation) || 0);
    };
    function sample(event) {
      if (!enabled || root.document?.visibilityState === "hidden") return;
      const now = clock();
      const result = detector.feed(event, now, angle());
      if (result.axes) validSamples += 1;
      if (now - lastDebug >= 140) {
        const a = result.axes;
        onDebug(a
          ? `横向 ${a.x.toFixed(1)} / 纵向 ${a.y.toFixed(1)} m/s² · 阈值 ${detector.threshold} · ${validSamples} 帧`
          : "等待有效加速度数据…");
        lastDebug = now;
      }
      if (result.direction && canTrigger())
        onFlick(result.direction, Math.abs(result.axes.x));
    }
    async function enable() {
      if (enabled) return true;
      if (!root.isSecureContext) {
        onStatus("Motion Control 需要 HTTPS（或本机 localhost）。手机请使用受信任的 HTTPS 地址。");
        return false;
      }
      if (!root.DeviceMotionEvent) {
        onStatus("浏览器没有 DeviceMotionEvent。Mac/Windows 电脑通常没有手机运动传感器，可使用模拟模式。");
        return false;
      }
      try {
        // Important: no await before this invocation; click activation is required by iOS.
        if (typeof root.DeviceMotionEvent.requestPermission === "function") {
          const permission = await root.DeviceMotionEvent.requestPermission();
          if (permission !== "granted") {
            onStatus("运动传感器权限未获允许，请调整系统/浏览器权限设置。");
            return false;
          }
        }
        detector.reset();
        validSamples = 0;
        lastDebug = 0;
        root.addEventListener("devicemotion", sample);
        enabled = true;
        onStatus("Motion 已开启。选择歌曲并轻快地横向甩动手机，切勿把手机真的抛出。");
        dataTimer = setTimeout(() => {
          if (enabled && validSamples === 0) {
            onStatus("已注册传感器监听，但未收到有效加速度。Mac 通常没有传感器；手机请检查 HTTPS 和权限，或试模拟模式。");
          }
        }, 3500);
        return true;
      } catch (error) {
        onStatus("无法启用 Motion：" + (error?.message || error));
        return false;
      }
    }
    function disable() {
      enabled = false;
      root.removeEventListener("devicemotion", sample);
      if (dataTimer !== null) clearTimeout(dataTimer);
      dataTimer = null;
      detector.reset();
    }
    return {
      enable, disable,
      get enabled() { return enabled; },
      setThreshold(value) { detector.configure({ threshold: value }); return detector.threshold; },
      setDirection(value) { detector.configure({ direction: value }); },
      setInverted(value) { detector.configure({ inverted: value }); }
    };
  }

  const api = { FlickDetector, portraitAxes, createMotionControl, DEFAULT_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.createMotionControl = createMotionControl; root.FlickMotion = api; }
})(typeof window === "undefined" ? globalThis : window);
