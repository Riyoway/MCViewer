import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { setImmediate as flush } from 'node:timers/promises';
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
import { Clouds,cloudGeometry,cloudTint } from '../src/world/Clouds.ts';
import { AssetManager } from '../src/core/AssetManager.ts';
import { Weather } from '../src/world/Weather.ts';
import { precipitationColumn,precipitationOffsets } from '../src/world/Precipitation.ts';
import { RainSounds } from '../src/world/RainSound.ts';
import { RainDrop,RainParticles } from '../src/world/RainParticles.ts';
import { Inventory,filterItems } from '../src/ui/Inventory.ts';
import type { UIAssets } from '../src/ui/types.ts';
import { Climate,precipitation,type WeatherAssets } from '../src/world/Climate.ts';
import { unpackBiomes } from '../scripts/weather-assets.ts';
import { unpackPalette } from '../scripts/anvil.ts';
import { legacyState, doorHalves } from '../scripts/legacy.ts';
import { Packs } from '../scripts/pack.ts';
import { rebuildLighting } from '../scripts/lighting.ts';
import { World } from '../src/minecraft/WorldLoader.ts';
import { fluidHeight, fluidFlow } from '../src/minecraft/Fluid.ts';
import type { Manifest } from '../src/minecraft/types.ts';

const manifest:Manifest=JSON.parse(await readFile('public/generated/manifest.json','utf8'));
const weatherAssets:WeatherAssets=JSON.parse(await readFile('public/generated/weather/assets.json','utf8'));
const uiAssets:UIAssets=JSON.parse(await readFile('public/generated/ui/assets.json','utf8'));
assert.equal(Object.keys(uiAssets.themes).length,5);
for(const [theme,ui] of Object.entries(uiAssets.themes)){
  assert(ui.items.length>400);assert.equal(new Set(ui.items.map(item=>item.id)).size,ui.items.length);
  for(const [file,width,height] of [[ui.hotbar,182,22],[ui.selection,...ui.selectionSize],[ui.inventory,195,136],[ui.particles,192,16]] as const){const metadata=await sharp(`public/generated/${file}`).metadata();assert.equal(metadata.width,width);assert.equal(metadata.height,height);}
  const sword=ui.items.find(item=>item.id==='diamond_sword')!;assert(Number.isInteger(sword.icon),'Tools use their actual item sprite');
  const fence=ui.items.find(item=>item.id==='oak_fence')!;assert(fence.model!.elements.length>1,'The GUI uses the native fence inventory model, including its two posts and rails');
  const sapling=ui.items.find(item=>item.id==='oak_sapling')!;assert(Number.isInteger(sapling.icon),'Generated plant items use a flat sprite instead of a rotated world cross');
  if(theme==='vanilla')assert.deepEqual(await sharp(`public/generated/${ui.hotbar}`).raw().toBuffer(),await sharp('minecraft-memory-assets/references/native-data/1.13/gui/widgets.png').extract({left:0,top:0,width:182,height:22}).raw().toBuffer());
}
const inventory=new Inventory(),catalog=uiAssets.themes.vanilla.items;
inventory.load(['diamond_sword','missing-item'],catalog);assert.deepEqual(inventory.hotbar.slice(0,2),['diamond_sword',null],'Saved items are checked against the selected pack');
inventory.select(-1);assert.equal(inventory.selected,8);inventory.cursor='apple';inventory.swap(0);assert.equal(inventory.hotbar[0],'apple');assert.equal(inventory.cursor,'diamond_sword');
assert(filterItems(catalog,'ＤＩＡＭＯＮＤ＿ＳＷＯＲＤ').some(item=>item.id==='diamond_sword'),'Search accepts native IDs and full-width input');assert(filterItems(catalog,'ダイヤモンドの剣').length>0,'Native Japanese item names are searchable');
assert.deepEqual(weatherAssets.sounds.rain,Array.from({length:8},(_,i)=>`weather/rain${i+1}.ogg`),'Official 1.13 weather.rain includes all eight native samples');
assert.deepEqual(weatherAssets.sounds.rain_above,Array.from({length:4},(_,i)=>`weather/rain${i+1}.ogg`),'Official 1.13 weather.rain.above uses rain1..4');
let atlasEnd=0;
for(const tile of [...manifest.atlas.tiles].sort((a,b)=>a.start-b.start)){
  assert(tile.start>=atlasEnd,'Animated sprites never overlap other atlas ranges');atlasEnd=tile.start+tile.frames;
}
assert.equal(manifest.missingTextures.length,0);
const tutorials=JSON.parse(await readFile('minecraft-memory-assets/worlds/templates/tutorial/world_templates.json','utf8')) as {templateLocation:string;downloadURI:string}[];
assert.equal(Object.keys(manifest.worlds).length,tutorials.length+4,'Every supplied tutorial and all four Mash-ups must be playable');
for(const entry of tutorials){const name=entry.templateLocation.split('/').pop()!.replace('.zip',''),id=name==='tutorial14'?'tutorial':name,world=manifest.worlds[id];assert(world,`Missing ${name}`);assert.equal(world.source,entry.downloadURI);assert.equal(world.checksum.replace(/^0+/,''),new URL(entry.downloadURI).searchParams.get('checksum'));assert.equal(createHash('md5').update(await readFile(`minecraft-memory-assets/worlds/archives/${id}.zip`)).digest('hex'),world.checksum,'Original tutorial ZIP is included and verified');assert.equal(manifest.audio[id],'vanilla.ogg');await sharp(`public/generated/${id}-icon.png`).metadata();}
assert.equal(Object.keys(manifest.effects).length,10,'Footsteps, swimming and door sounds must ship with the maps');
for(const block of manifest.blocks) {
  if(block?.fluid){assert.equal(block.cube,false,'Generated liquids use the surface mesher');assert(Number.isInteger(block.fluidLevel)&&block.fluidLevel!>=0&&block.fluidLevel!<=15);assert(block.fluidTiles&&block.fluidTiles.length>=2,'Generated liquids include both Still and Flow');for(const tile of block.fluidTiles)assert(manifest.atlas.tiles[tile]);}
  if(block?.name.endsWith('_fence'))assert.equal(Math.max(...block.collision.map(b=>b.to[1])),1.5,'Generated fences retain native collision height');
  if(block&&/^(chest|trapped_chest|ender_chest)$/.test(block.name))for(const e of block.elements)for(const face of Object.values(e.faces))assert(manifest.atlas.tiles[face!.tile].size,'Generated chest faces preserve native texel spacing');
}
for(const file of [...Object.values(manifest.audio).filter(Boolean),...Object.values(manifest.effects).flat()])assert.equal((await readFile(`public/generated/${file}`)).subarray(0,4).toString(),'OggS');
for(const [id,world] of Object.entries(manifest.worlds)) {
  assert(weatherAssets.worlds[id],'Every map includes weather assets');
  const weatherData=JSON.parse(gunzipSync(await readFile(`public/generated/${weatherAssets.worlds[id].climate}`)).toString());
  assert(Object.keys(weatherData.columns).length>=2900,'Weather uses the complete map’s saved biome data');
  const spawnBiome=new Climate(weatherData).at(...world.spawn);assert(spawnBiome&&Number.isFinite(spawnBiome.temperature),'Spawn has a saved biome climate');
  assert(Number.isInteger(world.paintings)&&world.paintings!>=0,'Saved painting counts are retained');
  assert(world.environment?.sun&&world.environment?.moon&&world.environment?.clouds,'Every map has its native sky assets');
  assert(world.blocks>10000000&&world.chunks.length>=2900,'Every map retains its complete original Console area');
  if(!/^tutorial\d+$/.test(id))assert(world.paintings!>0,'The original five maps retain their saved paintings');
  assert(world.quads<world.blocks);assert(world.chunks.every(c=>c.voxels),'Every render column needs actual collision data');
  assert(world.spawn.every(Number.isFinite));
  assert(world.spawn.every((n,i)=>n>=world.bounds.min[i]&&n<world.bounds.max[i]),'Spawn stays inside the playable area');
  const spawnColumn=world.chunks.find(c=>c.origin[0]===Math.floor(world.spawn[0]/16)*16&&c.origin[2]===Math.floor(world.spawn[2]/16)*16);assert(spawnColumn,'Spawn has saved terrain and collision data');
  const meshes=gunzipSync(await readFile(`public/generated/${spawnColumn.file}`)),cells=gunzipSync(await readFile(`public/generated/${spawnColumn.voxels}`));
  const spawnVoxels=new Voxels(),spawnLight=new Voxels();decodeColumn(cells.buffer.slice(cells.byteOffset,cells.byteOffset+cells.byteLength),spawnColumn.origin[0],spawnColumn.origin[2],spawnVoxels,spawnLight);
  assert(spawnVoxels.chunks.size>0&&spawnLight.chunks.size===spawnVoxels.chunks.size,'Start area contains terrain and stored light');
  for(const chunk of spawnVoxels.chunks.values())assert(chunk.every(n=>n===0||!!manifest.blocks[n]),'Start area uses valid block IDs');
  for(const mesh of decodeMeshes(meshes.buffer.slice(meshes.byteOffset,meshes.byteOffset+meshes.byteLength))){assert(mesh.attributes.every(a=>a.every(Number.isFinite)),'Start area mesh attributes are finite');assert(mesh.attributes[3].every(n=>Number.isInteger(n)&&!!manifest.atlas.tiles[n]),'Start area textures exist in the atlas');assert(mesh.attributes[6].every(n=>n>=0&&n<=1),'Stored mesh light stays within range');}
}
const networkMeshes=new Uint8Array(encodeMeshes({opaque:emptyMesh(),transparent:emptyMesh()}));
const networkColumns=Array.from({length:49},(_,i)=>{const x=(i%7-3)*16,z=(Math.floor(i/7)-3)*16;return{origin:[x,0,z],file:`test/${x}_${z}.bin.gz`,voxels:`test/${x}_${z}.vox.gz`};});
const networkAssets={manifest:{blocks:manifest.blocks,worlds:{test:{spawn:[0,1,0],chunks:networkColumns}}}} as any;
const realFetch=globalThis.fetch;let downloads=0;
const finishNetwork=async(w:World)=>{for(let i=0;i<50&&w.stats.pending;i++)await flush();assert.equal(w.stats.pending,0,'World requests settle after failure or disposal');};
try{
  globalThis.fetch=async(input)=>{downloads++;const file=String(input),column=networkColumns.find(c=>file.endsWith(c.voxels));return new Response(column?new Uint8Array(encodeColumn(new Voxels(),[column.origin as any],()=>240)):networkMeshes);};
  const preview=new World(networkAssets,'test');await preview.start(()=>{});for(let i=0;i<30;i++)preview.update([0,1,0],1);await finishNetwork(preview);
  assert.equal(preview.stats.loaded,9);assert.equal(downloads,18,'Map selection fetches only nine render/collision columns');preview.dispose();
  downloads=0;globalThis.fetch=async()=>{downloads++;return new Response('Bandwidth exhausted',{status:429});};
  const failed=new World(networkAssets,'test');failed.update([0,1,0]);await finishNetwork(failed);const failedDownloads=downloads;
  assert(failed.error);for(let i=0;i<120;i++)failed.update([0,1,0]);await finishNetwork(failed);assert.equal(downloads,failedDownloads,'A CDN failure never starts a per-frame retry loop');failed.dispose();
  const signals:AbortSignal[]=[];globalThis.fetch=async(_input,options)=>new Promise((_resolve,reject)=>{const signal=options!.signal!;signals.push(signal);signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});});
  const cancelled=new World(networkAssets,'test');cancelled.update([0,1,0]);cancelled.dispose();await finishNetwork(cancelled);
  assert(signals.length>0&&signals.every(s=>s.aborted),'Changing maps aborts unnecessary in-flight downloads');assert.equal(cancelled.error,'','Cancelled worlds do not show download errors');
}finally{globalThis.fetch=realFetch;}
const climates=[{name:'plains',temperature:.8,precipitation:'rain' as const},{name:'desert',temperature:2,precipitation:'none' as const},{name:'snowy_plains',temperature:0,precipitation:'snow' as const}];
const climateCells=new Uint8Array(64);climateCells[15]=2;climateCells[31]=1;
const climate=new Climate({biomes:climates,columns:{'-1,-1':{sections:{4:Buffer.from(climateCells).toString('base64')}}}});
assert.equal(climate.at(-1,65,-1)?.name,'snowy_plains','Negative coordinates select the correct saved biome');assert.equal(climate.at(-4,70,-4)?.name,'desert','Biome sampling retains the vertical quart coordinate');
assert.equal(precipitation(climates[0],64),'rain');assert.equal(precipitation(climates[1],64),'none');assert.equal(precipitation(climates[2],64),'snow');assert.equal(precipitation({...climates[0],temperature:.2},140),'snow','High terrain can turn rain into snow');
const biomeWords=Array<bigint>(6).fill(0n);for(let i=0;i<64;i++)biomeWords[Math.floor(i/12)]|=BigInt(i%17)<<BigInt(i%12*5);
assert.deepEqual(Array.from(unpackBiomes(biomeWords,17)),Array.from({length:64},(_,i)=>i%17));assert.throws(()=>unpackBiomes([],2));
const roofCells=new Voxels(),roofBlock=manifest.blocks.findIndex(b=>b?.name==='glass'&&b.theme==='vanilla');assert(roofBlock>0);roofCells.fill([0,0,0],[16,1,16],roofBlock);roofCells.set(8,4,8,roofBlock);
roofCells.set(6,2,8,manifest.blocks.findIndex(b=>b?.name==='oak_fence'&&b.theme==='vanilla'));
const roofBuffer=new Uint8Array(encodeColumn(roofCells,[[0,0,0]],()=>240));let roofWorld:World;
try{globalThis.fetch=async input=>new Response(String(input).endsWith('.vox.gz')?roofBuffer:networkMeshes);roofWorld=new World({...networkAssets,manifest:{...networkAssets.manifest,worlds:{test:{spawn:[8,1,8],chunks:[{origin:[0,0,0],file:'roof.bin.gz',voxels:'roof.vox.gz'}]}}}} as any,'test');await roofWorld.start(()=>{});}finally{globalThis.fetch=realFetch;}
assert.equal(roofWorld.precipitationSurface(8,8),5,'Even a transparent glass roof stops rainfall');assert.equal(roofWorld.precipitationSurface(7,8),1);assert.equal(roofWorld.precipitationSurface(32,0),null,'Unloaded terrain never emits rain');
assert.equal(roofWorld.precipitationSurface(6,8),3.5);assert.equal(roofWorld.rainSoundSurface(6,8),3,'Rain audio uses the block heightmap, independent of a taller fence collider');
const farmland=manifest.blocks.findIndex(b=>b?.name==='farmland'&&b.theme==='vanilla'),water=manifest.blocks.findIndex(b=>b?.name==='water'&&b.theme==='vanilla'&&b.fluidLevel===0),lava=manifest.blocks.findIndex(b=>b?.name==='lava'&&b.theme==='vanilla');
roofWorld.voxels.set(3,1,3,farmland);assert.equal(roofWorld.rainParticleHit(3.3,2,3.7).height,1.9375,'Drops start on the actual 15/16 farmland surface');
roofWorld.voxels.set(4,1,3,water);assert.equal(roofWorld.rainParticleHit(4.3,2,3.7).height,1+8/9,'Water splash height follows the fluid surface, not a full cube');
const waterDrop=new RainDrop(4.3,1+8/9,3.7,()=>.5);for(let i=0;i<20&&!waterDrop.dead;i++)waterDrop.tick(roofWorld);assert(waterDrop.dead&&waterDrop.position.y<1+8/9,'Water removes the particle on immersion instead of giving it solid-ground collision');
roofWorld.voxels.set(5,1,3,lava);assert(roofWorld.rainParticleHit(5.3,2,3.7).smoke,'Rain on lava produces smoke rather than a water drop');
const flatTerrain={particleSurface:()=>1,light:()=>240},drop=new RainDrop(0,1,0,()=>.5);assert.equal(drop.life,13);assert(Math.abs(drop.size-.15)<1e-9);assert.equal(drop.frame,2);
drop.tick(flatTerrain);assert(Math.abs(drop.position.y-1.14)<1e-9,'Native first-tick velocity is 0.2 - 0.06 blocks');
let grounded=false;for(let i=0;i<40&&!drop.dead;i++){drop.tick(flatTerrain);if(drop.position.y===1)grounded=true;assert(drop.position.y>=1,'Particles never tunnel through the ground');}assert(grounded&&drop.dead,'Drops land and expire, instead of repeating a sine wave forever');
const particles=new RainParticles({daylight:{value:1},gamma:{value:0}} as any,()=>.5),particleCamera=new PerspectiveCamera();particleCamera.rotation.set(-.4,.7,0);particles.spawn(0,1,0);particles.tick(flatTerrain);particles.render(particleCamera,flatTerrain,.5);
assert.equal(particles.mesh.geometry.drawRange.count,6);assert.equal(particles.mesh.material.depthWrite,true,'Native opaque particle sprites participate in the depth pass');
const particlePositions=particles.mesh.geometry.getAttribute('position'),edge=new Vector3().fromBufferAttribute(particlePositions,1).sub(new Vector3().fromBufferAttribute(particlePositions,0)),right=new Vector3(1,0,0).applyQuaternion(particleCamera.quaternion);assert(edge.clone().normalize().distanceTo(right)<1e-6,'Rain sprites face the camera even when looking down');
particles.clear();assert.equal(particles.drops.length,0);assert.equal(particles.mesh.geometry.drawRange.count,0);
const weather=new Weather({daylight:{value:1}} as any,{worlds:{},sounds:{}},()=>0);Object.assign(weather,{climate:new Climate({biomes:climates,columns:{'0,0':{sections:{0:0}}}})});
weather.setMode('rain');weather.update(5,new Vector3(8,2.62,8),roofWorld,true);assert(weather.stats.rainColumns>0&&weather.stats.snowColumns===0);assert(weather.stats.sheltered);assert(weather.rain.geometry.getAttribute('position').array.every(Number.isFinite));
for(let i=0;i<weather.rain.geometry.drawRange.count;i++){const p=weather.rain.geometry.getAttribute('position');assert(p.getY(i)>=roofWorld.precipitationSurface(Math.floor(p.getX(i)),Math.floor(p.getZ(i)))!,'Rain stays above the surface or roof');}
weather.setMode('snow');weather.update(.1,new Vector3(8,2.62,8),roofWorld,true);assert(weather.stats.snowColumns>0&&weather.stats.rainColumns===0);assert.equal(weather.consumeRainSounds().length,0,'Snowfall has no rain sound');
const snowGeometry=weather.snow.geometry,positions=Array.from(snowGeometry.getAttribute('position').array),uvs=Array.from(snowGeometry.getAttribute('uv').array);
weather.update(.1,new Vector3(8.1,2.72,8.1),roofWorld,true);
assert.deepEqual(Array.from(snowGeometry.getAttribute('position').array),positions,'Snow columns stay anchored when moving within one block');
assert.notDeepEqual(Array.from(snowGeometry.getAttribute('uv').array),uvs,'Snow falls and drifts through its texture rather than moving the whole quad');
weather.setMode('clear');weather.update(5,new Vector3(8,2.62,8),roofWorld,true);assert.equal(weather.rain.visible,false);assert.equal(weather.snow.visible,false);
weather.cycle=true;weather.minutes=1;weather.update(60,new Vector3(8,2.62,8),roofWorld,false);assert.equal(weather.mode,'clear','Automatic weather pauses with gameplay');weather.update(60,new Vector3(8,2.62,8),roofWorld,true);assert.equal(weather.mode,'thunder');roofWorld.dispose();
const rainSoundSampler=new RainSounds(),rainEye=new Vector3(0,2.62,0),rainHits:{tick:number;sound:NonNullable<ReturnType<RainSounds['tick']>>}[]=[];
let splashHits:number[][]=[];new RainSounds().tick(1,rainEye,()=>1,()=>'rain',(...position)=>splashHits.push(position));assert.equal(splashHits.length,100,'Full rain samples one hundred surface impacts per native tick');assert(splashHits.some(p=>p[0]%1!==splashHits[0][0]%1),'Impacts use independent sub-block offsets');
splashHits=[];new RainSounds().tick(1,rainEye,()=>1,()=>'snow',(...position)=>splashHits.push(position));assert.equal(splashHits.length,0,'Snow never produces rain splashes');
for(let tick=0;tick<20;tick++){const sound=rainSoundSampler.tick(1,rainEye,()=>1,()=>'rain');if(sound)rainHits.push({tick,sound});}
assert.deepEqual(rainHits.map(({tick,sound})=>[tick,sound.position]),[[2,[-2.5,.5,-6.5]],[6,[5.5,.5,5.5]],[8,[7.5,.5,-5.5]],[12,[-5.5,.5,6.5]],[15,[3.5,.5,6.5]],[18,[-3.5,.5,10.5]]],'Native 20Hz rain sound positions/timing match an independent java.util.Random reference');
assert(rainHits.every(({sound})=>sound.key==='rain'&&sound.volume===.2&&sound.pitch===1));
const indoorSampler=new RainSounds(),indoorHits=[];
for(let tick=0;tick<20;tick++){const sound=indoorSampler.tick(1,rainEye,()=>5,()=>'rain');if(sound)indoorHits.push(sound);}
assert(indoorHits.length>0&&indoorHits.every(sound=>sound.key==='rain_above'&&sound.volume===.1&&sound.pitch===.5&&sound.position[1]===4.5),'Rain hitting a roof above the listener uses the quieter, lower-pitched native event');
for(const [surface,kind] of [[()=>null,()=>'rain'],[()=>30,()=>'rain'],[()=>1,()=>'snow'],[()=>1,()=>'none']] as const){const sampler=new RainSounds();for(let i=0;i<60;i++)assert.equal(sampler.tick(1,rainEye,surface,kind),null,'Unloaded terrain, distant roofs and dry/snow climates make no rain impacts');}
const columns=Array.from({length:256},(_,i)=>precipitationColumn((i&15)-8,(i>>4)-8));
// Reference values evaluated with java.util.Random, the native 48-bit generator.
for(const [x,z,rainSpeed,rainPhase,snowU,snowDriftU,snowV,snowDriftV] of [
  [0,0,3.7309677600860596,0,.730967787376657,-1.2895731239084833,.5504370051176339,.6829853173685814],
  [-432,127,3.2487897872924805,198,.2487898639196956,.09372043225006638,.7666080329559587,-1.7248500484786713],
  [97,-106,3.111666679382324,94,.11166674171771296,.4037997839178245,.1423129496077371,1.7490462083356968],
  [432,-432,3.9191434383392334,224,.9191434481112394,.44870043041769253,.20469931781322348,.5339458703994436]
]){
  const actual=precipitationColumn(x,z),expected={rainSpeed,rainPhase,snowU,snowDriftU,snowV,snowDriftV};
  for(const key of Object.keys(expected) as (keyof typeof expected)[])assert(Math.abs(actual[key]-expected[key])<1e-14,`Native weather random sequence matches at ${x},${z}: ${key}`);
}
assert(new Set(columns.map(c=>c.snowU.toFixed(5))).size>250,'Nearby snow columns have distinct horizontal phases');
assert(new Set(columns.map(c=>c.snowDriftV.toFixed(5))).size>250,'Nearby snow columns have distinct falling speeds');
assert(columns.every(c=>c.rainSpeed>=3&&c.rainSpeed<4));
const motion=precipitationColumn(-432,127);
assert.deepEqual(precipitationColumn(-432,127),motion,'World-coordinate weather seeds stay deterministic across revisits');
for(const kind of ['rain','snow'] as const){const before=precipitationOffsets(motion,kind,2),after=precipitationOffsets(motion,kind,2.001);assert(after.every((n,i)=>Math.abs(n-before[i])<.01),'Precipitation interpolates smoothly between game ticks');}
const packs=new Packs(),stone=await packs.block('vanilla',{Name:'minecraft:stone_bricks'}),slab=await packs.block('vanilla',{Name:'minecraft:oak_slab'});
const stair=await packs.block('vanilla',{Name:'minecraft:spruce_stairs',Properties:{facing:'east',half:'bottom',shape:'straight',waterlogged:'false'}}),stairKey=`vanilla:${packs.blocks[stair].state}`;
await packs.block('vanilla',{Name:'minecraft:spruce_stairs',Properties:{facing:'east',half:'bottom',shape:'straight'}});assert.equal(packs.lookup[stairKey],stair,'Older saves with omitted defaults preserve existing canonical state IDs');
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
    const face=chest.elements[0].faces.south!,tile=packs.tiles[face.tile];assert.deepEqual(tile.size,[28,30]);
    const image=await sharp(packs.images[tile.start]).extract({left:18,top:17,width:28,height:30}).raw().toBuffer();
    const skin=await sharp('minecraft-memory-assets/references/native-data/1.21.6/entity/chest/normal.png').ensureAlpha().extract({left:42,top:33,width:14,height:10}).resize(28,30,{kernel:'nearest'}).raw().toBuffer();assert(image.equals(skin),'Every chest texel has the same integer footprint');
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
assert.equal(fence.opacity,0,'Fence posts leave space for sky/block light');
const shelter=new Voxels();shelter.set(0,0,0,fenceId);shelter.set(0,1,0,stone);
const sheltered=meshChunk(shelter,packs.blocks,[0,0,0],(x,y,z)=>y===1&&x===0&&z===0?0:0xe7).opaque;
const postVertices=sheltered.position.map((_,i)=>i%3===1&&sheltered.position[i]<1?(i-1)/3:-1).filter(i=>i>=0);
assert(postVertices.every(i=>sheltered.light[i*2]>0),'Fence sides sample their exposed space rather than the roof interior');
const picture=await packs.painting('vanilla',{variant:'minecraft:pool',facing:1,Pos:[2,4,6]}),pictureMesh=emptyMesh();
for(const e of picture.elements)appendElement(pictureMesh,e,picture.position,{rotation:picture.rotation,tint:[1,1,1],emissive:0} as any);
assert.equal(picture.elements.length,2,'Two-block paintings retain a texture tile for each block');
assert(Math.abs(Math.max(...pictureMesh.position.filter((_,i)=>i%3===2))-Math.min(...pictureMesh.position.filter((_,i)=>i%3===2))-2)<1e-6,'Painting size and hanging direction match NBT');
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
  const expected=await sharp('minecraft-memory-assets/references/native-data/1.13/entity/bed/red.png').ensureAlpha().extract({left:6,top:part==='head'?6:28,width:16,height:16}).resize(32,32,{kernel:'nearest'}).raw().toBuffer();
  assert(actual.equals(expected),'Keep the exact pillow/blanket pixels rather than downsampling the whole bed skin');
  for(const [i,leg] of bed.elements.slice(1).entries()){
    const image=await sharp(packs.images[packs.tiles[leg.faces.north!.tile].start]).extract({left:16,top:16,width:32,height:32}).raw().toBuffer();
    const skin=await sharp('minecraft-memory-assets/references/native-data/1.13/entity/bed/red.png').ensureAlpha().extract({left:53,top:3+i*6,width:3,height:3}).resize(32,32,{kernel:'nearest'}).raw().toBuffer();
    assert(image.equals(skin),'Legs use the bed skin at u=50 rather than transparent mattress padding');
  }
}
await packs.init('mario');const prismarine=await packs.tile('mario','prismarine');
assert.equal(packs.tiles[prismarine].ticks,300,'Slow frames retain their duration without hundreds of duplicate images');assert(packs.tiles[prismarine].frames<64);
const concurrent=new Packs();await concurrent.init('vanilla');
const concurrentIds=await Promise.all(['water_still','water_flow','lava_still','lava_flow'].map(t=>concurrent.tile('vanilla',t)));
let concurrentEnd=0;for(const tile of concurrentIds.map(i=>concurrent.tiles[i]).sort((a,b)=>a.start-b.start)){assert(tile.start>=concurrentEnd,'Concurrent decoding reserves disjoint animated ranges');concurrentEnd=tile.start+tile.frames;}
assert.equal(concurrent.images.length,concurrentEnd);assert(concurrent.images.every(Buffer.isBuffer));
const atlasRaw=await sharp('public/generated/atlas.png').ensureAlpha().raw().toBuffer();
for(const theme of ['vanilla','mario','festive','halloween','chinese']){
  const native=new Packs();await native.init(theme);
  for(const kind of ['water','lava']){
    const block=manifest.blocks.find(b=>b?.theme===theme&&b.name===kind&&b.fluidLevel===0)!;
    for(const [index,id] of block.fluidTiles!.entries()){
      const name=[`${kind}_still`,`${kind}_flow`,'water_overlay'][index],expected=native.tiles[await native.tile(theme,name)],actual=manifest.atlas.tiles[id];
      assert.equal(actual.frames,expected.frames,`${theme} ${name} preserves native frame order`);assert.equal(actual.ticks,expected.ticks,`${theme} ${name} preserves native frame duration`);
      for(let frame=0;frame<actual.frames;frame++){
        const image=await sharp(native.images[expected.start+frame]).ensureAlpha().raw().toBuffer(),tile=actual.start+frame,{size,cell}=manifest.atlas,cols=size/cell;
        for(let y=0;y<cell;y++){const offset=((Math.floor(tile/cols)*cell+y)*size+tile%cols*cell)*4;assert(atlasRaw.subarray(offset,offset+cell*4).equals(image.subarray(y*cell*4,(y+1)*cell*4)),`${theme} ${name} frame ${frame} contains its own native sprite, never another animation`);}
      }
    }
  }
}

