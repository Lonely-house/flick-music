"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io } = require("socket.io-client");
const { createDemoServer } = require("../server");
function waitEvent(socket, name, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, onEvent);
      reject(new Error("Missing event " + name));
    }, ms);
    const onEvent = (data) => {
      clearTimeout(timer);
      resolve(data);
    };
    socket.once(name, onEvent);
  });
}
const ack = (socket, event, data) =>
  new Promise((resolve, reject) =>
    socket
      .timeout(2000)
      .emit(event, data, (err, result) =>
        err ? reject(err) : resolve(result),
      ),
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function wav(frequency = 440, seconds = 1) {
  const rate = 8000,
    count = Math.floor(rate * seconds),
    b = Buffer.alloc(44 + count * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    b.writeInt16LE(
      Math.round(1500 * Math.sin((2 * Math.PI * frequency * i) / rate)),
      44 + 2 * i,
    );
  return b;
}
async function harness(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flick-v2-test-"));
  let demo = createDemoServer({ storageDir: dir, ...options }),
    clients = [],
    base;
  async function listen() {
    await new Promise((r) => demo.server.listen(0, "127.0.0.1", r));
    base = "http://127.0.0.1:" + demo.server.address().port;
  }
  await listen();
  t.after(async () => {
    clients.forEach((c) => c.socket?.disconnect());
    await demo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function fetchAs(client, url, init = {}) {
    return fetch(base + url, {
      ...init,
      headers: {
        Cookie: client.cookie,
        "X-CSRF-Token": client.session.csrfToken,
        ...init.headers,
      },
    });
  }
  async function connect(client) {
    const s = io(base, {
      autoConnect: false,
      forceNew: true,
      extraHeaders: { Cookie: client.cookie },
      reconnectionDelay: 10,
    });
    client.socket = s;
    client.events = [];
    s.onAny((name, data) => {
      client.events.push({ name, data });
      if (name === "device:state") client.state = data;
    });
    s.on("connect", async () => {
      const r = await ack(s, "device:register", { audioReady: false });
      client.state = r;
    });
    const connected = waitEvent(s, "device:state");
    s.connect();
    await connected;
    return s;
  }
  async function client(nickname) {
    const r = await fetch(base + "/api/session");
    const c = {
      cookie: r.headers.get("set-cookie").split(";")[0],
      session: await r.json(),
    };
    clients.push(c);
    await fetchAs(c, "/api/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
    await connect(c);
    return c;
  }
  async function upload(
    c,
    bytes = wav(),
    name = "song.wav",
    type = "audio/wav",
  ) {
    const body = new FormData();
    body.append("audio", new Blob([bytes], { type }), name);
    const response = await fetchAs(c, "/api/tracks", { method: "POST", body });
    return { response, data: await response.json() };
  }
  async function tracks(c) {
    const r = await fetchAs(c, "/api/tracks");
    return (await r.json()).tracks;
  }
  async function pair(a, b) {
    const request = await ack(b.socket, "pair:request", {
      targetId: a.session.device.id,
    });
    if (!request.ok) throw new Error(request.message);
    const accepted = await ack(a.socket, "pair:accept", {
      requestId: request.request.id,
    });
    if (!accepted.ok) throw new Error(accepted.message);
    return accepted.pairing;
  }
  async function restart() {
    clients.forEach((c) => c.socket.disconnect());
    await demo.close();
    demo = createDemoServer({ storageDir: dir, ...options });
    await listen();
  }
  return {
    get demo() {
      return demo;
    },
    get base() {
      return base;
    },
    dir,
    client,
    connect,
    fetchAs,
    upload,
    tracks,
    pair,
    restart,
  };
}
module.exports = { harness, ack, waitEvent, delay, wav };
