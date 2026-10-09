"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { attach, wheelPixels } = require("../public/desktopGesture");

function harness({wheelSign = () => 1} = {}) {
  const listeners = {};
  const events = [];
  const card = {
    clientWidth: 450,
    style: { setProperty: (...args) => events.push(["style", ...args]) },
    classList: { toggle: (...args) => events.push(["class", ...args]) },
    addEventListener(type, callback, options) { listeners[type] = { callback, options }; },
    removeEventListener(type) { delete listeners[type]; },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
    releasePointerCapture() {},
  };
  const actions = [];
  let time = 1000;
  let enabled = true;
  const teardown = attach(card, (dir) => { actions.push(dir); return true; }, {
    clock: () => time,
    enabled: () => enabled,
    wheelSign,
  });
  function dispatch(type, options={}) {
    const e = {
      target: { closest() { return options.interactive ? {} : null; } },
      cancelable: true,
      deltaMode: 0, deltaX: 0, deltaY: 0,
      clientX: 0, clientY: 0, pointerType: "mouse", pointerId: 1, button: 0,
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      preventDefault() { this.prevented = true; },
      ...options,
    };
    listeners[type].callback(e);
    return e;
  }
  return { actions, events, card, listeners, dispatch, teardown,
    setTime: (n) => time=n, setEnabled: (n) => enabled=n };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test("wheel pixels normalizes line and page deltas", () => {
  assert.deepEqual(wheelPixels({deltaX: 2, deltaY: -1, deltaMode: 1}), {x:32,y:-16});
  assert.deepEqual(wheelPixels({deltaX: -1, deltaY: 1, deltaMode: 2}, 640), {x:-640,y:640});
  assert.deepEqual(wheelPixels({deltaX: -12, deltaY: 0, deltaMode: 0}), {x:-12,y:0});
});

test("trackpad: plain horizontal swipe and Shift+vertical scroll never intercepted", async () => {
  const h=harness();
  let e=h.dispatch("wheel", {deltaX:-145});
  assert.equal(e.prevented, undefined);
  e=h.dispatch("wheel", {shiftKey:true, deltaY:155});
  assert.equal(e.prevented, undefined);
  e=h.dispatch("wheel", {shiftKey:true, deltaX:-145, ctrlKey:true});
  assert.equal(e.prevented, undefined);
  await sleep(200);
  assert.deepEqual(h.actions, []);
  assert.equal(h.listeners.wheel.options.passive, false);
  h.teardown();
});

test("trackpad Shift+left sends after quiet interval; repeats are cooled down", async () => {
  const h=harness();
  const event=h.dispatch("wheel",{shiftKey:true,deltaX:-62});
  h.dispatch("wheel",{shiftKey:true,deltaX:-67});
  assert.equal(event.prevented, true);
  assert.deepEqual(h.actions, []);
  await sleep(215);
  assert.deepEqual(h.actions, ["left"]);
  h.dispatch("wheel",{shiftKey:true,deltaX:190});
  await sleep(210);
  assert.deepEqual(h.actions, ["left"]);
  h.teardown();
});

test("trackpad Shift+right sends; too short, diagonal and non-cancelable ignored", async () => {
  const h=harness();
  h.dispatch("wheel",{shiftKey:true,deltaX:95});
  await sleep(210);
  assert.deepEqual(h.actions, []);
  h.dispatch("wheel",{shiftKey:true,deltaX:140,deltaY:125});
  h.dispatch("wheel",{shiftKey:true,deltaX:130,cancelable:false});
  await sleep(210);
  assert.deepEqual(h.actions, []);
  h.dispatch("wheel",{shiftKey:true,deltaX:145});
  await sleep(210);
  assert.deepEqual(h.actions, ["right"]);
  h.teardown();
});

test("pointer: mouse left/right drag sends, short drag and button origin ignored", () => {
  const h=harness();
  h.dispatch("pointerdown",{clientX:250,clientY:90,interactive:true});
  h.dispatch("pointerup",{clientX:60,clientY:90});
  assert.deepEqual(h.actions, []);
  h.dispatch("pointerdown",{clientX:250,clientY:90});
  h.dispatch("pointermove",{clientX:190,clientY:90});
  h.dispatch("pointerup",{clientX:190,clientY:90});
  assert.deepEqual(h.actions, []);
  h.setTime(2000);
  h.dispatch("pointerdown",{clientX:250,clientY:90});
  h.dispatch("pointermove",{clientX:90,clientY:94});
  h.dispatch("pointerup",{clientX:90,clientY:94});
  assert.deepEqual(h.actions, ["left"]);
  h.setTime(3000);
  h.dispatch("pointerdown",{clientX:40,clientY:100});
  h.dispatch("pointermove",{clientX:175,clientY:100});
  h.dispatch("pointerup",{clientX:175,clientY:100});
  assert.deepEqual(h.actions, ["left","right"]);
  h.teardown();
});

test("touch pointer, vertical mouse drag, mouse cancel, disabled and slow drag do not send", () => {
  const h=harness();
  h.dispatch("pointerdown",{pointerType:"touch",clientX:200});
  h.dispatch("pointerup",{pointerType:"touch",clientX:0});
  h.dispatch("pointerdown",{clientX:200,clientY:0});
  h.dispatch("pointermove",{clientX:185,clientY:110});
  h.dispatch("pointerup",{clientX:0,clientY:110});
  h.dispatch("pointerdown",{clientX:200});
  h.dispatch("pointermove",{clientX:0});
  h.dispatch("pointercancel",{clientX:0});
  h.dispatch("pointerup",{clientX:0});
  h.setEnabled(false);
  h.dispatch("pointerdown",{clientX:250});
  h.dispatch("pointerup",{clientX:0});
  h.setEnabled(true);
  h.setTime(2200);
  h.dispatch("pointerdown",{clientX:250});
  h.setTime(3500);
  h.dispatch("pointermove",{clientX:0});
  h.dispatch("pointerup",{clientX:0});
  assert.deepEqual(h.actions, []);
  h.teardown();
});

test("focused song card Shift+arrows sends, normal arrows and repetitions don't", () => {
  const h=harness();
  h.dispatch("keydown",{target:h.card,key:"ArrowLeft"});
  h.dispatch("keydown",{target:h.card,key:"ArrowLeft",shiftKey:true,repeat:true});
  assert.deepEqual(h.actions, []);
  const e=h.dispatch("keydown",{target:h.card,key:"ArrowLeft",shiftKey:true});
  assert.equal(e.prevented,true);
  assert.deepEqual(h.actions, ["left"]);
  h.setTime(2000);
  h.dispatch("keydown",{target:h.card,key:"ArrowRight",shiftKey:true});
  assert.deepEqual(h.actions, ["left","right"]);
  h.teardown();
});

test("detach cancels pending wheel gesture", async () => {
  const h=harness();
  h.dispatch("wheel",{shiftKey:true,deltaX:-140});
  h.teardown();
  await sleep(210);
  assert.deepEqual(h.actions, []);
});


test("mac/win wheel inversion is configurable; keyboard remains unchanged", async () => {
  let sign=-1;
  const h=harness({wheelSign:()=>sign});
  h.dispatch("wheel",{shiftKey:true,deltaX:146});
  await sleep(220);
  assert.deepEqual(h.actions,["left"]);
  h.setTime(2200); sign=1;
  h.dispatch("wheel",{shiftKey:true,deltaX:146});
  await sleep(220);
  assert.deepEqual(h.actions,["left","right"]);
  h.setTime(3300);
  h.dispatch("keydown",{target:h.card,shiftKey:true,key:"ArrowLeft"});
  assert.deepEqual(h.actions,["left","right","left"]);
  h.teardown();
});
