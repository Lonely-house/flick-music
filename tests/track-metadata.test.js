"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseID3, readTrackTags } = require("../public/trackMetadata");

function frame(id, value) {
  const payload=Buffer.concat([Buffer.from([3]),Buffer.from(value,"utf8")]);
  const header=Buffer.alloc(10);
  header.write(id,0,"latin1");
  header.writeUInt32BE(payload.length,4);
  return Buffer.concat([header,payload]);
}
function mp3(artist,title) {
  const payload=Buffer.concat([frame("TPE1",artist),frame("TIT2",title)]);
  const header=Buffer.from([0x49,0x44,0x33,3,0,0,
    (payload.length>>21)&127,(payload.length>>14)&127,
    (payload.length>>7)&127,payload.length&127]);
  return Buffer.concat([header,payload]);
}
test("ID3v2.3 utf8 title and artist recognized safely", () => {
  const body=mp3("苏打绿","蝉想");
  assert.deepEqual(parseID3(body),{artist:"苏打绿",title:"蝉想"});
});
test("Non-ID3 or truncated audio doesn't crash metadata parser", () => {
  assert.equal(parseID3(new Uint8Array()),null);
  assert.equal(parseID3(Buffer.from("RIFFWAV")),null);
  assert.equal(parseID3(Buffer.from([73,68,51,3,0,0,0,0,0,50,84,73])),null);
});
test("Private authenticated stream range request is read only for mp3", async () => {
  const bytes=mp3("Test Artist","Test Title");
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;
    assert.equal(url,"/api/tracks/my-track/stream");
    assert.equal(options.headers.Range,"bytes=0-131071");
    assert.equal(options.credentials,"same-origin");
    return {ok:true,arrayBuffer:async()=>bytes};
  };
  const track={id:"my-track",audioUrl:"/api/tracks/my-track/stream",
     mimeType:"audio/mpeg",displayName:"foo.mp3"};
  assert.equal((await readTrackTags(track,fetcher)).artist,"Test Artist");
  assert.equal(await readTrackTags({...track,mimeType:"audio/wav",displayName:"foo.wav"},fetcher),null);
  assert.equal(calls,1);
});
