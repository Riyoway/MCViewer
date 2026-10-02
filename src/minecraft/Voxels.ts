import type { Vec3 } from './types';
export const CHUNK = 16;

export class Voxels {
  readonly chunks = new Map<string, Uint16Array>();
  private key(x: number, y: number, z: number) { return `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`; }
  get(x: number, y: number, z: number): number {
    const chunk = this.chunks.get(this.key(x, y, z));
    return chunk?.[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)] ?? 0;
  }
  set(x: number, y: number, z: number, block: number) {
    const key = this.key(x, y, z);
    let chunk = this.chunks.get(key);
    if (!chunk) { if (!block) return; chunk = new Uint16Array(4096); this.chunks.set(key, chunk); }
    chunk[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)] = block;
  }
  fill(min: Vec3, max: Vec3, block: number) {
    for (let y = min[1]; y < max[1]; y++) for (let z = min[2]; z < max[2]; z++) for (let x = min[0]; x < max[0]; x++) this.set(x, y, z, block);
  }
  origins(): Vec3[] { return [...this.chunks.keys()].map(k => k.split(',').map(Number).map(n => n * CHUNK) as Vec3); }
}

export function encodeColumn(voxels:Voxels,origins:Vec3[],lighting?:(x:number,y:number,z:number)=>number):ArrayBuffer {
  const buffer=new ArrayBuffer(8+origins.length*(lighting?12292:8196)),header=new Uint32Array(buffer,0,2);header.set([lighting?0x564f5832:0x564f5831,origins.length]);
  let offset=8;
  for(const [x,y,z] of origins) {
    new Int32Array(buffer,offset,1)[0]=y;offset+=4;const cells=voxels.chunks.get(`${x/16},${y/16},${z/16}`);if(cells)new Uint16Array(buffer,offset,4096).set(cells);offset+=8192;
    if(lighting){const values=new Uint8Array(buffer,offset,4096);for(let i=0;i<4096;i++)values[i]=lighting(x+(i&15),y+(i>>8),z+((i>>4)&15));offset+=4096;}
  }
  return buffer;
}
export function decodeColumn(buffer:ArrayBuffer,x:number,z:number,voxels:Voxels,lights?:Voxels):string[] {
  if(buffer.byteLength<8)throw new Error('Invalid voxel column');
  const header=new Uint32Array(buffer,0,2),lit=header[0]===0x564f5832;if((!lit&&header[0]!==0x564f5831)||buffer.byteLength!==8+header[1]*(lit?12292:8196))throw new Error('Truncated voxel column');
  const keys:string[]=[];let offset=8;
  for(let n=0;n<header[1];n++) {
    const y=new Int32Array(buffer,offset,1)[0];offset+=4;const key=`${x/16},${y/16},${z/16}`;voxels.chunks.set(key,new Uint16Array(buffer.slice(offset,offset+8192)));keys.push(key);offset+=8192;
    if(lit){lights?.chunks.set(key,Uint16Array.from(new Uint8Array(buffer,offset,4096)));offset+=4096;}
  }
  return keys;
}
