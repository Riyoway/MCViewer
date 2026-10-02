import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3, Fog, PerspectiveCamera, MeshBasicMaterial } from 'three';
import sharp from 'sharp';
import { Voxels, encodeColumn, decodeColumn } from '../src/minecraft/Voxels.ts';
import { meshChunk, appendElement, emptyMesh } from '../src/minecraft/Mesher.ts';
import { encodeMeshes, decodeMeshes } from '../src/minecraft/binary.ts';
import { Collision } from '../src/core/Collision.ts';
import { Movement } from '../src/core/Movement.ts';
import { Player } from '../src/core/Player.ts';
import { PlayerModel, skinBox } from '../src/core/PlayerModel.ts';
import { AudioManager } from '../src/core/AudioManager.ts';
import { Sky } from '../src/world/Sky.ts';
import { unpackPalette } from '../scripts/anvil.ts';
import { legacyState, doorHalves } from '../scripts/legacy.ts';
import { Packs } from '../scripts/pack.ts';
import { rebuildLighting } from '../scripts/lighting.ts';
import { World } from '../src/minecraft/WorldLoader.ts';
import type { Manifest } from '../src/minecraft/types.ts';

const manifest:Manifest=JSON.parse(await readFile('public/generated/manifest.json','utf8'));
assert.equal(manifest.missingTextures.length,0);
assert.equal(Object.keys(manifest.worlds).length,5,'All five maps must be playable');
assert.equal(Object.keys(manifest.effects).length,10,'Footsteps, swimming and door sounds must ship with the maps');
for(const file of [...Object.values(manifest.audio).filter(Boolean),...Object.values(manifest.effects).flat()])assert.equal((await readFile(`public/generated/${file}`)).subarray(0,4).toString(),'OggS');
for(const world of Object.values(manifest.worlds)) {
  assert(world.blocks>10000000&&world.chunks.length>=2900,'Use the complete original Console map area');
  assert(world.quads<world.blocks);assert(world.chunks.every(c=>c.voxels),'Every render column needs actual collision data');
  assert(world.spawn.every(Number.isFinite));
}
const packs=new Packs(),stone=await packs.block('vanilla',{Name:'minecraft:stone_bricks'}),slab=await packs.block('vanilla',{Name:'minecraft:oak_slab'});
const voxels=new Voxels();voxels.fill([0,0,0],[2,3,5],stone);
const mesh=meshChunk(voxels,packs.blocks,[0,0,0]);assert.equal(mesh.opaque.index.length,36);
for(const [face,shade] of [.6,.6,1,.5,.8,.8].entries())assert(Math.abs(mesh.opaque.color[face*12]-shade)<1e-6,'Native face dimming survives mesh baking');
for(let vertex=0;vertex<24;vertex+=4)for(const [a,b] of [[0,1],[1,2]]) {
  const length=Math.hypot(...[0,1,2].map(d=>mesh.opaque.position[(vertex+a)*3+d]-mesh.opaque.position[(vertex+b)*3+d]));
  const uv=Math.hypot(...[0,1].map(d=>mesh.opaque.uv[(vertex+a)*2+d]-mesh.opaque.uv[(vertex+b)*2+d]));assert.equal(uv,length);
}
const decoded=decodeMeshes(encodeMeshes(mesh));assert.equal(decoded[0].indices.length,36);assert.equal(decoded[0].attributes[6].length,48);assert.throws(()=>decodeMeshes(new ArrayBuffer(20)));
voxels.set(-1,0,-1,stone);assert.equal(voxels.get(-1,0,-1),stone);
const restored=new Voxels();decodeColumn(encodeColumn(voxels,[[-16,0,-16]]),-16,-16,restored);assert.equal(restored.get(-1,0,-1),stone);assert.throws(()=>decodeColumn(new ArrayBuffer(12),0,0,restored));
const restoredLight=new Voxels();decodeColumn(encodeColumn(voxels,[[-16,0,-16]],()=>0xA7),-16,-16,restored,restoredLight);assert.equal(restoredLight.get(-1,0,-1),0xA7,'Entity/door light survives column storage');
const box=new Voxels();box.fill([0,0,0],[21,1,21],stone);box.fill([0,4,0],[21,5,21],stone);box.fill([0,1,0],[1,4,21],stone);box.fill([20,1,0],[21,4,21],stone);box.fill([0,1,0],[21,4,1],stone);box.fill([0,1,20],[21,4,21],stone);
box.set(0,2,10,0);const heights=new Int16Array(21*21).fill(4),dark=new Voxels(),skyLight=rebuildLighting(box,packs.blocks,dark,{min:[0,0,0],max:[21,6,21]},heights);
assert.equal(skyLight(10,5,10)>>4,15);assert.equal(skyLight(0,4,10)>>4,0,'A solid roof blocks direct sky');
assert((skyLight(1,2,10)>>4)>0,'Skylight spreads through a window');assert.equal(skyLight(18,2,10)>>4,0,'Skylight stops after fifteen propagation steps');
const torch=await packs.block('vanilla',{Name:'minecraft:torch'});box.set(10,2,10,torch);const lit=rebuildLighting(box,packs.blocks,new Voxels(),{min:[0,0,0],max:[21,6,21]},heights);assert.equal(lit(10,2,10)&15,14);assert.equal(lit(11,2,10)&15,13);assert.equal(lit(10,4,10)&15,0,'Opaque blocks stop torch light');
for(const power of [0,7,15]){const wire=packs.blocks[await packs.block('vanilla',{Name:'minecraft:redstone_wire',Properties:{power:String(power)}})];assert(wire.tint[0]>wire.tint[1]&&wire.tint[2]===0,'Wire uses its own red power tint');if(power===0)assert.equal(wire.tint[0],.3);if(power===15)assert(Math.abs(wire.tint[1]-.2)<1e-6);}
const unlit=packs.blocks[await packs.block('vanilla',{Name:'minecraft:redstone_torch',Properties:{lit:'false'}})];assert.equal(unlit.light,0);assert.equal(unlit.emissive,0);
for(const [name,level] of [['redstone_torch',7],['redstone_lamp',15],['furnace',13]] as const){const on=packs.blocks[await packs.block('vanilla',{Name:'minecraft:'+name,Properties:{lit:'true'}})],off=packs.blocks[await packs.block('vanilla',{Name:'minecraft:'+name,Properties:{lit:'false'}})];assert.equal(on.light,level);assert.equal(off.light,0);assert.equal(on.emissive,0,'Light emitters use block light rather than forcing every face white');}
for(const type of ['single','left','right'])for(const facing of ['north','east','south','west']) {
  const chest=packs.blocks[await packs.block('vanilla',{Name:'minecraft:chest',Properties:{type,facing}})];
  assert.equal(chest.elements[1].from[1],9/16);assert.equal(chest.elements[1].to[1],14/16,'Chest lid has native height');
  assert.deepEqual(chest.elements[0].faces.south!.uv,[16,16,0,0],'Chest uses upward-Y entity skin orientation');
  const latch=chest.collision[2],direction=({north:[0,0,-1],east:[1,0,0],south:[0,0,1],west:[-1,0,0]} as Record<string,number[]>)[facing];
  assert(Math.abs(latch.from[1]-7/16)<1e-6&&Math.abs(latch.to[1]-11/16)<1e-6);
  assert(direction.reduce((sum,n,i)=>sum+n*((latch.from[i]+latch.to[i])/2-.5),0)>.46,'Latch faces the chest front');
  if(type==='single') {
    const face=chest.elements[0].faces.south!,image=await sharp(packs.images[packs.tiles[face.tile].start]).extract({left:16,top:16,width:32,height:32}).raw().toBuffer();
    const skin=await sharp('minecraft-memory-assets/references/minecraft-assets/data/1.21.6/entity/chest/normal.png').ensureAlpha().extract({left:42,top:33,width:14,height:10}).resize(32,32,{kernel:'nearest'}).raw().toBuffer();assert(image.equals(skin),'Chest front keeps native skin pixels');
  }else assert.equal(chest.elements[0].to[0]-chest.elements[0].from[0],15/16,'Double-chest halves meet without a gap');
}
const arm=skinBox(4,12,4,40,16,new MeshBasicMaterial(),64,64),armUv=arm.geometry.attributes.uv;
assert.equal(armUv.getX(8),44/64);assert.equal(armUv.getY(8),1-20/64,'Shoulder cap preserves the native skin orientation');
assert.equal(armUv.getX(12),48/64);assert.equal(armUv.getY(12),1-16/64,'Fist cap is separate from the shoulder');arm.geometry.dispose();
const neighbor=new Voxels();neighbor.set(15,0,0,stone);neighbor.set(16,0,0,stone);assert.equal(meshChunk(neighbor,packs.blocks,[0,0,0]).opaque.index.length,30);
const leaves=await packs.block('vanilla',{Name:'minecraft:oak_leaves'});assert.equal(packs.blocks[leaves].occludes,false);
const canopy=new Voxels();canopy.set(0,0,0,stone);canopy.set(1,0,0,leaves);assert.equal(meshChunk(canopy,packs.blocks,[0,0,0]).opaque.index.length,66,'Leaves preserve the opaque faces visible through their holes');
const log=await packs.block('vanilla',{Name:'minecraft:oak_log',Properties:{axis:'x'}}),timber=new Voxels();timber.fill([0,0,0],[2,3,5],log);
assert(packs.blocks[log].uvRotations.some(Boolean));const grain=meshChunk(timber,packs.blocks,[0,0,0]).opaque;
for(let vertex=0;vertex<24;vertex+=4)for(const [a,b] of [[0,1],[1,2]])assert.equal(Math.hypot(...[0,1].map(d=>grain.uv[(vertex+a)*2+d]-grain.uv[(vertex+b)*2+d])),Math.hypot(...[0,1,2].map(d=>grain.position[(vertex+a)*3+d]-grain.position[(vertex+b)*3+d])),'Rotated grain keeps one texture tile per block on merged faces');

