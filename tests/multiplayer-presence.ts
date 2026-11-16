import assert from 'node:assert/strict';
import {Presence, type PresencePayload} from '../src/multiplayer/Presence.ts';

// Fake remote replica: records tick/update like PlayerModel without three.js.
interface FakeModel {
  root: {position: {set(x: number, y: number, z: number): void}; removeFromParent(): void};
  ticks: Array<[number, number, number, number]>;
  updates: number;
  detached: boolean;
  x: number; y: number; z: number;
}
const makeFake = (): FakeModel => {
  const model: FakeModel = {
    root: {
      position: {set(x: number, y: number, z: number) { model.x = x; model.y = y; model.z = z; }},
      removeFromParent() { model.detached = true; },
    },
    ticks: [],
    updates: 0,
    detached: false,
    x: 0, y: 0, z: 0,
  };
  return model;
};
const tickOf = (model: FakeModel) => ({
  tick(yaw: number, pitch: number, dx: number, dz: number) { model.ticks.push([yaw, pitch, dx, dz]); },
  update() { model.updates++; },
  root: model.root,
});

// --- broadcastLocal: 10Hz payload {id,x,y,z,yaw,pitch,seq} ---
const sent: string[] = [];
let now = 1000;
const local = new Presence('me', text => { sent.push(text); }, {now: () => now});
const player = {position: [10, 64, -3] as const, yaw: 1.2, pitch: -0.1};

assert.equal(local.broadcastLocal(player), true, 'first broadcast sends');
assert.equal(sent.length, 1);
const first = JSON.parse(sent[0]) as PresencePayload;
assert.deepEqual(Object.keys(first).sort(), ['id', 'pitch', 'seq', 'x', 'y', 'yaw', 'z']);
assert.deepEqual(first, {id: 'me', x: 10, y: 64, z: -3, yaw: 1.2, pitch: -0.1, seq: 1});

assert.equal(local.broadcastLocal(player), false, 'immediate repeat is throttled (10Hz)');
assert.equal(sent.length, 1);
now += 99;
assert.equal(local.broadcastLocal(player), false, '99ms still throttled');
now += 1;
assert.equal(local.broadcastLocal(player), true, '100ms boundary sends');
assert.equal((JSON.parse(sent[1]) as PresencePayload).seq, 2, 'seq increments per send');

// --- applyRemote: senderID+seq dedup, latest-seq-wins under delay/reorder ---
const fakes = new Map<string, FakeModel>();
const remote = new Presence('me', () => {}, {
  now: () => now,
  createModel: (id: string) => {
    const fake = makeFake();
    fakes.set(id, fake);
    return tickOf(fake);
  },
});

assert.equal(remote.applyRemote({id: 'me', x: 0, y: 64, z: 0, yaw: 0, pitch: 0, seq: 99}), false, 'own echo dropped by senderID');
assert.equal(remote.size, 0);

assert.equal(remote.applyRemote({id: 'a', x: 1, y: 64, z: 1, yaw: 0.5, pitch: 0, seq: 1}), true);
assert.equal(remote.applyRemote({id: 'a', x: 2, y: 64, z: 2, yaw: 0.6, pitch: 0, seq: 2}), true);
// Delayed duplicate of seq 1 arrives after seq 2: must not rewind.
assert.equal(remote.applyRemote({id: 'a', x: 1, y: 64, z: 1, yaw: 0.5, pitch: 0, seq: 1}), false, 'stale seq ignored');
// Exact duplicate also ignored.
assert.equal(remote.applyRemote({id: 'a', x: 2, y: 64, z: 2, yaw: 0.6, pitch: 0, seq: 2}), false, 'duplicate seq ignored');
const a = remote.remote('a')!;
assert.deepEqual([a.x, a.y, a.z, a.seq], [2, 64, 2, 2], 'latest seq wins');
// Reordered: seq 4 applied, then late seq 3 dropped.
assert.equal(remote.applyRemote({id: 'a', x: 4, y: 64, z: 4, yaw: 0, pitch: 0, seq: 4}), true);
assert.equal(remote.applyRemote({id: 'a', x: 3, y: 64, z: 3, yaw: 0, pitch: 0, seq: 3}), false);
assert.equal(remote.remote('a')!.x, 4);

// Object overload parity: (id, pos, yaw, pitch, seq) form.
assert.equal(remote.applyRemote('b', [5, 65, 6], 1, 0.2, 7), true);
assert.deepEqual([remote.remote('b')!.x, remote.remote('b')!.seq], [5, 7]);

// Replica display: PlayerModel tick/update clone, positioned at the remote.
const replica = fakes.get('a')!;
assert.equal(fakes.size, 2, 'one replica per remote sender');
assert.deepEqual([replica.x, replica.y, replica.z], [4, 64, 4], 'replica root follows latest position');
assert(replica.ticks.length >= 2, 'replica tick driven per apply');
assert.deepEqual(replica.ticks.at(-1)!.slice(0, 2), [0, 0], 'replica tick gets remote yaw/pitch');
assert.equal(replica.ticks.at(-1)![2], 2, 'replica tick dx tracks movement (4-2)');
assert(replica.updates >= 2, 'replica update driven per apply');

// Local Movement/Collision untouched: broadcast only reads the local player.
const frozen = Object.freeze({position: Object.freeze([0, 64, 0]) as unknown as [number, number, number], yaw: 0, pitch: 0});
assert.equal(local.broadcastLocal(frozen), false, 'throttled call never mutates local player');
assert.deepEqual([...frozen.position], [0, 64, 0]);

// Leave: replica detached from the scene graph.
assert.equal(remote.remove('a'), true);
assert.equal(replica.detached, true, 'replica root removed on leave');
assert.equal(remote.remote('a'), undefined);
assert.equal(remote.remove('a'), false, 'double remove is a no-op');

console.log('Multiplayer presence passed: 10Hz {id,x,y,z,yaw,pitch,seq} payload, senderID+seq dedup, latest-seq-wins, PlayerModel replica display.');
