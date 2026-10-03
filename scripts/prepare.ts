import { mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parse, simplify } from 'prismarine-nbt';
import { downloadWorld, downloadSound } from './download.ts';
import { readChunks, unpackPalette, stateKey } from './anvil.ts';
import type { State } from './anvil.ts';
import { legacyState, doorHalves } from './legacy.ts';
import { Packs } from './pack.ts';
import { rebuildLighting } from './lighting.ts';
import { Voxels, encodeColumn, decodeColumn } from '../src/minecraft/Voxels.ts';
import { meshChunk, emptyMesh, appendElement } from '../src/minecraft/Mesher.ts';
import { encodeMeshes } from '../src/minecraft/binary.ts';
import type { Vec3, WorldManifest, Manifest, Block } from '../src/minecraft/types.ts';

const output='public/generated';await mkdir(output,{recursive:true});
const packs=new Packs(),worlds:Record<string,WorldManifest>={};
const materialsOnly=process.argv.includes('--materials');
// The original finite Console maps occupy the central 864×864 blocks.
// New terrain generated around those saves by their Java conversion is excluded.
const bounds={min:[-432,0,-432] as Vec3,max:[432,320,432] as Vec3};
for(const theme of ['tutorial','mario','festive','halloween','chinese'] as const) {
  console.log(`Preparing ${theme} exploration map…`);
  const world=await downloadWorld(theme),pack=theme==='tutorial'?'vanilla':theme;
  const levelFile=Object.entries(world.files).find(([name])=>/level.dat$/.test(name));
  if(!levelFile)throw new Error(`Missing level.dat: ${theme}`);
  const level=simplify((await parse(Buffer.from(levelFile[1]))).parsed).Data;
  if(theme==='tutorial'&&world.files['icon.png'])await writeFile(`${output}/tutorial-icon.png`,world.files['icon.png']);
  const spawn:Vec3=level.spawn?.pos??[level.SpawnX,level.SpawnY,level.SpawnZ];
  const yaw=level.spawn?.yaw??level.SpawnAngle??0;
  const voxels=new Voxels(),lights=new Voxels(),paletteCache=new Map<string,number>();
  const oldDoors=new Map<string,State>();
  const paintingEntities=new Map<string,any>();
  const collect=(root:any)=>{for(const e of root.Entities??root.entities??[])if(e.id==='minecraft:painting'||e.id==='Painting')paintingEntities.set(JSON.stringify(e.UUID??[e.Pos,e.variant??e.Motive,e.facing??e.Facing]),e);};
  const width=bounds.max[0]-bounds.min[0],depth=bounds.max[2]-bounds.min[2],heightmap=new Int16Array(width*depth).fill(-1);
  const ids=async(palette:State[])=>{
    const mapped:number[]=[];
    for(const state of palette) {const key=stateKey(state);if(!paletteCache.has(key))paletteCache.set(key,await packs.block(pack,state));mapped.push(paletteCache.get(key)!);}
    return mapped;
  };
  let total=0,processed=0;
  for await(const {root,version} of readChunks(world.files,bounds)) {
    collect(root);
    for(const section of root.sections??root.Sections??[]) {
      const sy=section.Y*16;if(sy<bounds.min[1]||sy>=bounds.max[1])continue;
      const palette=section.block_states?.palette??section.Palette;
      if(palette?.length===1&&/air$/.test(palette[0].Name))continue;
      const mapped=palette?await ids(palette):null;
      const data=palette?unpackPalette(section.block_states?.data??section.BlockStates??[],palette.length,version>=2529):null;
      const cells=new Uint16Array(4096),light=new Uint16Array(4096);let nonempty=false;
      for(let i=0;i<4096;i++) {
        let id=0;
        if(mapped&&data)id=mapped[data[i]];
        else if(section.Blocks) {
          const legacyId=(section.Blocks[i]&255)+(((section.Add?.[i>>1]??0)>>(i%2*4)&15)<<8);
          if(legacyId) {const meta=(section.Data[i>>1]>>(i%2*4))&15,key=`${legacyId}:${meta}`;if(!paletteCache.has(key))paletteCache.set(key,await packs.block(pack,legacyState(legacyId,meta)));id=paletteCache.get(key)!;}
          if(/_door$/.test(packs.blocks[id]?.name??''))oldDoors.set(`${root.xPos*16+(i&15)},${sy+(i>>8)},${root.zPos*16+((i>>4)&15)}`,legacyState(legacyId,(section.Data[i>>1]>>(i%2*4))&15));
        }
        cells[i]=id;
        const block=packs.blocks[id];
        if(block){total++;nonempty=true;const x=root.xPos*16+(i&15),z=root.zPos*16+((i>>4)&15),y=sy+(i>>8),h=(z-bounds.min[2])*width+x-bounds.min[0];if(block.opacity)heightmap[h]=Math.max(heightmap[h],y);}
        light[i]=(section.BlockLight?.[i>>1]??0)>>(i%2*4)&15;
      }
      if(nonempty) {const key=`${root.xPos},${section.Y},${root.zPos}`;voxels.chunks.set(key,cells);if(light.some(Boolean))lights.chunks.set(key,light);}
    }
    if(++processed%512===0)console.log(`  Decoded ${processed} columns`);
  }
  for(const [key,lower] of oldDoors){if(lower.Properties?.half!=='lower')continue;const [x,y,z]=key.split(',').map(Number),upper=oldDoors.get(`${x},${y+1},${z}`);if(!upper||upper.Name!==lower.Name)continue;
    const pair=doorHalves(lower,upper);for(const [dy,state] of pair.entries())voxels.set(x,y+dy,z,await packs.block(pack,state));
  }
  console.log(`  Reconnected ${await packs.connectFences(voxels)} fence blocks`);
  for await(const {root} of readChunks(world.files,bounds,'entities'))collect(root);
  const paintings=new Map<string,Awaited<ReturnType<Packs['painting']>>[]>();let paintingCount=0;
  for(const e of paintingEntities.values()){
    if(!e.Pos?.every((n:number,i:number)=>Number.isFinite(n)&&n>=bounds.min[i]&&n<bounds.max[i]))continue;
    const painting=await packs.painting(pack,e),key=`${Math.floor(painting.position[0]/16)*16}_${Math.floor(painting.position[2]/16)*16}`;
    if(!paintings.has(key))paintings.set(key,[]);paintings.get(key)!.push(painting);paintingCount++;
  }
  const lighting=materialsOnly?undefined:rebuildLighting(voxels,packs.blocks,lights,bounds,heightmap);
  const generated=resolve(output,theme);if(dirname(generated)!==resolve(output))throw new Error('Invalid generated directory');
  if(!materialsOnly)await rm(generated,{recursive:true,force:true});await mkdir(generated,{recursive:true});
  const columns=new Map<string,Vec3[]>();for(const origin of voxels.origins()){const key=`${origin[0]}_${origin[2]}`;if(!columns.has(key))columns.set(key,[]);columns.get(key)!.push(origin);}
  // Air-only cave/room sections also need light data; absent sections above these are open sky.
  for(const [key,origins] of columns){const [x,z]=key.split('_').map(Number),top=Math.max(...origins.map(o=>o[1]));columns.set(key,Array.from({length:top/16+1},(_,i)=>[x,i*16,z] as Vec3));}
  let quads=0,done=0;const chunks:WorldManifest['chunks']=[];
  for(const origins of columns.values()) {
    const origin:Vec3=[origins[0][0],0,origins[0][2]],mesh={opaque:emptyMesh(),transparent:emptyMesh()};
    for(const section of materialsOnly?[]:origins) {
      const part=meshChunk(voxels,packs.blocks,section,lighting,true);
      for(const type of ['opaque','transparent'] as const) {const target=mesh[type],source=part[type],offset=target.position.length/3;
        for(const attribute of ['position','normal','uv','tile','color','glow','light'] as const)for(const value of source[attribute])target[attribute].push(value);
        for(const index of source.index)target.index.push(index+offset);
      }
    }
    if(!materialsOnly)for(const painting of paintings.get(`${origin[0]}_${origin[2]}`)??[])for(const element of painting.elements)appendElement(mesh.opaque,element,painting.position,{rotation:painting.rotation,tint:[1,1,1],emissive:0} as Block,undefined,undefined,lighting);
    let count=(mesh.opaque.index.length+mesh.transparent.index.length)/6;const file=`${theme}/${origin[0]}_${origin[2]}.bin.gz`,voxelFile=`${theme}/${origin[0]}_${origin[2]}.vox.gz`;
    if(materialsOnly) {
      const existing=gunzipSync(await readFile(`${output}/${voxelFile}`));
      const old=new Voxels();decodeColumn(existing.buffer.slice(existing.byteOffset,existing.byteOffset+existing.byteLength),origin[0],origin[2],old);
      if(!Buffer.from(encodeColumn(old,origins)).equals(Buffer.from(encodeColumn(voxels,origins))))throw new Error(`Voxel palette changed: run npm run assets without --materials (${theme})`);
      const header=gunzipSync(await readFile(`${output}/${file}`));if(header.readUInt32LE(0)!==0x4d435632)throw new Error('Mesh format changed: rebuild all assets');
      count=(header.readUInt32LE(8)+header.readUInt32LE(16))/6;
    }else {await writeFile(`${output}/${file}`,gzipSync(new Uint8Array(encodeMeshes(mesh))));await writeFile(`${output}/${voxelFile}`,gzipSync(new Uint8Array(encodeColumn(voxels,origins,lighting))));}
    chunks.push({file,voxels:voxelFile,origin,quads:count});quads+=count;
    if(++done%256===0)console.log(`  ${materialsOnly?'Verified':'Meshed'} ${done}/${columns.size} columns`);
  }
  let colors:any={};if(theme!=='tutorial')try{colors=JSON.parse(await readFile(`minecraft-memory-assets/resourcepacks/${pack}/assets/legacy/biome_overrides.json`,'utf8')).overrides?.default??{};}catch{/* pack has no overrides */}
  const environment:NonNullable<WorldManifest['environment']>={sky_color:colors.sky_color,fog_color:colors.fog_color,water_fog_color:colors.water_fog_color,water_fog_distance:colors.water_fog_distance,sun:`${theme}-sun.png`,moon:`${theme}-moon.png`,clouds:`${theme}-clouds.png`};
  for(const [from,to] of [['sun','sun'],['moon_phases','moon'],['clouds','clouds']]){
    const vanilla=`minecraft-memory-assets/references/native-data/1.13/environment/${from}.png`,native=`minecraft-memory-assets/resourcepacks/${pack}/assets/minecraft/textures/environment/${from}.png`;
    try{await copyFile(native,`${output}/${theme}-${to}.png`);}catch{await copyFile(vanilla,`${output}/${theme}-${to}.png`);}
  }
  worlds[theme]={name:theme==='tutorial'?'Tutorial World · TU14':world.name.replace(' Save',''),source:world.source,checksum:world.checksum,bounds,spawn,yaw,chunks,blocks:total,quads,triangles:quads*2,paintings:paintingCount,environment,unsupported:[...packs.unsupported].filter(s=>s.startsWith(`${pack}:`))};
  console.log(`  ${total.toLocaleString()} blocks → ${quads.toLocaleString()} quads`);
}
await copyFile('minecraft-memory-assets/references/native-data/1.13/entity/steve.png',`${output}/steve.png`);
for(const [from,to] of [['sun','sun'],['moon_phases','moon'],['clouds','clouds']])await copyFile(`minecraft-memory-assets/references/native-data/1.13/environment/${from}.png`,`${output}/${to}.png`);
for(const [theme,icon] of Object.entries({mario:'super_mario',festive:'festive',halloween:'halloween',chinese:'chinese_mythology'}))await copyFile(`minecraft-memory-assets/worlds/templates/legacy/textures/gui/sprites/creation_list/${icon}.png`,`${output}/${theme}-icon.png`);
const tutorialIcon=(await downloadWorld('tutorial')).files['icon.png'];if(tutorialIcon)await writeFile(`${output}/tutorial-icon.png`,tutorialIcon);
const tracks:Record<string,string>={mario:'maintheme',festive:'flake',halloween:'h1',chinese:'02_chang_an_-_perpetual_peace_overworld'};
const audio:Manifest['audio']={};
for(const [theme,track] of Object.entries(tracks)){await copyFile(`minecraft-memory-assets/resourcepacks/${theme}/assets/minecraft/sounds/music/${track}.ogg`,`${output}/${theme}.ogg`);audio[theme]=`${theme}.ogg`;}
await writeFile(`${output}/vanilla.ogg`,await downloadSound('music/game/calm1'));audio.tutorial='vanilla.ogg';
const effects:Manifest['effects']={};await mkdir(`${output}/effects`,{recursive:true});
for(const group of ['wood','stone','grass','gravel','snow','sand','cloth','swim','door_open','door_close']){
  effects[group]=[];const names=group.startsWith('door_')?[`random/${group}`]:Array.from({length:group==='swim'?2:4},(_,i)=>`${group==='swim'?'liquid':'step'}/${group}${i+1}`);
  for(const name of names){const file=`effects/${name.replaceAll('/','-')}.ogg`;await writeFile(`${output}/${file}`,await downloadSound(name));effects[group].push(file);}
}
const atlas=await packs.atlas(`${output}/atlas.png`);
const manifest:Manifest={atlas,blocks:packs.blocks,lookup:packs.lookup,audio,effects,worlds,missingTextures:[...packs.missing]};
await writeFile(`${output}/manifest.json`,JSON.stringify(manifest));
console.log(`Atlas: ${atlas.size}²; ${packs.tiles.length} textures; missing ${packs.missing.size}; unsupported ${packs.unsupported.size}`);