const fenceId=await packs.block('vanilla',{Name:'minecraft:oak_fence',Properties:{north:'true',east:'true',south:'false',west:'false'}}),fence=packs.blocks[fenceId],fenceMesh=emptyMesh();
for(const e of fence.elements)appendElement(fenceMesh,e,[0,0,0],fence);
assert(Math.min(...fenceMesh.position.filter((_,i)=>i%3===2))<.01,'Multipart north rail keeps its own rotation');
assert(Math.max(...fenceMesh.position.filter((_,i)=>i%3===0))>.99,'Multipart east rail keeps its own rotation');
const doorId=await packs.block('vanilla',{Name:'minecraft:oak_door',Properties:{facing:'north',half:'lower',hinge:'left',open:'false',powered:'false'}}),door=packs.blocks[doorId],doorMesh=emptyMesh();
for(const e of door.elements)appendElement(doorMesh,e,[0,0,0],door);
for(const axis of [0,1,2]){const values=doorMesh.position.filter((_,i)=>i%3===axis),box=door.collision[0];assert(Math.abs(Math.min(...values)-box.from[axis])<1e-6);assert(Math.abs(Math.max(...values)-box.to[axis])<1e-6);}
assert(packs.lookup[`vanilla:${door.state.replace('open=false','open=true')}`],'Closed doors have an interactive open state');
const pair=doorHalves(legacyState(64,3),legacyState(64,8));assert(pair.every(s=>s.Properties?.facing==='north'&&s.Properties.hinge==='left'),'Legacy doors share the lower facing and upper hinge');
const upperId=await packs.block('vanilla',{Name:'minecraft:oak_door',Properties:{facing:'north',half:'upper',hinge:'left',open:'false',powered:'false'}});
const interactive=new World({manifest:{blocks:packs.blocks,lookup:packs.lookup,worlds:{test:{chunks:[]}}}} as any,'test');
interactive.voxels.set(0,0,0,doorId);interactive.voxels.set(0,1,0,upperId);
const middle=door.collision[0].from.map((n,i)=>(n+door.collision[0].to[i])/2) as [number,number,number];
assert(interactive.collision.point(...middle));assert.equal(interactive.interact([.5,1.5,2],[0,0,-1]),'door_open');
assert.equal(interactive.collision.point(...middle),false);assert(packs.blocks[interactive.voxels.get(0,0,0)].state.includes('open=true'));assert(packs.blocks[interactive.voxels.get(0,1,0)].state.includes('open=true'));
assert.equal(interactive.interact([.5,1.5,2],[0,0,-1]),'door_close');assert(interactive.collision.point(...middle));
const trapdoor=await packs.block('vanilla',{Name:'minecraft:oak_trapdoor',Properties:{open:'true'}});assert(packs.lookup[`vanilla:${packs.blocks[trapdoor].state.replace('open=true','open=false')}`],'Initially open trapdoors can also close');
interactive.voxels.set(3,0,0,trapdoor);assert.equal(interactive.interact([3.5,.5,2],[0,0,-1]),'door_close');
for(const [facing,direction] of Object.entries({north:[0,0,-1],east:[1,0,0],south:[0,0,1],west:[-1,0,0]}))for(const part of ['head','foot']){
  const bed=packs.blocks[await packs.block('vanilla',{Name:'minecraft:red_bed',Properties:{part,facing}})],geometry=emptyMesh();for(const e of bed.elements)appendElement(geometry,e,[0,0,0],bed);
  assert(Math.abs(Math.max(...geometry.position.filter((_,i)=>i%3===1))-.5625)<1e-6);assert(Math.abs(Math.max(...bed.collision.map(b=>b.to[1]))-.5625)<1e-6,'Bed collision follows its rotated mattress');
  const top=Math.floor(geometry.normal.findIndex((n,i)=>i%3===1&&n>.99)/3);
  const edge=[0,0,0];for(let i=top;i<top+4;i++)if(geometry.uv[i*2+1]===1)for(let axis=0;axis<3;axis++)edge[axis]+=geometry.position[i*3+axis]/2;
  assert(Math.abs(edge.reduce((sum,n,axis)=>sum+(n-.5)*direction[axis],0)-.5)<1e-6,`${facing} ${part}: pillow/blanket faces the head end`);
  const legs=bed.collision.slice(1),legEdge=direction.reduce((sum,n,axis)=>sum+n*(legs.reduce((s,b)=>s+(b.from[axis]+b.to[axis])/4,0)-.5),0);
  assert(Math.abs(legEdge-(part==='head'?1:-1)*.40625)<1e-6,'Bed legs stay at the two outer ends');
  const tile=bed.elements[0].faces.north!.tile,actual=await sharp(packs.images[packs.tiles[tile].start]).extract({left:16,top:16,width:32,height:32}).raw().toBuffer();
  const expected=await sharp('minecraft-memory-assets/references/minecraft-assets/data/1.13/entity/bed/red.png').ensureAlpha().extract({left:6,top:part==='head'?6:28,width:16,height:16}).resize(32,32,{kernel:'nearest'}).raw().toBuffer();
  assert(actual.equals(expected),'Keep the exact pillow/blanket pixels rather than downsampling the whole bed skin');
  for(const [i,leg] of bed.elements.slice(1).entries()){
    const image=await sharp(packs.images[packs.tiles[leg.faces.north!.tile].start]).extract({left:16,top:16,width:32,height:32}).raw().toBuffer();
    const skin=await sharp('minecraft-memory-assets/references/minecraft-assets/data/1.13/entity/bed/red.png').ensureAlpha().extract({left:53,top:3+i*6,width:3,height:3}).resize(32,32,{kernel:'nearest'}).raw().toBuffer();
    assert(image.equals(skin),'Legs use the bed skin at u=50 rather than transparent mattress padding');
  }
}
await packs.init('mario');const prismarine=await packs.tile('mario','prismarine');
assert.equal(packs.tiles[prismarine].ticks,300,'Slow frames retain their duration without hundreds of duplicate images');assert(packs.tiles[prismarine].frames<64);

