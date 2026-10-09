"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FlickDetector, portraitAxes } = require("../public/motionGesture");
const { MotionBatch } = require("../public/motionBatch");
const data = (x, y=0, z=0) => ({acceleration:{x,y,z}});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test("motion: two consistent left peaks trigger; cooling blocks duplicates", () => {
  const d = new FlickDetector({ threshold:13 });
  assert.equal(d.feed(data(-14,2),100).direction,null);
  assert.equal(d.feed(data(-15,1),140).direction,"left");
  assert.equal(d.feed(data(-16),170).direction,null);
  assert.equal(d.feed(data(-18),210).direction,null);
  assert.equal(d.feed(data(-14),2500).direction,null);
  assert.equal(d.feed(data(-15),2600).direction,"left");
});

test("motion: right, orientation, inversion, vertical rejection, stale sample", () => {
  const d = new FlickDetector({ direction:"right", threshold:12 });
  assert.equal(d.feed(data(-19),100).direction,null);
  assert.equal(d.feed(data(-19),130).direction,null);
  assert.equal(d.feed(data(20,25),170).direction,null);
  assert.equal(d.feed(data(18,1),200).direction,null);
  assert.equal(d.feed(data(18,1),230).direction,"right");
  assert.equal(portraitAxes({x:2,y:17,z:0},90).x,-17);
  assert.equal(portraitAxes({x:2,y:17,z:0},270).x,17);
  assert.equal(portraitAxes({x:-17,y:1,z:0},180).x,17);
  const reversed = new FlickDetector({ inverted:true });
  reversed.feed(data(-19),100);
  assert.equal(reversed.feed(data(-20),150).direction,"right");
  d.configure({threshold:999, direction:"invalid"});
  assert.equal(d.threshold,30);
  assert.equal(d.direction,"both");
});

test("motion: slow gesture, invalid samples, gravity-only filter", () => {
  const d = new FlickDetector({ threshold:13 });
  d.feed(data(-18),0);
  assert.equal(d.feed(data(-18),320).direction,null);
  assert.equal(d.feed({acceleration:null},340).direction,null);
  const g = new FlickDetector();
  const withGravity=(x)=>({acceleration:null,
    accelerationIncludingGravity:{x,y:9.8,z:0}});
  assert.equal(g.feed(withGravity(0),100).direction,null);
  assert.equal(g.feed(withGravity(0),120).direction,null);
  assert.equal(g.feed(withGravity(-19),140).direction,null);
  assert.equal(g.feed(withGravity(-20),160).direction,"left");
});

function harness() {
  const sent=[], delivered=[], failed=[], finished=[];
  const tracks = {A:{id:"A"},B:{id:"B"},C:{id:"C"}};
  const state={deviceRegistered:true,primary:true,pairing:{peer:{online:true},id:"pair"}};
  const sender = {socket:{connected:true},pending:null,
    request(track,dir,st,extra) {
      sent.push({id:track.id,dir,interaction:extra.interaction});
      this.pending={id:track.id}; return true;
    },
    cancel() {this.pending=null;}
  };
  const batch=new MotionBatch({sender,getState:()=>state,getTrack:(id)=>tracks[id],
    onDelivered:(...args)=>delivered.push(args),
    onFailed:(id)=>failed.push(id),onFinish:(v)=>finished.push(v),
    pauseMs:20});
  return {batch,sender,tracks,state,sent,delivered,failed,finished};
}

test("batch: sequential ACK, distinct songs, duplicate suppression, partial failure", async () => {
  const h=harness();
  assert.equal(h.batch.start(["A","B","A","C"],"left"),true);
  assert.deepEqual(h.sent,[{id:"A",dir:"left",interaction:"motion"}]);
  assert.equal(h.batch.delivered("A","left","tx1"),true);
  assert.equal(h.batch.delivered("A","left","tx1"),false);
  h.sender.pending=null;h.batch.idle();
  await sleep(35);
  assert.equal(h.sent[1].id,"B");
  h.sender.pending=null;h.batch.idle();
  await sleep(35);
  assert.equal(h.sent[2].id,"C");
  assert.equal(h.batch.delivered("C","left","tx3"),true);
  h.sender.pending=null;h.batch.idle();
  await sleep(35);
  assert.equal(h.finished.length,1);
  assert.equal(h.finished[0].success,2);
  assert.equal(h.finished[0].failed,1);
  assert.deepEqual(h.failed,["B"]);
});

test("batch: validates online pairing, existing transfer and cancellation", async () => {
  const h=harness();
  h.state.pairing=null;
  assert.equal(h.batch.start(["A"],"left"),false);
  h.state.pairing={id:"pair",peer:{online:true}};
  h.sender.pending={track:"existing"};
  assert.equal(h.batch.start(["A"],"left"),false);
  h.sender.pending=null;
  assert.equal(h.batch.start(["A","B"],"right"),true);
  assert.equal(h.batch.start(["A"],"left"),false);
  h.batch.stop();
  await sleep(40);
  assert.equal(h.sent.length,1);
  assert.equal(h.finished[0].failed,2);
});

test("batch: interrupted peer leaves undelivered songs as failures", async () => {
  const h=harness();
  h.batch.start(["A","B","C"],"left");
  h.batch.delivered("A","left","tx1");
  h.sender.pending=null;h.batch.idle();
  h.state.pairing.peer.online=false;
  await sleep(40);
  assert.equal(h.sent.length,1);
  assert.equal(h.finished[0].success,1);
  assert.equal(h.finished[0].failed,2);
});
