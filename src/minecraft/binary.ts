import type { MeshData } from './types';
const attributes = ['position','normal','uv','tile','color','glow','light'] as const;
export const sizes = [3,3,2,1,3,1,2];
export interface PackedMesh { attributes: Float32Array[]; indices: Uint32Array }
export function selectTriangles(data:PackedMesh,keep:(tile:number)=>boolean):PackedMesh {
  const remap=new Map<number,number>(),indices:number[]=[],values=sizes.map(()=>[] as number[]);
  for(let i=0;i<data.indices.length;i+=3)if(keep(data.attributes[3][data.indices[i]]))for(const old of data.indices.subarray(i,i+3)){
    if(!remap.has(old)){const index=remap.size;remap.set(old,index);for(const [a,size] of sizes.entries())for(let n=0;n<size;n++)values[a].push(data.attributes[a][old*size+n]);}
    indices.push(remap.get(old)!);
  }
  return {attributes:values.map(a=>new Float32Array(a)),indices:new Uint32Array(indices)};
}
export function encodeMeshes(data: { opaque: MeshData; transparent: MeshData }): ArrayBuffer {
  const meshes=[data.opaque,data.transparent];
  const counts=meshes.flatMap(m=>[m.position.length/3,m.index.length]);
  const buffer=new ArrayBuffer(20+counts.reduce((n,c,i)=>n+c*(i%2?4:60),0));
  new Uint32Array(buffer,0,5).set([0x4d435632,...counts]);
  let offset=20;
  for(const mesh of meshes) {
    for(const attr of attributes) {new Float32Array(buffer,offset,mesh[attr].length).set(mesh[attr]);offset+=mesh[attr].length*4;}
    new Uint32Array(buffer,offset,mesh.index.length).set(mesh.index);offset+=mesh.index.length*4;
  }
  return buffer;
}
export function decodeMeshes(buffer:ArrayBuffer): PackedMesh[] {
  if(buffer.byteLength<20 || buffer.byteLength%4) throw new Error('Invalid chunk data');
  const header=new Uint32Array(buffer,0,5);
  if(header[0]!==0x4d435632) throw new Error('Unknown chunk format');
  const expected=20+(header[1]+header[3])*60+(header[2]+header[4])*4;
  if(expected!==buffer.byteLength) throw new Error('Truncated chunk data');
  let offset=20;
  return [0,1].map(i=>{
    const vertices=header[1+i*2], count=header[2+i*2];
    const attrs=sizes.map(size=>{const array=new Float32Array(buffer,offset,vertices*size);offset+=array.byteLength;return array;});
    const indices=new Uint32Array(buffer,offset,count);offset+=indices.byteLength;
    return {attributes:attrs,indices};
  });
}
