(function (root) {
  "use strict";
  root.createMusicLibrary = function ({
    container,
    empty,
    state,
    player,
    onPlay,
    onSend,
    onDelete,
    onSelection,
    selection,
    motionSelection = new Set(),
    onMotionSelection = () => {},
    getTrackpadSign = () => 1,
  }) {
    const cards = new Map(),
      fmt = root.FlickTransfer.formatTime;
    function updateControls() {
      const current = player.snapshot();
      for (const [id, item] of cards) {
        const playing = current.trackId === id && current.isPlaying;
        item.play.classList.toggle("playing", playing);
        item.play.setAttribute(
          "aria-label",
          (playing ? "暂停 " : "播放 ") + item.track.displayName,
        );
        item.card.classList.toggle("is-playing", playing);
        item.checkbox.hidden = !state.selectMode;
        item.checkbox.checked = selection.has(id);
        item.motionCheckbox.hidden = !state.motionMode;
        item.motionCheckbox.checked = motionSelection.has(id);
        item.motionCheckbox.disabled = !!state.motionBatchActive;
        item.card.classList.toggle("selection-mode", state.selectMode);
        item.card.classList.toggle("motion-selected",
          !!state.motionMode && motionSelection.has(id));
        item.card.classList.toggle("motion-pending", state.motionCurrentId === id);
        const duration =
          current.trackId === id && Number.isFinite(player.audio.duration)
            ? player.audio.duration
            : item.track.duration;
        item.meta.textContent =
          (duration ? fmt(duration) : "时长待载入") +
          " · " +
          (item.track.mimeType?.split("/")[1]?.toUpperCase() || "AUDIO");
        item.status.textContent =
          state.motionCurrentId === id ? "FLICKING…" :
          state.motionMode && motionSelection.has(id) ? "MOTION READY" :
          state.outgoing?.trackId === id
            ? "Sending…"
            : playing
              ? "PLAYING"
              : item.track.sourceDeviceId !== state.device?.id
                ? "RECEIVED"
                : "MY TRACK";
      }
    }
    function make(track) {
      const slot = document.createElement("div");
      slot.className = "song-slot";
      slot.dataset.trackId = track.id;
      const card = document.createElement("article");
      card.className = "song-card";
      card.dataset.trackId = track.id;
      card.tabIndex = 0;
      card.setAttribute("aria-label",
        track.displayName + "，Shift 加左右方向键可发送；桌面也支持 Shift 加触控板横向滑动");
      const icon = document.createElement("div");
      icon.className = "song-icon";
      icon.textContent = "♫";
      icon.setAttribute("aria-hidden", "true");
      const body = document.createElement("div");
      body.className = "song-body";
      const titleClip = document.createElement("div");
      titleClip.className = "song-title-clip";
      const name = document.createElement("h3");
      name.className = "song-title-text";
      name.textContent = track.displayName;
      name.title = track.displayName;
      titleClip.append(name);
      const meta = document.createElement("p");
      meta.className = "song-meta";
      const status = document.createElement("span");
      status.className = "song-status sr-only";
      const actions = document.createElement("div");
      actions.className = "song-actions";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "card-play";
      play.innerHTML = `
        <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2a1.2 1.2 0 0 1 1.8-1L19 10.8a1.5 1.5 0 0 1 0 2.4l-9.2 6.6a1.2 1.2 0 0 1-1.8-1z"/></svg>
        <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>`;
      play.addEventListener("click", () => onPlay(cards.get(track.id).track));
      const detailsToggle = document.createElement("button");
      detailsToggle.type = "button";
      detailsToggle.className = "card-options";
      detailsToggle.setAttribute("aria-label", "查看歌曲格式及时长：" + track.displayName);
      detailsToggle.setAttribute("aria-expanded", "false");
      detailsToggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/>
        <circle cx="12" cy="19" r="1.8"/></svg>`;
      const extra = document.createElement("div");
      extra.className = "song-extra";
      extra.hidden = true;
      extra.append(meta);
      detailsToggle.addEventListener("click", () => {
        const expanded = extra.hidden;
        extra.hidden = !expanded;
        card.classList.toggle("info-open", expanded);
        detailsToggle.setAttribute("aria-expanded", String(expanded));
      });
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "track-checkbox";
      checkbox.setAttribute("aria-label", "选择 " + track.displayName);
      checkbox.addEventListener("change", () =>
        onSelection(track.id, checkbox.checked),
      );
      const motionCheckbox = document.createElement("input");
      motionCheckbox.type = "checkbox";
      motionCheckbox.className = "motion-checkbox";
      motionCheckbox.setAttribute("aria-label", "甩动发送 " + track.displayName);
      motionCheckbox.hidden = true;
      motionCheckbox.addEventListener("change", () => {
        if (!state.motionBatchActive) onMotionSelection(track.id, motionCheckbox.checked);
      });
      card.addEventListener("click", (event) => {
        if (!state.motionMode || state.motionBatchActive ||
            event.target.closest?.("button,input,a,label,audio,select")) return;
        onMotionSelection(track.id, !motionSelection.has(track.id));
      });
      card.addEventListener("keydown", (event) => {
        if (event.target === card && state.motionMode && !state.motionBatchActive &&
            [" ", "Enter"].includes(event.key)) {
          event.preventDefault();
          onMotionSelection(track.id, !motionSelection.has(track.id));
        }
      });
      actions.append(play);
      body.append(titleClip, actions, status);
      card.append(icon, body, checkbox, motionCheckbox, detailsToggle, extra);
      card.addEventListener("mouseenter", () => {
        const offset = Math.max(0, name.scrollWidth - titleClip.clientWidth + 9);
        titleClip.style.setProperty("--song-scroll", -offset + "px");
        titleClip.style.setProperty("--song-marquee-duration",
          Math.max(4, Math.min(16, offset / 21 + 4)).toFixed(1) + "s");
        card.classList.toggle("title-overflow", offset > 14);
      });
      const stamp = document.createElement("div");
      stamp.className = "send-stamp";
      stamp.textContent = "Send Already！";
      stamp.setAttribute("aria-hidden", "true");
      const deleteReveal = document.createElement("span");
      deleteReveal.className = "delete-reveal";
      deleteReveal.textContent = "左滑删除";
      deleteReveal.setAttribute("aria-hidden", "true");
      slot.append(deleteReveal, card, stamp);
      const detachTouch = root.FlickGesture.attach(
        card,
        (dir) => onSend(track.id, dir),
        {
          onDeleteSwipe: () => onDelete(track.id),
          enabled: () =>
            !state.selectMode && !state.motionMode &&
            !state.outgoing &&
            !slot.classList.contains("send-success"),
          move: (x, dragging, mode, armed) => {
            card.style.setProperty("--drag-x", x + "px");
            card.classList.toggle("dragging", dragging);
            slot.classList.toggle("delete-drag", dragging && mode === "single" && x < -12);
            slot.classList.toggle("delete-armed", !!armed && dragging);
            deleteReveal.textContent = armed ? "松手确认删除" : "左滑删除";
          },
        },
      );
      const detachDesktop = root.FlickDesktopGesture.attach(
        card, (dir) => onSend(track.id, dir), {
          enabled: () =>
            !state.selectMode && !state.motionMode && !state.outgoing &&
            !slot.classList.contains("send-success"),
          wheelSign: getTrackpadSign,
          move: (x, dragging) => {
            card.style.setProperty("--drag-x", x + "px");
            card.classList.toggle("dragging", dragging);
          },
        },
      );
      return {
        slot,
        card,
        track,
        name,
        meta,
        status,
        play,
        detailsToggle, extra, titleClip,
        checkbox, motionCheckbox,
        detach: () => { detachTouch(); detachDesktop(); },
        timer: null,
      };
    }
    function render(tracks) {
      const wanted = new Set(tracks.map((t) => t.id));
      for (const [id, item] of cards)
        if (!wanted.has(id)) {
          item.detach();
          clearTimeout(item.timer);
          item.slot.remove();
          cards.delete(id);
          selection.delete(id);
          motionSelection.delete(id);
        }
      for (const track of tracks) {
        let item = cards.get(track.id);
        if (!item) {
          item = make(track);
          cards.set(track.id, item);
        }
        item.track = track;
        item.name.textContent = track.displayName;
        item.name.title = track.displayName;
        item.detailsToggle.setAttribute("aria-label", "查看歌曲格式及时长：" + track.displayName);
        container.append(item.slot);
      }
      empty.hidden = tracks.length > 0;
      updateControls();
    }
    function rebound(id) {
      const item = cards.get(id);
      if (!item) return;
      item.card.classList.remove("dragging");
      item.card.style.setProperty("--drag-x", "0px");
      item.card.classList.add("spring-back");
      setTimeout(() => item.card.classList.remove("spring-back"), 350);
    }
    function sent(id, dir) {
      const item = cards.get(id);
      if (!item) return;
      const reduced = root.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      clearTimeout(item.timer);
      item.slot.classList.add("send-success");
      item.card.classList.add(dir === "right" ? "fly-right" : "fly-left");
      item.timer = setTimeout(
        () => {
          item.card.classList.remove("fly-right", "fly-left", "dragging");
          item.card.style.setProperty("--drag-x", "0px");
          item.card.classList.add("restore-card");
          item.slot.classList.remove("send-success");
          item.timer = setTimeout(
            () => item.card.classList.remove("restore-card"),
            reduced ? 50 : 350,
          );
        },
        reduced ? 300 : 900,
      );
    }
    function randomMotion(item) {
      const y = Math.round(Math.random() * 64) - 32;
      const rot = (Math.round(Math.random() * 34) - 17) || 11;
      item.card.style.setProperty("--motion-y", y + "px");
      item.card.style.setProperty("--motion-y-far", -y * 3 + "px");
      item.card.style.setProperty("--motion-r", rot + "deg");
      item.card.style.setProperty("--motion-r-small", (-rot / 2) + "deg");
      item.card.style.setProperty("--motion-r-far", (rot * 2.8) + "deg");
      item.card.style.setProperty("--motion-r-reverse", (-rot) + "deg");
    }
    function motionSent(id, dir) {
      const item = cards.get(id);
      if (!item) return;
      clearTimeout(item.timer);
      const reduced = root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const className = dir === "right" ? "motion-throw-right" : "motion-throw-left";
      randomMotion(item);
      item.slot.classList.add("send-success", "motion-sent");
      item.card.classList.remove("motion-throw-right","motion-throw-left","dragging");
      item.card.style.setProperty("--drag-x","0px");
      void item.card.offsetWidth;
      item.card.classList.add(className);
      item.timer = setTimeout(() => {
        item.card.classList.remove(className);
        item.slot.classList.remove("send-success", "motion-sent");
        item.card.classList.add("restore-card");
        item.timer = setTimeout(() => item.card.classList.remove("restore-card"),
          reduced ? 40 : 400);
      }, reduced ? 180 : 850);
    }
    function motionReceived(id, dir) {
      const item = cards.get(id);
      if (!item) return;
      randomMotion(item);
      const className = dir === "right" ? "motion-catch-right" : "motion-catch-left";
      item.card.classList.remove("receive-pop","motion-catch-right","motion-catch-left");
      void item.card.offsetWidth;
      item.card.classList.add(className);
      setTimeout(() => item.card.classList.remove(className), 980);
    }
    function received(id) {
      const item = cards.get(id);
      if (!item) return;
      item.card.classList.remove("receive-pop");
      void item.card.offsetWidth;
      item.card.classList.add("receive-pop");
      setTimeout(() => item.card.classList.remove("receive-pop"), 700);
    }
    return { render, updateControls, rebound, sent, received, motionSent, motionReceived, cards };
  };
})(window);
