import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Presence} from '../src/multiplayer/Presence.ts';
import {WorldGate} from '../src/multiplayer/WorldGate.ts';
import {createRoomCode, joinRoom} from '../src/multiplayer/Room.ts';
import {encodeSignal} from '../src/multiplayer/Signaling.ts';
import {languages, type Catalog} from '../src/ui/Language.ts';

// --- 1. Host env follow: low-frequency {kind:'env'} sky/weather overwrite ---
{
  const sent: string[] = [];
  let now = 0;
  const host = new Presence('host', text => { sent.push(text); }, {now: () => now});
  assert.equal(host.broadcastEnv(6100, 'rain'), true, 'first env broadcast sends');
  const wire = JSON.parse(sent[0]);
  assert.equal(wire.kind, 'env', 'env carries its own kind discriminator');
  assert.deepEqual([wire.sender, wire.time, wire.weather], ['host', 6100, 'rain']);
  assert.equal(typeof wire.seq, 'number');
  assert.equal(host.broadcastEnv(6200, 'rain'), false, 'env repeats are throttled (low frequency)');
  now += 999;
  assert.equal(host.broadcastEnv(6200, 'rain'), false, '999ms still throttled');
  now += 1;
  assert.equal(host.broadcastEnv(6200, 'rain'), true, '1000ms boundary sends');
  assert.equal(host.broadcastEnv(Number.NaN, 'rain'), false, 'non-finite time never sends');
  assert.equal(host.broadcastEnv(6000, 'storm'), false, 'unknown weather never sends');

  const guest = new Presence('guest', () => {}, {now: () => now});
  assert.deepEqual(guest.applyHostEnv(sent[0], 'host'), {time: 6100, weather: 'rain'}, 'guest follows the host sky/weather value');
  assert.equal(guest.applyHostEnv(sent[0], 'host'), false, 'replayed env is dropped');
  assert.equal(guest.applyHostEnv(JSON.stringify({...wire, sender: 'guest', seq: 99})), false, 'own echo dropped');
  assert.equal(guest.applyHostEnv(JSON.stringify({...wire, sender: 'intruder', seq: 99}), 'host'), false, 'non-host sender ignored when hostId is known');
  const open = new Presence('guest2', () => {});
  assert.deepEqual(open.applyHostEnv(JSON.stringify({...wire, sender: 'host', seq: 5})), {time: 6100, weather: 'rain'}, 'without hostId any non-self sender applies (single-host rooms)');
  assert.equal(guest.applyHostEnv(JSON.stringify({id: 'host', x: 1, y: 64, z: 1, yaw: 0, pitch: 0, seq: 9})), false, 'presence payload ignored by env');
  assert.equal(guest.applyHostEnv(JSON.stringify({kind: 'edit', sender: 'host', seq: 9, changes: []})), false, 'edits ignored by env');
  assert.equal(guest.applyHostEnv('not-json{{{'), false, 'garbage ignored');
  assert.equal(guest.applyHostEnv(JSON.stringify({...wire, seq: 50, weather: 'storm'})), false, 'unknown weather rejected');
  assert.equal(guest.applyHostEnv(JSON.stringify({...wire, seq: 51, time: null})), false, 'non-finite time rejected');
}

// --- 2. Stale remotes: remove() wiring + map-switch sweep ---
{
  const detached: string[] = [];
  const model = (id: string) => ({
    root: {
      position: {set() {}},
      removeFromParent() { detached.push(id); },
    },
    tick() {},
    update() {},
  });
  const presence = new Presence('me', () => {}, {createModel: model});
  assert.equal(presence.applyRemote({id: 'a', x: 1, y: 64, z: 1, yaw: 0, pitch: 0, seq: 1}), true);
  assert.equal(presence.applyRemote({id: 'b', x: 2, y: 64, z: 2, yaw: 0, pitch: 0, seq: 1}), true);
  assert.equal(presence.size, 2);
  assert.equal(presence.remove('a'), true, 'leave detaches the replica');
  assert.deepEqual(detached, ['a']);
  assert.equal(presence.remove('a'), false, 'double remove is a no-op');
  presence.clear();
  assert.equal(presence.size, 0, 'map switch drops stale remotes');
  assert.deepEqual(detached, ['a', 'b']);
}

