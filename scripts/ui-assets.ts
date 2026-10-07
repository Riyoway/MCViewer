import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import minecraftData from 'minecraft-data';
import { fetchBytes,vanillaSoundIndex } from './download.ts';
import type { Manifest } from '../src/minecraft/types.ts';
import type { UIAssets,UITheme } from '../src/ui/types.ts';
import type { Element,FaceName,Vec3 } from '../src/minecraft/types.ts';

const reference='asset-sources/references/native-data/1.13';
const exists=async(path:string)=>{try{await access(path);return true;}catch{return false;}};
export async function prepareUI(){
  const manifest:Manifest=JSON.parse(await readFile('public/generated/manifest.json','utf8')),assets:UIAssets={themes:{}};
  const native=minecraftData('1.13'),modern=minecraftData('1.21.6');
  const definitions:{name:string;texture:string|null}[]=JSON.parse(await readFile(`${reference}/items_textures.json`,'utf8'));
  const itemModels=JSON.parse(await readFile(`${reference}/items_models.json`,'utf8')),blockModels=JSON.parse(await readFile(`${reference}/blocks_models.json`,'utf8')),modernModels=JSON.parse(await readFile('asset-sources/references/native-data/1.21.6/blocks_models.json','utf8'));
  const langEntry=(await vanillaSoundIndex())['minecraft/lang/ja_jp.json'];let language:Buffer;
  try{language=await readFile('.cache/lang-ja-jp-1.13.json');}catch{language=await fetchBytes(`https://resources.download.minecraft.net/${langEntry.hash.slice(0,2)}/${langEntry.hash}`);await writeFile('.cache/lang-ja-jp-1.13.json',language);}
  if(createHash('sha1').update(language).digest('hex')!==langEntry.hash)throw new Error('Native Japanese language checksum mismatch');
  const names=JSON.parse(language.toString());await mkdir('public/generated/ui',{recursive:true});
  for(const theme of ['vanilla','mario','festive','halloween','chinese']){
    const root=`asset-sources/resourcepacks/${theme}`,roots=theme==='vanilla'?[]:[root];
    if(theme!=='vanilla')for(const entry of JSON.parse(await readFile(`${root}/pack.mcmeta`,'utf8')).overlays?.entries??[])if((entry.min_format??entry.formats?.[0]??0)<=84)roots.unshift(`${root}/${entry.directory}`);
    const texture=async(path:string,fallback:string)=>{for(const r of roots){const file=`${r}/assets/minecraft/textures/${path}.png`;if(await exists(file))return sharp(file);}return sharp(`${reference}/${fallback}.png`);};
    const modelCache=new Map<string,any>();
    const model=async(path:string):Promise<any>=>{
      path=path.replace('minecraft:','');if(modelCache.has(path))return modelCache.get(path);
      if(path==='builtin/generated')return {generated:true};if(path==='builtin/entity')return {};
      let value:any;for(const r of roots)if(await exists(`${r}/assets/minecraft/models/${path}.json`)){value=JSON.parse(await readFile(`${r}/assets/minecraft/models/${path}.json`,'utf8'));break;}
      value??=path.startsWith('item/')?itemModels[path.slice(5)]:blockModels[path.slice(6)]??modernModels[path.slice(6)];
      if(!value)return {};
      const parent=value.parent?await model(value.parent):{},merged={...parent,...value,textures:{...parent.textures,...value.textures},display:{...parent.display,...value.display}};modelCache.set(path,merged);return merged;
    };
    const save=async(key:string,input:sharp.Sharp)=>{const path=`ui/${theme}-${key}.png`;await input.png().toFile(`public/generated/${path}`);return path;};
    const gui:Partial<UITheme>={};
    gui.hotbar=await save('hotbar',theme==='vanilla'?sharp(`${reference}/gui/widgets.png`).extract({left:0,top:0,width:182,height:22}):await texture('gui/sprites/hud/hotbar','gui/widgets'));
    gui.selection=await save('selection',theme==='vanilla'?sharp(`${reference}/gui/widgets.png`).extract({left:0,top:22,width:24,height:22}):await texture('gui/sprites/hud/hotbar_selection','gui/widgets'));
    const legacy=`${root}/assets/legacy/textures/gui/sprites/hud/hotbar_selection.png`;
    gui.legacySelection=await save('legacy-selection',await exists(legacy)?sharp(legacy):sharp(`public/generated/${gui.selection}`));
    gui.crosshair=await save('crosshair',theme==='vanilla'?sharp(`${reference}/gui/icons.png`).extract({left:0,top:0,width:16,height:16}):await texture('gui/sprites/hud/crosshair','gui/icons'));
    for(const [file,key] of [['selection','selectionSize'],['legacySelection','legacySelectionSize'],['crosshair','crosshairSize']] as const){const meta=await sharp(`public/generated/${gui[file]}`).metadata();gui[key]=[meta.width!,meta.height!];}
    gui.inventory=await save('inventory',(await texture('gui/container/creative_inventory/tab_item_search','gui/container/creative_inventory/tab_item_search')).extract({left:0,top:0,width:195,height:136}));
    gui.scroller=await save('scroller',theme==='vanilla'?sharp(`${reference}/gui/container/creative_inventory/tabs.png`).extract({left:232,top:0,width:12,height:15}):await texture('gui/sprites/container/creative_inventory/scroller','gui/container/creative_inventory/tabs'));
    const sprites:Buffer[]=[];
    for(let i=0;i<12;i++){
      const path=`particle/${i<4?`splash_${i}`:`generic_${i-4}`}`;
      // 1.13's particles atlas is a 16 x 16 grid of 8-pixel sprites in its 128-pixel used region.
      const index=i<4?19+i:i-4;
      let image:sharp.Sharp|undefined;for(const r of roots)if(await exists(`${r}/assets/minecraft/textures/${path}.png`)){image=sharp(`${r}/assets/minecraft/textures/${path}.png`);break;}
      image??=sharp(`${reference}/particle/particles.png`).extract({left:index%16*8,top:Math.floor(index/16)*8,width:8,height:8});
      sprites.push(await image.resize(16,16,{kernel:'nearest'}).png().toBuffer());
    }
    gui.particles=await save('particles',sharp({create:{width:192,height:16,channels:4,background:'#00000000'}}).composite(sprites.map((input,i)=>({input,left:i*16,top:0}))));
    const items:UITheme['items']=[],icons:Buffer[]=[];
    const blockNames=new Set<string>();
    for(const block of manifest.blocks)if(block?.theme===theme&&modern.itemsByName[block.name])blockNames.add(block.name);
    const defined=new Set(definitions.map(d=>d.name)),order=[...defined,...[...blockNames].filter(id=>!defined.has(id))];
    for(const id of order){
      const definition=definitions.find(d=>d.name===id),name=names[`block.minecraft.${id}`]??names[`item.minecraft.${id}`]??modern.itemsByName[id]?.displayName??native.itemsByName[id]?.displayName??id;
      const itemModel=await model(`item/${id}`);
      let flat=itemModel.generated?itemModel.textures?.layer0:definition?.texture?.startsWith('items/')?definition.texture:undefined;
      for(let i=0;flat?.startsWith('#')&&i<16;i++)flat=itemModel.textures?.[flat.slice(1)];
      if(flat){
        const layers=Object.entries(itemModel.textures??{}).filter(([key])=>/^layer\d$/.test(key)).sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>String(value));
        if(!layers.length)layers.push(flat);
        const images:Buffer[]=[];
        for(let layer=0;layer<layers.length;layer++){
          let value=layers[layer];for(let i=0;value.startsWith('#')&&i<16;i++)value=itemModel.textures[value.slice(1)];
          const path=value.replace('minecraft:','').replace(/^items\//,'item/').replace(/^blocks\//,'block/'),fallback=path.replace(/^item\//,'items/').replace(/^block\//,'blocks/');
          const image=await texture(path,fallback),meta=await image.metadata();let pixels=await image.extract({left:0,top:0,width:meta.width!,height:Math.min(meta.width!,meta.height!)}).resize(32,32,{kernel:'nearest'}).ensureAlpha().raw().toBuffer();
          const block=manifest.blocks.find(b=>b?.theme===theme&&(b.name===id||id==='grass'&&b.name==='short_grass'));
          const tint=layer===0?(id.startsWith('leather_')?[160/255,101/255,64/255]:/^(potion|splash_potion|lingering_potion|tipped_arrow)$/.test(id)?[56/255,93/255,198/255]:block?.tinted.some(Boolean)?block.tint:undefined):undefined;
          if(tint)for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)pixels[i+c]=Math.round(pixels[i+c]*tint[c]);
          images.push(await sharp(pixels,{raw:{width:32,height:32,channels:4}}).png().toBuffer());
        }
        const icon=icons.length;icons.push(await sharp({create:{width:32,height:32,channels:4,background:'#00000000'}}).composite(images.map(input=>({input}))).png().toBuffer());const pose=itemModel.display?.firstperson_righthand??{};items.push({id,name,icon,firstPerson:{rotation:pose.rotation??[0,0,0],translation:pose.translation??[0,0,0],scale:pose.scale??[1,1,1]}});
      }else if(blockNames.has(id)){
        const score=(state:string)=>(state.match(/=true/g)?.length??0)*10+(state.includes('half=upper')?100:0)+(state.includes('facing=north')?0:1);
        const candidates=manifest.blocks.map((block,index)=>({block,index})).filter(b=>b.block?.theme===theme&&b.block.name===id&&b.block.elements.length).sort((a,b)=>score(a.block.state)-score(b.block.state));
        if(candidates.length){
          const pose=itemModel.display?.firstperson_righthand??{},block=candidates[0].block,item:UITheme['items'][number]={id,name,block:candidates[0].index,firstPerson:{rotation:pose.rotation??[0,0,0],translation:pose.translation??[0,0,0],scale:pose.scale??[1,1,1]}};
          if(itemModel.elements?.length){
            const elements:Element[]=itemModel.elements.map((element:any)=>{
              const from=element.from.map((v:number)=>v/16) as Vec3,to=element.to.map((v:number)=>v/16) as Vec3,faces:Element['faces']={};
              for(const [direction,face] of Object.entries(element.faces??{}) as [FaceName,any][]){
                const source=block.elements.flatMap(e=>Object.entries(e.faces)).find(([f])=>f===direction)?.[1]??Object.values(block.elements[0].faces)[0]!;
                const a=element.from,b=element.to,uv=face.uv??(direction==='up'?[a[0],a[2],b[0],b[2]]:direction==='down'?[a[0],16-b[2],b[0],16-a[2]]:direction==='east'?[16-b[2],16-b[1],16-a[2],16-a[1]]:direction==='west'?[a[2],16-b[1],b[2],16-a[1]]:direction==='north'?[16-b[0],16-b[1],16-a[0],16-a[1]]:[a[0],16-b[1],b[0],16-a[1]]);
                faces[direction]={tile:source!.tile,uv,rotation:face.rotation,tint:face.tintindex!==undefined};
              }
              return {from,to,faces,rotation:element.rotation?{...element.rotation,origin:element.rotation.origin.map((v:number)=>v/16)}:undefined};
            });
            const gui=itemModel.display?.gui??{};item.model={elements,rotation:gui.rotation??[30,225,0],translation:gui.translation??[0,0,0],scale:gui.scale??[.625,.625,.625]};
          }
          items.push(item);
        }
      }
    }
    const columns=16,rows=Math.ceil(icons.length/columns);
    gui.itemsTexture=await save('items',sharp({create:{width:columns*32,height:rows*32,channels:4,background:'#00000000'}}).composite(icons.map((input,i)=>({input,left:i%columns*32,top:Math.floor(i/columns)*32}))));
    assets.themes[theme]={...gui,itemColumns:columns,items} as UITheme;
    console.log(`UI: ${theme}, ${items.length} items, ${icons.length} native item sprites`);
  }
  await writeFile('public/generated/ui/assets.json',JSON.stringify(assets));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareUI();
