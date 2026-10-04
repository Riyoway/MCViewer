import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Mesh,MeshBasicMaterial,PerspectiveCamera} from 'three';
import {Building} from '../src/minecraft/Building.ts';
import {properties,stateId} from '../src/minecraft/BlockState.ts';
import {traceBlock,type BlockHit} from '../src/minecraft/Target.ts';
import {EditStore} from '../src/minecraft/EditStore.ts';
import {editLighting} from '../src/minecraft/EditLighting.ts';
import {CreativeControls} from '../src/core/CreativeControls.ts';
import {Voxels,encodeColumn} from '../src/minecraft/Voxels.ts';
import {World} from '../src/minecraft/WorldLoader.ts';
import {AssetManager} from '../src/core/AssetManager.ts';
import {appendElement,emptyMesh,meshChunk} from '../src/minecraft/Mesher.ts';
import {encodeMeshes,decodeMeshes,triangleSections} from '../src/minecraft/binary.ts';
import {createDebris,debrisBoxes,tickDebris} from '../src/world/TerrainParticles.ts';
import {BlockParticles} from '../src/world/BlockParticles.ts';
import {Collision} from '../src/core/Collision.ts';
import {runEditJob,type EditJob} from '../src/minecraft/EditJob.ts';
import type {Manifest,Vec3} from '../src/minecraft/types.ts';