const ground=new Voxels();ground.fill([-20,-1,-20],[20,0,20],stone);ground.fill([2,0,-5],[3,3,5],stone);ground.set(0,0,0,slab);ground.set(-2,0,0,stone);
const collision=new Collision(ground,packs.blocks),body=new Movement(collision);body.position.splice(0,3,0,0,4);
for(let i=0;i<5;i++)body.tick(0,0,0,false,false,false);assert(body.grounded);
let peak=0;for(let i=0;i<40;i++){body.tick(0,0,0,i===0,false,false);peak=Math.max(peak,body.position[1]);}
assert(peak>1.2&&peak<1.3,'Minecraft 20Hz jump reaches about 1.25 blocks');assert.equal(body.position[1],0);assert(body.grounded);
body.position.splice(0,3,0,0,10);body.stop();for(let i=0;i<20;i++)body.tick(1,0,0,false,false,false);const walk=10-body.position[2];
assert(walk>3.9&&walk<4.2,'Native ground acceleration approaches 4.317 blocks per second');
body.position.splice(0,3,0,0,10);body.stop();for(let i=0;i<20;i++)body.tick(1,0,0,false,true,false);assert(10-body.position[2]>walk*1.25,'Sprint is faster than walking');
body.position.splice(0,3,1,0,2);body.stop();for(let i=0;i<30;i++)body.tick(0,1,0,false,false,false);assert(body.position[0]<1.73,'Do not tunnel through walls');
body.position.splice(0,3,0,0,1.5);body.stop();body.grounded=true;for(let i=0;i<7;i++)body.tick(1,0,0,false,false,false);assert.equal(body.position[1],.5,'Auto step onto a slab');
for(let i=0;i<12;i++)body.tick(-1,0,0,false,false,false);assert.equal(body.position[1],0,'Gravity takes the player down from a slab');
body.position.splice(0,3,0,.5,0);body.flying=true;for(let i=0;i<10;i++)body.tick(0,0,0,true,false,false);assert(body.position[1]>2);body.flying=false;
const waterId=await packs.block('vanilla',{Name:'minecraft:water',Properties:{level:'0'}}),pool=new Voxels();pool.fill([-4,-1,-4],[20,0,4],stone);pool.fill([-4,0,-4],[0,1,4],waterId);pool.fill([0,0,-4],[20,1,4],stone);
const allocationOrder:string[]=[],ordered=new Packs();
ordered.tile=async(_theme,texture)=>{await new Promise(resolve=>setTimeout(resolve,texture.endsWith('_still')?10:0));return allocationOrder.push(texture)-1;};
await ordered.block('vanilla',{Name:'minecraft:water'});
assert.deepEqual(allocationOrder,['water_still','water_flow','water_overlay'],'Atlas allocation follows texture order even when Still loads last');
await assert.rejects(()=>packs.block('vanilla',{Name:'minecraft:water',Properties:{level:'16'}}),/Invalid fluid level/);
for(const kind of ['water','lava']) {
  const ids=await Promise.all([0,1,7,8].map(level=>packs.block('vanilla',{Name:`minecraft:${kind}`,Properties:{level:String(level)}})));
  const fluid=packs.blocks[ids[0]],channel=new Voxels();channel.fill([0,-1,0],[4,0,1],stone);ids.forEach((id,x)=>channel.set(x,0,0,id));
  assert.equal(fluidHeight(fluid,undefined,kind),8/9);assert.equal(fluidHeight(packs.blocks[ids[2]],undefined,kind),1/9);assert.equal(fluidHeight(fluid,fluid,kind),1);
  const get=(x:number,y:number,z:number)=>packs.blocks[channel.get(x,y,z)];
  assert(fluidFlow(get,[0,0,0],kind)[0]>.99,'Flow points from the source toward the shallower neighbor');
  const data=meshChunk(channel,packs.blocks,[0,0,0])[kind==='water'?'transparent':'opaque'];
  assert(data.position.every(Number.isFinite));
  const tops=data.normal.map((_,i)=>i%3===1&&data.normal[i]===1?(i-1)/3:-1).filter(i=>i>=0);
  assert(tops.some(i=>data.tile[i]===fluid.fluidTiles![1]),'Flowing tops use the native flow animation');
  assert(new Set(tops.map(i=>data.position[i*3+1].toFixed(5))).size>2,'Liquid surfaces slope according to saved levels');
  assert(!data.normal.some((n,i)=>i%3===0&&Math.abs(n)===1&&data.position[i]>1.99&&data.position[i]<2.01),'Different levels of the same fluid have no internal wall');
  const lake=new Voxels();lake.fill([0,0,0],[3,1,3],ids[0]);
  const flat=meshChunk(lake,packs.blocks,[0,0,0])[kind==='water'?'transparent':'opaque'];
  const center=flat.tile.findIndex((tile,i)=>tile===fluid.fluidTiles![0]&&flat.normal[i*3+1]===1&&flat.position[i*3]===1&&flat.position[i*3+2]===2);
  assert(center>=0);assert(Math.abs(flat.position[center*3+1]-(8/9-.001))<1e-6,'A still source lake sits below the block rim');
  const drop=new Voxels();drop.set(0,0,0,ids[0]);drop.set(1,-1,0,ids[0]);assert(fluidFlow((x,y,z)=>packs.blocks[drop.get(x,y,z)],[0,0,0],kind)[0]>.99,'Flow follows a drop even when the adjacent cell is air');
  const falling=new Voxels();falling.set(0,0,0,ids[3]);falling.set(0,1,0,ids[3]);const waterfall=meshChunk(falling,packs.blocks,[0,0,0])[kind==='water'?'transparent':'opaque'];
  assert(waterfall.position.some((v,i)=>i%3===1&&v===1),'Stacked waterfall sides meet at the block boundary without gaps');
}
const unconnected=await packs.block('vanilla',{Name:'minecraft:oak_fence'}),birch=await packs.block('vanilla',{Name:'minecraft:birch_fence'}),nether=await packs.block('vanilla',{Name:'minecraft:nether_brick_fence'});
const alignedGate=await packs.block('vanilla',{Name:'minecraft:oak_fence_gate',Properties:{facing:'north'}}),wrongGate=await packs.block('vanilla',{Name:'minecraft:oak_fence_gate',Properties:{facing:'east'}}),pumpkin=await packs.block('vanilla',{Name:'minecraft:pumpkin'});
const railing=new Voxels();railing.set(15,0,0,unconnected);railing.set(16,0,0,birch);railing.set(14,0,0,stone);railing.set(15,0,1,nether);railing.set(15,0,-1,leaves);
railing.set(20,0,0,unconnected);railing.set(21,0,0,alignedGate);railing.set(19,0,0,wrongGate);railing.set(20,0,1,pumpkin);
assert((await packs.connectFences(railing))>0);
const connected=packs.blocks[railing.get(15,0,0)],atGate=packs.blocks[railing.get(20,0,0)];
assert(connected.state.includes('east=true')&&connected.state.includes('west=true'),'Wooden fences connect to other wood and a sturdy wall across chunk boundaries');
assert(connected.state.includes('south=false')&&connected.state.includes('north=false'),'Wood and nether fences stay separate; leaves do not accept rails');
assert(atGate.state.includes('east=true')&&atGate.state.includes('west=false')&&atGate.state.includes('south=false'),'Gate orientation and pumpkin exceptions match FenceBlock');
assert(packs.blocks[railing.get(16,0,0)].state.includes('west=true'),'Both ends of a rail connect');
const railCollision=new Collision(railing,packs.blocks);assert(railCollision.point(15.9,1.3,.5),'Native fence collision covers the connected rail up to 1.5 blocks');
assert.equal(railCollision.overlaps(15.5,1.3,.5),true,'Collision queries include the taller fence in the cell below');
assert.equal(await packs.connectFences(railing),0,'Connection repair is stable');
const swimmer=new Movement(new Collision(pool,packs.blocks));swimmer.position.splice(0,3,-.5,0,.5);
for(let i=0;i<50;i++)swimmer.tick(0,1,0,true,false,false);
assert(swimmer.position[0]>.5&&swimmer.position[1]>=1,'Swimming into a bank supplies the native 0.3 water-exit impulse');
body.position.splice(0,3,0,5,4);body.stop();for(let i=0;i<40;i++)body.tick(0,0,0,false,false,false);assert.equal(body.position[1],0,'Landing from a fall');
collision.loaded=()=>false;const blocked=[...body.position];body.tick(1,0,0,true,true,false);assert.deepEqual(body.position,blocked,'Do not walk or fall into unloaded chunks');

