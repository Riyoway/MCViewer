import assert from 'node:assert/strict';
import {encodeSignal,decodeSignal,getSignalUrl,useAutoSignal,exchangeInvite} from '../src/multiplayer/Signaling.ts';
import {createHostNonce,createRoomCode,parseRoomCode,createRoom,joinRoom} from '../src/multiplayer/Room.ts';

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

// Invalid codes fail with a clear error before any RTC/WebSocket is touched.
for(const bad of ['','no-separator','#abc123','world#','a b#cdef12','w#!!!','x#ab']) {
  assert.throws(()=>parseRoomCode(bad),/Invalid room code/,JSON.stringify(bad));
}
assert.throws(()=>decodeSignal('!!!not-base64!!!'),/Invalid signal/);
assert.throws(()=>decodeSignal(''),/Invalid signal/);
await assert.rejects(joinRoom('bad-code',encodeSignal(answer)),/Invalid room code/);
await assert.rejects(createRoom(''),/Invalid/);

// Browser RTC binding stays isolated: Node has no RTCPeerConnection.
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