const manifest=JSON.parse(await readFile('public/generated/manifest.json','utf8')) as Manifest;
const id=(name:string,theme='vanilla')=>manifest.building![theme][name];
const hit=(position:Vec3,face:BlockHit['face']='up',point?:Vec3):BlockHit=>({position,face,point:point??position.map((n,i)=>n+(i===1?1:.5)) as Vec3,id:0,distance:1});
const away:Vec3=[-10,8,-10];
for(const theme of ['vanilla','mario','festive','halloween','chinese']){
  assert(Object.keys(manifest.building![theme]).length>200);
  const voxels=new Voxels();voxels.fill([0,0,0],[32,1,16],id('stone',theme));
  const building=new Building(voxels,manifest,theme,p=>p[0]>=0&&p[0]<32&&p[1]>=0&&p[1]<32&&p[2]>=0&&p[2]<16);
  const place=(item:string,target:BlockHit,direction:Vec3=[0,0,1],player=away)=>building.place(item,target,direction,player);
  const floor=hit([8,0,8]);floor.id=id('stone',theme);
  const stone=place('stone',floor)!;assert.equal(stone.length,1);assert.deepEqual(stone[0].position,[8,1,8]);
  assert.equal(place('stone',floor,[0,0,1],[8.5,1,8.5]),null,'Blocks cannot be placed through the player');
  assert.equal(place('diamond_sword',floor),null,'Tools are not silently treated as building blocks');
  voxels.set(8,1,8,id('stone',theme));const log=place('oak_log',hit([8,1,8],'east',[9,1.5,8.5]))!;assert.equal(properties(manifest.blocks[log[0].id]).axis,'x','Log end grain follows the clicked face');
  const top=place('oak_stairs',hit([8,1,8],'west',[8,1.8,8.5]))!;assert.equal(properties(manifest.blocks[top[0].id]).half,'top');voxels.set(8,1,8,0);
  const stairs=place('oak_stairs',floor)!;assert.equal(properties(manifest.blocks[stairs[0].id]).facing,'south');assert.equal(properties(manifest.blocks[stairs[0].id]).half,'bottom');
  const slab=place('oak_slab',floor)!;voxels.set(...slab[0].position,slab[0].id);
  const slabHit=hit([8,1,8],'up',[8.5,1.5,8.5]);slabHit.id=slab[0].id;
  const double=place('oak_slab',slabHit)!;assert.deepEqual(double[0].position,[8,1,8]);assert.equal(properties(manifest.blocks[double[0].id]).type,'double','Clicking the exposed slab face combines the two halves');voxels.set(8,1,8,0);
  const water=manifest.lookup[`${theme}:water[level=0]`];voxels.set(8,1,8,water);const wet=place('oak_slab',floor)!;assert.equal(properties(manifest.blocks[wet[0].id]).waterlogged,'true','Placing a slab in a water source waterlogs it');voxels.set(...wet[0].position,wet[0].id);assert.equal(building.destroy({...hit([8,1,8]),id:wet[0].id})[0].id,water,'Destroying a waterlogged block preserves its water source');voxels.set(8,1,8,0);
  const bed=place('red_bed',floor)!;assert.equal(bed.length,2);assert.deepEqual(bed[1].position,[8,1,9]);
  for(const change of bed)voxels.set(...change.position,change.id);
  assert.equal(building.destroy({...hit([8,1,9]),id:bed[1].id}).length,2,'Destroying a bed head also removes its foot');
  for(const change of bed)voxels.set(...change.position,0);
  const door=place('oak_door',floor)!;assert.equal(door.length,2);assert.equal(properties(manifest.blocks[door[1].id]).half,'upper');
  for(const change of door)voxels.set(...change.position,change.id);
  assert.equal(building.destroy({...hit([8,2,8]),id:door[1].id}).length,2,'Destroying the top of a door removes both halves');
  for(const change of door)voxels.set(...change.position,0);
  voxels.set(8,1,8,id('stone',theme));const torch=place('torch',hit([8,1,8],'east',[9,1.5,8.5]))!;assert.equal(manifest.blocks[torch[0].id].name,'wall_torch');assert.equal(properties(manifest.blocks[torch[0].id]).facing,'east');voxels.set(8,1,8,0);
  assert.equal(place('torch',hit([8,0,8],'down',[8.5,0,8.5])),null,'Torches cannot attach to a ceiling');
  voxels.set(8,1,8,id('torch',theme));voxels.set(8,0,8,0);assert(building.neighbors([8,0,8]).some(change=>change.position.join(',')==='8,1,8'&&change.id===0),'An attachment breaks when its support is removed');voxels.set(8,1,8,0);voxels.set(8,0,8,id('stone',theme));
  voxels.set(15,1,8,id('oak_fence',theme));voxels.set(16,1,8,id('birch_fence',theme)??id('oak_fence',theme));
  for(const change of building.neighbors([15,1,8]))voxels.set(...change.position,change.id);
  assert.equal(properties(manifest.blocks[voxels.get(15,1,8)]).east,'true');assert.equal(properties(manifest.blocks[voxels.get(16,1,8)]).west,'true','Fence connections cross chunk boundaries');
  voxels.set(16,1,8,0);for(const change of building.neighbors([16,1,8]))voxels.set(...change.position,change.id);assert.equal(properties(manifest.blocks[voxels.get(15,1,8)]).east,'false');
  voxels.set(15,1,8,0);voxels.set(15,1,8,stairs[0].id);
  const turning=stateId(manifest,manifest.blocks[stairs[0].id],{facing:'east'});voxels.set(15,1,9,turning);
  for(const change of building.neighbors([15,1,9]))voxels.set(...change.position,change.id);
  assert.equal(properties(manifest.blocks[voxels.get(15,1,8)]).shape,'outer_left','Adjacent stairs form the native corner');
}

const rays=new Voxels();rays.set(0,0,0,id('oak_slab'));const half=manifest.blocks[id('oak_slab')];
assert.equal(traceBlock(rays,manifest.blocks,[-1,.75,.5],[1,0,0]),null,'Selection rays pass above a bottom slab');
const slabRay=traceBlock(rays,manifest.blocks,[-1,.25,.5],[1,0,0])!;assert.equal(slabRay.face,'west');assert.equal(slabRay.distance,1);
const rays2=new Voxels();rays2.set(5,0,0,id('stone'));assert.equal(traceBlock(rays2,manifest.blocks,[0,.5,.5],[1,0,0])?.distance,5,'Creative reach includes the five-block boundary');assert.equal(traceBlock(rays2,manifest.blocks,[-.01,.5,.5],[1,0,0]),null);
rays2.set(1,0,0,manifest.lookup['vanilla:water[level=0]']);assert.equal(traceBlock(rays2,manifest.blocks,[0,.5,.5],[1,0,0])?.position[0],5,'Ordinary block targeting ignores fluids');