const ground=new Voxels();ground.fill([-20,-1,-20],[20,0,20],stone);ground.fill([2,0,-5],[3,3,5],stone);ground.set(0,0,0,slab);ground.set(-2,0,0,stone);
const collision=new Collision(ground,packs.blocks),body=new Movement(collision);body.position.splice(0,3,0,0,4);
for(let i=0;i<5;i++)body.tick(0,0,0,false,false,false);assert(body.grounded);
let peak=0;for(let i=0;i<40;i++){body.tick(0,0,0,i===0,false,false);peak=Math.max(peak,body.position[1]);}
assert(peak>1.2&&peak<1.3,'Minecraft 20Hz jump reaches about 1.25 blocks');assert.equal(body.position[1],0);assert(body.grounded);
body.position.splice(0,3,0,0,10);body.stop();for(let i=0;i<20;i++)body.tick(1,0,0,false,false,false);const walk=10-body.position[2];
body.position.splice(0,3,0,0,10);body.stop();for(let i=0;i<20;i++)body.tick(1,0,0,false,true,false);assert(10-body.position[2]>walk*1.25,'Sprint is faster than walking');
body.position.splice(0,3,1,0,2);body.stop();for(let i=0;i<30;i++)body.tick(0,1,0,false,false,false);assert(body.position[0]<1.73,'Do not tunnel through walls');
body.position.splice(0,3,0,0,1.5);body.stop();body.grounded=true;for(let i=0;i<7;i++)body.tick(1,0,0,false,false,false);assert.equal(body.position[1],.5,'Auto step onto a slab');
for(let i=0;i<12;i++)body.tick(-1,0,0,false,false,false);assert.equal(body.position[1],0,'Gravity takes the player down from a slab');
body.position.splice(0,3,0,.5,0);body.flying=true;for(let i=0;i<10;i++)body.tick(0,0,0,true,false,false);assert(body.position[1]>2);body.flying=false;
body.position.splice(0,3,0,5,4);body.stop();for(let i=0;i<40;i++)body.tick(0,0,0,false,false,false);assert.equal(body.position[1],0,'Landing from a fall');
collision.loaded=()=>false;const blocked=[...body.position];body.tick(1,0,0,true,true,false);assert.deepEqual(body.position,blocked,'Do not walk or fall into unloaded chunks');

