// Manual copy-paste signaling (base64 SDP) with opt-in WebSocket exchange.
// Pure functions only: no RTCPeerConnection or network access at module scope,
// so Node tests can run without browser APIs.

function toBase64(bytes: Uint8Array): string {
  const buffer = (globalThis as {Buffer?: {from(data: Uint8Array): {toString(encoding: string): string}}}).Buffer;
  if(buffer) return buffer.from(bytes).toString('base64');
  let binary = '';
  for(const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const buffer = (globalThis as {Buffer?: {from(data: string, encoding: string): Uint8Array}}).Buffer;
  if(buffer) return new Uint8Array(buffer.from(text, 'base64'));
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** JSON (or raw string) payload -> base64 text for manual copy-paste. */
export function encodeSignal(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return toBase64(new TextEncoder().encode(text));
}

/** Base64 text -> payload. Throws a clear error on empty or malformed input. */
export function decodeSignal<T = unknown>(encoded: string): T {
  const text = encoded.trim();
  if(!text || !/^[A-Za-z0-9+/=_-]+$/.test(text)) throw new Error(`Invalid signal payload: expected base64 offer/answer text, got ${JSON.stringify(encoded.slice(0, 24))}.`);
  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64(text.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    throw new Error('Invalid signal payload: base64 decoding failed.');
  }
  if(!json) throw new Error('Invalid signal payload: decoded text is empty.');
  try {
    return JSON.parse(json) as T;
  } catch {
    return json as T;
  }
}

function readEnv(name: string): string {
  try {
    const vite = (import.meta as unknown as {env?: Record<string, string | undefined>}).env?.[name];
    if(vite) return vite.trim();
  } catch {/* non-Vite runtime (Node tests) */}
  const node = (globalThis as {process?: {env?: Record<string, string | undefined>}}).process?.env?.[name];
  return (node ?? '').trim();
}

/** Optional signaling server URL. Empty means manual copy-paste (the default). */
export function getSignalUrl(): string {
  return readEnv('VITE_MULTIPLAYER_SIGNAL_URL');
}

/** True only when VITE_MULTIPLAYER_SIGNAL_URL is set; no secrets are hardcoded. */
export function useAutoSignal(): boolean {
  return getSignalUrl().length > 0;
}

/**
 * Exchange one signaling payload through the optional WebSocket server,
 * keyed by room code. Rejects clearly when no server URL is configured.
 */
export function exchangeInvite(roomCode: string, payload: string): Promise<string> {
  const url = getSignalUrl();
  if(!url) return Promise.reject(new Error('VITE_MULTIPLAYER_SIGNAL_URL is not set; use manual copy-paste instead.'));
  const Socket = (globalThis as {WebSocket?: new (url: string) => WebSocket}).WebSocket;
  if(!Socket) return Promise.reject(new Error('WebSocket is unavailable in this environment.'));
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new Socket(url);
    } catch(cause) {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    const timer = setTimeout(() => {
      try{socket.close();}catch{/* already closed */}
      reject(new Error(`Signaling exchange timed out for room ${roomCode}.`));
    }, 15000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({room: roomCode, payload})));
    socket.addEventListener('message', event => {
      clearTimeout(timer);
      try{socket.close();}catch{/* already closed */}
      try {
        const data = JSON.parse(String(event.data)) as {payload?: unknown};
        if(typeof data.payload !== 'string' || !data.payload) throw new Error('empty payload');
        resolve(data.payload);
      } catch {
        reject(new Error(`Invalid signaling reply for room ${roomCode}.`));
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`Signaling exchange failed for room ${roomCode}.`));
    });
  });
}
