"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSoundService, KINDS, checkKind, MAX_CUE_BYTES } = require("../server/soundService");
const { validFilename, validKind } = require("../public/soundEffects");
function sampleWav() {
  const b = Buffer.alloc(44 + 800 * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(1600, 40);
  return b;
}
test("four server-wide cue keys and file selection boundaries", () => {
  assert.deepEqual(KINDS, ["paired","receiverReady","uploaded","delivered"]);
  assert.equal(validKind("delivered"),true);
  assert.equal(validKind("random"),false);
  assert.equal(validFilename({name:"hint.mp3",size: MAX_CUE_BYTES}),true);
  assert.equal(validFilename({name:"hint.wav",size: 12}),true);
  assert.equal(validFilename({name:"hint.txt",size: 200}),false);
  assert.equal(validFilename({name:"hint.mp3",size: MAX_CUE_BYTES + 1}),false);
  assert.equal(validFilename({name:"hint.mp3",size: 2}),false);
  assert.throws(() => checkKind("../settings.json"),{status:404});
});
test("global soundpack persists, replaces atomically, and resets per event", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"flick-sound-test-"));
  try {
    let service = createSoundService(dir);
    const audio = sampleWav();
    for (const kind of KINDS) {
      const s = service.put(kind,{originalname:kind + ".wav",buffer:audio});
      assert.equal(s.name,kind + ".wav");
      assert.ok(s.url.startsWith("/api/sounds/" + kind + "/file?v="));
      assert.equal(fs.readFileSync(service.file(kind).filename).length,audio.length);
    }
    const first = service.list().paired.revision;
    service = createSoundService(dir);
    assert.equal(service.list().paired.revision,first);
    const oldPath = service.file("paired").filename;
    const changed = service.put("paired", {originalname:"new.wav",buffer:audio});
    assert.notEqual(changed.revision,first);
    assert.equal(fs.existsSync(oldPath),false);
    service.reset("paired");
    assert.equal(service.list().paired,null);
    assert.ok(service.list().uploaded);
    assert.throws(() => service.file("paired"),{status:404});
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test("soundpack rejects renamed nonaudio, wrong keys and oversized payload", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"flick-sound-test-"));
  try {
    const service = createSoundService(dir);
    assert.throws(() => service.put("paired",{originalname:"fake.wav", buffer:Buffer.alloc(100,0)}),{status:415});
    assert.throws(() => service.put("paired",{originalname:"fake.wav", buffer:Buffer.alloc(MAX_CUE_BYTES+1)}),{status:415});
    assert.throws(() => service.put("paired",{originalname:"fake.html",buffer:sampleWav()}),{status:415});
    assert.throws(() => service.put("evil",{originalname:"a.wav",buffer:sampleWav()}),{status:404});
    assert.equal(fs.readdirSync(service.dir).length,0);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
