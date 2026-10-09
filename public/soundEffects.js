(function (root) {
  "use strict";
  // Global soundpack files come from the host server. Volume/mute/unlock are
  // per-browser preferences. Web Audio is deliberately independent of the music
  // player, so a short event cue never seeks, pauses or replaces a song.
  const KINDS = ["paired", "receiverReady", "uploaded", "delivered"];
  const MAX_BYTES = 5 * 1024 * 1024;
  const PREFERENCE_KEY = "flick-music-sound-v1";
  const NOTES = {
    paired: [[523, 0, .11], [659, .12, .12], [784, .24, .20]],
    receiverReady: [[659, 0, .09], [880, .13, .20]],
    uploaded: [[440, 0, .10], [554, .10, .10], [659, .22, .20]],
    delivered: [[587, 0, .08], [740, .10, .09], [880, .20, .12], [1175, .34, .25]],
  };
  function validKind(kind) { return KINDS.includes(kind); }
  function validFilename(file) {
    return !!file && Number.isFinite(file.size) && file.size >= 12 &&
      file.size <= MAX_BYTES &&
      /\.(mp3|wav|m4a|mp4|aac|ogg|oga|webm|flac)$/i.test(file.name || "");
  }
  function createSoundEffects({ onStatus = () => {}, onChange = () => {} } = {}) {
    let ctx = null, bus = null, soundpack = {}, buffers = {}, lastSeen = new Map(),
      syncVersion = 0, lastUnlocked = false;
    let settings = { enabled: true, volume: 0.40 };
    try {
      const saved = JSON.parse(root.localStorage?.getItem(PREFERENCE_KEY) || "null");
      if (saved && typeof saved === "object") {
        settings.enabled = saved.enabled !== false;
        if (Number.isFinite(saved.volume)) settings.volume = Math.min(1, Math.max(0, saved.volume));
      }
    } catch { /* storage may be disabled */ }
    function remember() {
      try { root.localStorage?.setItem(PREFERENCE_KEY, JSON.stringify(settings)); } catch {}
    }
    function getContext() {
      if (!ctx) {
        const Constructor = root.AudioContext || root.webkitAudioContext;
        if (!Constructor) throw new Error("此浏览器不支持 Web Audio 提示音。");
        ctx = new Constructor();
        bus = ctx.createGain();
        bus.gain.value = settings.enabled ? settings.volume : 0;
        bus.connect(ctx.destination);
      }
      return ctx;
    }
    function updateGain() {
      if (bus) bus.gain.value = settings.enabled ? settings.volume : 0;
    }
    async function unlock() {
      try {
        const context = getContext();
        if (context.state !== "running") await context.resume();
        const success = context.state === "running";
        if (success && !lastUnlocked) onStatus("提示音已启用（不影响歌曲播放）。", "success");
        lastUnlocked = success;
        onChange();
        return success;
      } catch (err) {
        onStatus("提示音无法启用：" + err.message, "warning");
        onChange();
        return false;
      }
    }
    function tone(kind) {
      const context = getContext();
      const start = context.currentTime + 0.012;
      for (const [frequency, offset, duration] of NOTES[kind]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        envelope.gain.setValueAtTime(0.0001, start + offset);
        envelope.gain.exponentialRampToValueAtTime(0.45, start + offset + 0.014);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
        oscillator.connect(envelope);
        envelope.connect(bus);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + duration + 0.025);
      }
    }
    function play(kind, eventId) {
      if (!validKind(kind) || !settings.enabled) return false;
      // Real server events can be duplicated by reconnect/retry. Avoid double cues.
      if (eventId) {
        const key = kind + ":" + eventId;
        if (lastSeen.has(key)) return false;
        lastSeen.set(key, Date.now());
        if (lastSeen.size > 100) {
          for (const [id, time] of lastSeen)
            if (Date.now() - time > 60000) lastSeen.delete(id);
          if (lastSeen.size > 100) lastSeen.delete(lastSeen.keys().next().value);
        }
      }
      try {
        const context = getContext();
        if (context.state !== "running") {
          // Never claim automatic playback succeeded if the browser blocked it.
          onStatus("提示音被浏览器暂停；请点击“开启提示音”后重试。", "warning");
          onChange();
          return false;
        }
        if (buffers[kind]) {
          const source = context.createBufferSource();
          source.buffer = buffers[kind];
          source.connect(bus);
          source.start(0, 0, Math.min(12, source.buffer.duration));
        } else tone(kind);
        return true;
      } catch (err) {
        onStatus("提示音播放失败：" + err.message, "warning");
        return false;
      }
    }
    // Short complementary Motion cues: descending "throw" and rising "catch".
    // Use the existing event sound bus without replacing/pausing the music.
    function playMotionCue(which, transferId) {
      if (!["throw", "catch"].includes(which) || !settings.enabled) return false;
      const key = "motion-" + which + ":" + transferId;
      if (transferId && lastSeen.has(key)) return false;
      try {
        const context = getContext();
        if (context.state !== "running") {
          onStatus("Motion 音效被浏览器限制，请先点击开启事件提示音。", "warning");
          return false;
        }
        if (transferId) lastSeen.set(key, Date.now());
        if (lastSeen.size > 160) lastSeen.delete(lastSeen.keys().next().value);
        const t = context.currentTime + 0.01;
        const sweep = context.createOscillator();
        const envelope = context.createGain();
        sweep.type = which === "throw" ? "sawtooth" : "triangle";
        sweep.frequency.setValueAtTime(which === "throw" ? 750 : 180, t);
        sweep.frequency.exponentialRampToValueAtTime(which === "throw" ? 135 : 920, t + 0.27);
        envelope.gain.setValueAtTime(0.0001, t);
        envelope.gain.exponentialRampToValueAtTime(.14, t + .026);
        envelope.gain.exponentialRampToValueAtTime(.0001, t + .31);
        sweep.connect(envelope); envelope.connect(bus);
        sweep.start(t); sweep.stop(t + .32);
        if (context.createBufferSource && context.createBiquadFilter) {
          const length = Math.floor(context.sampleRate * .22);
          const buffer = context.createBuffer(1, length, context.sampleRate);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < length; i++)
            channel[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / length);
          const noise = context.createBufferSource();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          filter.type = which === "throw" ? "lowpass" : "bandpass";
          filter.frequency.setValueAtTime(which === "throw" ? 1800 : 600, t);
          filter.frequency.exponentialRampToValueAtTime(which === "throw" ? 430 : 1700, t + .22);
          gain.gain.setValueAtTime(.0001, t);
          gain.gain.exponentialRampToValueAtTime(.2, t + .024);
          gain.gain.exponentialRampToValueAtTime(.0001, t + .22);
          noise.buffer = buffer;
          noise.connect(filter); filter.connect(gain); gain.connect(bus);
          noise.start(t); noise.stop(t + .23);
        }
        return true;
      } catch (err) {
        onStatus("Motion 音效播放失败：" + err.message, "warning");
        return false;
      }
    }
    async function reload(api) {
      const version = ++syncVersion;
      const { sounds } = await api("/api/sounds");
      if (version !== syncVersion) return;
      const nextBuffers = { ...buffers }, nextInfo = { ...sounds };
      // Decode ahead of time: at the moment a pair/transfer event arrives there
      // must be no file download or media decoder latency on the critical path.
      const context = getContext();
      await Promise.all(KINDS.map(async (kind) => {
        const info = sounds[kind];
        if (!info) { delete nextBuffers[kind]; return; }
        if (soundpack[kind]?.revision === info.revision && buffers[kind]) return;
        try {
          const response = await fetch(info.url, { credentials: "same-origin", cache: "no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 12) throw new Error("invalid size");
          nextBuffers[kind] = await context.decodeAudioData(bytes);
        } catch (err) {
          delete nextBuffers[kind];
          onStatus("加载“" + kind + "”自定义提示音失败，使用内置音效。", "warning");
        }
      }));
      if (version !== syncVersion) return;
      buffers = nextBuffers;
      soundpack = nextInfo;
      onChange();
    }
    async function save(kind, file, api) {
      if (!validKind(kind) || !validFilename(file))
        throw new Error("请选择 5 MB 以内的 MP3、WAV、M4A、AAC、OGG 等音频文件。");
      const context = getContext();
      try {
        await context.decodeAudioData(await file.arrayBuffer());
      } catch {
        throw new Error("这个浏览器无法解码该提示音，请换 MP3/WAV 文件。");
      }
      const form = new FormData();
      form.append("audio", file);
      await api("/api/sounds/" + kind, { method: "POST", body: form });
      await reload(api);
    }
    async function restore(kind, api) {
      if (!validKind(kind)) throw new Error("Unknown sound event");
      await api("/api/sounds/" + kind, { method: "DELETE" });
      await reload(api);
    }
    function setEnabled(value) {
      settings.enabled = !!value;
      remember(); updateGain(); onChange();
    }
    function setVolume(value) {
      settings.volume = Math.max(0, Math.min(1, Number(value) || 0));
      remember(); updateGain(); onChange();
    }
    function snapshot() {
      return { ...settings, unlocked: !!ctx && ctx.state === "running", sounds: { ...soundpack } };
    }
    return { unlock, play, playMotionCue, reload, save, restore, setEnabled, setVolume, snapshot };
  }
  const api = { createSoundEffects, validFilename, validKind, KINDS, MAX_BYTES };
  if (typeof module !== "undefined") module.exports = api;
  else root.FlickSounds = api;
})(typeof window === "undefined" ? globalThis : window);
