"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { createDemoServer } = require("../server");
const { wav } = require("./helpers");

// Real browser pages and media playback; gesture events / autoplay rejection are
// deliberately synthetic. No autoplay-policy bypass flag is used.
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flick-v2-browser-"));
  const output = path.join(__dirname, "..", "test-output");
  fs.mkdirSync(output, { recursive: true });
  const demo = createDemoServer({
    storageDir: dir,
    transferTimeout: 2500,
    offlineGrace: 6000,
  });
  let browser;
  const checks = [],
    errors = [],
    pages = [];
  async function check(name, work) {
    await work();
    checks.push(name);
    console.log("PASS", name);
  }
  try {
    await new Promise((resolve) => demo.server.listen(0, "0.0.0.0", resolve));
    const base = "http://127.0.0.1:" + demo.server.address().port;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    });
    async function phone(name) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      pages.push(page);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base);
      await registered(page);
      await page.locator("#rename").click();
      await page.locator("#nickname").fill(name);
      await page.locator("#renameForm button[type=submit]").click();
      await page.waitForFunction(
        (n) => window.FlickDemo.state.device.nickname === n,
        name,
      );
      await page.evaluate(() => {
        window.receivedEvents = [];
        window.sendCount = 0;
        window.FlickDemo.socket.onAny((event, data) =>
          window.receivedEvents.push({ event, data }),
        );
        window.FlickDemo.socket.onAnyOutgoing((event) => {
          if (event === "transfer:request") window.sendCount++;
        });
      });
      return page;
    }
    const registered = (p) =>
      p.waitForFunction(
        () =>
          window.FlickDemo?.state.deviceRegistered &&
          window.FlickDemo.state.primary,
      );
    const identity = (p) => p.evaluate(() => window.FlickDemo.state.device.id);
    const trackId = (p, name) =>
      p.evaluate(
        (n) =>
          window.FlickDemo.state.tracks.find((t) => t.displayName === n)?.id,
        name,
      );
    const card = (p, id) => p.locator('.song-card[data-track-id="' + id + '"]');
    const send = (p, id, direction = "left") =>
      p.evaluate(({trackId, direction}) => window.transferMusic(trackId, direction),
        {trackId: id, direction});
    const isPlaying = (p) =>
      p.locator("#audio").evaluate((el) => !el.paused && !el.ended);
    async function uploaded(p, files) {
      await p.locator("#files").setInputFiles(files);
      try {
        await p.waitForFunction(
          (names) =>
            !window.FlickDemo.state.uploading &&
            names.every((name) =>
              window.FlickDemo.state.tracks.some((t) => t.displayName === name),
            ),
          files.map((f) => f.name),
          { timeout: 7000 },
        );
      } catch (error) {
        console.error(
          "Upload diagnostics",
          await p.evaluate(() => ({
            names: window.FlickDemo.state.tracks.map((t) => t.displayName),
            notice: document.querySelector("#notice").textContent,
          })),
          errors,
        );
        throw error;
      }
    }
    async function enable(p) {
      await p.locator("#enableAudio").click();
      await p.waitForFunction(() => window.FlickDemo.state.audioReady);
    }
    async function play(p, id) {
      if (
        await p.evaluate(
          (id) =>
            window.FlickDemo.player.snapshot().trackId === id &&
            window.FlickDemo.player.snapshot().isPlaying,
          id,
        )
      )
        return;
      await card(p, id).locator(".card-play").click();
      await p.waitForFunction(
        (id) =>
          window.FlickDemo.player.snapshot().trackId === id &&
          window.FlickDemo.player.snapshot().isPlaying,
        id,
      );
    }
    async function pause(p) {
      await p.locator("#audio").evaluate((el) => el.pause());
    }
    async function settled(p) {
      await p.waitForFunction(
        () =>
          !window.FlickDemo.state.outgoing && !window.FlickDemo.state.incoming,
      );
    }
    async function request(from, to) {
      const id = await identity(to);
      await from
        .locator('.device-card[data-device-id="' + id + '"] .request-pair')
        .click();
      await to.locator("#pairDialog").waitFor({ state: "visible" });
    }
    async function pair(from, to) {
      await request(from, to);
      await to.locator("#acceptPair").click();
      await Promise.all([
        from.waitForFunction(
          () => window.FlickDemo.state.pairingStatus === "paired",
        ),
        to.waitForFunction(
          () => window.FlickDemo.state.pairingStatus === "paired",
        ),
      ]);
    }
    async function gesture(
      p,
      id,
      {
        x1 = -140,
        x2 = -140,
        y = 0,
        duration = 120,
        cancel = false,
        follow = false,
      } = {},
    ) {
      return p.evaluate(
        async ({ id, x1, x2, y, duration, cancel, follow }) => {
          const target = document.querySelector(
              '.song-card[data-track-id="' + id + '"] h3',
            ),
            card = target.closest(".song-card");
          const touch = (identifier, x, yy) =>
            new Touch({ identifier, target, clientX: x, clientY: yy });
          const start = [touch(7, 270, 200), touch(19, 280, 240)],
            end = [touch(7, 270 + x1, 200 + y), touch(19, 280 + x2, 240 + y)];
          const fire = (type, touches, changedTouches) =>
            target.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches,
                targetTouches: touches,
                changedTouches,
              }),
            );
          fire("touchstart", start, start);
          fire("touchmove", end, end);
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const transform = getComputedStyle(card).transform;
          if (follow) {
            const dx = new DOMMatrixReadOnly(transform).m41;
            if (Math.sign(dx) !== Math.sign(x1) || Math.abs(dx) < 40)
              throw new Error("Card did not follow fingers: " + transform);
          }
          await new Promise((r) => setTimeout(r, duration));
          fire(cancel ? "touchcancel" : "touchend", [], end);
          return transform;
        },
        { id, x1, x2, y, duration, cancel, follow },
      );
    }
    // A one-finger leftward drag must open a confirmation modal; two fingers
    // still invoke transfer, never deletion.
    async function deleteGesture(p, id, { x = -145, y = 0, duration = 130, cancel = false } = {}) {
      return p.evaluate(async ({ id, x, y, duration, cancel }) => {
        const target = document.querySelector('.song-card[data-track-id="' + id + '"] h3');
        const one = (xx, yy) => new Touch({ identifier: 71, target, clientX: xx, clientY: yy });
        const fire = (kind, touches, changed) => target.dispatchEvent(new TouchEvent(kind, {
          bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed,
        }));
        fire("touchstart", [one(80, 130)], [one(80, 130)]);
        fire("touchmove", [one(80 + x, 130 + y)], [one(80 + x, 130 + y)]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const followed = new DOMMatrixReadOnly(
          getComputedStyle(target.closest(".song-card")).transform,
        ).m41;
        await new Promise((r) => setTimeout(r, duration));
        fire(cancel ? "touchcancel" : "touchend", [], [one(80 + x, 130 + y)]);
        return followed;
      }, { id, x, y, duration, cancel });
    }
    const fixture = (name, frequency) =>
      name.endsWith(".mp3")
        ? {
            name,
            mimeType: "audio/mpeg",
            buffer: fs.readFileSync(
              path.join(__dirname, "fixtures", "tone.mp3"),
            ),
          }
        : { name, mimeType: "audio/wav", buffer: wav(frequency, 60) };
    const a = await phone("我的手机 A"),
      b = await phone("我的手机 B"),
      c = await phone("旁观设备 C");
    let ax, ay, bz, bx, by;
    await check(
      "three isolated mobile browser sessions register with independent identity",
      async () => {
        assert.equal(
          new Set(await Promise.all([identity(a), identity(b), identity(c)]))
            .size,
          3,
        );
        assert.equal(await a.locator("#onlineCount").textContent(), "2 台");
        assert.equal(await a.locator("audio").count(), 1);
        assert.equal(await a.locator("#roleA,#roleB,#gestureArea").count(), 0);
        assert.equal(
          await a.evaluate(() => document.cookie.includes("flick_session")),
          false,
        );
      },
    );
    await check(
      "multiple uploads retain independent personal lists; real HTML5 Audio plays",
      async () => {
        await uploaded(a, [
          fixture("青柠之夏.mp3", 440),
          fixture("午夜散步.wav", 550),
        ]);
        await uploaded(b, [fixture("海边来信.wav", 660)]);
        ax = await trackId(a, "青柠之夏.mp3");
        ay = await trackId(a, "午夜散步.wav");
        bz = await trackId(b, "海边来信.wav");
        assert.equal(await a.locator(".song-card").count(), 2);
        assert.equal(await b.locator(".song-card").count(), 1);
        assert.equal(await c.locator(".song-card").count(), 0);
        await play(a, ax);
        assert.ok(await isPlaying(a));
      },
    );
    await check(
      "unpaired send rebounds without pausing or success animation",
      async () => {
        await gesture(a, ax);
        await a.waitForFunction(() =>
          document.querySelector("#notice").textContent.includes("配对"),
        );
        assert.ok(await isPlaying(a));
        assert.equal(await a.locator(".send-success").count(), 0);
      },
    );
    await check("single-left deletion is confirmed; short and right swipes do not delete", async () => {
      assert.equal(await a.locator(".card-delete").count(), 0);
      await deleteGesture(a, ax, { x: -60 });
      assert.equal(await a.locator("#deleteTrackDialog").evaluate((el) => el.open), false);
      await deleteGesture(a, ax, { x: 150 });
      assert.equal(await a.locator("#deleteTrackDialog").evaluate((el) => el.open), false);
      const drag = await deleteGesture(a, ax);
      assert.ok(drag < -55);
      await a.locator("#deleteTrackDialog").waitFor({ state: "visible" });
      await a.locator("#cancelDeleteTrack").click();
      assert.ok(await trackId(a, "青柠之夏.mp3"));
    });

    await check("Mac/Windows desktop gesture listener never hijacks plain browser scrolling", async () => {
      // This checks actual DOM event cancellation. Platform-level trackpad
      // navigation interception still requires manual Mac/Win browser testing.
      const observed = await a.evaluate((id) => {
        const el = document.querySelector('.song-card[data-track-id="' + id + '"]');
        const w = (props) => el.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, deltaMode: 0, ...props,
        }));
        return {
          ordinary: w({ deltaX: -140, deltaY: 0 }),
          vertical: w({ deltaX: 0, deltaY: 150, shiftKey: true }),
          shifted: w({ deltaX: -140, deltaY: 0, shiftKey: true }),
        };
      }, ax);
      assert.equal(observed.ordinary, true, "normal horizontal navigation must remain uncanceled");
      assert.equal(observed.vertical, true, "vertical page scrolling must remain uncanceled");
      assert.equal(observed.shifted, false, "Shift+horizontal wheel should be handled");
      await new Promise(r => setTimeout(r, 230));
    });
    await check(
      "directed invitation needs consent; rejection leaves both unpaired; C sees no invitation",
      async () => {
        await request(b, a);
        assert.equal(
          await b.evaluate(() => !!window.FlickDemo.state.pairing),
          false,
        );
        assert.equal(
          await c.locator("#pairDialog").evaluate((el) => el.open),
          false,
        );
        await a.locator("#rejectPair").click();
        await b.waitForFunction(
          () => !window.FlickDemo.state.requests.outgoing,
        );
        assert.equal(
          await a.evaluate(() => !!window.FlickDemo.state.pairing),
          false,
        );
        await pair(b, a);
        assert.equal(
          await c.evaluate(() => !!window.FlickDemo.state.pairing),
          false,
        );
      },
    );
    await check(
      "paired but not audio-ready is rejected: no receiver library mutation",
      async () => {
        const before = await a.evaluate(() => window.sendCount);
        await send(a, ax);
        await settled(a);
        await settled(b);
        assert.equal(await trackId(b, "青柠之夏.mp3"), undefined);
        assert.ok(await isPlaying(a));
        assert.match(await a.locator("#notice").textContent(), /尚未启用音频接收/);
        assert.equal(await a.evaluate(() => window.sendCount), before + 1);
        assert.equal(
          await c.evaluate(() =>
            window.receivedEvents.filter((e) => e.event.startsWith("transfer:")).length),
          0,
        );
      },
    );
    await check(
      "Enable Audio primes real receiver media without confusing pairing state",
      async () => {
        await enable(b);
        assert.equal(
          await b.evaluate(() => window.FlickDemo.state.pairingStatus),
          "paired",
        );
      },
    );
    await check(
      "left swipe follows the card and hands off real playback only after ACK",
      async () => {
        await a.waitForTimeout(1100);
        await a.locator("#audio").evaluate((el) => {
          el.currentTime = 8;
        });
        const before = await a.evaluate(() => window.sendCount);
        await gesture(a, ax, { follow: true });
        await a.waitForFunction(
          () =>
            document.querySelector("#audio").paused &&
            !window.FlickDemo.state.outgoing,
        );
        await settled(b);
        bx = await trackId(b, "青柠之夏.mp3");
        assert.ok(bx);
        assert.ok(await isPlaying(b));
        assert.equal(await a.evaluate(() => window.sendCount), before + 1);
        const position = await b
          .locator("#audio")
          .evaluate((el) => el.currentTime);
        assert.ok(
          position >= 7.8 && position < 11,
          "receiver position " + position,
        );
        assert.equal(await a.locator(".song-card").count(), 2);
        assert.equal(await b.locator(".song-card").count(), 2);
        await a.waitForFunction(
          (id) =>
            !document
              .querySelector('.song-card[data-track-id="' + id + '"]')
              .closest(".song-slot")
              .classList.contains("send-success"),
          ax,
        );
        assert.equal(
          await card(a, ax).evaluate(
            (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41,
          ),
          0,
        );
        await a.waitForFunction(() => !document.querySelector(".restore-card"));
        await a.evaluate(() => scrollTo(0, 0));
        await a.screenshot({
          path: path.join(output, "Flick_Music_V2_Mobile.png"),
          fullPage: true,
        });
        await b.evaluate(() => scrollTo(0, 0));
        await b.screenshot({
          path: path.join(output, "Flick_Music_V2_Receiver.png"),
          fullPage: true,
        });
        await a.setViewportSize({ width: 1180, height: 900 });
        await a.screenshot({
          path: path.join(output, "Flick_Music_V2_Preview.png"),
          fullPage: true,
        });
        await a.setViewportSize({ width: 390, height: 844 });
      },
    );
    await check(
      "right swipe shares a non-playing card without borrowing another track position",
      async () => {
        await enable(a); // reverse receiving requires a separate, explicit opt-in
        await gesture(b, bz, { x1: 140, x2: 140, follow: true });
        await settled(b);
        await settled(a);
        assert.ok(await trackId(a, "海边来信.wav"));
        assert.ok(await isPlaying(b));
        const last = demo.db
          .prepare("SELECT * FROM transfers ORDER BY created_at DESC LIMIT 1")
          .get();
        assert.equal(last.direction, "right");
        assert.equal(last.current_time, 0);
        assert.equal(last.playback_status, "not-requested");
        assert.match(
          await b.locator(".send-stamp").first().textContent(),
          /Send Already/,
        );
      },
    );
    await check(
      "rightward reverse playback handoff uses the same protocol",
      async () => {
        await enable(a);
        await b.locator("#audio").evaluate((el) => {
          el.currentTime = 12;
        });
        await gesture(b, bx, { x1: 140, x2: 140 });
        await b.waitForFunction(() => document.querySelector("#audio").paused);
        await settled(a);
        assert.ok(await isPlaying(a));
        assert.ok(
          await a.locator("#audio").evaluate((el) => el.currentTime >= 11.8),
        );
      },
    );
    await check(
      "receiver playing another song retains playback while importing selected song",
      async () => {
        await play(b, bz);
        await play(a, ay);
        await send(a, ay);
        await settled(a);
        await settled(b);
        by = await trackId(b, "午夜散步.wav");
        assert.ok(by);
        assert.ok(await isPlaying(a));
        assert.equal(
          await b.evaluate(() => window.FlickDemo.player.snapshot().trackId),
          bz,
        );
        assert.ok(await isPlaying(b));
        assert.match(await a.locator("#notice").textContent(), /未自动播放/);
      },
    );
    await check(
      "injected NotAllowedError keeps received song and A playback; tap prompt is visible",
      async () => {
        await pause(b);
        await b.evaluate(() => {
          window.savedPlay = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = () =>
            Promise.reject(
              new DOMException("Autoplay blocked for test", "NotAllowedError"),
            );
        });
        await send(a, ay);
        await b.waitForFunction(() =>
          document
            .querySelector("#notice")
            .textContent.includes("Tap to allow playback"),
        );
        await settled(a);
        assert.ok(await isPlaying(a));
        assert.equal(
          await b.evaluate(() => window.FlickDemo.state.audioReady),
          false,
        );
        assert.equal(await trackId(b, "午夜散步.wav"), by);
        await b.evaluate(() => {
          HTMLMediaElement.prototype.play = window.savedPlay;
        });
        await enable(b);
      },
    );
    await check(
      "duplicate transfer triggers produce exactly one network request",
      async () => {
        const before = await a.evaluate(() => window.sendCount);
        await a.evaluate((id) => {
          window.transferMusic(id, "left");
          window.transferMusic(id, "right");
        }, ay);
        await settled(a);
        await settled(b);
        assert.equal(await a.evaluate(() => window.sendCount), before + 1);
        assert.equal(await b.locator(".song-card").count(), 3);
      },
    );
    await check(
      "vertical/short/slow/stationary-finger/cancelled touches never send",
      async () => {
        await play(a, ax);
        const before = await a.evaluate(() => window.sendCount);
        await gesture(a, ax, { y: 130 });
        await gesture(a, ax, { x1: 15, x2: 15 });
        await gesture(a, ax, { duration: 850 });
        await gesture(a, ax, { x1: -240, x2: 0 });
        await gesture(a, ax, { cancel: true });
        assert.equal(await a.evaluate(() => window.sendCount), before);
        assert.ok(await isPlaying(a));
        assert.equal(
          await card(a, ax).evaluate((el) =>
            el.style.getPropertyValue("--drag-x"),
          ),
          "0px",
        );
      },
    );
    await check(
      "native one-finger vertical scrolling is preserved on a song card",
      async () => {
        await card(a, ax).scrollIntoViewIfNeeded();
        const box = await card(a, ax).locator("h3").boundingBox(),
          before = await a.evaluate(() => ({
            y: scrollY,
            count: window.sendCount,
          }));
        const cdp = await a.context().newCDPSession(a),
          x = box.x + 20,
          y = box.y + 8;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        for (const delta of [20, 45, 70, 100]) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y - delta }],
          });
          await a.waitForTimeout(20);
        }
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await a.waitForTimeout(200);
        const after = await a.evaluate(() => ({
          y: scrollY,
          count: window.sendCount,
        }));
        assert.ok(after.y > before.y + 20, "native scroll moved vertically");
        assert.equal(after.count, before.count);
        await cdp.detach();
      },
    );
    await check(
      "multi-selection disables gestures and sending; cancelled batch deletion changes nothing",
      async () => {
        await a.locator("#manage").click();
        const before = await a.evaluate(() => window.sendCount);
        await gesture(a, ax);
        assert.equal(await a.evaluate(() => window.sendCount), before);
        assert.equal(
          await card(a, ax).locator(".card-send").count(),
          0,
        );
        await card(a, ax).locator(".track-checkbox").check();
        await card(a, ay).locator(".track-checkbox").check();
        a.once("dialog", (dialog) => dialog.dismiss());
        await a.locator("#deleteSelected").click();
        assert.equal(await a.locator(".song-card").count(), 3);
        await a.locator("#exitSelection").click();
      },
    );
    await check(
      "deleting an unrelated song preserves current playback and the peer copy",
      async () => {
        const id = await trackId(a, "海边来信.wav");
        const drag = await deleteGesture(a, id);
        assert.ok(drag < -55, "card should follow a single finger leftward");
        await a.locator("#deleteTrackDialog").waitFor({ state: "visible" });
        await a.locator("#confirmDeleteTrack").click();
        await a.waitForFunction(
          (id) => !window.FlickDemo.state.tracks.some((t) => t.id === id),
          id,
        );
        assert.ok(await isPlaying(a));
        assert.ok(await trackId(b, "海边来信.wav"));
      },
    );
    await check(
      "Socket reconnect re-registers and verifies pairing before another send",
      async () => {
        const old = await b.evaluate(() => window.FlickDemo.socket.id);
        await b.evaluate(() => window.FlickDemo.socket.io.engine.close());
        await b.waitForFunction(
          (id) =>
            window.FlickDemo.state.deviceRegistered &&
            window.FlickDemo.socket.id !== id &&
            window.FlickDemo.state.pairingStatus === "paired",
          old,
        );
        assert.equal(await b.evaluate(() => window.FlickDemo.state.audioReady), false);
        await enable(b); // reconnect intentionally clears the receiving opt-in
        await pause(b);
        await send(a, ax);
        await a.waitForFunction(() => document.querySelector("#audio").paused);
        await settled(b);
        assert.ok(await isPlaying(b));
      },
    );
    await check(
      "near-end MP3 handoff clamps to a finite legal seek position",
      async () => {
        await play(a, ax);
        await pause(b);
        await b.evaluate(() => {
          window.lastSeek = null;
          document.querySelector("#audio").addEventListener("seeked", () => {
            const a = document.querySelector("#audio");
            window.lastSeek = { time: a.currentTime, duration: a.duration };
          });
        });
        await a.evaluate((id) => {
          const a = document.querySelector("#audio");
          a.currentTime = a.duration - 0.02;
          window.transferMusic(id, "left");
        }, ax);
        await settled(a);
        await settled(b);
        const seek = await b.evaluate(() => window.lastSeek);
        assert.ok(seek && Number.isFinite(seek.time));
        assert.ok(seek.time >= 0 && seek.time < seek.duration);
        const transfer = demo.db
          .prepare("SELECT * FROM transfers ORDER BY created_at DESC LIMIT 1")
          .get();
        assert.equal(transfer.playback_status, "playing");
      },
    );
    await check(
      "refresh retains Cookie identity and private songs; Audio Ready is newly initialized",
      async () => {
        const id = await identity(b),
          count = await b.locator(".song-card").count();
        await b.reload();
        await registered(b);
        assert.equal(await identity(b), id);
        await b.waitForFunction(
          (n) => window.FlickDemo.state.tracks.length === n,
          count,
        );
        assert.equal(
          await b.evaluate(() => window.FlickDemo.state.audioReady),
          false,
        );
        assert.equal(
          await b.evaluate(() => window.FlickDemo.state.pairingStatus),
          "paired",
        );
        await enable(b);
      },
    );
    await check(
      "a newer tab controls the same identity; closing the old tab cannot clear it",
      async () => {
        const id = await identity(c),
          next = await c.context().newPage();
        await next.goto(base);
        await registered(next);
        assert.equal(await identity(next), id);
        await c.waitForFunction(() => !window.FlickDemo.state.primary);
        await c.close();
        assert.ok(demo.devices.isOnline(id));
        assert.equal(
          await next.evaluate(() => window.FlickDemo.state.primary),
          true,
        );
        await next.close();
      },
    );
    await check(
      "loss of playback ACK never pauses the sender and does not retract delivery",
      async () => {
        await play(a, ax);
        // The preceding near-end case intentionally left this track close to
        // its natural end. Test ACK loss from the middle of the song instead.
        await a.locator("#audio").evaluate((el) => {
          el.currentTime = 4;
        });
        await pause(b);
        await b.evaluate(() => {
          const socket = window.FlickDemo.socket;
          window.savedEmit = socket.emit;
          socket.emit = function (event, ...args) {
            if (event === "transfer:playback") return this;
            return window.savedEmit.call(this, event, ...args);
          };
        });
        await send(a, ax);
        await a.waitForFunction(() => !window.FlickDemo.state.outgoing);
        assert.ok(await isPlaying(a));
        assert.ok(await trackId(b, "青柠之夏.mp3"));
        assert.match(await a.locator("#notice").textContent(), /确认超时/);
        await b.evaluate(() => {
          window.FlickDemo.socket.emit = window.savedEmit;
        });
        await settled(b);
      },
    );
    await check(
      "switching the sender song during metadata loading cancels stale handoff",
      async () => {
        await play(a, ay);
        await pause(b);
        await b.route("**/api/tracks/*/stream", async (route) => {
          await new Promise((r) => setTimeout(r, 800));
          await route.continue().catch(() => {});
        });
        await send(a, ay);
        await a.waitForFunction(() => !!window.FlickDemo.state.outgoing);
        await play(a, ax);
        await a.waitForTimeout(900);
        assert.equal(
          await a.evaluate(() => window.FlickDemo.player.snapshot().trackId),
          ax,
        );
        assert.ok(await isPlaying(a));
        await b.unroute("**/api/tracks/*/stream");
        await settled(b);
      },
    );
    await check(
      "deleting the current song stops its player; received copy survives and reloads",
      async () => {
        await play(a, ay);
        await deleteGesture(a, ay);
        await a.locator("#deleteTrackDialog").waitFor({ state: "visible" });
        await a.locator("#confirmDeleteTrack").click();
        await a.waitForFunction(() => !window.FlickDemo.player.current());
        assert.equal(await isPlaying(a), false);
        assert.ok(await trackId(b, "午夜散步.wav"));
        await a.reload();
        await registered(a);
        assert.equal(await trackId(a, "午夜散步.wav"), undefined);
      },
    );
    await check(
      "confirmed batch deletion removes selected received songs but keeps peer references",
      async () => {
        await b.locator("#manage").click();
        await card(b, bx).locator(".track-checkbox").check();
        await card(b, by).locator(".track-checkbox").check();
        b.once("dialog", (dialog) => dialog.accept());
        await b.locator("#deleteSelected").click();
        await b.waitForFunction(
          () => window.FlickDemo.state.tracks.length === 1,
        );
        assert.ok(await trackId(a, "青柠之夏.mp3"));
        await b.locator("#exitSelection").click();
      },
    );
    await check(
      "manual unpair and offline target leave the sender playing without a success stamp",
      async () => {
        await play(a, ax);
        await a.locator("#disconnectPair").click();
        await a.waitForFunction(() => !window.FlickDemo.state.pairing);
        await b.waitForFunction(() => !window.FlickDemo.state.pairing);
        await gesture(a, ax);
        assert.ok(await isPlaying(a));
        assert.equal(await a.locator(".send-success").count(), 0);
        await pair(b, a);
        await b.context().close();
        await a.waitForFunction(
          () => window.FlickDemo.state.pairingStatus === "peer-offline",
        );
        await a.evaluate((id) => window.transferMusic(id, "right"), ax);
        assert.ok(await isPlaying(a));
      },
    );
    await check(
      "mobile/desktop layout stays in bounds; Debug Log and reduced motion work",
      async () => {
        assert.ok(
          await a.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await a.locator(".debug-panel summary").click();
        assert.match(
          await a.locator("#logs").textContent(),
          /Device session restored/,
        );
        assert.ok(
          !(await a
            .locator("#logs")
            .evaluate((el) => /flick_session|csrfToken/.test(el.textContent))),
        );
        await a.locator(".debug-panel summary").click();
        await a.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await a.evaluate(
            (id) =>
              getComputedStyle(
                document.querySelector(
                  '.song-card[data-track-id="' + id + '"]',
                ),
              ).transitionDuration,
            ax,
          ),
          "0s",
        );
        await a.emulateMedia({ reducedMotion: "no-preference" });
        await a.evaluate(() => scrollTo(0, 0));
        await a.screenshot({
          path: path.join(output, "Final_Mobile_State.png"),
          fullPage: true,
        });
        await a.setViewportSize({ width: 1180, height: 900 });
        assert.ok(
          await a.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await a.screenshot({
          path: path.join(output, "Final_Desktop_State.png"),
          fullPage: true,
        });
        assert.deepEqual(errors, []);
      },
    );
    fs.writeFileSync(
      path.join(output, "browser-results.json"),
      JSON.stringify(
        {
          browser: browser.version(),
          scope:
            "Chromium mobile emulation, three independent cookies, real audio playback; synthetic TouchEvent and injected NotAllowedError; no physical phone",
          checks,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "Browser checks:",
      checks.length,
      "PASS; page errors:",
      errors.length,
    );
  } catch (error) {
    for (let i = 0; i < pages.length; i++)
      if (!pages[i].isClosed()) {
        console.error(
          "Page diagnostic",
          i,
          await pages[i].evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            viewport: visualViewport.width,
            scrollY,
            notice: document.querySelector("#notice").textContent,
            cards: [...document.querySelectorAll(".song-card")].map((el) => ({
              name: el.querySelector("h3").textContent,
              className: el.className,
              style: el.getAttribute("style"),
              rect: el.getBoundingClientRect().toJSON(),
              transform: getComputedStyle(el).transform,
            })),
          })),
        );
        await pages[i].screenshot({
          path: path.join(output, "failure-" + i + ".png"),
          fullPage: true,
        });
      }
    throw error;
  } finally {
    await browser?.close();
    await demo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
