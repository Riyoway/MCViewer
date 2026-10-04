import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import sharp from 'sharp';
import { Packs } from './pack.ts';
import type { Manifest } from '../src/minecraft/types.ts';

// Repair/regenerate fluid sprites while keeping the tile IDs stored in every terrain mesh.
const root='public/generated',manifest:Manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));
const fluidNames=new Map<number,{theme:string;texture:string}>();
for(const block of manifest.blocks)if(block?.fluidTiles){
  const kind=block.name==='lava'?'lava':'water',names=[`${kind}_still`,`${kind}_flow`,'water_overlay'];
  for(const [index,id] of block.fluidTiles.entries()){
    const entry={theme:block.theme,texture:names[index]},previous=fluidNames.get(id);
    if(previous&&(previous.theme!==entry.theme||previous.texture!==entry.texture))throw new Error(`Conflicting fluid tile: ${id}`);
    fluidNames.set(id,entry);
  }
}
const packs=new Packs(),replacements=new Map<number,number>();
for(const [id,{theme,texture}] of fluidNames){await packs.init(theme);replacements.set(id,await packs.tile(theme,texture));}
const {size,cell}=manifest.atlas,columns=size/cell,source=await sharp(`${root}/atlas.png`).ensureAlpha().raw().toBuffer();
const output=Buffer.alloc(size*size*4);let start=0;
const copy=(pixels:Buffer,width:number,left:number,top:number,destination:number)=>{
  for(let y=0;y<cell;y++)pixels.copy(output,((Math.floor(destination/columns)*cell+y)*size+destination%columns*cell)*4,((top+y)*width+left)*4,((top+y)*width+left+cell)*4);
};
for(const [id,old] of manifest.atlas.tiles.entries()){
  const replacement=replacements.get(id),tile=replacement===undefined?old:packs.tiles[replacement];
  if(start+tile.frames>columns*columns)throw new Error('Fluid atlas exceeds texture capacity');
  for(let frame=0;frame<tile.frames;frame++){
    if(replacement===undefined){const index=old.start+frame;copy(source,size,index%columns*cell,Math.floor(index/columns)*cell,start+frame);}
    else copy(await sharp(packs.images[tile.start+frame]).ensureAlpha().raw().toBuffer(),cell,0,0,start+frame);
  }
  manifest.atlas.tiles[id]={...tile,start};start+=tile.frames;
}
await mkdir('.cache',{recursive:true});
await sharp(output,{raw:{width:size,height:size,channels:4}}).png().toFile('.cache/fluid-atlas.png');
await rename('.cache/fluid-atlas.png',`${root}/atlas.png`);
await writeFile(`${root}/manifest.json`,JSON.stringify(manifest));
console.log(`Regenerated ${fluidNames.size} fluid sprites; ${start} frames have separate atlas ranges. Terrain tile IDs are unchanged.`);
