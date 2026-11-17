import assert from 'node:assert/strict';
import {WorldGate, chunkData, isWorldGateMessage, encodeGateMessage, decodeGateMessage} from '../src/multiplayer/WorldGate.ts';

// Both sides know the same sample catalog; each side also knows its own saves.
const samples = ['tutorial', 'demo'];
const savedIds = ['local:mine'];

// --- Sample一致は転送0で local ---
const local = new WorldGate({samples, savedIds, roomWorld: 'sample:demo'});
assert.equal(local.resolveWorld('sample:demo'), 'local');
assert.equal(local.resolveWorld('tutorial'), 'local', 'bare sample id also matches');
assert.equal(local.resolveWorld('local:mine'), 'local', 'own save matches with zero transfer');
assert.equal(local.decision, 'local');
assert.equal(local.transferBytesNeeded, 0, 'local reload needs no transfer');
assert.equal(local.canPlay, true, 'local match can play immediately');
assert.equal(local.canEnter, true);
assert.equal(local.receiveComplete(0, 0), true, 'nothing to receive counts as complete');
assert.equal(local.progress(), 1);

// --- 不一致/カスタムは transfer: 全チャンク受信完了まで参加不可 ---
const guest = new WorldGate({samples, savedIds, roomWorld: 'local:host-custom'});
assert.equal(guest.resolveWorld('local:host-custom'), 'transfer');
assert.equal(guest.resolveWorld('local:unknown'), 'transfer');
assert.equal(guest.decision, 'transfer');
assert.equal(guest.canPlay, false, 'enter/play blocked before any byte');
assert.equal(guest.canEnter, false);
assert.equal(guest.takeBytes(), undefined, 'no ImportWorker handoff before 100%');
assert.equal(guest.receiveComplete(0, 8), false);

// Host splits its WorldStore bytes; guest reassembles out of order.
const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const host = new WorldGate({samples: [], savedIds: ['local:host-custom'], roomWorld: 'local:host-custom'});
host.setSource(original, 3);
assert.equal(host.chunkCount, 3);
const meta = host.metaMessage();
assert.equal(isWorldGateMessage(meta), true, 'meta carries kind for the future dispatcher');
guest.beginTransfer(original.length, host.chunkCount);
assert.equal(guest.canPlay, false);
assert.equal(guest.receiveChunk(2, host.chunkData(2)), false, 'last chunk alone is not complete');
assert.equal(guest.progress() < 1, true);
assert.equal(guest.canPlay, false, 'partial receipt still blocks play');
assert.equal(guest.takeBytes(), undefined, 'no handoff while partial');
assert.equal(guest.receiveChunk(2, host.chunkData(2)), false, 'duplicate chunk is a no-op');
assert.equal(guest.receiveChunk(0, host.chunkData(0)), false);
assert.equal(guest.progress(), 5 / 8);
const done = guest.receiveChunk(1, host.chunkData(1));
assert.equal(done, true, '100% arrival completes');
assert.equal(guest.receiveComplete(8, 8), true);
assert.equal(guest.canPlay, true, 'play allowed only at 100%');
assert.equal(guest.canEnter, true);
assert.deepEqual(guest.takeBytes(), original, 'complete bytes hand off to the ImportWorker path');
assert.deepEqual(guest.progress(), 1);

// --- 進捗とキャンセル ---
const retry = new WorldGate({samples, savedIds, roomWorld: 'local:host-custom'});
retry.beginTransfer(4, 2);
retry.receiveChunk(0, new Uint8Array([9, 9]));
assert.equal(retry.progress(), 0.5);
assert.equal(retry.canPlay, false);
retry.cancel();
assert.equal(retry.progress(), 0, 'cancel drops buffered bytes');
assert.equal(retry.canPlay, false, 'cancelled gate keeps play blocked');
assert.equal(retry.receiveComplete(0, 4), false);
assert.equal(retry.takeBytes(), undefined);
retry.beginTransfer(4, 2);
retry.receiveChunk(0, new Uint8Array([9, 9]));
retry.receiveChunk(1, new Uint8Array([9, 9]));
assert.equal(retry.canPlay, true, 're-transfer after cancel can still complete');

// --- 世界切替: transfer→transferでも旧バイトを漏らさない ---
const sw = new WorldGate({samples, savedIds, roomWorld: 'local:world-a'});
assert.equal(sw.decision, 'transfer');
sw.beginTransfer(4, 2);
sw.receiveChunk(0, new Uint8Array([1, 1]));
assert.equal(sw.progress(), 0.5);
assert.equal(sw.transferBytesNeeded, 2);
assert.equal(sw.resolveWorld('local:world-b'), 'transfer');
assert.equal(sw.decision, 'transfer');
assert.equal(sw.progress(), 0, 'switch drops buffered bytes');
assert.equal(sw.transferBytesNeeded, 0);
assert.equal(sw.receiveComplete(), false);
assert.equal(sw.canPlay, false);
assert.equal(sw.takeBytes(), undefined);
const swHost = new WorldGate({samples, savedIds, roomWorld: 'local:world-a'});
swHost.setSource(new Uint8Array([1, 2, 3, 4]), 2);
assert.equal(swHost.chunkCount, 2);
swHost.resolveWorld('local:world-b');
assert.equal(swHost.chunkCount, 0, 'switch drops the host source too');

