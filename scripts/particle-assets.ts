import {readFile,writeFile} from 'node:fs/promises';
import {Packs} from './pack.ts';
import sharp from 'sharp';
import type {Manifest} from '../src/minecraft/types.ts';

// Native models' particle entry is independent of the face that was clicked.
// Reuse existing IDs and append only particle textures absent from the old atlas.
const path='public/generated/manifest.json',manifest=JSON.parse(await readFile(path,'utf8')) as Manifest;
const packs=new Packs();packs.blocks=manifest.blocks;packs.tiles=manifest.atlas.tiles;packs.restoreTileKeys();let count=0;
const oldFrames=Math.max(...packs.tiles.map(t=>t.start+t.frames));packs.images.length=oldFrames;
for(const block of manifest.blocks)if(block){const tile=await packs.particleTile(block);if(tile!==undefined){block.particle=tile;count++;}}
if(packs.missing.size)throw new Error(`Missing native particle assets: ${[...packs.missing]}`);
if(packs.images.length>oldFrames){
  const {size,cell}=manifest.atlas,columns=size/cell;if(packs.images.length>columns*columns)throw new Error('Particle atlas overflow');
  const raw=await sharp('public/generated/atlas.png').ensureAlpha().raw().toBuffer();
  for(let i=oldFrames;i<packs.images.length;i++){const pixels=await sharp(packs.images[i]).ensureAlpha().raw().toBuffer();for(let y=0;y<cell;y++)pixels.copy(raw,((Math.floor(i/columns)*cell+y)*size+i%columns*cell)*4,y*cell*4,(y+1)*cell*4);}
  await sharp(raw,{raw:{width:size,height:size,channels:4}}).png().toFile('public/generated/atlas.png');
}
await writeFile(path,JSON.stringify(manifest));console.log(`Native particle textures: ${count} states; ${packs.images.length-oldFrames} appended frames, old cells unchanged.`);
