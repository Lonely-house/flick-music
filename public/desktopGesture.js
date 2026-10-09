(function (root) {
  "use strict";
  // Desktop browsers expose touchpad scrolling as WheelEvent (not finger count).
  // To avoid browser Back/Forward collisions, capture only Shift + horizontal
  // scroll while hovering a song card. Mouse dragging and focused-card
  // Shift+Arrow provide predictable fallbacks on macOS and Windows.
  const WHEEL_THRESHOLD = 110;
  const MOUSE_THRESHOLD = 110;
  const QUIET_MS = 180;
  const COOLDOWN_MS = 650;

  function wheelPixels(e, pageWidth = 800) {
    const mode = Number(e.deltaMode) || 0;
    const factor = mode === 1 ? 16 : mode === 2 ? pageWidth : 1;
    return { x: (Number(e.deltaX) || 0) * factor,
             y: (Number(e.deltaY) || 0) * factor };
  }

  function attach(card, onSwipe, {
    enabled = () => true,
    wheelSign = () => 1, // configurable per device; does not affect mouse or keyboard
    clock = () => performance.now(),
    move = (x, dragging) => {
      card.style.setProperty("--drag-x", x + "px");
      card.classList.toggle("dragging", dragging);
    },
  } = {}) {
    let wheelX = 0;
    let wheelTimer = null;
    let wheelStarted = 0;
    let mouse = null;
    let lastSent = -Infinity;
    const interactive = (e) =>
      !!e.target?.closest?.("button,input,a,label,audio,select,textarea");
    const clamp = (n) => Math.max(-190, Math.min(190, n));
    const canAct = () => enabled() && clock() - lastSent >= COOLDOWN_MS;

    function resetWheel(restore = true) {
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      wheelTimer = null;
      wheelX = 0;
      wheelStarted = 0;
      if (restore && !mouse) move(0, false, "desktop");
    }
    function finish(dx, direction) {
      lastSent = clock();
      const accepted = onSwipe(direction) !== false;
      move(accepted ? clamp(dx) : 0, false, "desktop");
      return accepted;
    }
    function flushWheel() {
      wheelTimer = null;
      const x = wheelX;
      const time = clock() - wheelStarted;
      wheelX = 0;
      wheelStarted = 0;
      if (!canAct() || mouse || Math.abs(x) < WHEEL_THRESHOLD || time > 1800) {
        move(0, false, "desktop");
        return;
      }
      finish(x, x < 0 ? "left" : "right");
    }
    function onWheel(e) {
      // Shift must be *physically held*. Normal scrolling is never intercepted.
      if (!canAct() || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey ||
          interactive(e) || mouse) return;
      const raw = wheelPixels(e, card.clientWidth || 800);
      const x = raw.x * (wheelSign() === -1 ? -1 : 1), y = raw.y;
      if (Math.abs(x) < 1 || Math.abs(x) < Math.abs(y) * 1.15) return;
      if (!e.cancelable) return; // Let browser navigate rather than pretending.
      e.preventDefault();
      if (wheelTimer === null) wheelStarted = clock();
      // Direction reversal starts a new deliberate gesture.
      if (wheelX && Math.sign(wheelX) !== Math.sign(x)) wheelX = 0;
      wheelX = Math.max(-300, Math.min(300, wheelX + x));
      move(clamp(wheelX), true, "desktop");
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(flushWheel, QUIET_MS);
    }

    function releaseMouse() {
      if (mouse) {
        try {
          if (card.hasPointerCapture?.(mouse.id)) card.releasePointerCapture(mouse.id);
        } catch (_) { /* pointer may already have been released */ }
      }
      mouse = null;
    }
    function pointerDown(e) {
      if (!canAct() || e.pointerType !== "mouse" || e.button !== 0 ||
          interactive(e) || mouse) return;
      resetWheel();
      mouse = { id: e.pointerId, startX: e.clientX, startY: e.clientY,
                dx: 0, dy: 0, at: clock(), horizontal: false };
      try { card.setPointerCapture?.(e.pointerId); } catch (_) {}
    }
    function pointerMove(e) {
      if (!mouse || mouse.id !== e.pointerId) return;
      const dx = e.clientX - mouse.startX;
      const dy = e.clientY - mouse.startY;
      mouse.dx = dx; mouse.dy = dy;
      if (!mouse.horizontal && Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
        releaseMouse();
        move(0, false, "desktop");
        return;
      }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15)
        mouse.horizontal = true;
      if (mouse.horizontal) {
        if (e.cancelable) e.preventDefault();
        move(clamp(dx), true, "desktop");
      }
    }
    function pointerUp(e) {
      if (!mouse || mouse.id !== e.pointerId) return;
      pointerMove(e);
      if (!mouse) return;
      const { dx, dy, horizontal, at } = mouse;
      releaseMouse();
      const elapsed = clock() - at;
      if (canAct() && horizontal && Math.abs(dx) >= MOUSE_THRESHOLD &&
          Math.abs(dy) <= 70 && elapsed >= 0 && elapsed <= 1200) {
        finish(dx, dx < 0 ? "left" : "right");
      } else {
        move(0, false, "desktop");
      }
    }
    function pointerCancel(e) {
      if (mouse && e.pointerId === mouse.id) {
        releaseMouse();
        move(0, false, "desktop");
      }
    }
    function keydown(e) {
      if (e.target !== card || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey ||
          !["ArrowLeft", "ArrowRight"].includes(e.key) || e.repeat || !canAct()) return;
      if (e.cancelable) e.preventDefault();
      finish(e.key === "ArrowLeft" ? -160 : 160,
             e.key === "ArrowLeft" ? "left" : "right");
    }
    const handlers = { wheel: onWheel, pointerdown: pointerDown,
      pointermove: pointerMove, pointerup: pointerUp,
      pointercancel: pointerCancel, lostpointercapture: pointerCancel,
      keydown };
    for (const [type, fn] of Object.entries(handlers))
      card.addEventListener(type, fn, type === "wheel" ? { passive: false } : false);

    return () => {
      for (const [type, fn] of Object.entries(handlers))
        card.removeEventListener(type, fn);
      resetWheel(false);
      releaseMouse();
      move(0, false, "desktop");
    };
  }

  const api = { attach, wheelPixels };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FlickDesktopGesture = api;
})(typeof window === "undefined" ? globalThis : window);
