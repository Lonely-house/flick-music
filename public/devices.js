(function (root) {
  "use strict";
  root.renderDevices = function (container, list, state, onRequest) {
    container.replaceChildren();
    const peers = list
      .filter((d) => d.id !== state.device?.id)
      .sort((a, b) => Number(b.online) - Number(a.online));
    if (!peers.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "让另一台设备打开相同地址，它会出现在这里。";
      container.append(p);
    }
    for (const d of peers) {
      const card = document.createElement("div");
      card.className = "device-card";
      card.dataset.deviceId = d.id;
      const monogram = document.createElement("span");
      monogram.className = "device-avatar";
      monogram.textContent = d.nickname.slice(0, 1);
      const copy = document.createElement("div");
      copy.className = "device-copy";
      const name = document.createElement("strong");
      name.textContent = d.nickname;
      const status = document.createElement("small");
      status.textContent =
        d.id.slice(0, 8) +
        " · " +
        (!d.online ? "离线" : d.paired ? "已配对" : "在线 · 可连接");
      copy.append(name, status);
      const button = document.createElement("button");
      button.className = "small-button request-pair";
      button.textContent =
        state.pairing?.peer.id === d.id ? "已连接" : "请求连接";
      button.disabled =
        !d.available ||
        !!state.pairing ||
        !!state.requests.outgoing ||
        !state.deviceRegistered ||
        !state.primary;
      button.addEventListener("click", () => onRequest(d.id));
      card.append(monogram, copy, button);
      container.append(card);
    }
  };
})(window);
