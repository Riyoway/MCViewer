import {Voxels} from './Voxels';
import {editLighting} from './EditLighting';
import {meshChunk} from './Mesher';
import type {Block,Vec3} from './types';
import type {PackedMesh} from './binary';

export interface EditJob {
  revision:number;positions:Vec3[];sections:string[];height:number;columns:string[];
  voxels:[string,Uint16Array][];lights:[string,Uint16Array][];
}
export interface EditResult {revision:number;lights:[string,Uint16Array][];meshes:{key:string;data:PackedMesh[]}[]}

// Both the worker and the headless fixtures run this exact lighting/meshing path.
export function runEditJob(job:EditJob,blocks:Block[]):EditResult {
  const voxels=new Voxels(),lights=new Voxels(),columns=new Set(job.columns),sections=new Set(job.sections);
  for(const [key,data] of job.voxels)voxels.chunks.set(key,data);
  for(const [key,data] of job.lights)lights.chunks.set(key,data);
  const read=(x:number,y:number,z:number)=>lights.chunks.get(`${x>>4},${y>>4},${z>>4}`)?.[((y&15)*16+(z&15))*16+(x&15)]??240;
  const before=new Map([...lights.chunks].map(([key,data])=>[key,data.slice()]));
  if(job.positions.length)for(const key of editLighting(voxels,blocks,lights,job.positions,job.height,(x,z)=>columns.has(`${x>>4},${z>>4}`),read))sections.add(key);
  const changed:[string,Uint16Array][]=[];
  for(const [key,data] of lights.chunks){const old=before.get(key);if(!old||data.some((n,i)=>n!==old[i]))changed.push([key,data]);}
  const meshes:EditResult['meshes']=[];
  for(const key of sections){const [cx,cy,cz]=key.split(',').map(Number);if(!columns.has(`${cx},${cz}`))continue;
    const result=meshChunk(voxels,blocks,[cx*16,cy*16,cz*16],read,true);
    meshes.push({key,data:[result.opaque,result.transparent].map(m=>({attributes:[m.position,m.normal,m.uv,m.tile,m.color,m.glow,m.light].map(a=>new Float32Array(a)),indices:new Uint32Array(m.index)}))});
  }
  return {revision:job.revision,lights:changed,meshes};
}