const inputWindow=new EventTarget(),canvas={clientWidth:1000,clientHeight:700} as HTMLCanvasElement,inputDocument=Object.assign(new EventTarget(),{pointerLockElement:canvas as HTMLCanvasElement|null,exitPointerLock(){this.pointerLockElement=null;this.dispatchEvent(new Event('pointerlockchange'));}});
Object.assign(globalThis,{window:inputWindow,document:inputDocument});
const inputPlayer=new Player(new PerspectiveCamera(),new PlayerModel(),collision,canvas,()=>{});
inputPlayer.update(0);assert.equal(inputPlayer.model.hand.visible,false,'The map menu has no first-person hand');
inputDocument.dispatchEvent(new Event('pointerlockchange'));
const mouse=(x:number,y:number)=>inputDocument.dispatchEvent(Object.assign(new Event('mousemove'),{movementX:x,movementY:y}));
mouse(900,500);assert.equal(inputPlayer.yaw,0,'Ignore pointer-lock entry warp');mouse(10,5);const turned=inputPlayer.yaw;assert.equal(turned,-.02);mouse(1600,-1000);assert.equal(inputPlayer.yaw,turned,'Ignore discontinuous display warp');mouse(20,0);assert.equal(inputPlayer.yaw,-.06,'Normal mouse input continues after a rejected warp');
inputPlayer.model.swing();inputPlayer.model.update(.075,0,0,0,0,0,true);assert(inputPlayer.model.hand.position.x<.64,'Interaction swing moves the arm toward the crosshair even with bobbing off');inputPlayer.model.update(.3,0,0,0,0,0,true);assert.deepEqual(inputPlayer.model.hand.position.toArray(),[.64,-.6,-.72],'The native six-tick swing returns to rest');
collision.loaded=()=>true;inputPlayer.position.splice(0,3,0,0,4);inputPlayer.update(0);inputPlayer.keys.add('KeyW');
for(let i=0;i<20;i++){inputPlayer.update(.05);assert(inputPlayer.camera.rotation.z===0);assert.equal(inputPlayer.camera.position.y,inputPlayer.eye.y,'Walking has no camera bob');assert.equal(inputPlayer.model.hand.position.y,-.6,'Walking has no hand bob');}inputPlayer.stop();
const press=(code:string)=>inputWindow.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code,repeat:false}));
press('Space');press('Space');assert(inputPlayer.movement.flying);
press('Space');assert(inputPlayer.movement.flying,'The next press after a double tap can ascend without cancelling flight');
press('Space');assert.equal(inputPlayer.movement.flying,false);
press('F5');assert.equal(inputPlayer.perspective,1);press('KeyV');assert.equal(inputPlayer.perspective,2);
press('Escape');assert.equal(inputPlayer.locked,false);assert.equal(inputPlayer.keys.size,0);

