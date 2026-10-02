import { parse, simplify } from 'prismarine-nbt';
import { inflateSync, gunzipSync } from 'node:zlib';

export interface State { Name: string; Properties?: Record<string, string> }
export function stateKey(state: State) {
  const properties = Object.entries(state.Properties ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return state.Name.replace('minecraft:', '') + (properties.length ? '[' + properties.map(([k,v]) => `${k}=${v}`).join(',') + ']' : '');
}
export function unpackPalette(data: ([number, number] | bigint)[], paletteLength: number, padded: boolean): Uint16Array {
  const output = new Uint16Array(4096);
  if (paletteLength === 1) return output;
  const bits = Math.max(4, Math.ceil(Math.log2(paletteLength))), mask = (1n << BigInt(bits)) - 1n;
  const perWord = Math.floor(64 / bits);
  const required=padded?Math.ceil(4096/perWord):Math.ceil(4096*bits/64);
  if(data.length<required)throw new Error('Truncated block-state array');
  const words = data.map(word => typeof word==='bigint'?BigInt.asUintN(64,word):(BigInt(word[0] >>> 0) << 32n) | BigInt(word[1] >>> 0));
  for (let i=0; i<4096; i++) {
    const word = padded ? Math.floor(i / perWord) : Math.floor(i * bits / 64);
    const shift = padded ? (i % perWord) * bits : (i * bits) % 64;
    let value = (words[word] ?? 0n) >> BigInt(shift);
    if (!padded && shift+bits > 64) value |= (words[word+1] ?? 0n) << BigInt(64-shift);
    output[i] = Number(value & mask);
    if (output[i] >= paletteLength) throw new Error(`Invalid palette index ${output[i]} / ${paletteLength}`);
  }
  return output;
}

export async function* readChunks(files: Record<string, Uint8Array>, bounds: { min: number[]; max: number[] }) {
  for (const [name, bytes] of Object.entries(files)) {
    if (!/(^|\/)region\/r\.-?\d+\.-?\d+\.mca$/.test(name) || /DIM-?\d/.test(name) || /dimensions\//.test(name) && !/dimensions\/minecraft\/overworld\//.test(name)) continue;
    const match = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name)!;
    const rx=Number(match[1]), rz=Number(match[2]);
    if ((rx+1)*512 <= bounds.min[0] || rx*512 >= bounds.max[0] || (rz+1)*512 <= bounds.min[2] || rz*512 >= bounds.max[2]) continue;
    const region = Buffer.from(bytes);
    for (let i=0;i<1024;i++) {
      const cx=rx*32+(i%32), cz=rz*32+Math.floor(i/32);
      if ((cx+1)*16 <= bounds.min[0] || cx*16 >= bounds.max[0] || (cz+1)*16 <= bounds.min[2] || cz*16 >= bounds.max[2]) continue;
      const offset=region.readUIntBE(i*4,3)*4096;
      if (!offset) continue;
      if (offset+5 > region.length) throw new Error(`Truncated region: ${name}`);
      const length=region.readUInt32BE(offset), compression=region[offset+4];
      if (length<1 || offset+4+length > region.length) throw new Error(`Invalid chunk length: ${name}`);
      const data=region.subarray(offset+5,offset+4+length);
      const raw=compression===2 ? inflateSync(data) : compression===1 ? gunzipSync(data) : compression===3 ? data : null;
      if (!raw) throw new Error(`Unsupported Anvil compression ${compression}`);
      const nbt=simplify((await parse(raw)).parsed);
      yield { root: nbt.Level ?? nbt, version: nbt.DataVersion ?? nbt.Level?.DataVersion ?? 0 };
    }
  }
}