const inputWindow=new EventTarget(),canvas={} as HTMLCanvasElement,inputDocument=Object.assign(new EventTarget(),{pointerLockElement:canvas as HTMLCanvasElement|null,exitPointerLock(){this.pointerLockElement=null;this.dispatchEvent(new Event('pointerlockchange'));}});
Object.assign(globalThis,{window:inputWindow,document:inputDocument});
const inputPlayer=new Player(new PerspectiveCamera(),new PlayerModel(),collision,canvas,()=>{});
inputPlayer.update(0);assert.equal(inputPlayer.model.hand.visible,false,'The map menu has no first-person hand');
inputDocument.dispatchEvent(new Event('pointerlockchange'));
collision.loaded=()=>true;inputPlayer.position.splice(0,3,0,0,4);inputPlayer.update(0);inputPlayer.keys.add('KeyW');
for(let i=0;i<20;i++){inputPlayer.update(.05);assert(inputPlayer.camera.rotation.z===0);assert.equal(inputPlayer.camera.position.y,inputPlayer.eye.y,'Walking has no camera bob');assert.equal(inputPlayer.model.hand.position.y,-.6,'Walking has no hand bob');}inputPlayer.stop();
const press=(code:string)=>inputWindow.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code,repeat:false}));
press('Space');press('Space');assert(inputPlayer.movement.flying);
press('Space');assert(inputPlayer.movement.flying,'The next press after a double tap can ascend without cancelling flight');
press('Space');assert.equal(inputPlayer.movement.flying,false);
press('F5');assert.equal(inputPlayer.perspective,1);press('KeyV');assert.equal(inputPlayer.perspective,2);
press('Escape');assert.equal(inputPlayer.locked,false);assert.equal(inputPlayer.keys.size,0);