const realAudio=globalThis.Audio;let musicPreload='',cancelledMusic=0;
try{Object.assign(globalThis,{Audio:class extends EventTarget{loop=false;volume=0;preload='auto';constructor(readonly src:string){super();}pause(){}removeAttribute(){}load(){cancelledMusic++;}}});const selectingAudio=new AudioManager({one:'vanilla.ogg',two:'mario.ogg'});selectingAudio.select('one');musicPreload=(selectingAudio as any).track.preload;selectingAudio.select('two');assert.equal(musicPreload,'none','Map selection does not preload music');assert.equal(cancelledMusic,1,'Changing maps stops the previous music download');}finally{globalThis.Audio=realAudio;}
let effectStarts=0,rejectMusic=true;
const music={volume:0,paused:true,async play(){if(rejectMusic)throw new Error('Playback blocked');this.paused=false;},pause(){this.paused=true;}};
Object.assign(globalThis,{AudioContext:class{state='running';destination={};async resume(){}createBufferSource(){return {playbackRate:{value:1},connect(){},disconnect(){},start(){effectStarts++;}};}createGain(){return {gain:{value:1},connect(){},disconnect(){}};}}});
const audioCheck=new AudioManager({});Object.assign(audioCheck,{track:music,buffers:new Map([['wood',Promise.resolve([{}])]])});
audioCheck.setVolume(.6);await assert.rejects(audioCheck.start());assert.equal(music.volume,.6,'A playback failure must preserve the chosen BGM volume');
rejectMusic=false;await audioCheck.start();assert.equal(music.paused,false);
audioCheck.effect('wood');await Promise.resolve();assert.equal(effectStarts,1,'Audible footsteps create a sound source');
audioCheck.setEffectVolume(0);audioCheck.effect('wood');await Promise.resolve();assert.equal(effectStarts,1,'Effects can be muted independently');

