import assert from 'node:assert/strict';
import {EditSync, type EditMessage} from '../src/multiplayer/EditSync.ts';
import {Building, type BlockChange} from '../src/minecraft/Building.ts';
import {EditStore} from '../src/minecraft/EditStore.ts';
import {Voxels} from '../src/minecraft/Voxels.ts';
import type {Vec3} from '../src/minecraft/types.ts';

// Fake voxel stores: one per side, World.setBlock semantics (identical set is a no-op).
const store = () => {
  const map = new Map<string, number>();
  let writes = 0;
  return {
    get writes() { return writes; },
    apply: (changes: BlockChange[]) => {
      let changed = false;
      for(const change of changes) {
        const key = change.position.join(',');
        if(map.get(key) !== change.id) { map.set(key, change.id); writes++; changed = true; }
      }
      return changed;
    },
    at: (p: Vec3) => map.get(p.join(',')),
  };
};

// Host validation simulates Building's player-AABB guard: [8,1,8] is inside
// the local player, so the host rejects any edit touching it.
const hostValidate = (changes: BlockChange[]) =>
  changes.every(change => change.position.join(',') !== '8,1,8');

const hostVox = store(), guestVox = store(), guestBVox = store();
const hostSend: string[] = [], guestSend: string[] = [];
const host = new EditSync('host', text => { hostSend.push(text); },
  {isHost: true, hostId: 'host', apply: hostVox.apply, validate: hostValidate});
const guest = new EditSync('guestA', text => { guestSend.push(text); },
  {isHost: false, hostId: 'host', apply: guestVox.apply});
const guestB = new EditSync('guestB', () => {},
  {isHost: false, hostId: 'host', apply: guestBVox.apply});

// --- place round-trip: guest proposes, host validates + rebroadcasts, all apply once ---
const place: BlockChange[] = [{position: [8, 2, 8], id: 7}];
assert.equal(guest.broadcastEdit(place), true, 'valid local proposal sends');
assert.equal(guestSend.length, 1);
const wire = JSON.parse(guestSend[0]) as EditMessage;
assert.equal(wire.kind, 'edit', 'edit carries its own kind discriminator');
assert.deepEqual([wire.sender, wire.seq], ['guestA', 1]);
assert.deepEqual(wire.changes, place);

assert.equal(host.applyRemoteEdit(guestSend[0]), true, 'host accepts the valid proposal');
assert.equal(hostVox.at([8, 2, 8]), 7);
assert.equal(hostSend.length, 1, 'host rebroadcasts validated edits to everyone');
const rebroadcast = JSON.parse(hostSend[0]) as EditMessage;
assert.deepEqual([rebroadcast.kind, rebroadcast.sender], ['edit', 'host']);

assert.equal(host.applyRemoteEdit(guestSend[0]), false, 'replayed proposal is dropped (no doubling)');
assert.equal(hostVox.writes, 1, 'host applied the proposal exactly once');

assert.equal(guest.applyRemoteEdit(hostSend[0]), true, 'guest applies the host rebroadcast');
assert.equal(guestVox.at([8, 2, 8]), 7);
assert.equal(guest.applyRemoteEdit(hostSend[0]), false, 'rebroadcast replay is dropped');
assert.equal(guestVox.writes, 1, 'guest applied the edit exactly once');
assert.equal(guest.applyRemoteEdit(guestSend[0]), false, 'own echo is dropped by senderID');
assert.equal(host.applyRemoteEdit(hostSend[0]), false, 'host drops its own echo');
assert.equal(guestB.applyRemoteEdit(guestSend[0]), false, 'guests ignore non-host senders');

// --- destroy round-trip from the host ---
assert.equal(host.broadcastEdit([{position: [8, 2, 8], id: 0}]), true);
assert.equal(guest.applyRemoteEdit(hostSend[1]), true, 'host destroy applies on guests');
assert.equal(guestVox.at([8, 2, 8]), 0);
assert.equal(guest.broadcastEdit([]), false, 'empty edit never sends');
assert.equal(guestSend.length, 1);

// --- host rejection is unanimous: player-AABB interference applies nowhere ---
const bad: BlockChange[] = [{position: [8, 1, 8], id: 7}];
assert.equal(guest.broadcastEdit(bad), true, 'guest may still propose it locally');
const badWire = guestSend.at(-1)!;
assert.equal(host.applyRemoteEdit(badWire), false, 'host rejects the player-overlapping edit');
assert.equal(hostVox.at([8, 1, 8]), undefined, 'host voxels untouched');
assert.equal(hostSend.length, 2, 'rejected edits are never rebroadcast');
assert.equal(guest.applyRemoteEdit(badWire), false, 'guest drops its own echo');
assert.equal(guestB.applyRemoteEdit(badWire), false, 'other guests ignore non-host senders');
assert.equal(guestVox.at([8, 1, 8]), undefined);
assert.equal(guestBVox.at([8, 1, 8]), undefined, 'rejected edit applies nowhere');

// --- kind discriminator: presence payloads pass through untouched ---
const presence = JSON.stringify({id: 'guestA', x: 1, y: 64, z: 1, yaw: 0, pitch: 0, seq: 9});
assert.equal(host.applyRemoteEdit(presence), false, 'presence payload (no kind) ignored by EditSync');
assert.equal(guest.applyRemoteEdit(presence), false);
assert.equal(host.applyRemoteEdit('not-json{{{'), false, 'garbage ignored');
assert.equal(host.applyRemoteEdit(JSON.stringify({kind: 'edit'})), false, 'shape violations ignored');

// --- Building: send hook only, ruling logic untouched ---
const voxels = new Voxels();
voxels.set(8, 1, 8, 5);
const fakeManifest = {blocks: [], lookup: {}} as any;
fakeManifest.blocks[5] = {name: 'stone', state: 'minecraft:stone'};
const seen: BlockChange[][] = [];
const building = new Building(voxels, fakeManifest, 'vanilla', () => true, changes => { seen.push(changes); });
const destroyed = building.destroy({position: [8, 1, 8], face: 'up', point: [8.5, 1.5, 8.5], id: 5, distance: 1});
assert.equal(destroyed.length, 1, 'destroy ruling unchanged');
assert.equal(seen.length, 1, 'successful destroy fires the send hook once');
assert.deepEqual(seen[0], destroyed);
assert.equal(building.place('diamond_sword', {position: [8, 1, 8], face: 'up', point: [8.5, 1.5, 8.5], id: 5, distance: 1}, [0, 0, 1], [-10, 8, -10]), null, 'place ruling unchanged');
assert.equal(seen.length, 1, 'failed place never fires the hook');

// --- EditStore: remote re-apply records nothing twice ---
const edits = new EditStore('mp', undefined);
const editManifest = {blocks: []} as any;
editManifest.blocks[7] = {name: 'stone', state: 'minecraft:stone'};
edits.record([8, 2, 8], 0, 0, editManifest);
assert.equal(edits.cells.size, 0, 'no-op edit records nothing');
assert.equal(edits.originals.size, 0, 'no-op edit leaves no original behind');
edits.record([8, 2, 8], 0, 7, editManifest);
edits.record([8, 2, 8], 0, 7, editManifest);
assert.equal(edits.cells.size, 1, 'remote replay keeps a single cell entry');
assert.equal(edits.originals.get('8,2,8'), 0, 'original stays the first-seen value');
edits.clear();

console.log('Multiplayer edits passed: host-authority place/destroy round-trip without doubling, unanimous host rejection, echo drop, kind discriminator, Building hook-only, EditStore single-record.');