let breaks=0,uses=0,picks=0;const controls=new CreativeControls(()=>breaks++,()=>uses++,()=>picks++);
controls.down(0);assert.equal(breaks,1);for(let i=0;i<4;i++)controls.update(.05);assert.equal(breaks,1);controls.update(.05);assert.equal(breaks,2,'Holding attack repeats every five game ticks');controls.up(0);controls.update(.1);assert.equal(breaks,2);
controls.down(2);assert.equal(uses,1);for(let i=0;i<4;i++)controls.update(.05);assert.equal(uses,2,'Holding use repeats every four ticks');controls.down(1);assert.equal(picks,1);controls.reset();controls.update(.1);assert.equal(uses,2,'Pointer unlock clears held buttons');

const storage=new Map<string,string>(),mockStorage={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value);}};
const store=new EditStore('one',mockStorage);store.record([1,2,3],id('stone'),0,manifest);store.flush();assert.equal(new EditStore('one',mockStorage).cells.get('1,2,3'),null);assert.equal(new EditStore('other',mockStorage).cells.size,0,'Edits are scoped to the map');store.record([1,2,3],0,id('stone'),manifest);store.flush();assert.equal(new EditStore('one',mockStorage).cells.size,0,'Restoring the original block removes its edit');
const other=new EditStore('other',mockStorage);other.record([2,3,4],id('stone'),0,manifest);other.flush();store.record([1,2,3],id('stone'),0,manifest);store.clear();store.flush();assert.equal(new EditStore('one',mockStorage).cells.size,0,'Reset cancels pending saves and cannot restore old edits during dispose');assert.equal(store.originals.size,0);assert.equal(new EditStore('other',mockStorage).cells.size,1,'Reset leaves other maps untouched');

const cubeParticles=createDebris(debrisBoxes(manifest.blocks[id('stone')]),[0,2,0],()=>.5);
assert.equal(cubeParticles.length,64);assert.equal(createDebris(debrisBoxes(half),[0,2,0]).length,32,'A half slab emits two vertical layers instead of four');
assert(cubeParticles.every(p=>Math.abs(Math.hypot(p.velocity[0],p.velocity[1]-.1,p.velocity[2])-.12)<1e-9),'Launch velocities are normalized to native speed, with the upward .1 bias');
assert(cubeParticles.every(p=>p.size===.07500000000000001&&p.life===7));
const randomParticles=createDebris(debrisBoxes(manifest.blocks[id('stone')]),[0,2,0]);assert(randomParticles.every(p=>Math.hypot(p.velocity[0],p.velocity[1]-.1,p.velocity[2])>=.06&&Math.hypot(p.velocity[0],p.velocity[1]-.1,p.velocity[2])<=.18));
const debrisVoxels=new Voxels();debrisVoxels.fill([-2,0,-2],[3,1,3],id('stone'));debrisVoxels.set(1,1,0,id('stone'));const debrisCollision=new Collision(debrisVoxels,manifest.blocks);
assert(Math.abs(debrisCollision.particleMove([.85,1.2,.5],[.2,0,0])[0]-.05)<1e-9,'Debris clips its full AABB against walls');assert.equal(debrisCollision.particleMove([.5,1.1,.5],[0,-.2,0])[1],-.10000000000000009,'Debris lands on the block top');
const p=cubeParticles[0],previous=[...p.position],velocity=[...p.velocity];tickDebris(p,(position,v)=>debrisCollision.particleMove(position,v));assert.deepEqual(p.previous,previous);assert(Math.abs(p.position[1]-previous[1]-velocity[1]+.04)<1e-9);assert(Math.abs(p.velocity[1]-(velocity[1]-.04)*.98)<1e-9);
for(const theme of ['vanilla','mario','festive','halloween','chinese']){const grass=manifest.blocks[id('grass_block',theme)],dirt=manifest.blocks[id('dirt',theme)];assert(grass.particle===dirt.tiles[0]||manifest.atlas.tiles[grass.particle!].key===`${theme}:dirt`,'Grass destruction uses the native dirt particle texture (old and appended atlases can contain equivalent IDs)');}

