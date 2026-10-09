"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createDevices } = require("../server/deviceManager");
const { createTransfers } = require("../server/transferService");

function fixture() {
  const names = {a:"A",b:"B"};
  const rows = [];
  const db = {
    prepare(query) {
      if (query.startsWith("SELECT * FROM transfers WHERE id=?"))
        return {get() {return fixture.transferRow || null;}};
      if (query.startsWith("SELECT id,nickname FROM devices WHERE id=?"))
        return {get(id) {return {id,nickname:names[id] || "?"};}};
      if (query.startsWith("SELECT id,nickname,last_seen_at FROM devices"))
        return {all(){return [];}};
      if (query.startsWith("SELECT 1 FROM pair_members"))
        return {get(){return undefined;}};
      if (query.startsWith("UPDATE devices SET last_seen_at"))
        return {run(){return {changes:1};}};
      throw new Error("UNEXPECTED database access: " + query);
    },
  };
  const io = {to() {return {emit(){}};}};
  const auth = {verifySocket() {}};
  const devices = createDevices(io, db, auth);
  const makeSocket=(id)=>({
    id:"socket-"+id,data:{deviceId:id},join(){},emit(){},
  });
  const a=makeSocket("a"), b=makeSocket("b");
  devices.register(a,{audioReady:true}); // attacker-controlled registration payload
  devices.register(b,{audioReady:true});
  const pairId=randomUUID();
  const pairings = {
    row(id) {return {id:pairId,a_id:"a",b_id:"b"};},
  };
  const transfers = createTransfers(db, devices, pairings, {}, {});
  return {devices,transfers,a,b,pairId};
}

test("socket registration cannot forge receiver opt-in", () => {
  const f=fixture();
  assert.equal(f.devices.snapshot(f.b).audioReady, false);
  assert.equal(f.devices.canReceive("b"),false);
  f.devices.ready(f.b,true);
  assert.equal(f.devices.canReceive("b"),true);
  f.devices.disconnect(f.b);
  assert.equal(f.devices.canReceive("b"),false);
});

test("pairing alone cannot create transfer metadata before receiver is ready", () => {
  const f=fixture();
  assert.equal(f.devices.canReceive("b"),false);
  const payload={requestKey:randomUUID(),trackId:randomUUID(),
    pairId:f.pairId,direction:"left",isPlaying:false,currentTime:0};
  assert.throws(
    ()=>f.transfers.request(f.a,payload),
    (e)=> e.status===409 && /尚未启用音频接收/.test(e.message)
  );
  // Rejected before even fetching source or inserting the receiver library record.
});

test("receiver can't confirm storage if its current socket is not enabled", () => {
  const f=fixture();
  const id=randomUUID();
  // Only query of known transfer metadata is permitted before readiness check.
  const fakeRow={id,receiver_id:"b",receiver_socket_id:f.b.id};
  const localDb = {prepare(sql) {
    if (sql==="SELECT * FROM transfers WHERE id=?")
      return {get(){return fakeRow;}};
    throw new Error("No mutation should occur: " + sql);
  }};
  const t=createTransfers(localDb,f.devices,{row(){return null;}},{},{});
  assert.throws(()=>t.stored(f.b,{transferId:id}),
    (e)=>e.status===409 && /权限未启用/.test(e.message));
});
