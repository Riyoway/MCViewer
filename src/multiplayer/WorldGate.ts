// Multiplayer join gate: world match check plus full-receipt play gating.
// Sample-ID match reloads locally (R2) with zero transfer; mismatch/custom
// worlds arrive as kind-tagged chunks over the Task 2 DataChannel and hand
// off to the existing ImportWorker path only at 100%. Presence stays bare
// and edits stay kind:'edit'; every message here carries kind:'world-*' so
// a future single dispatcher can route on kind.
export type GateDecision = 'local' | 'transfer';

export type WorldGateMessage =
  | {kind: 'world-request'; worldId: string}
  | {kind: 'world-meta'; worldId: string; total: number; chunks: number}
  | {kind: 'world-chunk'; worldId: string; index: number; total: number; data: Uint8Array}
  | {kind: 'world-complete'; worldId: string};

const KINDS = new Set(['world-request', 'world-meta', 'world-chunk', 'world-complete']);

/** Kind guard for the future dispatcher: only world-* messages match. */
export function isWorldGateMessage(value: unknown): value is WorldGateMessage {
  if(!value || typeof value !== 'object') return false;
  return KINDS.has((value as {kind?: unknown}).kind as string);
}

function toBase64(data: Uint8Array): string {
  const buffer = (globalThis as {Buffer?: {from(data: Uint8Array): {toString(encoding: string): string}}}).Buffer;
  if(buffer) return buffer.from(data).toString('base64');
  let binary = '';
  for(const byte of data) binary += String.fromCharCode(byte);
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

// JSON transport cannot carry Uint8Array (it degrades to a numeric object),
// so chunk bytes travel as base64 text and decode back before receiveChunk.
export function encodeGateMessage(message: WorldGateMessage): string {
  return JSON.stringify(message.kind === 'world-chunk'
    ? {...message, data: toBase64(message.data)}
    : message);
}

/** Decode a wire string (or pass through an in-memory message); null when not a world message. */
export function decodeGateMessage(raw: unknown): WorldGateMessage | null {
  let value: unknown = raw;
  if(typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if(!isWorldGateMessage(value)) return null;
  if(value.kind === 'world-chunk') {
    const data = (value as {data?: unknown}).data;
    if(data instanceof Uint8Array) return value;
    if(typeof data !== 'string') return null;
    try {
      return {...value, data: fromBase64(data)};
    } catch {
      return null;
    }
  }
  return value;
}

/** Host-side split of WorldStore bytes into fixed chunks (last may be short). */
export function chunkData(data: Uint8Array, chunkSize: number): Uint8Array[] {
  if(!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error(`Invalid chunk size: expected a positive integer, got ${chunkSize}.`);
  if(data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for(let offset = 0; offset < data.length; offset += chunkSize) chunks.push(data.slice(offset, offset + chunkSize));
  return chunks;
}

export interface WorldGateOpts {
  /** Bare sample ids (e.g. 'tutorial') or full 'sample:*' ids. */
  samples: Iterable<string> | Record<string, unknown>;
  /** WorldStore ids already on this device. */
  savedIds?: Iterable<string>;
  roomWorld?: string;
  chunkSize?: number;
}

const bare = (id: string): string => id.startsWith('sample:') ? id.slice(7) : id;

export class WorldGate {
  private sampleIds = new Set<string>();
  private ownedIds = new Set<string>();
  private chunkSize: number;
  private current = '';
  private source?: Uint8Array;
  private parts: Uint8Array[] = [];
  private slots: (Uint8Array | undefined)[] = [];
  private expected = 0;
  private wanted = 0;
  private cancelled = false;

  constructor(opts: WorldGateOpts) {
    const samples = Symbol.iterator in Object(opts.samples) ? opts.samples as Iterable<string> : Object.keys(opts.samples);
    for(const id of samples) this.sampleIds.add(bare(id));
    if(opts.savedIds) for(const id of opts.savedIds) this.ownedIds.add(id);
    this.chunkSize = opts.chunkSize ?? 16384;
    if(opts.roomWorld) this.resolveWorld(opts.roomWorld);
  }

  get roomWorld(): string { return this.current; }
  get decision(): GateDecision { return this.decide(this.current); }

  /** 'local' when the room world resolves here (samples or saves), else 'transfer'. */
  resolveWorld(roomWorld: string): GateDecision {
    this.current = roomWorld;
    this.cancelled = false;
    // Any world switch drops the previous world's bytes (guest buffer and
    // host source alike); a fresh beginTransfer/setSource starts the new one.
    this.slots = [];
    this.parts = [];
    this.source = undefined;
    this.expected = 0;
    this.wanted = 0;
    return this.decide(roomWorld);
  }

  private decide(roomWorld: string): GateDecision {
    if(!roomWorld) return 'transfer';
    if(this.sampleIds.has(bare(roomWorld))) return 'local';
    if(this.ownedIds.has(roomWorld)) return 'local';
    return 'transfer';
  }

  /** Transfer bytes still missing; always 0 for a local match. */
  get transferBytesNeeded(): number {
    if(this.decision === 'local') return 0;
    return Math.max(0, this.wanted - this.receivedBytes());
  }

  /** Enter and play stay disabled until a local match or 100% receipt. */
  get canPlay(): boolean {
    if(this.cancelled) return false;
    if(this.decision === 'local') return true;
    return this.wanted > 0 && this.receivedBytes() >= this.wanted;
  }

  get canEnter(): boolean { return this.canPlay; }

  private receivedBytes(): number {
    let total = 0;
    for(const slot of this.slots) if(slot) total += slot.length;
    return total;
  }

  /** 0..1 receipt progress; 1 when local or fully received. */
  progress(): number {
    if(this.decision === 'local') return 1;
    if(this.wanted <= 0) return 0;
    return Math.min(1, this.receivedBytes() / this.wanted);
  }

  // --- host side: split WorldStore bytes and describe each chunk ---

  setSource(data: Uint8Array, chunkSize = this.chunkSize): void {
    this.source = data.slice();
    this.chunkSize = chunkSize;
    this.parts = chunkData(this.source, chunkSize);
    this.expected = this.parts.length;
    this.wanted = data.length;
  }

  get chunkCount(): number { return this.source ? this.expected : 0; }

  chunkData(index: number): Uint8Array {
    const chunk = this.parts[index];
    if(!chunk) throw new Error(`Invalid chunk index: ${index} is outside 0..${this.expected - 1}.`);
    return chunk;
  }

  requestMessage(): WorldGateMessage {
    return {kind: 'world-request', worldId: this.current};
  }

  metaMessage(): WorldGateMessage {
    return {kind: 'world-meta', worldId: this.current, total: this.source?.length ?? 0, chunks: this.expected};
  }

  chunkMessage(index: number): WorldGateMessage {
    return {kind: 'world-chunk', worldId: this.current, index, total: this.expected, data: this.chunkData(index)};
  }

  // --- guest side: accumulate chunks, gate play, hand off at 100% ---

  beginTransfer(total: number, chunks = 0): void {
    if(!Number.isFinite(total) || total <= 0) throw new Error(`Invalid transfer: expected a positive byte total, got ${total}.`);
    this.slots = chunks > 0 ? new Array(chunks).fill(undefined) : [];
    this.expected = chunks;
    this.wanted = Math.floor(total);
    this.cancelled = false;
  }

  /**
   * Store one chunk; duplicates and out-of-range writes are no-ops.
   * Returns whether receipt is now complete.
   */
  receiveChunk(index: number, data: Uint8Array): boolean {
    if(this.decision === 'local') return true;
    if(!Number.isInteger(index) || index < 0 || !data?.length) return this.receiveComplete();
    if(index < this.slots.length) {
      if(!this.slots[index]) this.slots[index] = data.slice();
    } else if(this.slots.length === 0 && this.expected === 0) {
      // Unframed stream (no chunk count): accept arrival order only, so a
      // duplicate or reordered resend can never silently corrupt the bytes.
      if(index === this.slots.length) this.slots.push(data.slice());
    }
    return this.receiveComplete();
  }

  /** True only when every expected byte arrived (local match: 0/0 counts). */
  receiveComplete(received = this.receivedBytes(), total = this.wanted): boolean {
    if(this.cancelled) return false;
    if(this.decision === 'local') return true;
    return total > 0 && received >= total;
  }

  /** Drop buffered bytes; play stays blocked until a fresh transfer completes. */
  cancel(): void {
    this.slots = [];
    this.cancelled = true;
  }

  /**
   * Assembled payload for the existing ImportWorker path.
   * Returns undefined until 100% — the handoff must not run on partial bytes.
   */
  takeBytes(): Uint8Array | undefined {
    if(this.decision === 'local') return undefined;
    if(!this.canPlay) return undefined;
    if(this.slots.length === 0 || this.slots.some(slot => !slot)) return undefined;
    const out = new Uint8Array(this.wanted);
    let offset = 0;
    for(const slot of this.slots) {
      out.set(slot!, offset);
      offset += slot!.length;
    }
    return out.length === this.wanted ? out : undefined;
  }
}