// --- 3. Host leaves -> guests drop the session; rejoin re-syncs ---
{
  const samples = ['tutorial'];
  const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const guestGate = new WorldGate({samples, savedIds: [], roomWorld: 'local:host-custom'});
  assert.equal(guestGate.decision, 'transfer');
  const hostGate = new WorldGate({samples, savedIds: [], roomWorld: 'local:host-custom'});
  hostGate.setSource(original, 3);
  guestGate.beginTransfer(original.length, hostGate.chunkCount);
  for(let i = 0; i < hostGate.chunkCount; i++) guestGate.receiveChunk(i, hostGate.chunkData(i));
  assert.equal(guestGate.canEnter, true, 'enter enabled only at 100%');
  assert.deepEqual(guestGate.takeBytes(), original, 'complete bytes hand off to the ImportWorker path');
  // Host leaves: the guest drops the session (bytes gone, play blocked again).
  guestGate.cancel();
  assert.equal(guestGate.canEnter, false, 'after host leave, enter is blocked again');
  assert.equal(guestGate.takeBytes(), undefined, 'no handoff after the session drops');
  // Rejoin + re-sync: a fresh transfer completes and hands off identical bytes.
  guestGate.beginTransfer(original.length, hostGate.chunkCount);
  for(let i = hostGate.chunkCount - 1; i >= 0; i--) guestGate.receiveChunk(i, hostGate.chunkData(i));
  assert.equal(guestGate.canEnter, true, 'rejoin re-syncs');
  assert.deepEqual(guestGate.takeBytes(), original);
}

// --- 4. Room guest leak: late throws close the peer like the host side ---
{
  const code = createRoomCode('local:test-world');
  const offer = encodeSignal({type: 'offer', sdp: 'v=0'});
  const lateBoom: any = {
    closed: 0,
    iceGatheringState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    async setRemoteDescription(this: any) { this.ondatachannel?.({channel: {readyState: 'open'}}); },
    async createAnswer() { throw new Error('late boom'); },
    async setLocalDescription() {},
    close() { this.closed++; },
  };
  await assert.rejects(joinRoom(code, offer, lateBoom), /late boom/);
  assert.equal(lateBoom.closed, 1, 'guest late-throw closes the peer (host parity)');
  const earlyBoom: any = {
    closed: 0,
    iceGatheringState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    async setRemoteDescription() { throw new Error('early boom'); },
    close() { this.closed++; },
  };
  await assert.rejects(joinRoom(code, offer, earlyBoom), /early boom/);
  assert.equal(earlyBoom.closed, 1, 'guest early-throw closes the peer too');
  const ok: any = {
    closed: 0,
    iceGatheringState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    async setRemoteDescription(this: any) { this.ondatachannel?.({channel: {readyState: 'open'}}); },
    async createAnswer() { return {type: 'answer', sdp: 'v=0'}; },
    localDescription: {type: 'answer', sdp: 'v=0'},
    async setLocalDescription() {},
    close() { this.closed++; },
  };
  const room = await joinRoom(code, offer, ok);
  assert.equal(room.worldId, 'local:test-world');
  assert.equal(ok.closed, 0, 'success path never closes');
}

// --- 5. main.ts lifecycle wiring (source contract, same style as multiplayer-ui.ts) ---
{
  const main = await readFile('src/main.ts', 'utf8');
  for(const needle of [
    'Host left the session',
    'Connection to the host was lost',
    "menu('map-menu')",
    'presence?.clear()',
    'takeBytes()',
    'canEnter',
    'broadcastEnv',
    'applyHostEnv',
    'syncMpEnter',
    'syncMpProgress',
    'leaveMultiplayer',
    'quitMpSession',
    'onclose',
    // End-to-end wiring: edits, framed transfer, host serve, peer close.
    "kind==='edit'",
    'applyRemoteEdit',
    'broadcastEdit',
    'encodeGateMessage',
    'decodeGateMessage',
    'serveWorld',
    'correctGuestEdit',
    'applyRemote',
    'mpPeer',
    'mpEdit',
    'parseRoomCode',
    "'Invalid room code'",
    'room-error',
    'transfer-progress',
    'signal-connect',
    'room-play',
    'mpGate.roomWorld',
  ]) assert(main.includes(needle), `main.ts missing lifecycle wiring: ${needle}`);
  assert.match(main, /sky\.time\s*=\s*env\.time/, 'host time overwrites local sky');
  assert(main.includes('weather.setMode(env.weather)'), 'host weather overwrites local weather');
}

// --- 6. New strings ship in all 5 locales ---
{
  for(const [code] of languages) {
    const data: Catalog = JSON.parse(await readFile(`public/menu/locales/${code}.json`, 'utf8'));
    for(const key of ['Host left the session', 'Connection to the host was lost', 'Invalid room code', 'Offer', 'Answer', 'Connect', 'Waiting for connection...', 'Receiving world...', 'World ready']) {
      assert(data.ui[key]?.trim(), `${code}: missing ${key}`);
    }
  }
}

// --- 7. npm test runs every multiplayer suite ---
{
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const test: string = pkg.scripts.test;
  for(const file of ['multiplayer-ui', 'multiplayer-signaling', 'multiplayer-presence', 'multiplayer-edits', 'multiplayer-gate', 'multiplayer-lifecycle', 'multiplayer-wire']) {
    assert(test.includes(`tsx tests/${file}.ts`), `npm test missing tests/${file}.ts`);
  }
}

console.log('Multiplayer lifecycle passed: host sky/weather follow at low frequency, disconnect returns every guest to the world list, rejoin re-syncs, guest peer leaks closed, enter gated on 100% with ImportWorker handoff.');
