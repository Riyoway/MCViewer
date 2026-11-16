// Host-authority block-edit sync over the Task 2 DataChannel.
// The local World applies its own successful Building.place/destroy first,
// then broadcastEdit sends only that validated outcome. The host re-checks
// every guest proposal (validate, default accept) and rebroadcasts it as its
// own message, so guests apply exactly the host-approved stream. Echoes die
// on senderID, replays on per-sender seq, and presence payloads are ignored:
// edits carry kind:'edit' while Task 3 presence payloads stay kind-less.
import type {Vec3} from '../minecraft/types.ts';
import type {BlockChange} from '../minecraft/Building.ts';

export interface EditMessage {
  kind: 'edit';
  sender: string;
  seq: number;
  changes: BlockChange[];
}

export interface EditSyncOpts {
  isHost: boolean;
  hostId: string;
  /** Write validated changes to local voxels (Voxels.set -> pumpEdits path). */
  apply: (changes: BlockChange[]) => boolean;
  /** Host-only re-check of guest proposals (e.g. player-AABB overlap). */
  validate?: (changes: BlockChange[]) => boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validChange(change: BlockChange): boolean {
  if(!change || !Array.isArray(change.position) || change.position.length !== 3) return false;
  if(!change.position.every(n => Number.isInteger(n))) return false;
  return finite(change.id) && change.id >= 0;
}

export class EditSync {
  private seq = 0;
  private readonly seen = new Map<string, number>();

  constructor(
    readonly localId: string,
    private readonly send: (text: string) => void,
    private readonly opts: EditSyncOpts,
  ) {}

  /** Send one successful local edit. Returns false (sends nothing) when empty. */
  broadcastEdit(changes: BlockChange[]): boolean {
    if(!changes?.length) return false;
    this.seq++;
    const message: EditMessage = {
      kind: 'edit',
      sender: this.localId,
      seq: this.seq,
      changes: changes.map(change => ({position: [...change.position] as Vec3, id: change.id})),
    };
    this.send(JSON.stringify(message));
    return true;
  }

  /** Apply one received edit. Returns false for echoes, replays, non-edits, and host rejections. */
  applyRemoteEdit(raw: string | EditMessage): boolean {
    let message: EditMessage;
    if(typeof raw === 'string') {
      try {
        message = JSON.parse(raw);
      } catch {
        return false;
      }
    } else message = raw;
    if(!message || message.kind !== 'edit') return false;
    if(typeof message.sender !== 'string' || !message.sender || message.sender === this.localId) return false;
    if(!finite(message.seq) || !Array.isArray(message.changes) || !message.changes.length) return false;
    if(!message.changes.every(validChange)) return false;
    const last = this.seen.get(message.sender) ?? -Infinity;
    if(message.seq <= last) return false;
    if(!this.opts.isHost && message.sender !== this.opts.hostId) return false;
    if(this.opts.isHost && !(this.opts.validate?.(message.changes) ?? true)) return false;
    if(!this.opts.apply(message.changes)) return false;
    this.seen.set(message.sender, message.seq);
    // A validated guest proposal becomes the host's own broadcast, so every
    // guest (including the proposer, whose local copy makes it a no-op)
    // converges on the same host-approved stream.
    if(this.opts.isHost) this.broadcastEdit(message.changes);
    return true;
  }
}
