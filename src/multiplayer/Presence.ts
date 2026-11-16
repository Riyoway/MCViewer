// 10Hz position sharing: {id,x,y,z,yaw,pitch,seq} over the Task 2
// DataChannel, with senderID+seq dedup (latest-seq-wins) and one
// PlayerModel replica per remote peer. Never touches the local
// Movement/Collision: broadcast only reads, apply only poses replicas.
import type {PlayerModel} from '../core/PlayerModel.ts';

export interface PresencePayload {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  seq: number;
}

export interface LocalPose {
  readonly position: readonly number[];
  readonly yaw: number;
  readonly pitch: number;
}

/** Minimal PlayerModel surface remotes need (tick/update clone). */
export interface RemoteModel {
  readonly root: {readonly position: {set(x: number, y: number, z: number): void}; removeFromParent(): void};
  tick(yaw: number, pitch: number, dx: number, dz: number): void;
  update(dt: number, yaw: number, pitch: number): void;
}

export interface RemotePeer {
  readonly id: string;
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

interface RemoteEntry extends RemotePeer {
  model?: RemoteModel;
}

const TICK_MS = 100;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function clock(): number {
  const now = (globalThis as {performance?: {now(): number}}).performance;
  return now ? now.now() : Date.now();
}

export class Presence {
  private seq = 0;
  private lastSend = -Infinity;
  private readonly remotes = new Map<string, RemoteEntry>();

  constructor(
    readonly localId: string,
    private readonly send: (text: string) => void,
    private readonly opts?: {createModel?: (id: string) => RemoteModel | PlayerModel; now?: () => number},
  ) {}

  get size(): number {
    return this.remotes.size;
  }

  remote(id: string): RemotePeer | undefined {
    const entry = this.remotes.get(id);
    if(!entry) return undefined;
    const {id: peer, seq, x, y, z, yaw, pitch} = entry;
    return {id: peer, seq, x, y, z, yaw, pitch};
  }

  /** Read-only local pose -> {id,x,y,z,yaw,pitch,seq}, at most every 100ms (10Hz). */
  broadcastLocal(player: LocalPose): boolean {
    const [x, y, z] = player.position;
    if(!finite(x) || !finite(y) || !finite(z) || !finite(player.yaw) || !finite(player.pitch)) return false;
    const now = this.opts?.now ?? clock;
    if(now() - this.lastSend < TICK_MS) return false;
    this.lastSend = now();
    this.seq++;
    const payload: PresencePayload = {id: this.localId, x, y, z, yaw: player.yaw, pitch: player.pitch, seq: this.seq};
    this.send(JSON.stringify(payload));
    return true;
  }

  applyRemote(payload: PresencePayload): boolean;
  applyRemote(id: string, pos: readonly number[], yaw: number, pitch: number, seq: number): boolean;
  applyRemote(payload: PresencePayload | string, pos?: readonly number[], yaw?: number, pitch?: number, seq?: number): boolean {
    if(typeof payload === 'string') {
      if(payload === this.localId || !pos || seq === undefined) return false;
      return this.store(payload, pos, yaw ?? 0, pitch ?? 0, seq);
    }
    if(!payload || typeof payload !== 'object') return false;
    const {id, x, y, z} = payload;
    if(typeof id !== 'string' || !finite(x) || !finite(y) || !finite(z) || !finite(payload.yaw) || !finite(payload.pitch) || !finite(payload.seq)) return false;
    return this.store(id, [x, y, z], payload.yaw, payload.pitch, payload.seq);
  }

  private store(id: string, pos: readonly number[], yaw: number, pitch: number, seq: number): boolean {
    if(id === this.localId || !finite(seq)) return false;
    const [x, y, z] = pos;
    if(!finite(x) || !finite(y) || !finite(z) || !finite(yaw) || !finite(pitch)) return false;
    const known = this.remotes.get(id);
    if(known && seq <= known.seq) return false;
    let model = known?.model;
    if(!model && this.opts?.createModel) model = this.opts.createModel(id) as RemoteModel;
    const dx = known ? x - known.x : 0, dz = known ? z - known.z : 0;
    if(model) {
      model.root.position.set(x, y, z);
      model.tick(yaw, pitch, dx, dz);
      model.update(0, yaw, pitch);
    }
    this.remotes.set(id, {id, seq, x, y, z, yaw, pitch, model});
    return true;
  }

  /** Detach the replica; the transport (Task 5/6) decides reconnect policy. */
  remove(id: string): boolean {
    const entry = this.remotes.get(id);
    if(!entry) return false;
    this.remotes.delete(id);
    try {
      entry.model?.root.removeFromParent();
    } catch {/* replica already detached */}
    return true;
  }
}