// --- kind付き: dispatcherは kind で振り分け、素のpresenceは触らない ---
const request = guest.requestMessage();
assert.equal(isWorldGateMessage(request), true);
assert.equal((request as {kind: string}).kind, 'world-request');
for(const wire of [request, meta, host.chunkMessage(0), {kind: 'world-complete', worldId: 'local:host-custom'}]) {
  assert.equal(isWorldGateMessage(JSON.parse(JSON.stringify(wire))), true, 'kind survives the wire');
}
assert.equal(isWorldGateMessage(JSON.stringify({kind: 'world-chunk'})), false, 'raw strings are not messages');
assert.equal(isWorldGateMessage({id: 'a', x: 1, y: 2, z: 3, yaw: 0, pitch: 0, seq: 1}), false, 'bare presence stays untouched');
assert.equal(isWorldGateMessage({kind: 'edit', sender: 'h', seq: 1, changes: []}), false, 'edits route elsewhere');
assert.equal(isWorldGateMessage(null), false);

// --- world-announce: short room keys resolve to worlds only in-band ---
{
  const host = new WorldGate({samples: ['tutorial'], savedIds: [], roomWorld: 'tutorial'});
  const hello = host.announceMessage('Tutorial World · TU14');
  assert.equal(hello.kind, 'world-announce');
  const wire = encodeGateMessage(hello);
  assert.equal(typeof wire, 'string', 'announce travels as string-only JSON');
  const back = decodeGateMessage(wire);
  assert(back?.kind === 'world-announce' && back.worldId === 'tutorial' && back.name === 'Tutorial World · TU14', 'announce survives the wire with id and name');
  assert.equal(isWorldGateMessage(hello), true, 'announce routes to the gate dispatcher');
}

// --- string-only wire: base64 framing survives a JSON transport round-trip ---
{
  const host = new WorldGate({samples: [], savedIds: ['local:host-custom'], roomWorld: 'local:host-custom'});
  const original = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  host.setSource(original, 4);
  assert.equal(host.decision, 'local', 'host owns the world, no transfer for itself');
  const guest = new WorldGate({samples: [], savedIds: [], roomWorld: 'local:host-custom'});
  assert.equal(guest.decision, 'transfer');
  const wire = [encodeGateMessage(host.metaMessage())];
  for(let i = 0; i < host.chunkCount; i++) wire.push(encodeGateMessage(host.chunkMessage(i)));
  assert(wire.every(text => typeof text === 'string'), 'every gate message travels as string-only JSON');
  const meta = decodeGateMessage(wire[0]);
  if(!meta || meta.kind !== 'world-meta') throw new Error('meta did not survive the wire');
  guest.beginTransfer(meta.total, meta.chunks);
  for(const text of wire.slice(1)) {
    const msg = decodeGateMessage(text);
    if(!msg || msg.kind !== 'world-chunk') throw new Error('chunk did not survive the wire');
    assert(msg.data instanceof Uint8Array, 'base64 data decodes back to bytes');
    guest.receiveChunk(msg.index, msg.data);
  }
  assert.equal(guest.canPlay, true, 'string-only wire still gates play until 100%');
  assert.deepEqual(guest.takeBytes(), original, 'complete bytes hand off after base64 framing');
  assert.equal(decodeGateMessage('not-json{{{'), null, 'garbage is not a gate message');
  assert.equal(decodeGateMessage(JSON.stringify({kind: 'edit', sender: 'h', seq: 1, changes: []})), null, 'edits never route to the gate');
  const passthrough = host.metaMessage();
  assert.equal(decodeGateMessage(passthrough), passthrough, 'in-memory messages pass through untouched');
}

// --- zero-byte transfer is rejected loudly instead of deadlocking play ---
{
  const zero = new WorldGate({samples: [], savedIds: [], roomWorld: 'local:empty'});
  assert.equal(zero.decision, 'transfer');
  assert.throws(() => zero.beginTransfer(0, 0), /positive byte total/, 'total 0 throws instead of blocking forever');
  assert.throws(() => zero.beginTransfer(0), /positive byte total/);
  assert.equal(zero.canPlay, false, 'rejected gate never unblocks play');
  assert.equal(zero.takeBytes(), undefined);
}

// --- chunkData: host-side split helper ---
assert.deepEqual(chunkData(new Uint8Array([1, 2, 3]), 10), [new Uint8Array([1, 2, 3])], 'short input stays one chunk');
assert.throws(() => chunkData(new Uint8Array([1]), 0), /chunk size/, 'non-positive chunk size throws');

console.log('Multiplayer gate passed: sample match reloads locally with zero transfer; custom worlds stay blocked until 100% with progress/cancel; ImportWorker handoff only when complete; kind-tagged messages route the future dispatcher.');
