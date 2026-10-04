import { Group, Mesh } from 'three';
import { decodeMeshes,triangleSections,type PackedMesh } from './binary';
import { Voxels, decodeColumn } from './Voxels';
import { appendElement, emptyMesh } from './Mesher';
import { AssetManager, assetUrl } from '../core/AssetManager';
import { Collision } from '../core/Collision';
import type { WorldManifest, Vec3 } from './types';
import { fluidHeight,fluidKind } from './Fluid';
import {traceBlock,type BlockHit} from './Target';
import {Building,type BlockChange} from './Building';
import {EditStore} from './EditStore';
import {runEditJob,type EditJob,type EditResult} from './EditJob';
import type {WorldSource} from '../viewer/ImportWorld';

interface Column {group:Group;keys:string[];surface:Float32Array;rainSurface:Int16Array;sections:Map<string,Group>;bases:{mesh:Mesh;data:PackedMesh;owners?:Int16Array;transparent:boolean}[]}

async function readCompressed(file:string,signal:AbortSignal) {
  const response=await fetch(assetUrl(file),{signal});if(!response.ok)throw new Error(`チャンクを読み込めません: ${file}`);
  let buffer=await response.arrayBuffer();const bytes=new Uint8Array(buffer);
  if(bytes[0]===31&&bytes[1]===139)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buffer;
}
export class World {
  readonly root=new Group();readonly voxels=new Voxels();readonly lights=new Voxels();readonly collision:Collision;readonly data:WorldManifest;
  private loaded=new Map<string,Column>();private pending=new Map<string,Promise<void>>();
  private columns=new Map<string,WorldManifest['chunks'][number]>();private center:Vec3=[0,0,0];private disposed=false;
  private controller=new AbortController();
  private doorMeshes=new Map<string,Mesh>();private doorGeometry=new Map<string,Mesh>();
  readonly edits:EditStore;readonly building:Building;private terrainTiles=new Set<number>();private dirty=new Set<string>();
  private worker?:Worker;private job?:EditJob;private revision=0;private lightEdits=new Map<string,Vec3>();private ready:EditResult['meshes']=[];
  radius=6;error='';
  constructor(readonly assets:AssetManager,readonly name:string,private source?:WorldSource) {
    this.data=assets.manifest.worlds[name];if(!this.data)throw new Error(`ワールドがありません: ${name}`);
    this.collision=new Collision(this.voxels,assets.manifest.blocks);
    this.edits=new EditStore(name);this.building=new Building(this.voxels,assets.manifest,this.data.theme??(name.startsWith('tutorial')?'vanilla':name),p=>this.validPosition(p));
    for(const block of assets.manifest.blocks)if(block){for(const tile of [...block.tiles,...block.fluidTiles??[]])this.terrainTiles.add(tile);for(const element of block.elements)for(const face of Object.values(element.faces))if(face)this.terrainTiles.add(face.tile);}
    for(const column of this.data.chunks)this.columns.set(`${column.origin[0]/16},${column.origin[2]/16}`,column);
    this.collision.loaded=(x,z)=>this.loaded.has(`${Math.floor(x/16)},${Math.floor(z/16)}`);
    if(typeof Worker!=='undefined'){
      this.worker=new Worker(new URL('./EditWorker.ts',import.meta.url),{type:'module'});
      this.worker.postMessage({blocks:assets.manifest.blocks});
      this.worker.onmessage=event=>{if(event.data.error){this.error=event.data.error;return;}this.finishJob(event.data);};
      this.worker.onerror=event=>{this.error=`地形を更新できません: ${event.message}`;};
    }
  }
  async start(progress:(done:number,total:number)=>void) {
    this.center=[...this.data.spawn];let next=0,done=0;const initial=this.nearby(1);
    try{await Promise.all(Array.from({length:4},async()=>{while(next<initial.length){await this.load(initial[next++]);progress(++done,initial.length);}}));}
    catch(error){this.error=String(error);this.controller.abort();throw error;}
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
      const {meshBuffer,voxelBuffer}=this.source?await this.source.read(column.origin):await Promise.all([readCompressed(column.file,this.controller.signal),readCompressed(column.voxels,this.controller.signal)]).then(([meshBuffer,voxelBuffer])=>({meshBuffer,voxelBuffer}));
      if(this.disposed)return;
      const group=new Group(),surface=new Float32Array(256).fill(this.data.bounds?.min[1]??0),rainSurface=new Int16Array(256).fill(this.data.bounds?.min[1]??0),keys=decodeColumn(voxelBuffer,column.origin[0],column.origin[2],this.voxels,this.lights);
      const bases:Column['bases']=[];
      decodeMeshes(meshBuffer).forEach((data,i)=>{if(data.indices.length){const mesh=this.assets.mesh(data,i===1);group.add(mesh);bases.push({mesh,data,transparent:i===1});}});
      const edited=this.edits.apply(column.origin[0]/16,column.origin[2]/16,this.building.theme,this.assets.manifest,(p,id)=>this.voxels.set(...p,id),p=>this.voxels.get(...p));
      for(const chunkKey of this.voxels.chunks.keys())if(chunkKey.startsWith(`${column.origin[0]/16},`)&&chunkKey.endsWith(`,${column.origin[2]/16}`)&&!keys.includes(chunkKey))keys.push(chunkKey);
      for(const chunkKey of keys) {
        const [cx,cy,cz]=chunkKey.split(',').map(Number),cells=this.voxels.chunks.get(chunkKey)!;
        for(let i=0;i<4096;i++){const id=cells[i],block=this.assets.manifest.blocks[id];if(!block)continue;
          if(block.solid||block.fluid){const cell=i&255,y=cy*16+(i>>8),top=y+(block.fluid?1:Math.max(0,...block.collision.map(box=>box.to[1])));surface[cell]=Math.max(surface[cell],top);rainSurface[cell]=Math.max(rainSurface[cell],y+1);}
          if(!/door$/.test(block.name))continue;
          const position:Vec3=[cx*16+(i&15),cy*16+(i>>8),cz*16+((i>>4)&15)],door=this.door(id,this.light(...position));door.position.set(...position);group.add(door);this.doorMeshes.set(position.join(','),door);
        }
      }
      this.loaded.set(key,{group,keys,surface,rainSurface,bases,sections:new Map()});this.root.add(group);this.revision++;
      const affected=[...this.edits.cells.keys()].map(k=>k.split(',').map(Number) as Vec3).filter(p=>p[0]>=column.origin[0]-16&&p[0]<column.origin[0]+32&&p[2]>=column.origin[2]-16&&p[2]<column.origin[2]+32);
      // A newly loaded neighbor arrives with its original baked light. It must see
      // saved torches/roof openings in adjacent columns, even if it has no own edits.
      if(affected.length){this.refreshLighting(affected);for(const p of affected)this.markDirty(p);}
      if(edited)for(const p of affected)if(p[0]>>4===column.origin[0]/16&&p[2]>>4===column.origin[2]/16)this.markDirty(p);
      // AO/hidden faces at edited chunk edges must also see newly arrived neighbors.
      for(const [neighbor,value] of this.loaded)if(value.sections.size&&neighbor!==key){const [x,z]=neighbor.split(',').map(Number);if(Math.abs(x-column.origin[0]/16)<=1&&Math.abs(z-column.origin[2]/16)<=1)for(const section of value.sections.keys())this.dirty.add(section);}
      if(!this.worker)this.pumpEdits();
    })().finally(()=>this.pending.delete(key));
    this.pending.set(key,operation);return operation;
  }
  light(x:number,y:number,z:number):number {
    const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z),value=this.lights.get(X,Y,Z);
    // Empty sections above the saved terrain are open sky, including Creative flight.
    return this.lights.chunks.has(`${Math.floor(X/16)},${Math.floor(Y/16)},${Math.floor(Z/16)}`)?value:240;
  }
  precipitationSurface(x:number,z:number):number|null {
    x=Math.floor(x);z=Math.floor(z);
    return this.loaded.get(`${Math.floor(x/16)},${Math.floor(z/16)}`)?.surface[(z&15)*16+(x&15)]??null;
  }
  rainSoundSurface(x:number,z:number):number|null {
    x=Math.floor(x);z=Math.floor(z);
    return this.loaded.get(`${Math.floor(x/16)},${Math.floor(z/16)}`)?.rainSurface[(z&15)*16+(x&15)]??null;
  }
  particleSurface(x:number,y:number,z:number,fluids=true):number|null {
    const X=Math.floor(x),Z=Math.floor(z);if(!this.collision.loaded(X,Z))return null;
    let top:number|null=null;
    for(let Y=Math.floor(y)-1;Y<=Math.floor(y);Y++){
      const block=this.assets.manifest.blocks[this.voxels.get(X,Y,Z)];if(!block)continue;
      const fluid=fluidKind(block),above=this.assets.manifest.blocks[this.voxels.get(X,Y+1,Z)];
      if(fluid&&fluids){const height=Y+fluidHeight(block,above,fluid);top=Math.max(top??-Infinity,height);}
      for(const box of block.collision)if(x-X>=box.from[0]&&x-X<=box.to[0]&&z-Z>=box.from[2]&&z-Z<=box.to[2])top=Math.max(top??-Infinity,Y+box.to[1]);
    }
    return top;
  }
  particleCollision(x:number,y:number,z:number){return this.particleSurface(x,y,z,false);}
  rainParticleHit(x:number,top:number,z:number){
    const y=top-1,block=this.assets.manifest.blocks[this.voxels.get(Math.floor(x),y,Math.floor(z))];
    return {height:this.particleSurface(x,y,z)??y,smoke:!!block&&(block.name==='lava'||block.name==='magma_block'||block.name.endsWith('campfire')&&!block.state.includes('lit=false'))};
  }
  private door(id:number,level:number):Mesh {
    const key=`${id}:${level}`;let mesh=this.doorGeometry.get(key);
    if(!mesh){const block=this.assets.manifest.blocks[id],data=emptyMesh();for(const element of block.elements)appendElement(data,element,[0,0,0],block,undefined,undefined,[(level>>4)/15,(level&15)/15]);mesh=this.assets.mesh(data);this.doorGeometry.set(key,mesh);}
    const clone=mesh.clone();clone.userData.door=true;return clone;
  }
  target(eye:Vec3,direction:Vec3):BlockHit|null{return traceBlock(this.voxels,this.assets.manifest.blocks,eye,direction);}
  private validPosition(p:Vec3){const bounds=this.data.bounds??{min:[-Infinity,0,-Infinity],max:[Infinity,320,Infinity]};return p.every((n,i)=>Number.isInteger(n)&&n>=bounds.min[i]&&n<bounds.max[i])&&this.collision.loaded(p[0],p[2]);}
  destroy(hit:BlockHit){const changes=this.building.destroy(hit);return changes.length?this.change(changes):false;}
  place(item:string,hit:BlockHit,direction:Vec3,player:Vec3){const changes=this.building.place(item,hit,direction,player);return changes?this.change(changes):false;}
  private markDirty(p:Vec3){for(let y=Math.max(this.data.bounds?.min[1]??0,p[1]-1)>>4;y<=(p[1]+1)>>4;y++)for(let z=(p[2]-1)>>4;z<=(p[2]+1)>>4;z++)for(let x=(p[0]-1)>>4;x<=(p[0]+1)>>4;x++)this.dirty.add(`${x},${y},${z}`);}
  private refreshSurface(p:Vec3){const column=this.loaded.get(`${p[0]>>4},${p[2]>>4}`);if(!column)return;const index=(p[2]&15)*16+(p[0]&15);column.surface[index]=this.data.bounds?.min[1]??0;column.rainSurface[index]=this.data.bounds?.min[1]??0;
    for(let y=this.data.bounds?.min[1]??0;y<(this.data.bounds?.max[1]??320);y++){const block=this.assets.manifest.blocks[this.voxels.get(p[0],y,p[2])];if(block?.solid||block?.fluid){column.surface[index]=Math.max(column.surface[index],y+(block.fluid?1:Math.max(0,...block.collision.map(box=>box.to[1]))));column.rainSurface[index]=y+1;}}
  }
  private refreshLighting(positions:Vec3[]){for(const p of positions)this.lightEdits.set(p.join(','),p);}
  private setBlock({position:p,id}:BlockChange){const old=this.voxels.get(...p);if(old===id)return false;this.edits.record(p,old,id,this.assets.manifest);this.voxels.set(...p,id);this.markDirty(p);this.refreshSurface(p);
    const key=`${p[0]>>4},${p[1]>>4},${p[2]>>4}`,column=this.loaded.get(`${p[0]>>4},${p[2]>>4}`);if(column&&!column.keys.includes(key))column.keys.push(key);
    const doorKey=p.join(','),oldMesh=this.doorMeshes.get(doorKey);if(oldMesh){oldMesh.removeFromParent();this.doorMeshes.delete(doorKey);}
    if(/door$/.test(this.assets.manifest.blocks[id]?.name??'')&&column){const mesh=this.door(id,this.light(...p));mesh.position.set(...p);column.group.add(mesh);this.doorMeshes.set(doorKey,mesh);}return true;
  }
  private change(changes:BlockChange[]){const positions:Vec3[]=[];for(const change of changes)if(this.setBlock(change))positions.push(change.position);if(!positions.length)return false;
    // Connected shapes and unsupported attachments are local, deterministic updates.
    let frontier=positions;for(let pass=0;pass<4&&frontier.length;pass++){const next:Vec3[]=[];for(const p of frontier)for(const change of this.building.neighbors(p))if(this.setBlock(change)){next.push(change.position);positions.push(change.position);}frontier=next;}
    this.revision++;this.refreshLighting(positions);this.pumpEdits();
    return true;
  }
  private pumpEdits(){
    if(this.job||this.ready.length||this.disposed||this.error||!this.dirty.size&&!this.lightEdits.size)return;
    const first=this.lightEdits.values().next().value??this.dirty.values().next().value!.split(',').map(n=>Number(n)*16) as Vec3;
    // Distant saved edits are separate jobs, never one enormous intervening volume.
    const positions=[...this.lightEdits.values()].filter(p=>Math.abs(p[0]-first[0])<=16&&Math.abs(p[2]-first[2])<=16);
    const points=positions.length?positions:[first],minX=Math.min(...points.map(p=>p[0]))-32,maxX=Math.max(...points.map(p=>p[0]))+32,minZ=Math.min(...points.map(p=>p[2]))-32,maxZ=Math.max(...points.map(p=>p[2]))+32;
    const inside=(key:string)=>{const [x,,z]=key.split(',').map(Number);return x>=minX>>4&&x<=maxX>>4&&z>=minZ>>4&&z<=maxZ>>4;};
    const sections=[...this.dirty].filter(inside);for(const key of sections)this.dirty.delete(key);for(const p of positions)this.lightEdits.delete(p.join(','));
    const snapshot=(source:Voxels)=>[...source.chunks].filter(([key])=>inside(key)).map(([key,data])=>[key,data.slice()] as [string,Uint16Array]);
    const job:EditJob={revision:this.revision,positions,sections,height:this.data.bounds?.max[1]??320,minY:this.data.bounds?.min[1]??0,columns:[...this.loaded.keys()],voxels:snapshot(this.voxels),lights:snapshot(this.lights)};this.job=job;
    if(this.worker)this.worker.postMessage(job,[...job.voxels,...job.lights].map(([,data])=>data.buffer));
    else this.finishJob(runEditJob(job,this.assets.manifest.blocks));
  }
  private finishJob(result:EditResult){
    if(this.disposed||!this.job)return;const job=this.job;this.job=undefined;
    // A newer edit/load invalidates the snapshot. Replay the whole affected region,
    // so an old result cannot restore removed blocks or overwrite newer light.
    if(result.revision!==this.revision){for(const p of job.positions)this.lightEdits.set(p.join(','),p);for(const key of job.sections)this.dirty.add(key);this.pumpEdits();return;}
    for(const [key,data] of result.lights){const [x,,z]=key.split(',').map(Number),column=this.loaded.get(`${x},${z}`);if(column){this.lights.chunks.set(key,data);if(!column.keys.includes(key))column.keys.push(key);}}
    this.ready.push(...result.meshes);
    if(!this.worker){while(this.ready.length)this.rebuildSection(this.ready.shift()!);this.pumpEdits();}
  }
  private rebuildSection({key,data}:{key:string;data:PackedMesh[]}){const [cx,cy,cz]=key.split(',').map(Number),column=this.loaded.get(`${cx},${cz}`);if(!column)return;
    const old=column.sections.get(key);if(old){column.group.remove(old);this.release(old);}if(!column.keys.includes(key))column.keys.push(key);
    const group=new Group();data.forEach((mesh,i)=>{if(mesh.indices.length)group.add(this.assets.mesh(mesh,i===1));});
    column.sections.set(key,group);column.group.add(group);
    const replaced=new Set([...column.sections.keys()].map(k=>Number(k.split(',')[1])));
    for(const base of column.bases){base.owners??=triangleSections(base.data,this.terrainTiles);const indices:number[]=[];for(let i=0;i<base.owners.length;i++)if(!replaced.has(base.owners[i]))indices.push(base.data.indices[i*3],base.data.indices[i*3+1],base.data.indices[i*3+2]);this.assets.updateIndices(base.mesh,new Uint32Array(indices),base.data.attributes[3],base.transparent);}
    for(const mesh of this.doorMeshes.values())if(mesh.position.x>>4===cx&&mesh.position.y>>4===cy&&mesh.position.z>>4===cz){const id=this.voxels.get(...mesh.position.toArray());mesh.geometry=this.door(id,this.light(...mesh.position.toArray())).geometry;}
  }
  interact(eye:Vec3,direction:Vec3):'door_open'|'door_close'|null {
    const hit=this.target(eye,direction);if(!hit)return null;const p=hit.position,block=this.assets.manifest.blocks[hit.id];
      if(/door$/.test(block.name)&&!block.name.startsWith('iron_')) {
        const open=!block.state.includes('open=true'),half=block.state.includes('half=upper')?'upper':'lower';
        for(const y of block.name.endsWith('trapdoor')?[p[1]]:[p[1],p[1]+(half==='upper'?-1:1)]) {
          const old=this.voxels.get(p[0],y,p[2]),b=this.assets.manifest.blocks[old];if(!b||b.name!==block.name)continue;
          const state=b.state.replace(/open=(true|false)/,`open=${open}`),newId=this.assets.manifest.lookup[`${b.theme}:${state}`];if(!newId)continue;
          this.edits.record([p[0],y,p[2]],old,newId,this.assets.manifest);this.voxels.set(p[0],y,p[2],newId);const mesh=this.doorMeshes.get(`${p[0]},${y},${p[2]}`);if(mesh)mesh.geometry=this.door(newId,this.light(p[0],y,p[2])).geometry;
        }
        this.revision++;return open?'door_open':'door_close';
      }
    return null;
  }
  update(position:readonly number[],radius=this.radius) {
    if(this.disposed||this.error)return;this.center=[position[0],position[1],position[2]];
    const deadline=performance.now()+4;while(this.ready.length){this.rebuildSection(this.ready.shift()!);if(performance.now()>deadline)break;}this.pumpEdits();
    const wanted=new Set(this.nearby(radius));
    for(const key of wanted){if(this.pending.size>=4)break;if(!this.loaded.has(key)&&!this.pending.has(key))void this.load(key).catch(e=>{if(!this.disposed&&!this.error){this.error=String(e);this.controller.abort();}});}
    const cx=Math.floor(position[0]/16),cz=Math.floor(position[2]/16);
    for(const [key,value] of this.loaded) {
      const [x,z]=key.split(',').map(Number),distance=Math.hypot(x-cx,z-cz);value.group.visible=distance<=this.radius+.5;
      if(distance>this.radius+2){this.root.remove(value.group);this.release(value.group);for(const chunk of value.keys){this.voxels.chunks.delete(chunk);this.lights.chunks.delete(chunk);}this.loaded.delete(key);this.revision++;}
    }
  }
  private release(group:Group) {
    group.traverse(object=>{if(object instanceof Mesh){if(!object.userData.door)object.geometry.dispose();else this.doorMeshes.delete(object.position.toArray().join(','));}});
  }
  dispose(){this.edits.flush();this.disposed=true;this.controller.abort();this.worker?.terminate();this.source?.dispose();this.ready=[];this.job=undefined;for(const {group} of this.loaded.values())this.release(group);for(const mesh of this.doorGeometry.values())mesh.geometry.dispose();this.loaded.clear();this.voxels.chunks.clear();this.lights.chunks.clear();this.root.clear();}
  get stats(){return {loaded:this.loaded.size,pending:this.pending.size,sections:this.voxels.chunks.size,editing:!!this.job||!!this.dirty.size||!!this.ready.length||!!this.lightEdits.size};}
}
