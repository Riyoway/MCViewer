import { Group, Mesh } from 'three';
import { decodeMeshes } from './binary';
import { Voxels, decodeColumn } from './Voxels';
import { appendElement, emptyMesh } from './Mesher';
import { AssetManager, assetUrl } from '../core/AssetManager';
import { Collision } from '../core/Collision';
import type { WorldManifest, Vec3 } from './types';

async function readCompressed(file:string) {
  const response=await fetch(assetUrl(file));if(!response.ok)throw new Error(`チャンクを読み込めません: ${file}`);
  let buffer=await response.arrayBuffer();const bytes=new Uint8Array(buffer);
  if(bytes[0]===31&&bytes[1]===139)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buffer;
}
export class World {
  readonly root=new Group();readonly voxels=new Voxels();readonly lights=new Voxels();readonly collision:Collision;readonly data:WorldManifest;
  private loaded=new Map<string,{group:Group;keys:string[]}>();private pending=new Map<string,Promise<void>>();
  private columns=new Map<string,WorldManifest['chunks'][number]>();private center:Vec3=[0,0,0];private disposed=false;
  private doorMeshes=new Map<string,Mesh>();private doorGeometry=new Map<string,Mesh>();
  radius=6;error='';
  constructor(readonly assets:AssetManager,readonly name:string) {
    this.data=assets.manifest.worlds[name];if(!this.data)throw new Error(`ワールドがありません: ${name}`);
    this.collision=new Collision(this.voxels,assets.manifest.blocks);
    for(const column of this.data.chunks)this.columns.set(`${column.origin[0]/16},${column.origin[2]/16}`,column);
    this.collision.loaded=(x,z)=>this.loaded.has(`${Math.floor(x/16)},${Math.floor(z/16)}`);
  }
  async start(progress:(done:number,total:number)=>void) {
    this.center=[...this.data.spawn];let next=0,done=0;const initial=this.nearby(1);
    await Promise.all(Array.from({length:4},async()=>{while(next<initial.length){await this.load(initial[next++]);progress(++done,initial.length);}}));
    this.update(this.center);
  }
  private nearby(radius:number):string[] {
    const x=Math.floor(this.center[0]/16),z=Math.floor(this.center[2]/16),keys:string[]=[];
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++)if(dx*dx+dz*dz<=(radius+.5)**2&&this.columns.has(`${x+dx},${z+dz}`))keys.push(`${x+dx},${z+dz}`);
    return keys.sort((a,b)=>{const A=a.split(',').map(Number),B=b.split(',').map(Number);return (A[0]-x)**2+(A[1]-z)**2-(B[0]-x)**2-(B[1]-z)**2;});
  }
  private load(key:string):Promise<void> {
    if(this.loaded.has(key))return Promise.resolve();if(this.pending.has(key))return this.pending.get(key)!;
    const column=this.columns.get(key)!;
    const operation=(async()=>{
      const [meshBuffer,voxelBuffer]=await Promise.all([readCompressed(column.file),readCompressed(column.voxels)]);
      if(this.disposed)return;
      const group=new Group(),keys=decodeColumn(voxelBuffer,column.origin[0],column.origin[2],this.voxels,this.lights);
      decodeMeshes(meshBuffer).forEach((data,i)=>{if(data.indices.length)group.add(this.assets.mesh(data,i===1));});
      for(const chunkKey of keys) {
        const [cx,cy,cz]=chunkKey.split(',').map(Number),cells=this.voxels.chunks.get(chunkKey)!;
        for(let i=0;i<4096;i++){const id=cells[i],block=this.assets.manifest.blocks[id];if(!block||!/door$/.test(block.name))continue;
          const position:Vec3=[cx*16+(i&15),cy*16+(i>>8),cz*16+((i>>4)&15)],door=this.door(id,this.light(...position));door.position.set(...position);group.add(door);this.doorMeshes.set(position.join(','),door);
        }
      }
      this.loaded.set(key,{group,keys});this.root.add(group);
    })().finally(()=>this.pending.delete(key));
    this.pending.set(key,operation);return operation;
  }
  light(x:number,y:number,z:number):number {
    const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z),value=this.lights.get(X,Y,Z);
    // Empty sections above the saved terrain are open sky, including Creative flight.
    return this.lights.chunks.has(`${Math.floor(X/16)},${Math.floor(Y/16)},${Math.floor(Z/16)}`)?value:240;
  }
  private door(id:number,level:number):Mesh {
    const key=`${id}:${level}`;let mesh=this.doorGeometry.get(key);
    if(!mesh){const block=this.assets.manifest.blocks[id],data=emptyMesh();for(const element of block.elements)appendElement(data,element,[0,0,0],block,undefined,undefined,[(level>>4)/15,(level&15)/15]);mesh=this.assets.mesh(data);this.doorGeometry.set(key,mesh);}
    const clone=mesh.clone();clone.userData.door=true;return clone;
  }
  interact(eye:Vec3,direction:Vec3):'door_open'|'door_close'|null {
    for(let d=0;d<=4.5;d+=.04){const p=eye.map((v,i)=>Math.floor(v+direction[i]*d)) as Vec3,id=this.voxels.get(...p),block=this.assets.manifest.blocks[id];if(!block)continue;
      if(/door$/.test(block.name)) {
        const open=!block.state.includes('open=true'),half=block.state.includes('half=upper')?'upper':'lower';
        for(const y of block.name.endsWith('trapdoor')?[p[1]]:[p[1],p[1]+(half==='upper'?-1:1)]) {
          const old=this.voxels.get(p[0],y,p[2]),b=this.assets.manifest.blocks[old];if(!b||b.name!==block.name)continue;
          const state=b.state.replace(/open=(true|false)/,`open=${open}`),newId=this.assets.manifest.lookup[`${b.theme}:${state}`];if(!newId)continue;
          this.voxels.set(p[0],y,p[2],newId);const mesh=this.doorMeshes.get(`${p[0]},${y},${p[2]}`);if(mesh)mesh.geometry=this.door(newId,this.light(p[0],y,p[2])).geometry;
        }
        return open?'door_open':'door_close';
      }
      if(block.solid&&this.collision.point(eye[0]+direction[0]*d,eye[1]+direction[1]*d,eye[2]+direction[2]*d))return null;
    }
    return null;
  }
  update(position:readonly number[]) {
    if(this.disposed)return;this.center=[position[0],position[1],position[2]];
    const wanted=new Set(this.nearby(this.radius));
    for(const key of wanted){if(this.pending.size>=4)break;if(!this.loaded.has(key)&&!this.pending.has(key))void this.load(key).catch(e=>{this.error=String(e);});}
    const cx=Math.floor(position[0]/16),cz=Math.floor(position[2]/16);
    for(const [key,value] of this.loaded) {
      const [x,z]=key.split(',').map(Number),distance=Math.hypot(x-cx,z-cz);value.group.visible=distance<=this.radius+.5;
      if(distance>this.radius+2){this.root.remove(value.group);this.release(value.group);for(const chunk of value.keys){this.voxels.chunks.delete(chunk);this.lights.chunks.delete(chunk);}this.loaded.delete(key);}
    }
  }
  private release(group:Group) {
    group.traverse(object=>{if(object instanceof Mesh){if(!object.userData.door)object.geometry.dispose();else this.doorMeshes.delete(object.position.toArray().join(','));}});
  }
  dispose(){this.disposed=true;for(const {group} of this.loaded.values())this.release(group);for(const mesh of this.doorGeometry.values())mesh.geometry.dispose();this.loaded.clear();this.voxels.chunks.clear();this.lights.chunks.clear();this.root.clear();}
  get stats(){return {loaded:this.loaded.size,pending:this.pending.size,sections:this.voxels.chunks.size};}
}
