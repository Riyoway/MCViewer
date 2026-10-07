import {readFile,writeFile} from 'node:fs/promises';
import minecraftData from 'minecraft-data';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {Packs} from './pack.ts';
import {legacyState} from './legacy.ts';
import type {Manifest} from '../src/minecraft/types.ts';

// Persist texture names for the original sample atlas without changing its tile IDs.
const path='public/generated/manifest.json',manifest:Manifest=JSON.parse(await readFile(path,'utf8'));
const packs=new Packs();packs.blocks=manifest.blocks;packs.tiles=manifest.atlas.tiles;packs.restoreTileKeys();
for(const block of manifest.blocks)if(block)await packs.particleTile(block);
// particleTile recovers the old face IDs; write the recovered keys onto those IDs.
const cache=(packs as unknown as {tileCache:Map<string,number>}).tileCache;
for(const [key,id] of cache)manifest.atlas.tiles[id].key??=key;
const {size,cell}=manifest.atlas,raw=await sharp('public/generated/atlas.png').ensureAlpha().raw().toBuffer(),hashes=new Map<string,string>();
const fingerprints=manifest.atlas.tiles.map(tile=>{const hash=createHash('sha256');hash.update(JSON.stringify([tile.frames,tile.size]));const x=tile.start%(size/cell)*cell,y=Math.floor(tile.start/(size/cell))*cell;for(let row=0;row<cell;row++)hash.update(raw.subarray(((y+row)*size+x)*4,((y+row)*size+x+cell)*4));return hash.digest('hex');});
for(const [id,tile] of manifest.atlas.tiles.entries())if(tile.key)hashes.set(fingerprints[id],tile.key);
for(const [id,tile] of manifest.atlas.tiles.entries())tile.key??=hashes.get(fingerprints[id]);
const nativePack=new Packs();
for(const block of manifest.blocks)if(block){
  const properties=Object.fromEntries((block.state.split('[')[1]??'').replace(']','').split(',').filter(Boolean).map(p=>p.split('=')));
  const id=await nativePack.block(block.theme,{Name:'minecraft:'+block.name,Properties:properties}),nativeBlock=nativePack.blocks[id];if(!nativeBlock)continue;
  const pairs:[number,number][]=[...block.tiles.map((tile,i)=>[tile,nativeBlock.tiles[i]] as [number,number]),...[...block.fluidTiles??[]].map((tile,i)=>[tile,nativeBlock.fluidTiles?.[i]??-1] as [number,number])];
  for(const [i,element] of block.elements.entries())for(const [face,value] of Object.entries(element.faces))if(value)pairs.push([value.tile,nativeBlock.elements[i]?.faces[face as keyof typeof element.faces]?.tile??-1]);
  for(const [old,next] of pairs)if(nativePack.tiles[next]?.key)manifest.atlas.tiles[old].key=nativePack.tiles[next].key;
  if(block.name==='grass_block')for(const face of [0,1,4,5])manifest.atlas.tiles[block.tiles[face]].key=block.theme+':grass_block_side';
}
await writeFile(path,JSON.stringify(manifest));
const legacy:Record<string,ReturnType<typeof legacyState>>={};
for(const key of Object.keys(minecraftData.legacy.pc.blocks)){const [id,meta]=key.split(':').map(Number);legacy[key]=legacyState(id,meta);}
const native=minecraftData('1.21.6'),biomes=Object.values(native.biomesByName).map((b:any)=>({id:b.id,name:b.name,temperature:b.temperature??.8,precipitation:/desert|savanna|badlands|nether|end/.test(b.name)?'none':'rain'}));
const oldBiomes=Object.values(minecraftData('1.12.2').biomesByName).map((b:any)=>({id:b.id,name:b.name,temperature:b.temperature??.8,precipitation:/desert|savanna|mesa|hell|sky/.test(b.name)?'none':'rain'}));
await writeFile('public/menu/viewer-data.json',JSON.stringify({legacy,biomes,oldBiomes}));
await writeFile('public/menu/native-models.json',await readFile('asset-sources/references/native-data/1.21.6/blocks_models.json'));
await writeFile('public/menu/native-states.json',await readFile('asset-sources/references/native-data/1.21.6/blocks_states.json'));
console.log(`Recovered ${manifest.atlas.tiles.filter(t=>t.key).length} texture names; ${Object.keys(legacy).length} legacy states.`);
