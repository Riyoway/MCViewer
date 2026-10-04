import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import sharp from 'sharp';
import minecraftData from 'minecraft-data';
import {Packs} from './pack.ts';
import {downloadSound} from './download.ts';
import type {Manifest} from '../src/minecraft/types.ts';
import type {UIAssets} from '../src/ui/types.ts';

// Append placement states without renumbering any saved map's palette or atlas tiles.
export async function prepareBuilding(){
  const directory='public/generated',manifest=JSON.parse(await readFile(`${directory}/manifest.json`,'utf8')) as Manifest;
  const ui=JSON.parse(await readFile(`${directory}/ui/assets.json`,'utf8')) as UIAssets,data=minecraftData('1.21.6');
  const packs=new Packs();packs.blocks=manifest.blocks;packs.lookup=manifest.lookup;packs.tiles=manifest.atlas.tiles;packs.restoreTileKeys();
  const oldCount=packs.blocks.length,oldTiles=packs.tiles.length,building:NonNullable<Manifest['building']>={};
  packs.images.length=Math.max(...packs.tiles.map(tile=>tile.start+tile.frames));
  const aliases:Record<string,string>={grass:'short_grass',grass_path:'dirt_path',sign:'oak_sign'};
  for(const [theme,catalog] of Object.entries(ui.themes)){
    building[theme]={};
    for(const item of catalog.items){
      const name=aliases[item.id]??item.id,native=data.blocksByName[name];if(!native)continue;
      const base=await packs.block(theme,{Name:`minecraft:${name}`});if(!base)continue;
      building[theme][item.id]=base;
      // Only geometric placement/neighbor properties vary. Power, growth and fluid levels
      // are not an invented simulation of redstone or random ticks.
      const varying=native.states?.filter(property=>['facing','axis','half','face','rotation','hinge','open','part','shape','east','west','south','north','up','waterlogged'].includes(property.name)||property.name==='type'&&name.endsWith('_slab'))??[];
      let variants:Record<string,string>[]=[{}];
      for(const property of varying){const values=property.type==='bool'?['false','true']:property.values??Array.from({length:property.num_values},(_,i)=>String(i));variants=variants.flatMap(props=>values.map(value=>({...props,[property.name]:String(value)})));}
      for(const Properties of variants)await packs.block(theme,{Name:`minecraft:${name}`,Properties});
    }
    for(const name of ['wall_torch','redstone_wall_torch','soul_wall_torch'])for(const facing of ['north','east','south','west'])await packs.block(theme,{Name:`minecraft:${name}`,Properties:{facing,...(name==='redstone_wall_torch'?{lit:'true'}:{})}});
    console.log(`${theme}: ${Object.keys(building[theme]).length} placeable items`);
  }
  if(packs.blocks.length>65535)throw new Error('Placement palette exceeds the voxel format');
  // Existing cells are copied exactly. Only new textures are decoded and appended.
  if(packs.tiles.length!==oldTiles){
    const {size,cell}=manifest.atlas,raw=await sharp(`${directory}/atlas.png`).ensureAlpha().raw().toBuffer(),columns=size/cell;
    const count=Math.max(...manifest.atlas.tiles.slice(0,oldTiles).map(tile=>tile.start+tile.frames));
    for(let i=0;i<count;i++){
      const pixels=Buffer.alloc(cell*cell*4);for(let y=0;y<cell;y++){const start=((Math.floor(i/columns)*cell+y)*size+i%columns*cell)*4;raw.copy(pixels,y*cell*4,start,start+cell*4);}
      packs.images[i]=await sharp(pixels,{raw:{width:cell,height:cell,channels:4}}).png().toBuffer();
    }
    manifest.atlas=await packs.atlas(`${directory}/atlas.next.png`);await rename(`${directory}/atlas.next.png`,`${directory}/atlas.png`);
  }
  manifest.building=building;
  if(packs.missing.size)throw new Error(`Missing placement textures: ${[...packs.missing].join(', ')}`);
  await mkdir(`${directory}/effects`,{recursive:true});
  for(const group of ['wood','stone','grass','gravel','snow','sand','cloth','glass']){
    const key=`dig_${group}`,names=group==='glass'?Array.from({length:3},(_,i)=>`random/glass${i+1}`):Array.from({length:4},(_,i)=>`dig/${group}${i+1}`);
    manifest.effects[key]=[];
    for(const name of names){const file=`effects/${name.replaceAll('/','-')}.ogg`;await writeFile(`${directory}/${file}`,await downloadSound(name));manifest.effects[key].push(file);}
  }
  await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest));
  console.log(`Placement states: ${oldCount} → ${packs.blocks.length}; atlas: ${packs.tiles.length} tiles`);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/building-assets.ts'))await prepareBuilding();