const rainStarts:any[]=[],rainGains:any[]=[],rainPanners:any[]=[],parameter=()=>({value:0,setValueAtTime(value:number){this.value=value;},setTargetAtTime(value:number){this.value=value;}});
const rainContext={state:'running',currentTime:1.2,destination:{},listener:Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(key=>[key,parameter()])),
  createBufferSource(){return {buffer:null,loop:false,playbackRate:{value:1},connect(){},disconnect(){},onended:null as (()=>void)|null,start(time:number){rainStarts.push({source:this,time});},stop(){this.onended?.();}};},
  createGain(){const gain={gain:parameter(),connect(){},disconnect(){}};rainGains.push(gain);return gain;},
  createPanner(){const panner={positionX:parameter(),positionY:parameter(),positionZ:parameter(),connect(){},disconnect(){}};rainPanners.push(panner);return panner;}};
const rainAudio=new AudioManager({}),rainCamera=new PerspectiveCamera();rainCamera.position.set(10,2.62,3);
Object.assign(rainAudio,{context:rainContext,buffers:new Map([['rain',Promise.resolve([{duration:2}])],['rain_above',Promise.resolve([{duration:2}])]])});
rainAudio.weather([rainHits[0].sound],rainCamera,true);await Promise.resolve();rainAudio.weather([indoorHits[0]],rainCamera,true);await Promise.resolve();
assert.equal(rainStarts.length,2);assert(rainStarts.every(({source,time})=>!source.loop&&time===1.2),'Native faded clips overlap as one-shots, never a single seamless-loop assumption');
assert.deepEqual(rainStarts.map(({source})=>source.playbackRate.value),[1,.5]);assert.deepEqual(rainGains.slice(1).map(g=>g.gain.value),[.2,.1]);
assert(rainPanners.every(p=>p.distanceModel==='linear'&&p.refDistance===0&&p.maxDistance===16),'Rain attenuates over the native sixteen-block range');assert.equal(rainContext.listener.positionX.value,10);
rainAudio.setEffectVolume(0);assert.equal(rainGains[0].gain.value,0);rainAudio.weather([rainHits[1].sound],rainCamera,true);await Promise.resolve();assert.equal(rainStarts.length,2);
rainAudio.setEffectVolume(.7);let finishRain!:(buffers:any[])=>void;(rainAudio as any).buffers.set('rain',new Promise(resolve=>finishRain=resolve));rainAudio.weather([rainHits[1].sound],rainCamera,true);rainAudio.select('empty');rainAudio.weather([],rainCamera,true);finishRain([{duration:2}]);await Promise.resolve();assert.equal(rainStarts.length,2,'Changing maps cancels pending rain voices');assert.equal((rainAudio as any).rainVoices.size,0,'Ended/stopped voices release their audio nodes');
let lateRain!:(buffers:any[])=>void;(rainAudio as any).buffers.set('rain',new Promise(resolve=>lateRain=resolve));rainAudio.weather([rainHits[1].sound],rainCamera,true);rainContext.currentTime+=1;lateRain([{duration:2}]);await Promise.resolve();assert.equal(rainStarts.length,2,'Slow downloads never play a burst of stale rain impacts');
rainAudio.weather([],rainCamera,false);assert.equal(rainGains[0].gain.value,0,'Menus and underwater views mute the rain bus smoothly');

