(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    socket = io({ autoConnect: false });
  const state = {
    socketConnected: false,
    deviceRegistered: false,
    pairingStatus: "unpaired",
    audioReady: false,
    transferStatus: "idle",
    primary: false,
    device: null,
    pairing: null,
    requests: { outgoing: null, incoming: [] },
    devices: [],
    tracks: [],
    selectMode: false,
    motionMode: false,
    motionDemo: false,
    motionBatchActive: false,
    motionCurrentId: null,
    outgoing: null,
    incoming: null,
    uploading: false,
    priming: false,
  };
  let csrfToken,
    musicUI,
    sender,
    motionBatch,
    registerVersion = 0,
    loadVersion = 0,
    logCount = 0,
    activeRequest = null;
  const selection = new Set();
  const motionSelection = new Set();

  // WheelEvent deltaX reports scroll input, not necessarily finger movement.
  // Mac and Windows defaults can differ, and either system has natural-scroll
  // settings. Only the Shift+Wheel handler uses this correction.
  const TRACKPAD_KEY = "flick-trackpad-direction-v1";
  let trackpadMode = "auto";
  try {
    const saved = localStorage.getItem(TRACKPAD_KEY);
    if (["auto", "standard", "reversed"].includes(saved)) trackpadMode = saved;
  } catch {}
  const macPlatform = /Mac/i.test(
    navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "");
  const getTrackpadSign = () => trackpadMode === "auto"
    ? (macPlatform ? -1 : 1)
    : (trackpadMode === "reversed" ? -1 : 1);
  function renderTrackpadSettings() {
    $("trackpadDirection").value = trackpadMode;
    $("trackpadHint").textContent = "当前生效：" +
      (getTrackpadSign() === -1 ? "反转" : "标准") +
      "。如果手指向左划却触发右发，请改选另一个方向；本机自动记住此设置。";
  }
  $("trackpadDirection").addEventListener("change", (event) => {
    trackpadMode = event.target.value;
    try { localStorage.setItem(TRACKPAD_KEY, trackpadMode); } catch {}
    renderTrackpadSettings();
  });
  renderTrackpadSettings();
  const makeId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return (
      h.slice(0, 8) +
      "-" +
      h.slice(8, 12) +
      "-" +
      h.slice(12, 16) +
      "-" +
      h.slice(16, 20) +
      "-" +
      h.slice(20)
    );
  };
  function log(message, type = "info") {
    const li = document.createElement("li"),
      time = document.createElement("time");
    li.dataset.type = type;
    time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    li.append(time, document.createTextNode(message));
    $("logs").append(li);
    while ($("logs").children.length > 150) $("logs").firstChild.remove();
    $("logs").scrollTop = $("logs").scrollHeight;
    $("logCount").textContent = ++logCount + " entries";
  }
  let noticeTimer = null;
  function notify(message, type = "info") {
    const notice = $("notice");
    notice.textContent = message;
    notice.dataset.type = type;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, type === "error" ? 8500 : 4800);
    log(message, type);
  }
  const sounds = window.FlickSounds.createSoundEffects({
    onStatus: (message, type = "info") => {
      $("cueStatus").textContent = message;
      log("Sound cues · " + message, type);
    },
    onChange: () => renderCueSettings(),
  });
  function renderCueSettings() {
    const info = sounds.snapshot();
    $("cuesEnabled").checked = info.enabled;
    $("cueVolume").value = Math.round(info.volume * 100);
    $("cueVolumeText").textContent = Math.round(info.volume * 100) + "%";
    $("enableCues").textContent = info.unlocked ? "🔊 提示音已开启 ✓" : "🔊 开启事件提示音";
    $("enableCues").classList.toggle("is-ready", info.unlocked);
    for (const kind of window.FlickSounds.KINDS) {
      document.querySelector('[data-cue-name="' + kind + '"]').textContent =
        info.sounds[kind]?.name || "内置默认提示音";
      document.querySelector('[data-cue-reset="' + kind + '"]').disabled =
        !info.sounds[kind];
    }
  }
  async function api(url, init = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...init.headers,
      },
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("服务器未返回有效响应。");
    }
    if (!response.ok) throw new Error(data.error || "请求失败。");
    return data;
  }
  function rpc(name, data, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!socket.connected)
        return reject(new Error("Socket disconnected，当前音乐继续播放。"));
      socket
        .timeout(timeout)
        .emit(name, data, (err, result) =>
          err || !result?.ok
            ? reject(new Error(result?.message || "服务器确认超时。"))
            : resolve(result),
        );
    });
  }
  function abortIncoming(message) {
    const incoming = state.incoming;
    if (!incoming) return;
    incoming.controller.abort();
    state.incoming = null;
    $("incomingTrack").hidden = true;
    log(message, "warning");
    render();
  }
  const player = window.createPlayer($("audio"), {
    log,
    changed: () => {
      musicUI?.updateControls();
      renderPlayer();
    },
    manual: () => {
      sender?.cancel("本机播放器已改变，原接力取消。");
      abortIncoming("用户已操作播放器。");
    },
  });
  // Compact native-audio view and custom turntable use the SAME #audio player.
  // Derive artist only when present in metadata or an "Artist - Title" filename;
  // never invent an artist for an untagged file.
  const tagLookups = new Map();
  function scheduleTrackTags(track) {
    if (!track || !window.FlickTrackMetadata || tagLookups.has(track.id)) return;
    tagLookups.set(track.id, true);
    void window.FlickTrackMetadata.readTrackTags(track).then((tags) => {
      if (!tags) return;
      const current = player.current();
      const own = state.tracks.find((t) => t.id === track.id);
      for (const obj of [track, own, current?.id === track.id ? current : null]) {
        if (!obj) continue;
        if (tags.artist) obj.artist = tags.artist;
        if (tags.title) obj.title = tags.title;
      }
      if (playerMode === "advanced" && current?.id === track.id) renderPlayer();
    }).catch(() => {});
  }
  const PLAYER_MODE_KEY = "flick-player-view-final";
  let playerMode = "minimal";
  try {
    if (localStorage.getItem(PLAYER_MODE_KEY) === "advanced") playerMode = "advanced";
  } catch {}
  function titleAndArtist(track) {
    if (!track) return { title: "从曲库选择一首歌", artist: "未知艺术家" };
    const base = (track.displayName || "未命名歌曲")
      .replace(/\.(mp3|m4a|mp4|aac|wav|ogg|oga|flac|webm)$/i, "");
    const byFilename = /^(.{1,90}?)\s+[-–—]\s+(.{1,150})$/.exec(base);
    return {
      title: track.title || (byFilename ? byFilename[2] : base),
      artist: track.artist || (byFilename ? byFilename[1] : "未知艺术家"),
    };
  }
  function updatePlayerMode() {
    const advanced = playerMode === "advanced";
    $("minimalPlayer").hidden = advanced;
    $("advancedPlayer").hidden = !advanced;
    $("playerPanel").classList.toggle("advanced-active", advanced);
    $("togglePlayerView").setAttribute("aria-pressed", String(advanced));
    $("togglePlayerView").textContent = advanced ? "极简模式 ↙" : "高级模式 ↗";
    renderPlayer();
  }
  function renderPlayer() {
    const current = player.current();
    const snapshot = player.snapshot();
    const audio = player.audio;
    if (playerMode === "advanced") scheduleTrackTags(current);
    const { title, artist } = titleAndArtist(current);
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration : (Number(current?.duration) > 0 ? Number(current.duration) : 0);
    const elapsed = Math.max(0, Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    $("nowPlaying").textContent = current?.displayName || "从曲库选择一首歌";
    $("playerState").textContent = current
      ? (snapshot.isPlaying ? "正在播放" : "已暂停") +
        " · " + window.FlickTransfer.formatTime(elapsed)
      : "一个播放器，播放你的整份曲库。";
    $("advancedTrackTitle").textContent = title;
    $("advancedTrackArtist").textContent = artist;
    $("advancedElapsed").textContent = window.FlickTransfer.formatTime(elapsed);
    $("advancedDuration").textContent = window.FlickTransfer.formatTime(duration);
    const seek = $("advancedSeek");
    seek.disabled = !current || duration <= 0;
    seek.max = Math.max(1, duration);
    if (!seek.matches(":active")) seek.value = Math.min(elapsed, Math.max(1, duration));
    seek.style.setProperty("--seek-progress",
      (duration > 0 ? Math.min(100, elapsed / duration * 100) : 0) + "%");
    $("playerPanel").classList.toggle("is-playing", snapshot.isPlaying);
    $("advancedPlayPause").setAttribute("aria-label", snapshot.isPlaying ? "暂停" : "播放");
    for (const name of ["advancedPrev","advancedNext"])
      $(name).disabled = !state.tracks.length;
  }
  $("togglePlayerView").addEventListener("click", () => {
    playerMode = playerMode === "minimal" ? "advanced" : "minimal";
    try { localStorage.setItem(PLAYER_MODE_KEY, playerMode); } catch {}
    updatePlayerMode();
  });
  $("advancedPlayPause").addEventListener("click", async () => {
    const track = player.current() || state.tracks[0];
    if (!track) return notify("请先上传一首歌曲。", "warning");
    try { await player.toggle(track); }
    catch (err) { notify("播放失败：" + err.message, "error"); }
  });
  function playAdjacent(direction) {
    if (!state.tracks.length) return notify("曲库还没有歌曲。", "warning");
    const index = state.tracks.findIndex((t) => t.id === player.current()?.id);
    const length = state.tracks.length;
    const next = index < 0 ? 0 : (index + direction + length) % length;
    const track = state.tracks[next];
    if (track.id === player.current()?.id && !player.audio.paused) {
      try { player.audio.currentTime = 0; }
      catch (err) { notify("无法跳转：" + err.message, "error"); }
      return;
    }
    player.toggle(track).catch((err) => notify("切歌失败：" + err.message, "error"));
  }
  $("advancedPrev").addEventListener("click", () => playAdjacent(-1));
  $("advancedNext").addEventListener("click", () => playAdjacent(1));
  $("advancedSeek").addEventListener("input", (event) => {
    const audio = player.audio;
    if (!player.current() || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const target = Number(event.target.value);
    if (!Number.isFinite(target)) return;
    try {
      audio.currentTime = Math.max(0, Math.min(target, audio.duration));
      renderPlayer();
    } catch (err) { notify("拖动播放进度失败：" + err.message, "error"); }
  });
  updatePlayerMode();
  function render() {
    $("socketBadge").textContent = state.socketConnected
      ? "Socket online"
      : "Socket offline";
    $("socketBadge").classList.toggle("good", state.socketConnected);
    $("deviceName").textContent = state.device?.nickname || "正在识别设备…";
    $("rename").disabled = !state.device;
    $("registeredBadge").textContent = state.deviceRegistered
      ? state.primary
        ? "Device registered"
        : "同设备 · 非控制页"
      : state.socketConnected
        ? "正在注册设备…"
        : "等待设备注册";
    $("registeredBadge").classList.toggle(
      "good",
      state.deviceRegistered && state.primary,
    );
    $("audioBadge").textContent = state.audioReady
      ? "允许接收 ✓"
      : "尚未允许接收";
    $("audioBadge").classList.toggle("good", state.audioReady);
    $("tabWarning").hidden = !state.deviceRegistered || state.primary;
    if (!state.deviceRegistered && state.pairing) {
      state.pairingStatus = "unverified";
      $("pairLabel").textContent = "连接中断 · 等待验证配对";
      $("pairHint").textContent = "重连后会由服务器重新确认。";
    } else if (state.pairing) {
      state.pairingStatus = state.pairing.peer.online
        ? "paired"
        : "peer-offline";
      $("pairLabel").textContent =
        (state.pairing.peer.online ? "已连接：" : "对方离线：") +
        state.pairing.peer.nickname;
      const peerReady = state.devices.some((d) =>
      d.id === state.pairing.peer.id && d.audioReady === true);
    $("pairHint").textContent = !state.pairing.peer.online
      ? "短暂断线可重连；持续离线会解除配对。"
      : peerReady
        ? "对方已允许接收歌曲，可以通过滑动或 Motion Control 发送。"
        : "连接已建立，但对方尚未点击「启用音频接收」，目前不能向对方发送文件。";
    } else if (state.requests.outgoing) {
      state.pairingStatus = "requesting";
      $("pairLabel").textContent =
        "等待 " + state.requests.outgoing.target.nickname + " 接受";
      $("pairHint").textContent = "对方确认之前，双方尚未配对。";
    } else {
      state.pairingStatus = "unpaired";
      $("pairLabel").textContent = "未配对";
      $("pairHint").textContent = "选择在线设备，等待对方接受后开始分享。";
    }
    $("disconnectPair").hidden = !state.pairing;
    $("disconnectPair").disabled = !state.deviceRegistered || !state.primary;
    $("enableAudio").disabled =
      !state.deviceRegistered ||
      !state.primary ||
      state.priming ||
      !!state.incoming;
    $("enableAudio").textContent = state.priming
      ? "正在启用…"
      : state.audioReady
        ? "音频接收已启用 ✓"
        : "启用音频接收";
    $("files").disabled = !state.device || state.uploading;
    $("musicCount").textContent = state.tracks.length;
    $("onlineCount").textContent =
      state.devices.filter((d) => d.online && d.id !== state.device?.id)
        .length + " 台";
    $("manage").textContent = state.selectMode ? "退出多选" : "多选管理";
    $("manage").disabled = state.motionMode || state.motionBatchActive;
    $("motionControls").hidden = !state.motionMode;
    $("motionSelectedCount").textContent = "已选 " + motionSelection.size + " 首";
    for (const id of ["motionSelectAll", "motionSelectNone", "disableMotion"])
      $(id).disabled = !!state.motionBatchActive;
    const motionCanSend = state.motionMode && !state.motionBatchActive &&
      motionSelection.size > 0 && state.deviceRegistered &&
      state.primary && !!state.pairing?.peer.online && socket.connected;
    $("motionSimLeft").disabled = !motionCanSend;
    $("motionSimRight").disabled = !motionCanSend;
    $("enableMotion").disabled = !!state.motionBatchActive;
    $("demoMotion").disabled = !!state.motionBatchActive;
    $("enableMotion").textContent = state.motionMode && !state.motionDemo
      ? "Motion Control 已开启 ✓" : "Enable Motion Control";
    $("selectionToolbar").hidden = !state.selectMode;
    $("selectionCount").textContent = "已选 " + selection.size + " 首";
    $("deleteSelected").disabled = selection.size === 0;
    $("fullDeviceId").textContent = state.device
      ? "本机 ID：" +
        state.device.id +
        " · transferStatus: " +
        state.transferStatus
      : "";
    window.renderDevices($("devices"), state.devices, state, requestPair);
    musicUI?.updateControls();
    renderPlayer();
    updatePairDialog();
  }
  function updatePairDialog() {
    const request =
      state.requests.incoming.find((r) => r.id === activeRequest?.id) ||
      state.requests.incoming[0];
    if (!request || !state.primary || !state.deviceRegistered) {
      activeRequest = null;
      if ($("pairDialog").open) $("pairDialog").close();
      return;
    }
    activeRequest = request;
    $("pairRequestText").textContent =
      "设备“" + request.requester.nickname + "”希望与你连接。";
    if (!$("pairDialog").open) $("pairDialog").showModal();
  }
  function applySnapshot(data) {
    if (!socket.connected || !data.deviceRegistered) return;
    state.device = data.device;
    state.deviceRegistered = true;
    state.primary = data.primary;
    state.audioReady = data.audioReady;
    state.pairing = data.pairing;
    state.requests = data.requests;
    if (!state.primary) {
      motionBatch?.stop();
      sender.cancel("另一标签页成为控制页，原传输已取消。");
      abortIncoming("当前标签页不再控制接收。");
    }
    render();
  }
  function upsertTrack(track) {
    const found = state.tracks.findIndex((t) => t.id === track.id);
    found < 0 ? state.tracks.unshift(track) : (state.tracks[found] = track);
    musicUI.render(state.tracks);
    render();
  }
  async function loadTracks() {
    const version = ++loadVersion;
    try {
      const data = await api("/api/tracks");
      if (version !== loadVersion) return;
      state.tracks = data.tracks;
      if (
        player.current() &&
        !state.tracks.some((t) => t.id === player.current().id)
      ) {
        sender.cancel("当前歌曲已删除。");
        abortIncoming("当前歌曲已删除。");
        player.stop();
      }
      musicUI.render(state.tracks);
      render();
    } catch (err) {
      if (version === loadVersion) notify(err.message, "error");
    }
  }
  function setSelectMode(value) {
    if (value && state.motionMode) return;
    state.selectMode = value;
    selection.clear();
    for (const id of musicUI.cards.keys()) musicUI.rebound(id);
    render();
  }
  let pendingDeleteTrack = null;
  function confirmSwipeDelete(id) {
    if (state.selectMode || state.motionMode || state.outgoing) return false;
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return false;
    pendingDeleteTrack = id;
    $("deleteTrackName").textContent = "《" + track.displayName + "》";
    if (!$("deleteTrackDialog").open) $("deleteTrackDialog").showModal();
    log("Single-finger left swipe · delete confirmation: " + track.displayName);
    return true;
  }
  async function deleteTracks(ids, { skipConfirm = false } = {}) {
    if (!ids.length) return;
    if (
      !skipConfirm && !confirm(
        ids.length === 1
          ? "从本设备曲库删除这首歌？其他设备的副本不受影响。"
          : "删除选中的 " + ids.length + " 首歌曲？仅移除本设备曲库记录。",
      )
    )
      return;
    try {
      await api("/api/tracks/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      selection.clear();
      await loadTracks();
      notify("歌曲已从本设备曲库删除。", "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }
  musicUI = window.createMusicLibrary({
    container: $("musicList"),
    empty: $("emptyLibrary"),
    state,
    player,
    selection,
    onPlay: (track) =>
      player
        .toggle(track)
        .catch((err) => notify("点击播放重试：" + err.message, "error")),
    onSend: (id, dir) => transferMusic(id, dir),
    onDelete: confirmSwipeDelete,
    onSelection: (id, checked) => {
      checked ? selection.add(id) : selection.delete(id);
      render();
    },
    motionSelection,
    onMotionSelection: (id, checked) => {
      if (!state.motionMode || state.motionBatchActive) return;
      checked ? motionSelection.add(id) : motionSelection.delete(id);
      render();
    },
    getTrackpadSign,
  });
  sender = new window.FlickTransfer.OutgoingTransfer({
    socket,
    player,
    makeId,
    notify,
    changed: (status, pending) => {
      state.transferStatus = status;
      state.outgoing = pending;
      if (status === "idle" && motionBatch?.active) motionBatch.idle();
      render();
    },
    delivered: (id, dir, transferId) => {
      if (motionBatch?.active && motionBatch.delivered(id, dir, transferId)) {
        musicUI.motionSent(id, dir);
        sounds.playMotionCue("throw", transferId);
        motionSelection.delete(id); // success only; failures stay selected
        log("Motion track delivered · " + id.slice(0, 8));
        render();
      } else {
        musicUI.sent(id, dir);
      }
      sounds.play("delivered", transferId); // retain the custom 4th event cue
    },
    failed: (id) => musicUI.rebound(id),
  });
  motionBatch = new window.FlickMotionBatch.MotionBatch({
    sender,
    getState: () => state,
    getTrack: (id) => state.tracks.find((track) => track.id === id),
    onFailed: (id) => musicUI.rebound(id),
    onProgress: (progress) => {
      state.motionBatchActive = progress.active;
      state.motionCurrentId = progress.currentId;
      $("motionProgress").textContent = progress.active
        ? "批次传输中 · " + progress.success + "/" + progress.total +
          " 首已收到，" + progress.failed + " 首失败"
        : "本次完成 · 成功 " + progress.success + " / " + progress.total +
          " 首；失败 " + progress.failed + " 首。";
      render();
    },
    onFinish: (progress) => {
      state.motionBatchActive = false;
      state.motionCurrentId = null;
      notify("Motion 批次已结束：成功 " + progress.success +
        " 首，失败 " + progress.failed +
        " 首。失败歌曲仍保持选中，可再次甩动。",
        progress.failed ? "warning" : "success");
      render();
    },
  });
  function startMotionBatch(direction, acceleration = null) {
    if (!state.motionMode || state.motionBatchActive) return false;
    const ids = state.tracks.filter((track) => motionSelection.has(track.id))
      .map((track) => track.id);
    if (!ids.length) {
      notify("请先在「我的音乐」选择要甩出的歌曲。", "warning");
      return false;
    }
    if (!state.pairing?.peer.online) {
      notify("请先与接收设备成功配对，且确保对方在线。", "warning");
      return false;
    }
    const started = motionBatch.start(ids, direction);
    if (started) log("Motion flick " + direction + " · " + ids.length +
      " 首" + (acceleration == null ? "（模拟）" :
        " · " + acceleration.toFixed(1) + " m/s²"));
    else notify("当前无法甩歌：设备尚未就绪，或有其它文件正在传输。", "warning");
    return started;
  }
  function transferMusic(trackId, direction = "left") {
    if (state.selectMode || state.motionMode) {
      musicUI.rebound(trackId);
      return false;
    }
    const track = state.tracks.find((t) => t.id === trackId);
    log(
      "Swipe " +
        direction +
        " / Send button · " +
        (track?.displayName || "unknown"),
    );
    const accepted = sender.request(track, direction, state);
    if (!accepted) musicUI.rebound(trackId);
    return accepted;
  }
  window.transferMusic = transferMusic;
  async function requestPair(id) {
    try {
      const r = await rpc("pair:request", { targetId: id });
      notify(
        "Pairing requested · 等待 " + r.request.target.nickname + " 接受。",
      );
    } catch (err) {
      notify(err.message, "error");
    }
  }
  $("acceptPair").addEventListener("click", async () => {
    const id = activeRequest?.id;
    if (!id) return;
    try {
      await rpc("pair:accept", { requestId: id });
      log("Pairing accepted");
    } catch (err) {
      notify(err.message, "error");
    }
  });
  $("rejectPair").addEventListener("click", async () => {
    const id = activeRequest?.id;
    if (!id) return;
    try {
      await rpc("pair:reject", { requestId: id });
      log("Pairing rejected");
    } catch (err) {
      notify(err.message, "error");
    }
  });
  $("pairDialog").addEventListener("cancel", (e) => e.preventDefault());
  $("disconnectPair").addEventListener("click", () =>
    rpc("pair:disconnect", {}).catch((err) => notify(err.message, "error")),
  );
  $("rename").addEventListener("click", () => {
    $("nickname").value = state.device.nickname;
    $("renameDialog").showModal();
  });
  $("cancelRename").addEventListener("click", () => $("renameDialog").close());
  $("renameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: $("nickname").value }),
      });
      state.device = r.device;
      $("renameDialog").close();
      render();
    } catch (err) {
      notify(err.message, "error");
    }
  });
  $("cancelDeleteTrack").addEventListener("click", () => $("deleteTrackDialog").close());
  $("deleteTrackDialog").addEventListener("close", () => { pendingDeleteTrack = null; });
  $("confirmDeleteTrack").addEventListener("click", async () => {
    const id = pendingDeleteTrack;
    if (!id) return;
    $("confirmDeleteTrack").disabled = true;
    try {
      await deleteTracks([id], { skipConfirm: true });
      $("deleteTrackDialog").close();
    } finally {
      $("confirmDeleteTrack").disabled = false;
    }
  });
  $("enableCues").addEventListener("click", () => sounds.unlock());
  $("cuesEnabled").addEventListener("change", (e) => sounds.setEnabled(e.target.checked));
  $("cueVolume").addEventListener("input", (e) => sounds.setVolume(Number(e.target.value) / 100));
  for (const kind of window.FlickSounds.KINDS) {
    const upload = document.querySelector('[data-cue-upload="' + kind + '"]');
    upload.addEventListener("change", async () => {
      const file = upload.files?.[0];
      if (!file) return;
      upload.disabled = true;
      try {
        await sounds.save(kind, file, api);
        notify("已更新全设备提示音：" + file.name, "success");
      } catch (err) {
        notify("更新提示音失败：" + err.message, "error");
      } finally { upload.disabled = false; upload.value = ""; }
    });
    document.querySelector('[data-cue-preview="' + kind + '"]').addEventListener("click", async () => {
      await sounds.unlock();
      sounds.play(kind);
    });
    document.querySelector('[data-cue-reset="' + kind + '"]').addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try { await sounds.restore(kind, api); notify("已恢复内置提示音。", "success"); }
      catch (err) { notify("恢复失败：" + err.message, "error"); }
      finally { renderCueSettings(); }
    });
  }
  // Resume Web Audio from a real user gesture. Background Socket.IO events
  // cannot bypass mobile-browser autoplay policy by themselves.
  window.addEventListener("pointerdown", () => {
    if (sounds.snapshot().enabled && !sounds.snapshot().unlocked)
      void sounds.unlock();
  }, { passive: true });
  $("manage").addEventListener("click", () => setSelectMode(!state.selectMode));
  $("exitSelection").addEventListener("click", () => setSelectMode(false));
  $("deleteSelected").addEventListener("click", () =>
    deleteTracks([...selection]),
  );
  $("files").addEventListener("change", async () => {
    const files = [...$("files").files];
    if (!files.length || state.uploading) return;
    state.uploading = true;
    let successCount = 0;
    render();
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("audio", file);
        notify("正在上传：" + file.name);
        const r = await api("/api/tracks", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(120000),
        });
        upsertTrack(r.track);
        successCount++;
        log("Track uploaded · " + r.track.displayName);
        notify(
          r.reused
            ? "相同音频已在曲库中，已复用。"
            : "音乐已加入你的私人曲库。",
          "success",
        );
      } catch (err) {
        notify("上传失败：" + file.name + " · " + err.message, "error");
      }
    }
    state.uploading = false;
    if (successCount) sounds.play("uploaded", makeId());
    $("files").value = "";
    await loadTracks();
    render();
  });
  $("enableAudio").addEventListener("click", async () => {
    if (state.priming || !state.primary || !state.deviceRegistered) return;
    state.priming = true;
    const wasReady = state.audioReady;
    render();
    try {
      void sounds.unlock();
      await player.enable();
      await rpc("device:ready", { audioReady: true });
      state.audioReady = true;
      notify("Audio receiver ready · 音频接收已启用。", "success");
      if (!wasReady) sounds.play("receiverReady");
    } catch (err) {
      state.audioReady = false;
      notify("Tap to allow playback：" + err.message, "error");
    } finally {
      state.priming = false;
      render();
    }
  });
  socket.on("connect", async () => {
    state.socketConnected = true;
    state.deviceRegistered = false;
    const version = ++registerVersion;
    log("Socket connected");
    render();
    try {
      const snapshot = await rpc("device:register", {
        audioReady: state.audioReady,
      });
      if (version !== registerVersion || !socket.connected) return;
      applySnapshot(snapshot);
      log("Device registered");
      await loadTracks();
    } catch (err) {
      notify(err.message, "error");
    }
  });
  socket.on("disconnect", (reason) => {
    ++registerVersion;
    state.socketConnected = false;
    state.deviceRegistered = false;
    motionBatch?.stop();
    sender.cancel("连接断开，当前音乐继续播放。");
    abortIncoming("接收连接已断开。");
    log("Socket disconnected · " + reason, "error");
    render();
  });
  socket.on("connect_error", (err) =>
    notify("连接失败，请检查网络或刷新页面：" + err.message, "error"),
  );
  socket.io.on("reconnect_attempt", () => log("Socket reconnecting…"));
  socket.on("device:state", applySnapshot);
  socket.on("devices:updated", (list) => {
    state.devices = list;
    log("Online devices updated");
    render();
  });
  socket.on("pair:incoming", () => log("Incoming pairing request"));
  socket.on("pair:requested", () => log("Pairing requested"));
  socket.on("pair:established", (p) => {
    notify("Pair established · 已连接 " + p.peer.nickname, "success");
    sounds.play("paired", p.id);
  });
  for (const name of [
    "pair:rejected",
    "pair:expired",
    "pair:cancelled",
    "pair:disconnected",
  ])
    socket.on(name, (data) => notify(data.message, "warning"));
  socket.on("sounds:updated", () => {
    sounds.reload(api).catch((err) => log("Sound settings sync failed: " + err.message, "warning"));
  });
  socket.on("library:changed", () => loadTracks());
  socket.on("transfer:delivered", (data) => sender.saved(data));
  socket.on("transfer:handoff", (data) => sender.handoff(data));
  socket.on("transfer:complete", (data) => sender.complete(data));
  socket.on("transfer:failed", (data) => {
    log("Transfer failed", "error");
    sender.complete(data);
  });
  socket.on("transfer:cancelled", (data) => {
    if (state.incoming?.id === data.id)
      abortIncoming(data.message || "播放接力已取消；歌曲如已保存则会保留。");
  });
  socket.on("transfer:incoming", async (data) => {
    if (!state.deviceRegistered || !state.primary || state.incoming) return;
    const incoming = {
      id: data.id,
      controller: new AbortController(),
      saved: false,
    };
    state.incoming = incoming;
    state.transferStatus = "receiving";
    $("incomingText").textContent =
      "设备“" +
      data.sender.nickname +
      "”给您传来了一首歌：《" +
      data.trackName +
      "》";
    $("incomingTrack").hidden = false;
    log("Incoming transfer · " + data.id.slice(0, 8));
    render();
    let message = "歌曲已收到，点击播放。";
    const timer = setTimeout(() => {
      if (state.incoming === incoming) abortIncoming("接收超时。");
    }, data.timeout + 1000);
    try {
      const saved = await rpc("transfer:stored", { transferId: data.id });
      incoming.saved = true;
      sounds.play("delivered", data.id);
      if (data.interaction === "motion")
        sounds.playMotionCue("catch", data.id);
      upsertTrack(saved.track);
      if (data.interaction === "motion")
        musicUI.motionReceived(saved.track.id, data.direction);
      else musicUI.received(saved.track.id);
      log("Track added to receiver library");
      if (incoming.controller.signal.aborted || state.incoming !== incoming)
        return;
      if (!data.isPlaying) {
        message = saved.transfer.reused
          ? "已拥有相同歌曲，已高亮曲库中的歌曲。"
          : "已添加到我的音乐。";
        return;
      }
      const current = player.snapshot();
      const busy = current.isPlaying && current.trackId !== saved.track.id;
      if (busy || !state.audioReady || state.priming) {
        await rpc("transfer:playback", {
          transferId: data.id,
          success: false,
          reason: busy ? "busy" : "not-ready",
        });
        message = busy
          ? "已添加到我的音乐；保留本机当前播放。"
          : "歌曲已收到，点击播放。需要接力时先启用音频接收。";
        return;
      }
      incoming.playGeneration = player.snapshot().generation + 1;
      await player.receive(
        saved.track,
        data.currentTime,
        incoming.controller.signal,
      );
      if (incoming.controller.signal.aborted || state.incoming !== incoming)
        return;
      log("Receiver playback started");
      await rpc("transfer:playback", {
        transferId: data.id,
        success: true,
        currentTime: player.audio.currentTime,
      });
      message = "已添加到我的音乐 · 播放接力成功。";
      log("Handoff completed");
    } catch (err) {
      if (incoming.saved) {
        message =
          "歌曲已收到，点击播放。" +
          (err.name === "NotAllowedError"
            ? " Tap to allow playback。"
            : " 自动播放未完成。");
        if (err.name === "NotAllowedError") {
          state.audioReady = false;
          if (socket.connected)
            rpc("device:ready", { audioReady: false }).catch(() => {});
        }
        if (socket.connected && !incoming.controller.signal.aborted)
          rpc("transfer:playback", {
            transferId: data.id,
            success: false,
            reason: err.name === "NotAllowedError" ? "blocked" : "failed",
          }).catch(() => {});
      } else message = "接收失败：" + err.message;
    } finally {
      clearTimeout(timer);
      // An old async completion must not overwrite a newer incoming transfer UI.
      if (state.incoming === incoming) {
        state.incoming = null;
        state.transferStatus = state.outgoing ? state.transferStatus : "idle";
        $("incomingTrack").hidden = true;
        notify(message, incoming.saved ? "success" : "error");
        render();
      }
      loadTracks();
    }
  });
  $("audio").addEventListener("error", () => {
    if (player.current())
      notify("音频不可用：文件缺失或浏览器不支持该格式。", "error");
  });
  $("audio").addEventListener("loadedmetadata", () => {
    const track = player.current(),
      duration = player.audio.duration;
    if (track && Number.isFinite(duration) && duration > 0) {
      track.duration = duration;
      const cached = state.tracks.find((t) => t.id === track.id);
      if (cached) cached.duration = duration;
      musicUI.updateControls();
      api("/api/tracks/" + track.id + "/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration }),
      }).catch(() => {});
    }
  });
  const motion = window.createMotionControl({
    canTrigger: () => state.motionMode && !state.motionDemo &&
      !state.motionBatchActive && motionSelection.size > 0 &&
      state.deviceRegistered && state.primary && !!state.pairing?.peer.online,
    onFlick: (direction, strength) => startMotionBatch(direction, strength),
    onDebug: (text) => { $("motionDebug").textContent = text; },
    onStatus: (text) => {
      $("motionStatus").textContent = text;
      log(text);
    },
  });
  function startMotionMode(simulated) {
    if (state.selectMode) setSelectMode(false);
    state.motionMode = true;
    state.motionDemo = simulated;
    $("motionStatus").textContent = simulated
      ? "模拟模式开启：选好歌曲，点击模拟左甩/右甩进行真实网络交付。"
      : "传感器已启用：选好歌曲，保持页面前台，然后轻快横向甩动。";
    render();
  }
  $("enableMotion").addEventListener("click", async () => {
    // Critical: requestPermission is invoked inside motion.enable() immediately
    // on this click; we do not await a separate operation before it.
    const permissionResult = motion.enable();
    void sounds.unlock();
    if (await permissionResult) startMotionMode(false);
  });
  $("demoMotion").addEventListener("click", () => {
    if (state.motionBatchActive) return;
    motion.disable();
    void sounds.unlock();
    startMotionMode(true);
  });
  $("disableMotion").addEventListener("click", () => {
    if (state.motionBatchActive) return;
    motion.disable();
    motionSelection.clear();
    state.motionMode = false;
    state.motionDemo = false;
    state.motionCurrentId = null;
    $("motionProgress").textContent = "尚未开始。";
    $("motionStatus").textContent = "已关闭 Motion Control。";
    render();
  });
  $("motionSelectAll").addEventListener("click", () => {
    if (!state.motionMode || state.motionBatchActive) return;
    for (const track of state.tracks) motionSelection.add(track.id);
    render();
  });
  $("motionSelectNone").addEventListener("click", () => {
    if (state.motionBatchActive) return;
    motionSelection.clear();
    render();
  });
  $("motionSimLeft").addEventListener("click", () => startMotionBatch("left"));
  $("motionSimRight").addEventListener("click", () => startMotionBatch("right"));
  $("motionThreshold").addEventListener("input", (event) => {
    const applied = motion.setThreshold(event.target.value);
    $("motionThresholdValue").textContent = String(applied);
  });
  $("motionDirection").addEventListener("change", (event) => {
    motion.setDirection(event.target.value);
  });
  $("motionInvert").addEventListener("change", (event) => {
    motion.setInverted(event.target.checked);
  });
  if (!window.isSecureContext)
    $("motionStatus").textContent =
      "Motion control requires HTTPS on this browser. 请参阅 HTTPS 配置说明，也可以先使用模拟模式。";
  async function boot() {
    try {
      // V1 preferences are neither credentials nor a source of library ownership.
      for (const key of ["flick-role", "flick-device-id", "flick-track"]) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
      const session = await api("/api/session");
      csrfToken = session.csrfToken;
      state.device = session.device;
      log(
        session.restored ? "Device session restored" : "Device session created",
      );
      render();
      await loadTracks();
      await sounds.reload(api).catch((err) => log("Sound settings load failed: " + err.message, "warning"));
      socket.connect();
    } catch (err) {
      notify("无法初始化设备：" + err.message + " 请刷新页面。", "error");
    }
  }
  window.FlickDemo = {
    state, socket, player, sender, musicUI, sounds,
    motion, motionBatch, motionSelection, startMotionBatch
  };
  render();
  renderCueSettings();
  boot();
})();
