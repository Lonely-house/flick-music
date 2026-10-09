(function (root) {
  "use strict";
  // A single leftward finger deletes (after confirmation). Two horizontal
  // fingers transfer in either direction. The gestures share a single state
  // machine so the second touch can never commit a pending delete.
  function direction(start, end, elapsed) {
    if (start.length !== 2 || end.length !== 2 || elapsed < 0 || elapsed > 800)
      return null;
    const d = start.map((p, i) => ({ x: end[i].x - p.x, y: end[i].y - p.y }));
    if (d.some((p) => Math.abs(p.y) > 80)) return null;
    const avg = (d[0].x + d[1].x) / 2;
    if (
      Math.abs(avg) < 100 ||
      d.some((p) => Math.abs(p.x) < 60) ||
      Math.sign(d[0].x) !== Math.sign(d[1].x)
    ) return null;
    return avg < 0 ? "left" : "right";
  }
  function singleLeft(start, end, elapsed) {
    if (!start || !end || elapsed < 0 || elapsed > 1100) return false;
    const dx = end.x - start.x, dy = end.y - start.y;
    return dx <= -105 && Math.abs(dy) <= 70 && -dx > Math.abs(dy) * 1.35;
  }
  function attach(card, onSwipe, {
    onDeleteSwipe = () => false,
    enabled = () => true,
    clock = () => performance.now(),
    move = (x, dragging) => {
      card.style.setProperty("--drag-x", x + "px");
      card.classList.toggle("dragging", dragging);
    },
  } = {}) {
    let active = null, blocked = false, last = -Infinity, frame = null, latest = 0;
    const point = (t) => ({ x: t.clientX, y: t.clientY });
    const interactive = (e) => e.target.closest?.("button,input,a,label,audio");
    const belongs = (t) => !t.target || !card.contains || card.contains(t.target);
    function cancelFrame() {
      if (frame !== null) {
        root.cancelAnimationFrame ? root.cancelAnimationFrame(frame) : clearTimeout(frame);
        frame = null;
      }
    }
    function paint() {
      frame = null;
      const mode = active?.mode || "";
      const armed = mode === "single" && singleLeft(active.start[0], active.end[0], clock() - active.at);
      move(latest, !!active && active.horizontal, mode, armed);
    }
    function schedule(x) {
      latest = x;
      if (frame === null)
        frame = root.requestAnimationFrame ? root.requestAnimationFrame(paint) : setTimeout(paint, 0);
    }
    function reset(keepBlocked = false) {
      active = null;
      blocked = keepBlocked;
      cancelFrame();
      latest = 0;
      move(0, false, "", false);
    }
    function make(touches, mode) {
      return {
        mode,
        ids: touches.map((t) => t.identifier),
        start: touches.map(point),
        end: touches.map(point),
        ended: new Set(),
        at: clock(),
        horizontal: false,
      };
    }
    function start(e) {
      if (!enabled()) return;
      if (e.touches.length > 2) return reset(true);
      if (blocked || clock() - last < 650) return;
      const touches = [...e.touches];
      if (touches.some((t) => !belongs(t)) || interactive(e)) {
        if (active) reset(true);
        return;
      }
      if (touches.length === 1 && !active) {
        active = make(touches, "single");
        return;
      }
      if (touches.length === 2) {
        // A second finger converts the candidate single swipe into a transfer.
        // Any partial one-finger delete movement is discarded first.
        if (active?.mode === "single") {
          const previous = active;
          const first = touches.find((t) => t.identifier === previous.ids[0]);
          if (!first || previous.ended.size ||
              clock() - previous.at > 500 ||
              Math.abs(first.clientX - previous.start[0].x) > 45) {
            return reset(true);
          }
        } else if (active) return;
        active = make(touches, "double");
        cancelFrame();
        move(0, false, "", false);
      }
    }
    function update(e) {
      if (!active) return;
      if (!enabled()) return reset(true);
      for (const t of [...e.touches, ...e.changedTouches]) {
        const i = active.ids.indexOf(t.identifier);
        if (i >= 0) active.end[i] = point(t);
      }
      const count = active.ids.length;
      const dx = active.end.reduce((sum, t, i) => sum + t.x - active.start[i].x, 0) / count;
      const dy = active.end.reduce((sum, t, i) => sum + t.y - active.start[i].y, 0) / count;
      if (!active.horizontal && Math.abs(dy) > 15 && Math.abs(dy) > Math.abs(dx))
        return reset(true);
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.12)
        active.horizontal = true;
      if (active.horizontal) {
        if (e.cancelable) e.preventDefault();
        const drag = active.mode === "single"
          ? Math.max(-200, Math.min(0, dx))
          : Math.max(-180, Math.min(180, dx));
        schedule(drag);
      }
    }
    function end(e) {
      if (blocked) {
        if (e.touches.length === 0) reset();
        return;
      }
      update(e);
      if (!active) return;
      for (const t of e.changedTouches)
        if (active.ids.includes(t.identifier)) active.ended.add(t.identifier);
      if (active.ended.size === active.ids.length) {
        const done = active;
        const elapsed = clock() - done.at;
        const action = done.mode === "double"
          ? direction(done.start, done.end, elapsed)
          : singleLeft(done.start[0], done.end[0], elapsed) ? "delete" : null;
        active = null;
        cancelFrame();
        if (action && enabled()) {
          last = clock();
          if (action === "delete") {
            reset(); // the card returns while the confirmation dialog is shown
            onDeleteSwipe();
            return;
          }
          if (onSwipe(action) !== false) {
            move(latest, false, "double", false);
            return;
          }
        }
        reset();
      }
    }
    const listeners = { touchstart: start, touchmove: update, touchend: end,
      touchcancel: () => reset() };
    for (const [name, fn] of Object.entries(listeners))
      card.addEventListener(name, fn, { passive: false });
    return () => {
      for (const [name, fn] of Object.entries(listeners))
        card.removeEventListener(name, fn);
      reset();
    };
  }
  const api = { direction, singleLeft, attach };
  if (typeof module !== "undefined") module.exports = api;
  else root.FlickGesture = api;
})(typeof window === "undefined" ? globalThis : window);
