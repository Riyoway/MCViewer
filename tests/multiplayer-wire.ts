import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WorldGate, encodeGateMessage, decodeGateMessage} from '../src/multiplayer/WorldGate.ts';
import {EditSync, type EditMessage} from '../src/multiplayer/EditSync.ts';
import type {BlockChange} from '../src/minecraft/Building.ts';
import type {Vec3} from '../src/minecraft/types.ts';
import {languages, type Catalog} from '../src/ui/Language.ts';

// End-to-end custom join over a string-only transport, mirroring the main.ts
// seams: gateJoinWorld -> encodeGateMessage wire -> decodeGateMessage ->
// receiveChunk -> takeBytes (the openSelected handoff input).
{
  const samples = ['tutorial'];
  const worldId = 'local:host-custom';
  const original = new Uint8Array([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]);
  // Host owns the world: local decision, serves WorldStore bytes as chunks.
  const hostGate = new WorldGate({samples, savedIds: [worldId], roomWorld: worldId});
  assert.equal(hostGate.decision, 'local');
  hostGate.setSource(original, 4);
  // Guest joins by room code: transfer decision, requests, then receives.
  const guestGate = new WorldGate({samples, savedIds: [], roomWorld: worldId});
  assert.equal(guestGate.decision, 'transfer');
  assert.equal(guestGate.canPlay, false);
  const request = encodeGateMessage(guestGate.requestMessage());
  assert.equal(typeof request, 'string');
  assert.equal(decodeGateMessage(request)?.kind, 'world-request');
  // Host serve: meta + every chunk, each framed as base64 JSON text.
  const wire = [encodeGateMessage(hostGate.metaMessage())];
  for(let i = 0; i < hostGate.chunkCount; i++) wire.push(encodeGateMessage(hostGate.chunkMessage(i)));
  const meta = decodeGateMessage(wire[0]);
  if(!meta || meta.kind !== 'world-meta') throw new Error('meta lost on the wire');
  guestGate.beginTransfer(meta.total, meta.chunks);
  assert.equal(guestGate.canPlay, false, 'enter stays blocked mid-transfer');
  assert.equal(guestGate.takeBytes(), undefined, 'no handoff while partial');
  // Out-of-order arrival still reassembles exactly.
  for(const text of wire.slice(1).reverse()) {
    const msg = decodeGateMessage(text);
    if(!msg || msg.kind !== 'world-chunk') throw new Error('chunk lost on the wire');
    guestGate.receiveChunk(msg.index, msg.data);
  }
  assert.equal(guestGate.canPlay, true, 'play unlocks only at 100%');
  assert.deepEqual(guestGate.takeBytes(), original, 'guest bytes equal the host source');
}

// Host rejection converges: the guest applies its proposal optimistically
// (World.change path), the host validates + rejects, then rebroadcasts the
// current authoritative voxels (correctGuestEdit in main.ts) so the proposer
// reverts instead of diverging.
{
  const hostVox = new Map<string, number>([['8,1,8', 0]]);
  const guestVox = new Map<string, number>([['8,1,8', 0]]);
  const guestSend: string[] = [], hostSend: string[] = [];
  const host = new EditSync('host:abc123', text => { hostSend.push(text); },
    {isHost: true, hostId: 'host:abc123',
      apply: changes => { let changed = false; for(const c of changes) { const k = c.position.join(','); if(hostVox.get(k) !== c.id) { hostVox.set(k, c.id); changed = true; } } return changed; },
      validate: changes => changes.every(c => c.position.join(',') !== '8,1,8')});
  const guest = new EditSync('guest:1', text => { guestSend.push(text); },
    {isHost: false, hostId: 'host:abc123',
      apply: changes => { let changed = false; for(const c of changes) { const k = c.position.join(','); if(guestVox.get(k) !== c.id) { guestVox.set(k, c.id); changed = true; } } return changed; }});
  // Optimistic local apply, then broadcast (the World onEdit path).
  const proposal: BlockChange[] = [{position: [8, 1, 8], id: 7}];
  guestVox.set('8,1,8', 7);
  assert.equal(guest.broadcastEdit(proposal), true);
  assert.equal(host.applyRemoteEdit(guestSend[0]), false, 'host rejects the player-overlapping edit');
  assert.equal(hostVox.get('8,1,8'), 0, 'host voxels untouched');
  // correctGuestEdit mirror: diff the proposal against authoritative voxels.
  const wire = JSON.parse(guestSend[0]) as EditMessage;
  const corrections: BlockChange[] = [];
  for(const change of wire.changes) {
    const current = hostVox.get(change.position.join(',')) ?? 0;
    if(current !== change.id) corrections.push({position: [...change.position] as Vec3, id: current});
  }
  assert.equal(corrections.length, 1, 'one correction restores air');
  assert.equal(host.broadcastEdit(corrections), true, 'host rebroadcasts the authoritative value');
  assert.equal(guest.applyRemoteEdit(hostSend.at(-1)!), true, 'guest applies the host correction');
  assert.equal(guestVox.get('8,1,8'), 0, 'proposer reverts: replicas converge');
  assert.equal(host.applyRemoteEdit(hostSend.at(-1)!), false, 'host drops its own correction echo');
}

// Invalid room codes fail before any RTC work, and every locale ships the
// message the room UI shows for them.
{
  const {parseRoomCode} = await import('../src/multiplayer/Room.ts');
  for(const bad of ['', 'no-separator', '#abc123', 'a b#cdef12']) {
    assert.throws(() => parseRoomCode(bad), /Invalid room code/);
  }
  for(const [code] of languages) {
    const data: Catalog = JSON.parse(await readFile(`public/menu/locales/${code}.json`, 'utf8'));
    assert(data.ui['Invalid room code']?.trim(), `${code}: missing Invalid room code`);
  }
  const main = await readFile('src/main.ts', 'utf8');
  assert(main.includes("'Invalid room code'"), 'main.ts must show the localized invalid-code message');
  assert(main.includes('room-error'), 'room UI must surface the invalid-code message');
}

console.log('Multiplayer wire passed: string-only custom join reassembles host bytes at 100%, host rejection reverts the proposer, invalid codes show a localized message.');
