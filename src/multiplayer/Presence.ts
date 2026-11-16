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

/** Host sky/weather snapshot: guests overwrite sky.time/weather.mode at low frequency. */
export type EnvWeather = 'clear' | 'rain' | 'thunder' | 'snow';

export interface EnvMessage {
  kind: 'env';
  sender: string;
  seq: number;
  time: number;
  weather: EnvWeather;
}

export interface EnvState {
  time: number;
  weather: EnvWeather;
}

interface RemoteEntry extends RemotePeer {
  model?: RemoteModel;
}

const TICK_MS = 100;
const ENV_TICK_MS = 1000;
const ENV_WEATHERS: readonly string[] = ['clear', 'rain', 'thunder', 'snow'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function clock(): number {
  const now = (globalThis as {performance?: {now(): number}}).performance;
  return now ? now.now() : Date.now();
}

export class Presence {
  private seq = 0;
  private lastSend = -Infinity;
  private envSeq = 0;
  private lastEnvSend = -Infinity;
  private lastEnvSeq = -Infinity;
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

  /** Detach every replica; map switches and disconnects drop stale remotes. */
  clear(): void {
    for(const id of [...this.remotes.keys()]) this.remove(id);
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

  /** Host sky/weather snapshot, at most every 1000ms (low frequency). */
  broadcastEnv(time: number, weather: string): boolean {
    if(!finite(time) || !ENV_WEATHERS.includes(weather)) return false;
    const now = this.opts?.now ?? clock;
    if(now() - this.lastEnvSend < ENV_TICK_MS) return false;
    this.lastEnvSend = now();
    this.envSeq++;
    const message: EnvMessage = {kind: 'env', sender: this.localId, seq: this.envSeq, time, weather: weather as EnvWeather};
    this.send(JSON.stringify(message));
    return true;
  }

  /**
   * Follow one host snapshot. Guests pass the host id to ignore anyone else;
   * without it any non-self sender applies (single-host rooms: only the host
   * broadcasts). Own echoes, stale seq, and non-env payloads are dropped.
   */
  applyHostEnv(raw: string | EnvMessage, hostId?: string): EnvState | false {
    let message: EnvMessage;
    if(typeof raw === 'string') {
      try {
        message = JSON.parse(raw);
      } catch {
        return false;
      }
    } else message = raw;
    if(!message || typeof message !== 'object' || message.kind !== 'env') return false;
    if(typeof message.sender !== 'string' || !message.sender || message.sender === this.localId) return false;
    if(hostId && message.sender !== hostId) return false;
    if(!finite(message.seq) || message.seq <= this.lastEnvSeq) return false;
    if(!finite(message.time) || !ENV_WEATHERS.includes(message.weather)) return false;
    this.lastEnvSeq = message.seq;
    return {time: message.time, weather: message.weather};
  }
}
