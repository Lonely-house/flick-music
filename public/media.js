(function (root) {
  "use strict";
  function clampTime(time, duration) {
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Audio duration is unavailable");
    return Math.min(
      Math.max(0, Number.isFinite(time) ? time : 0),
      Math.max(0, duration - Math.min(0.1, duration / 2)),
    );
  }
  function waitFor(audio, events, predicate, signal, timeout = 6000, action) {
    return new Promise((resolve, reject) => {
      let timer;
      const clean = () => {
        clearTimeout(timer);
        for (const e of events) audio.removeEventListener(e, check);
        audio.removeEventListener("error", error);
        signal?.removeEventListener("abort", abort);
      };
      const done = (err) => {
        clean();
        err ? reject(err) : resolve();
      };
      const check = () => {
        if (predicate()) done();
      };
      const error = () =>
        done(new Error("Audio unavailable or format not supported"));
      const abort = () => done(new Error("Transfer cancelled"));
      for (const e of events) audio.addEventListener(e, check);
      audio.addEventListener("error", error);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => done(new Error("Audio loading timed out")),
        timeout,
      );
      if (signal?.aborted) return abort();
      try {
        if (action) action();
        check();
      } catch (err) {
        done(err);
      }
    });
  }
  async function prepare(audio, url, time, signal, onSeek = () => {}) {
    if (audio.getAttribute("src") !== url) {
      audio.src = url;
      audio.load();
    }
    await waitFor(
      audio,
      ["loadedmetadata", "durationchange"],
      () =>
        audio.readyState >= 1 &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0,
      signal,
    );
    const target = clampTime(time, audio.duration);
    onSeek(target);
    await waitFor(
      audio,
      ["seeked", "timeupdate"],
      () => !audio.seeking && Math.abs(audio.currentTime - target) < 0.25,
      signal,
      4000,
      () => {
        audio.currentTime = target;
      },
    );
    return target;
  }
  function play(audio, signal, timeout = 6000) {
    return new Promise((resolve, reject) => {
      let timer;
      const clean = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        audio.pause();
        clean();
        reject(new Error("Transfer cancelled"));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        audio.pause();
        clean();
        reject(new Error("Audio playback timed out"));
      }, timeout);
      // Called synchronously so a click retains its user activation when priming audio.
      try {
        Promise.resolve(audio.play()).then(
          () => {
            clean();
            if (signal?.aborted || audio.paused || audio.ended)
              reject(new Error("Playback did not start"));
            else resolve();
          },
          (err) => {
            clean();
            reject(err);
          },
        );
      } catch (err) {
        clean();
        reject(err);
      }
    });
  }
  const api = { clampTime, waitFor, prepare, play };
  if (typeof module !== "undefined") module.exports = api;
  else root.FlickMedia = api;
})(typeof window === "undefined" ? globalThis : window);
