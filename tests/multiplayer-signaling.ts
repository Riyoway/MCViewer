import assert from 'node:assert/strict';
import {encodeSignal,decodeSignal,getSignalUrl,useAutoSignal,exchangeInvite} from '../src/multiplayer/Signaling.ts';
import {createHostNonce,createRoomCode,parseRoomCode,createRoom,joinRoom,gatherComplete} from '../src/multiplayer/Room.ts';

// offer->answer round-trip as pure base64 payloads (no RTCPeerConnection in Node).
const offer={type:'offer',sdp:'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n'};
const answer={type:'answer',sdp:'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n'};
const encodedOffer=encodeSignal(offer);
assert.match(encodedOffer,/^[A-Za-z0-9+/=]+$/,'offer must be plain base64 for manual copy-paste');
assert.deepEqual(decodeSignal<typeof offer>(encodedOffer),offer);
assert.deepEqual(decodeSignal<typeof answer>(encodeSignal(answer)),answer);
assert.equal(decodeSignal<string>(encodeSignal('hello')), 'hello');

// Room code round-trip: worldId + hostNonce short form.
const nonce=createHostNonce();
assert.match(nonce,/^[0-9a-z]{6}$/,'host nonce is a 6-char short form');
const code=createRoomCode('local:test-world');
assert.match(code,/^local:test-world#[0-9a-z]{6}$/);
assert.deepEqual(parseRoomCode(code),{worldId:'local:test-world',hostNonce:code.split('#')[1]});
assert.equal(parseRoomCode(createRoomCode('sample:demo',nonce)).hostNonce,nonce);

// Short custom alias codes: the host mints "c"+nonce so "local:<uuid>"
// never travels in the code; guests echo it and the host resolves it.
const aliasCode = createRoomCode(`c${createHostNonce()}`);
assert(aliasCode.length < 20, `alias code must stay short, got ${aliasCode.length} chars`);
assert.deepEqual(parseRoomCode(aliasCode), {worldId: aliasCode.split('#')[0], hostNonce: aliasCode.split('#')[1]});

// Invalid codes fail with a clear error before any RTC/WebSocket is touched.
for(const bad of ['','no-separator','#abc123','world#','a b#cdef12','w#!!!','x#ab']) {
  assert.throws(()=>parseRoomCode(bad),/Invalid room code/,JSON.stringify(bad));
}
assert.throws(()=>decodeSignal('!!!not-base64!!!'),/Invalid signal/);
assert.throws(()=>decodeSignal(''),/Invalid signal/);
await assert.rejects(joinRoom('bad-code',encodeSignal(answer)),/Invalid room code/);
await assert.rejects(createRoom(''),/Invalid/);

// gatherComplete: single-shot SDP must wait for ICE (no trickle). Fake peer.
const fakePeer = () => {
  const listeners = new Map<string, Set<() => void>>();
  const peer = {
    state: 'gathering',
    get iceGatheringState(): string { return peer.state; },
    addEventListener(type: string, fn: () => void): void {
      if(!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void): void { listeners.get(type)?.delete(fn); },
    fire(): void { listeners.get('icegatheringstatechange')?.forEach(fn => fn()); },
  };
  return peer;
};
{
  const done = fakePeer();
  done.state = 'complete';
  await gatherComplete(done as unknown as RTCPeerConnection, 50);
  const waiting = fakePeer();
  let resolved = false;
  const pending = gatherComplete(waiting as unknown as RTCPeerConnection, 5000).then(() => { resolved = true; });
  waiting.state = 'complete';
  waiting.fire();
  await pending;
  assert.equal(resolved, true, 'gatherComplete resolves on icegatheringstatechange');
  const stuck = fakePeer();
  await assert.rejects(gatherComplete(stuck as unknown as RTCPeerConnection, 50), /Timed out gathering/);
}
assert.equal(typeof (globalThis as {RTCPeerConnection?: unknown}).RTCPeerConnection,'undefined');
await assert.rejects(createRoom('local:test-world'),/RTCPeerConnection is unavailable/);

// WebSocket auto-exchange is opt-in via VITE_MULTIPLAYER_SIGNAL_URL only.
const saved=process.env.VITE_MULTIPLAYER_SIGNAL_URL;
delete process.env.VITE_MULTIPLAYER_SIGNAL_URL;
try {
  assert.equal(getSignalUrl(),'');
  assert.equal(useAutoSignal(),false);
  await assert.rejects(exchangeInvite(code,encodedOffer),/VITE_MULTIPLAYER_SIGNAL_URL is not set/);
  process.env.VITE_MULTIPLAYER_SIGNAL_URL='ws://127.0.0.1:9/signal';
  assert.equal(getSignalUrl(),'ws://127.0.0.1:9/signal');
  assert.equal(useAutoSignal(),true);
} finally {
  if(saved===undefined)delete process.env.VITE_MULTIPLAYER_SIGNAL_URL;
  else process.env.VITE_MULTIPLAYER_SIGNAL_URL=saved;
}

console.log('Multiplayer signaling checks passed: base64 offer/answer round-trip, room-code round-trip, invalid-code failures, RTC isolation, opt-in WebSocket exchange.');
