// Room codes are short human-typed keys only (e.g. "k7q2md"). The joined
// world travels in-band after the channel opens (world-announce), so the
// code never embeds a world id and stays typable.
import {decodeSignal,encodeSignal} from './Signaling.ts';

export interface RoomInfo {
  key: string;
}

const KEY_PATTERN = /^[0-9A-Za-z]{4,16}$/;

/** 6-char short nonce, e.g. "k7q2md". */
export function createHostNonce(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(6);
  const crypto = (globalThis as {crypto?: {getRandomValues?: (array: Uint8Array) => Uint8Array}}).crypto;
  // shortcut: Math.random fallback only where WebCrypto is missing; upgrade if room-code collisions ever matter.
  if(crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for(let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let nonce = '';
  for(const byte of bytes) nonce += alphabet[byte % alphabet.length];
  return nonce;
}

/** Short human-typed room key, e.g. "k7q2md". */
export function createRoomCode(key: string = createHostNonce()): string {
  if(!KEY_PATTERN.test(key)) throw new Error(`Invalid room code: expected 4-16 letters/digits, got ${JSON.stringify(key)}.`);
  return key;
}

/** Validate a typed room key. Throws clearly on bad input. */
export function parseRoomCode(code: string): RoomInfo {
  const key = code.trim();
  if(!KEY_PATTERN.test(key)) throw new Error(`Invalid room code: expected 4-16 letters/digits, got ${JSON.stringify(code)}.`);
  return {key};
}

function resolvePeer(input?: RTCPeerConnection | (() => RTCPeerConnection)): RTCPeerConnection {
  if(typeof input === 'function') return input();
  if(input) return input;
  const Factory = (globalThis as {RTCPeerConnection?: new () => RTCPeerConnection}).RTCPeerConnection;
  if(!Factory) throw new Error('RTCPeerConnection is unavailable in this environment (browser-only).');
  return new Factory();
}

/**
 * Single-shot manual signaling carries no trickle ICE, so the encoded SDP
 * must already contain every candidate. Wait for gathering to complete.
 */
export function gatherComplete(peer: Pick<RTCPeerConnection, 'iceGatheringState' | 'addEventListener' | 'removeEventListener'>, timeoutMs = 15000): Promise<void> {
  if(peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange);
      reject(new Error('Timed out gathering connection candidates.'));
    }, timeoutMs);
    const onChange = (): void => {
      if(peer.iceGatheringState === 'complete') {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', onChange);
  });
}

export interface HostRoom {
  code: string;
  /** Base64 offer for manual copy-paste (or auto-exchange). */
  offer: string;
  channel: RTCDataChannel;
  peer: RTCPeerConnection;
  /** Complete the offer->answer->open round-trip with the guest's answer. */
  acceptAnswer: (answer: string) => Promise<RTCDataChannel>;
}

/**
 * Host side: mint a short room key and a base64 offer. Needs a browser
 * RTCPeerConnection (or an injected factory in tests).
 */
export async function createRoom(opts?: {key?: string; peer?: RTCPeerConnection | (() => RTCPeerConnection)}): Promise<HostRoom> {
  const code = createRoomCode(opts?.key);
  const peer = resolvePeer(opts?.peer);
  try {
    const channel = peer.createDataChannel('mc', {ordered: true});
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await gatherComplete(peer);
    return {
      code,
      offer: encodeSignal(peer.localDescription ?? offer),
      channel,
      peer,
      acceptAnswer: async (answer: string) => {
        await peer.setRemoteDescription(decodeSignal<RTCSessionDescriptionInit>(answer));
        return channel;
      },
    };
  } catch(cause) {
    try{peer.close();}catch{/* already closed */}
    throw cause;
  }
}

export interface GuestRoom {
  key: string;
  /** Base64 answer to hand back to the host. */
  answer: string;
  channel: RTCDataChannel;
  peer: RTCPeerConnection;
}

/**
 * Guest side: join by room key with the host's base64 offer, producing
 * the base64 answer. The key is validated before any RTC work runs.
 */
export async function joinRoom(code: string, offer: string, peer?: RTCPeerConnection | (() => RTCPeerConnection)): Promise<GuestRoom> {
  const {key} = parseRoomCode(code);
  const remote = decodeSignal<RTCSessionDescriptionInit>(offer);
  const connection = resolvePeer(peer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = new Promise<RTCDataChannel>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No data channel arrived for room ${code}.`)), 15000);
    connection.ondatachannel = event => {
      clearTimeout(timer);
      resolve(event.channel);
    };
  });
  try {
    await connection.setRemoteDescription(remote);
    const dataChannel = await channel;
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await gatherComplete(connection);
    return {key, answer: encodeSignal(connection.localDescription ?? answer), channel: dataChannel, peer: connection};
  } catch(cause) {
    clearTimeout(timer);
    try{connection.close();}catch{/* already closed */}
    throw cause;
  }
}