for(const padded of [false,true]) {
  const bits=5,perWord=Math.floor(64/bits),values=Array.from({length:4096},(_,i)=>i%17),words=Array<bigint>(padded?Math.ceil(4096/perWord):Math.ceil(4096*bits/64)).fill(0n);
  values.forEach((v,i)=>{const index=padded?Math.floor(i/perWord):Math.floor(i*bits/64),shift=padded?(i%perWord)*bits:(i*bits)%64;words[index]|=BigInt(v)<<BigInt(shift);if(!padded&&shift+bits>64)words[index+1]|=BigInt(v)>>BigInt(64-shift);words[index]=BigInt.asUintN(64,words[index]);});
  assert.deepEqual(Array.from(unpackPalette(words,17,padded)),values);
}
assert.throws(()=>unpackPalette([],17,true));assert.equal(legacyState(5,1).Name,'minecraft:spruce_planks');
const sky=new Sky({daylight:{value:0},time:{value:0}} as any),fog=new Fog('#fff');sky.time=6000;sky.cycle=false;sky.update(10,new Vector3(),fog,true,96);assert.equal(sky.time,6000);assert.equal(sky.brightness,1);
sky.environment={sky_color:'#3d2300',fog_color:'#e4880b',sun:'',moon:'',clouds:''};sky.update(0,new Vector3(),fog,true,96);assert.equal(fog.color.getHexString(),'e4880b','Halloween keeps the pack’s original orange fog');
sky.time=18000;sky.update(0,new Vector3(),fog,true,96);assert(sky.brightness<.1);sky.cycle=true;sky.time=0;sky.minutes=20;sky.update(1200,new Vector3(),fog,true,96);assert.equal(sky.time,0);
sky.cycle=false;sky.time=6000;sky.update(0,new Vector3(),fog,true,96,{rainLevel:1,thunderLevel:1,flash:0});const stormBrightness=sky.brightness;assert(stormBrightness<.4);assert(fog.far<96,'Rain reduces visibility');sky.update(0,new Vector3(),fog,true,96,{rainLevel:1,thunderLevel:1,flash:1});assert(sky.brightness>stormBrightness,'Lightning briefly lights the sky');
const cloudPattern={width:5,height:5,pixels:new Uint8Array(5*5*4)};cloudPattern.pixels.set([43,8,69,255],(2*5+2)*4);
const cloudCell=cloudGeometry(cloudPattern,2,2,0),cloudColor=cloudCell.getAttribute('color');
assert.equal(cloudCell.index!.count,36,'One native cloud pixel becomes a closed cuboid');
cloudCell.computeBoundingBox();assert.deepEqual(cloudCell.boundingBox!.getSize(new Vector3()).toArray(),[12,4,12]);
for(const [face,shade] of [.9,.9,1,.7,.8,.8].entries()){assert(Math.abs(cloudColor.getX(face*4)-43/255*shade)<1e-7,'Pack cloud colors retain native face shading');assert(Math.abs(cloudColor.getW(face*4)-.8)<1e-7);}
const wrappedCloud=cloudGeometry(cloudPattern,-3,-3,0);assert.deepEqual(Array.from(wrappedCloud.getAttribute('color').array),Array.from(cloudColor.array),'Native cloud pattern repeats at negative coordinates');
cloudPattern.pixels.set([255,255,255,255],(2*5+3)*4);const adjacentCloud=cloudGeometry(cloudPattern,2,2,1);assert.equal(adjacentCloud.index!.count,60,'Adjacent cloud pixels omit their two internal faces');
assert.deepEqual(cloudTint(6000,0,0),[1,1,1]);assert.deepEqual(cloudTint(18000,0,0),[.1,.1,.15]);assert.deepEqual(cloudTint(6000,1,0),[.62,.62,.62]);
for(const color of cloudTint(6000,1,1))assert(Math.abs(color-.1488)<1e-10,'Native thunder darkens cloud color with its grey blend');
const clouds=new Clouds();clouds.setPattern(cloudPattern);const cloudEye=new Vector3(0,70,0);clouds.update(cloudEye,0,6000,true,true,0,0);const cachedCloud=clouds.color.geometry;
assert.equal(clouds.root.position.y+cloudEye.y,128.33);assert(clouds.color.renderOrder<0&&clouds.depth.renderOrder<clouds.color.renderOrder);
cloudEye.x=10;clouds.update(cloudEye,1,18000,true,true,0,0);assert.equal(clouds.color.geometry,cachedCloud);assert(Math.abs(cloudEye.x+clouds.root.position.x+.6)<1e-10,'Clouds move 0.03 blocks per native tick without following the camera');
cloudEye.y=200;clouds.update(cloudEye,1,6000,false,true,0,0);assert.equal(clouds.root.position.y+cloudEye.y,192);assert(clouds.depth.renderOrder>0,'Above the cloud layer, clouds follow translucent terrain');
assert.equal(clouds.depth.material.colorWrite,false);assert.equal(clouds.depth.material.depthWrite,true);assert.equal(clouds.color.material.depthWrite,false);assert.equal(clouds.depth.material.forceSinglePass,true);
clouds.update(cloudEye,1,6000,true,false,0,0);assert.equal(clouds.root.visible,false);
const glassAssets=Reflect.construct(AssetManager,[manifest,new MeshBasicMaterial({alphaTest:.1})]) as AssetManager;
for(const theme of ['vanilla','mario','festive','halloween','chinese']){
  const data=emptyMesh();const blocks=['glass','glass_pane','water'].map(name=>manifest.blocks.find(b=>b?.theme===theme&&b.name===name)!);
  for(const [x,block] of blocks.entries())for(const element of block.elements)appendElement(data,element,[x,0,0],block);
  const stained=manifest.blocks.find(b=>b?.theme===theme&&b.name.endsWith('_stained_glass'));if(stained)for(const element of stained.elements)appendElement(data,element,[3,0,0],stained);
  // Fluids have their own mesher; add a translucent quad to cover mixed saved meshes too.
  appendElement(data,{from:[4,0,0],to:[5,1,0],faces:{north:{tile:blocks[2].fluidTiles![0],uv:[0,0,16,16]}}},[0,0,0],{rotation:[0,0,0],emissive:0,tint:[1,1,1]});
  const glassMesh=glassAssets.mesh(data,true),materials=glassMesh.material as MeshBasicMaterial[];
  assert.equal(materials[0].transparent,false,'Ordinary glass writes depth in the native cutout pass');assert.equal(materials[0].depthWrite,true);assert.equal(materials[1].transparent,true);assert.equal(materials[1].depthWrite,false);
  assert.equal(glassMesh.geometry.groups.length,2);assert.equal(glassMesh.geometry.index!.count,data.index.length,'Separating cutout/blend preserves every original triangle');glassMesh.geometry.dispose();
}
for(const geometry of [cloudCell,wrappedCloud,adjacentCloud,clouds.color.geometry])geometry.dispose();
console.log('Checks passed: all tutorials and Mash-ups, native clouds and glass layers, weather climates/roofs/transitions, native rain audio/indoors, rain/snow/storm lighting, fluids, fences, native UVs, lighting, doors, movement/input, audio, Anvil and day/night.');