const lightVoxels=new Voxels(),lights=new Voxels();lightVoxels.fill([-32,0,-32],[32,1,32],id('stone'));
const read=(x:number,y:number,z:number)=>lights.chunks.has(`${x>>4},${y>>4},${z>>4}`)?lights.get(x,y,z):240,loaded=(x:number,z:number)=>x>=-32&&x<32&&z>=-32&&z<32;
lightVoxels.set(0,3,0,id('torch'));editLighting(lightVoxels,manifest.blocks,lights,[[0,3,0]],16,loaded,read);assert.equal(lights.get(4,3,0)&15,10,'Placed torches emit native level 14 with one-level propagation');
lightVoxels.set(0,3,0,0);editLighting(lightVoxels,manifest.blocks,lights,[[0,3,0]],16,loaded,read);assert.equal(lights.get(4,3,0)&15,0,'Removing a torch removes its old propagated light, including at world height');
lightVoxels.fill([-2,5,-2],[3,6,3],id('stone'));editLighting(lightVoxels,manifest.blocks,lights,[[0,5,0]],16,loaded,read);const covered=lights.get(0,4,0)>>4;assert(covered<15);
lightVoxels.set(0,5,0,0);editLighting(lightVoxels,manifest.blocks,lights,[[0,5,0]],16,loaded,read);assert.equal(lights.get(0,4,0)>>4,15,'Breaking a roof restores direct skylight below the opening');

