(function (root) {
  "use strict";
  root.createPlayer = function (audio, { log, changed, manual }) {
    let current = null,
      generation = 0;
    function select(track) {
      current = track;
      generation++;
      if (audio.getAttribute("src") !== track.audioUrl) {
        audio.src = track.audioUrl;
        audio.load();
      }
      changed();
    }
    function snapshot() {
      return {
        trackId: current?.id || null,
        generation,
        src: audio.getAttribute("src"),
        currentTime: audio.currentTime || 0,
        isPlaying: !!current && !audio.paused && !audio.ended,
      };
    }
    async function toggle(track) {
      manual();
      if (current?.id === track.id && !audio.paused) {
        audio.pause();
        return;
      }
      if (current?.id !== track.id) select(track);
      else generation++;
      await root.FlickMedia.play(audio); // invoked synchronously from the card click
    }
    async function receive(track, time, signal) {
      select(track);
      const token = generation;
      await root.FlickMedia.prepare(audio, track.audioUrl, time, signal, (t) =>
        log("Seeking to " + root.FlickTransfer.formatTime(t)),
      );
      await root.FlickMedia.play(audio, signal);
      return token;
    }
    async function enable() {
      const wasPlaying = !audio.paused && !audio.ended,
        oldTime = audio.currentTime;
      let url;
      if (!current) {
        const buffer = new ArrayBuffer(1644),
          v = new DataView(buffer),
          text = (offset, s) =>
            [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
        text(0, "RIFF");
        v.setUint32(4, 1636, true);
        text(8, "WAVEfmt ");
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 8000, true);
        v.setUint32(28, 16000, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        text(36, "data");
        v.setUint32(40, 1600, true);
        url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
        audio.src = url;
        audio.load();
      }
      try {
        audio.muted = false;
        await root.FlickMedia.play(audio);
        if (!wasPlaying) audio.pause();
        if (current && Number.isFinite(audio.duration))
          audio.currentTime = Math.min(oldTime, audio.duration);
      } finally {
        if (url) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          URL.revokeObjectURL(url);
        }
      }
    }
    function stop() {
      generation++;
      current = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      changed();
    }
    for (const name of [
      "play",
      "pause",
      "ended",
      "timeupdate",
      "loadedmetadata",
      "durationchange",
    ])
      audio.addEventListener(name, () => {
        changed();
        if (name === "play" && current)
          log("Playing track · " + current.displayName);
      });
    return {
      audio,
      snapshot,
      toggle,
      receive,
      enable,
      stop,
      current: () => current,
    };
  };
})(window);