let effectStarts=0,rejectMusic=true;
const music={volume:0,paused:true,async play(){if(rejectMusic)throw new Error('Playback blocked');this.paused=false;},pause(){this.paused=true;}};
Object.assign(globalThis,{AudioContext:class{state='running';destination={};async resume(){}createBufferSource(){return {playbackRate:{value:1},connect(){},disconnect(){},start(){effectStarts++;}};}createGain(){return {gain:{value:1},connect(){},disconnect(){}};}}});
const audioCheck=new AudioManager({});Object.assign(audioCheck,{track:music,buffers:new Map([['wood',Promise.resolve([{}])]])});
audioCheck.setVolume(.6);await assert.rejects(audioCheck.start());assert.equal(music.volume,.6,'A playback failure must preserve the chosen BGM volume');
rejectMusic=false;await audioCheck.start();assert.equal(music.paused,false);
audioCheck.effect('wood');await Promise.resolve();assert.equal(effectStarts,1,'Audible footsteps create a sound source');
audioCheck.setEffectVolume(0);audioCheck.effect('wood');await Promise.resolve();assert.equal(effectStarts,1,'Effects can be muted independently');

for(const padded of [false,true]) {
  const bits=5,perWord=Math.floor(64/bits),values=Array.from({length:4096},(_,i)=>i%17),words=Array<bigint>(padded?Math.ceil(4096/perWord):Math.ceil(4096*bits/64)).fill(0n);
  values.forEach((v,i)=>{const index=padded?Math.floor(i/perWord):Math.floor(i*bits/64),shift=padded?(i%perWord)*bits:(i*bits)%64;words[index]|=BigInt(v)<<BigInt(shift);if(!padded&&shift+bits>64)words[index+1]|=BigInt(v)>>BigInt(64-shift);words[index]=BigInt.asUintN(64,words[index]);});
  assert.deepEqual(Array.from(unpackPalette(words,17,padded)),values);
}
assert.throws(()=>unpackPalette([],17,true));assert.equal(legacyState(5,1).Name,'minecraft:spruce_planks');
const sky=new Sky({daylight:{value:0},time:{value:0}} as any),fog=new Fog('#fff');sky.time=6000;sky.cycle=false;sky.update(10,new Vector3(),fog,true,96);assert.equal(sky.time,6000);assert.equal(sky.brightness,1);
sky.time=18000;sky.update(0,new Vector3(),fog,true,96);assert(sky.brightness<.1);sky.cycle=true;sky.time=0;sky.minutes=20;sky.update(1200,new Vector3(),fog,true,96);assert.equal(sky.time,0);
console.log('Checks passed: five maps, native chest/bed/arm UVs, redstone tint, sky/torch propagation, stored light, doors, stable walking, movement/input, audio, Anvil and day/night.');