// A real two-column mesh fixture exercises rendering, collision, decoration and reload.
const cells=new Voxels();cells.fill([0,0,0],[32,1,16],id('stone'));cells.set(15,1,8,id('stone'));cells.set(16,1,8,id('stone'));cells.set(8,52,8,id('stone'));
const used=new Set(manifest.blocks.filter(Boolean).flatMap(block=>[...block.tiles,...block.fluidTiles??[],...block.elements.flatMap(e=>Object.values(e.faces).map(f=>f!.tile))]));
const paintingTile=manifest.atlas.tiles.findIndex((_,i)=>!used.has(i));assert(paintingTile>=0);
const responses=new Map<string,Uint8Array>(),chunks=[];
for(const x of [0,16]){
  const data=meshChunk(cells,manifest.blocks,[x,0,0],()=>240,true),upper=meshChunk(cells,manifest.blocks,[x,48,0],()=>240,true);for(const part of ['opaque','transparent'] as const){const offset=data[part].position.length/3;for(const key of ['position','normal','uv','tile','color','glow','light'] as const)data[part][key].push(...upper[part][key]);data[part].index.push(...upper[part].index.map(n=>n+offset));}
  if(x===0)appendElement(data.opaque,{from:[0,0,0],to:[1,1,.0625],faces:{south:{tile:paintingTile,uv:[0,0,16,16]}}},[8,3,8],{rotation:[0,0,0],tint:[1,1,1],emissive:0} as any);
  const packed=decodeMeshes(encodeMeshes(data))[0],owners=triangleSections(packed,used);assert(owners.includes(0));if(x===0){assert(owners.includes(3));assert(owners.includes(-32768));}
  responses.set(`${x}.bin.gz`,new Uint8Array(encodeMeshes(data)));responses.set(`${x}.vox.gz`,new Uint8Array(encodeColumn(cells,[[x,0,0],[x,48,0]],()=>240)));chunks.push({origin:[x,0,0] as Vec3,file:`${x}.bin.gz`,voxels:`${x}.vox.gz`,quads:0});
}
const worldManifest={...manifest,worlds:{fixture:{name:'Fixture',spawn:[15,2,8] as Vec3,bounds:{min:[0,0,0] as Vec3,max:[32,64,16] as Vec3},chunks}}} as any;
const assets=Reflect.construct(AssetManager,[worldManifest,new MeshBasicMaterial({alphaTest:.1})]) as AssetManager;
const particleRenderer=new BlockParticles(assets),particleCamera=new PerspectiveCamera();particleRenderer.break({...hit([0,2,0]),id:id('stone')},240);
const firstBatch=(particleRenderer as any).batches[0],firstParticle=firstBatch.particles[0];particleRenderer.update(.075,particleCamera,{collision:debrisCollision} as any,true);
const vertices=firstBatch.mesh.geometry.getAttribute('position');for(let axis=0;axis<3;axis++){let center=0;for(let i=0;i<4;i++)center+=vertices.array[i*3+axis]/4;assert(Math.abs(center-(firstParticle.previous[axis]+firstParticle.position[axis])/2)<1e-6,'Rendering interpolates between native 20Hz particle ticks');}
const paused=Array.from(vertices.array);particleRenderer.update(.1,particleCamera,{collision:debrisCollision} as any,false);assert.deepEqual(Array.from(vertices.array),paused);particleRenderer.clear();assert.equal(particleRenderer.root.children.length,0);
let particleLight=0,particlePending=true;const particleWorld={collision:debrisCollision,light:(_:number,y:number)=>y>=3?240:particleLight,get stats(){return{editing:particlePending};}} as any;
particleRenderer.break({...hit([0,2,0]),id:id('stone')},0,particleWorld);particleRenderer.update(0,particleCamera,particleWorld,true);const lightAttribute=(particleRenderer as any).batches[0].mesh.geometry.getAttribute('lightLevel');assert.equal(lightAttribute.getX(0),1,'An exposed surface does not emit black debris from its old opaque-block light');
particlePending=false;particleLight=15;particleRenderer.update(0,particleCamera,particleWorld,true);assert.equal(lightAttribute.getX(0),0);assert.equal(lightAttribute.getY(0),1,'Debris reads current sky/block light after the terrain worker completes');particleRenderer.clear();
const originalFetch=globalThis.fetch;Object.assign(globalThis,{localStorage:mockStorage});
try{
  globalThis.fetch=async input=>new Response(responses.get(String(input).split('/').pop()!)!);
  const world=new World(assets,'fixture');await world.start(()=>{});
  // Fixture uses the default theme, while real map names select their native pack.
  Object.defineProperty(world.building,'theme',{value:'vanilla'});
  const target=world.target([14.5,1.5,8.5],[1,0,0])!;assert.deepEqual(target.position,[15,1,8]);assert(world.destroy(target));assert.equal(world.voxels.get(15,1,8),0);
  for(let i=0;i<60&&(world as any).dirty.size;i++)world.update([15,2,8],1);
  let revealed=false,picture=false;world.root.traverse(object=>{if(!(object instanceof Mesh))return;const p=object.geometry.getAttribute('position'),n=object.geometry.getAttribute('normal'),tile=object.geometry.getAttribute('tileInfo');for(let i=0;i<p.count;i++){if(p.getX(i)===16&&p.getY(i)>=1&&p.getY(i)<=2&&p.getZ(i)>=8&&p.getZ(i)<=9&&n.getX(i)===-1)revealed=true;if(tile.getX(i)===manifest.atlas.tiles[paintingTile].start)picture=true;}});
  assert(revealed,'Destroying a block reveals its neighbor face across the chunk edge');assert(picture,'Editing terrain preserves the saved painting mesh');
  const baseMeshes=[...(world as any).loaded.values()].flatMap((c:any)=>c.bases);assert(baseMeshes.some((b:any)=>b.mesh.geometry.index.array.subarray(0,b.mesh.geometry.drawRange.count).some((i:number)=>b.data.attributes[0][i*3+1]>=52)),'An untouched upper section keeps its baked geometry');
  for(const base of baseMeshes)assert.notEqual(base.mesh.geometry.index.array,base.data.indices,'Updating GPU indices cannot mutate the saved source triangle order');
  const replacement=world.target([14.5,1.5,8.5],[1,0,0])!;assert(world.place('glass',replacement,[1,0,0],away));assert.equal(manifest.blocks[world.voxels.get(15,1,8)].name,'glass');assert(world.collision.point(15.5,1.5,8.5),'Placed blocks immediately participate in collision');assert.equal(world.rainSoundSurface(15,8),2,'Placed blocks update the precipitation heightmap');world.edits.flush();world.dispose();
  const restored=new World(assets,'fixture');Object.defineProperty(restored.building,'theme',{value:'vanilla'});await restored.start(()=>{});assert.equal(manifest.blocks[restored.voxels.get(15,1,8)].name,'glass','Reloading re-applies saved edits before remeshing');
  assert(restored.destroy(restored.target([14.5,1.5,8.5],[1,0,0])!));const base=restored.target([15.5,4,8.5],[0,-1,0])!;assert(restored.place('torch',base,[0,-1,0],away));assert.equal(restored.light(17,2,8)&15,11);restored.edits.flush();restored.dispose();
  const relit=new World(assets,'fixture');Object.defineProperty(relit.building,'theme',{value:'vanilla'});await relit.start(()=>{});assert.equal(relit.light(17,2,8)&15,11,'A later-loaded unedited neighbor receives the saved torch light');relit.dispose();
  relit.edits.clear();relit.dispose();const reset=new World(assets,'fixture');Object.defineProperty(reset.building,'theme',{value:'vanilla'});await reset.start(()=>{});assert.equal(reset.voxels.get(15,1,8),id('stone'),'Map reset restores the original supplied voxel file');assert.equal(reset.voxels.get(15,0,8),id('stone'));assert.equal(reset.edits.cells.size,0);reset.dispose();
  class FakeWorker {static latest:FakeWorker;onmessage?:Function;onerror?:Function;terminated=false;jobs:EditJob[]=[];constructor(){FakeWorker.latest=this;}postMessage(data:any,transfer?:ArrayBuffer[]){if(!data.blocks)this.jobs.push(structuredClone(data,{transfer:transfer??[]}));}terminate(){this.terminated=true;}complete(){this.onmessage?.({data:runEditJob(this.jobs.shift()!,manifest.blocks)});}}
  const oldWorker=globalThis.Worker;Object.assign(globalThis,{Worker:FakeWorker});
  try{const asyncWorld=new World(assets,'fixture');Object.defineProperty(asyncWorld.building,'theme',{value:'vanilla'});await asyncWorld.start(()=>{});const worker=FakeWorker.latest;
    assert(asyncWorld.destroy({...hit([15,1,8]),id:id('stone')}));assert.equal(worker.jobs.length,1);
    assert(asyncWorld.destroy({...hit([16,1,8]),id:id('stone')}));worker.complete();assert.equal(worker.jobs.length,1,'An edit during a worker job replays both edits against the newest snapshot');worker.complete();for(let i=0;i<60&&asyncWorld.stats.editing;i++)asyncWorld.update([15,2,8],1);
    assert.equal(asyncWorld.stats.editing,false);assert.equal(asyncWorld.voxels.get(15,1,8),0);assert.equal(asyncWorld.voxels.get(16,1,8),0);assert.equal(asyncWorld.lights.get(15,1,8)>>4,15);asyncWorld.edits.clear();asyncWorld.dispose();assert(worker.terminated,'Reset/map change terminates outstanding worker work');
  }finally{Object.assign(globalThis,{Worker:oldWorker});}
}finally{globalThis.fetch=originalFetch;}
console.log('Building checks passed: placement, collision/lighting, worker edit races, partial baked meshes/paintings, reset persistence, native destruction textures/physics/interpolation and creative controls.');
