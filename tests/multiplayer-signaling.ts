import assert from 'node:assert/strict';
import {encodeSignal,decodeSignal,getSignalUrl,useAutoSignal,exchangeInvite} from '../src/multiplayer/Signaling.ts';
import {createHostNonce,createRoomCode,parseRoomCode,createRoom,joinRoom,gatherComplete,iceServersFrom,HOST_UNREACHABLE} from '../src/multiplayer/Room.ts';

// offer->answer round-trip as pure base64 payloads (no RTCPeerConnection in Node).
const offer={type:'offer',sdp:'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n'};
const answer={type:'answer',sdp:'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n'};
const encodedOffer=encodeSignal(offer);
assert.match(encodedOffer,/^[A-Za-z0-9+/=]+$/,'offer must be plain base64 for manual copy-paste');
assert.deepEqual(decodeSignal<typeof offer>(encodedOffer),offer);
assert.deepEqual(decodeSignal<typeof answer>(encodeSignal(answer)),answer);
assert.equal(decodeSignal<string>(encodeSignal('hello')), 'hello');

// Room code round-trip: a short human-typed key only (no world id inside).
const nonce=createHostNonce();
assert.match(nonce,/^[0-9a-z]{6}$/,'host nonce is a 6-char short form');
const code=createRoomCode();
assert.match(code,/^[0-9a-z]{6}$/,`room code must stay short and typable, got ${code}`);
assert(code.length < 20, 'room code must stay short');
assert.deepEqual(parseRoomCode(code),{key:code});
assert.equal(parseRoomCode(createRoomCode(nonce)).key,nonce);
assert.equal(parseRoomCode(`  ${code}  `).key,code,'surrounding whitespace is trimmed');

// Invalid codes fail with a clear error before any RTC/WebSocket is touched.
for(const bad of ['','a b','x#ab','toolongtoolongtoolong','ab!','#abc123']) {
  assert.throws(()=>parseRoomCode(bad),/Invalid room code/,JSON.stringify(bad));
}
assert.throws(()=>decodeSignal('!!!not-base64!!!'),/Invalid signal/);
assert.throws(()=>decodeSignal(''),/Invalid signal/);
await assert.rejects(joinRoom('bad code',encodeSignal(answer)),/Invalid room code/);
await assert.rejects(createRoom({key:''}),/Invalid room code/);

// Pasted blobs are shape-checked before any RTC work: a valid-base64 blob
// that is not an offer fails fast with an actionable message, not a 15s wait.
await assert.rejects(joinRoom(code, encodeSignal('hello')),/not the host Offer/);
await assert.rejects(joinRoom(code, encodeSignal(answer)),/not the host Offer/);

// Unreachable hosts fail with the actionable message (timer or ICE failure).
{
  const waiting: any = {
    iceConnectionState: 'checking',
    ondatachannel: null,
    _ice: null,
    set oniceconnectionstatechange(fn: (() => void) | null) { this._ice = fn; },
    get oniceconnectionstatechange(): ((() => void) | null) { return this._ice; },
    async setRemoteDescription() {
      // ICE already knows the path is dead: fail now, not after the timer.
      setTimeout(() => { waiting.iceConnectionState = 'failed'; waiting._ice?.(); }, 10);
    },
    close() {},
  };
  const t0 = Date.now();
  await assert.rejects(
    joinRoom(code, encodedOffer, waiting),
    (e: unknown) => e instanceof Error && e.message === HOST_UNREACHABLE,
    'ICE failure surfaces the actionable message',
  );
  assert(Date.now() - t0 < 15000, 'ICE failure fails fast instead of waiting out the timer');
}

// Optional TURN relay for direct-path-less networks (self-hosted, env-only).
assert.equal(iceServersFrom({}), undefined, 'no TURN without VITE_TURN_URL');
assert.deepEqual(
  iceServersFrom({VITE_TURN_URL: 'turn:example.com:3478', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p'}),
  [{urls: 'turn:example.com:3478', username: 'u', credential: 'p'}],
);
assert.deepEqual(iceServersFrom({VITE_TURN_URL: 'turn:example.com:3478'}), [{urls: 'turn:example.com:3478'}]);

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
await assert.rejects(createRoom(),/RTCPeerConnection is unavailable/);

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
