import {unzip} from 'fflate';
import {CanvasTexture,NearestFilter,NearestMipmapLinearFilter,SRGBColorSpace,type Texture} from 'three';
import type {AssetManager} from '../core/AssetManager';
import type {Block,Element,Tile,FaceName,Vec3} from '../minecraft/types';
import {FACES} from '../minecraft/types';
import {properties} from '../minecraft/BlockState';
import {safePath,type LocalFile} from './WorldStore';

export function unzipFiles(bytes:Uint8Array):Promise<Record<string,Uint8Array>>{return new Promise((resolve,reject)=>unzip(bytes,(error,files)=>error?reject(error):resolve(files)));}
const aliases:Record<string,string>={grass_block_top:'grass_top',grass_block_side:'grass_side',grass_block_side_overlay:'grass_side_overlay',oak_planks:'planks_oak',oak_log:'log_oak',oak_log_top:'log_oak_top',stone_bricks:'stonebrick',mossy_stone_bricks:'stonebrick_mossy',cracked_stone_bricks:'stonebrick_cracked',chiseled_stone_bricks:'stonebrick_carved',short_grass:'tallgrass',dirt_path_top:'grass_path_top',dirt_path_side:'grass_path_side',crafting_table_front:'crafting_table_front',oak_door_top:'door_wood_upper',oak_door_bottom:'door_wood_lower'};
export class ResourcePack {
  private originalTexture:Texture;private originalBlocks:Block[];private originalTiles:Tile[];
  private texture?:CanvasTexture;private urls:string[]=[];private originals:Map<number,string>=new Map();
  constructor(readonly assets:AssetManager){this.originalTexture=assets.opaque.map!;this.originalBlocks=assets.manifest.blocks.slice();this.originalTiles=structuredClone(assets.manifest.atlas.tiles);for(const [i,t] of this.originalTiles.entries())if(t.key)this.originals.set(i,t.key);}
  reset(){this.assets.opaque.map=this.assets.transparent.map=this.originalTexture;this.assets.opaque.needsUpdate=this.assets.transparent.needsUpdate=true;this.texture?.dispose();this.texture=undefined;this.assets.manifest.blocks=this.originalBlocks.slice();this.assets.manifest.atlas.tiles=structuredClone(this.originalTiles);this.assets.refreshCutouts();for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];}
  async apply(file:LocalFile,progress:(message:string)=>void,theme='vanilla'){
    this.reset();progress('Unpacking resource pack...');const raw=await unzipFiles(new Uint8Array(await file.blob.arrayBuffer())),files:Record<string,Uint8Array>=Object.create(null);
    for(const [name,bytes] of Object.entries(raw))files[safePath(name)]=bytes;
    const metaPath=Object.keys(files).find(name=>/(^|\/)pack\.mcmeta$/.test(name));if(!metaPath)throw new Error('Resource pack is missing pack.mcmeta');
    const root=metaPath.slice(0,-11),decoder=new TextDecoder(),json=(path:string)=>{const bytes=files[root+path];return bytes?JSON.parse(decoder.decode(bytes)):undefined;};
    const meta=json('pack.mcmeta');if(!meta?.pack)throw new Error('Invalid pack.mcmeta format');
    const overlays=(meta.overlays?.entries??[]).map((e:any)=>e.directory+'/');
    const getFile=(path:string)=>{for(const overlay of overlays.slice().reverse())if(files[root+overlay+path])return files[root+overlay+path];return files[root+path];};
    const source=(texture:string)=>{let [namespace,path]=texture.includes(':')?texture.split(':',2):['minecraft',texture];path=path.replace(/^blocks?\//,'');
      const candidates=/^(entity|painting|environment|gui|font)\//.test(path)?[path]:[path,'block/'+path,'blocks/'+path,'blocks/'+(aliases[path]??path),'blocks/'+path.replace(/^(spruce|birch|jungle|acacia|dark_oak)_(planks|log)(_top)?$/,(_,wood,kind,top)=>(kind==='planks'?'planks_':'log_')+wood+(top??''))];
      for(const name of candidates){const resource=`assets/${namespace}/textures/${name}.png`,bytes=getFile(resource);if(bytes)return {bytes,path:resource,meta:json(resource+'.mcmeta')?.animation};}
    };
    const imageCache=new Map<string,Promise<ImageBitmap>>();
    const image=(path:string,bytes:Uint8Array)=>{let result=imageCache.get(path);if(!result){result=createImageBitmap(new Blob([bytes.slice().buffer],{type:'image/png'}));imageCache.set(path,result);}return result;};
    const atlas=this.assets.manifest.atlas,canvas=document.createElement('canvas');canvas.width=canvas.height=atlas.size;const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(this.originalTexture.image,0,0);
    const columns=atlas.size/atlas.cell,padding=(atlas.cell-atlas.pixels)/2;let next=Math.max(...atlas.tiles.map(t=>t.start+t.frames)),replaced=0;
    const customTiles=new Map<string,number>();
    async function put(texture:string,existing?:number,region?:number[]){
      const found=source(texture);if(!found)return undefined;const picture=await image(found.path,found.bytes),animation=found.meta;
      const width=animation?.width??picture.width,height=animation?.height??(animation?width:picture.height),framesAvailable=Math.floor(picture.width/width)*Math.floor(picture.height/height);
      let ticks=animation?.frametime??1,sequence:{index:number;time:number}[]=animation?(animation.frames??Array.from({length:framesAvailable},(_,i)=>i)).map((v:any)=>typeof v==='number'?{index:v,time:ticks}:{index:v.index,time:v.time??ticks}):[{index:0,time:1}];
      sequence=sequence.filter(f=>Number.isInteger(f.index)&&f.index>=0&&f.index<framesAvailable&&Number.isInteger(f.time)&&f.time>0);if(!sequence.length)throw new Error(`Invalid animation frames: ${found.path}`);
      const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;ticks=sequence.reduce((n,f)=>gcd(n,f.time),sequence[0].time);
      const order=sequence.flatMap(f=>Array.from({length:f.time/ticks},()=>f.index));if(order.length>1024||next+order.length>columns*columns)throw new Error('Resource pack animations exceed atlas capacity');
      const id=existing??atlas.tiles.length,old=existing===undefined?undefined:atlas.tiles[existing],tile:Tile={start:next,frames:order.length,ticks,size:old?.size??[atlas.pixels-1,atlas.pixels-1],key:'vanilla:'+texture};
      for(const frame of order){const x=next%columns*atlas.cell,y=Math.floor(next/columns)*atlas.cell;ctx.clearRect(x,y,atlas.cell,atlas.cell);
        const sx=(frame%Math.floor(picture.width/width))*width,sy=Math.floor(frame/Math.floor(picture.width/width))*height;
        const r=region??[0,0,16,16],a=r[0]/16*width,b=r[1]/16*height,w=(r[2]-r[0])/16*width,h=(r[3]-r[1])/16*height;
        const [dw,dh]=old?.size??[atlas.pixels,atlas.pixels],left=x+(atlas.cell-dw)/2,top=y+(atlas.cell-dh)/2;
        // Entity face UVs already carry the original flip; keep the crop in image order.
        ctx.drawImage(picture,sx+Math.min(a,a+w),sy+Math.min(b,b+h),Math.abs(w),Math.abs(h),left,top,dw,dh);
        // Extrude edge pixels across the mipmap gutter.
        ctx.drawImage(canvas,left,top,dw,1,left,y,dw,top-y);
        ctx.drawImage(canvas,left,top+dh-1,dw,1,left,top+dh,dw,atlas.cell-(top-y)-dh);
        ctx.drawImage(canvas,left,y,1,atlas.cell,x,y,left-x,atlas.cell);ctx.drawImage(canvas,left+dw-1,y,1,atlas.cell,left+dw,y,atlas.cell-(left-x)-dw,atlas.cell);next++;
      }
      if(existing===undefined)atlas.tiles.push(tile);else atlas.tiles[existing]=tile;replaced++;return id;
    }
    try{
      for(const [id,key] of this.originals){if(!key.startsWith(theme+':'))continue;const parts=key.slice(theme.length+1).split(':'),texture=parts[0];if(texture==='layer')continue;await put(texture,id,parts[1]?.split(',').map(Number));}
      const [natives,nativeStates]=await Promise.all(['native-models.json','native-states.json'].map(file=>fetch(`${import.meta.env.BASE_URL}menu/${file}`).then(r=>r.json()))),models=new Map<string,any>();
      const readModel=(name:string,depth=0):any=>{if(depth>24)throw new Error('Circular model inheritance');if(models.has(name))return models.get(name);const [namespace,path]=name.includes(':')?name.split(':',2):['minecraft',name],clean=path.replace(/^blocks?\//,''),custom=json(`assets/${namespace}/models/${path}.json`)??json(`assets/${namespace}/models/block/${clean}.json`)??json(`assets/${namespace}/models/blocks/${clean}.json`),own=custom??(namespace==='minecraft'?natives[clean]:undefined);if(!own)return undefined;const parent=own.parent?readModel(own.parent,depth+1):{};const result={...parent,...own,custom:!!custom||!!parent?.custom,textures:{...parent?.textures,...own.textures},elements:own.elements??parent?.elements};models.set(name,result);return result;};
      const tileFor=async(texture:string)=>{if(customTiles.has(texture))return customTiles.get(texture);const added=await put(texture);let id=added;if(id===undefined)id=[...this.originals].find(([,key])=>key===`vanilla:${texture.replace(/^minecraft:/,'').replace(/^block\//,'')}`)?.[0];if(id!==undefined)customTiles.set(texture,id);return id;};
      for(const [id,block] of this.originalBlocks.entries()){
        if(block?.theme!==theme)continue;
        const customState=json(`assets/minecraft/blockstates/${block.name}.json`),state=customState??nativeStates[block.name];if(!state)continue;
        const props=properties(block),matches=(condition:any):boolean=>!condition||(condition.OR?condition.OR.some(matches):condition.AND?condition.AND.every(matches):Object.entries(condition).every(([k,v])=>String(v).split('|').includes(props[k])));
        const chosen=Object.entries(state.variants??{}).find(([key])=>!key||key.split(',').every(v=>{const [k,p]=v.split('=');return props[k]===p;}))?.[1],variants:any[]=[];
        if(chosen)variants.push(Array.isArray(chosen)?chosen[0]:chosen);for(const part of state.multipart??[])if(matches(part.when))variants.push(Array.isArray(part.apply)?part.apply[0]:part.apply);
        if(!customState&&!variants.some(variant=>readModel(variant.model)?.custom))continue;
        const elements:Element[]=[];for(const variant of variants){const model=readModel(variant.model);if(!model?.elements)continue;
          const resolve=(t:string,depth=0):string=>{if(depth>24)throw new Error('Circular model texture reference');return t?.startsWith('#')?resolve(model.textures[t.slice(1)],depth+1):t;};
          for(const e of model.elements){const element:Element={from:e.from.map((n:number)=>n/16),to:e.to.map((n:number)=>n/16),faces:{},transform:[variant.x??0,variant.y??0,0],uvlock:!!variant.uvlock};if(e.rotation)element.rotation={...e.rotation,origin:e.rotation.origin.map((n:number)=>n/16)};
            for(const [face,f] of Object.entries(e.faces??{}) as [FaceName,any][]){const texture=resolve(f.texture),tile=await tileFor(texture);if(tile===undefined)continue;const a=e.from,b=e.to,uv=f.uv??(face==='up'?[a[0],a[2],b[0],b[2]]:face==='down'?[a[0],16-b[2],b[0],16-a[2]]:face==='east'?[16-b[2],16-b[1],16-a[2],16-a[1]]:face==='west'?[a[2],16-b[1],b[2],16-a[1]]:face==='north'?[16-b[0],16-b[1],16-a[0],16-a[1]]:[a[0],16-b[1],b[0],16-a[1]]);element.faces[face]={tile,uv,tint:f.tintindex>=0,cull:f.cullface,rotation:f.rotation};}elements.push(element);
          }
        }
        if(elements.length)this.assets.manifest.blocks[id]={...block,cube:false,elements};
      }
      this.texture=new CanvasTexture(canvas);this.texture.magFilter=NearestFilter;this.texture.minFilter=NearestMipmapLinearFilter;this.texture.colorSpace=SRGBColorSpace;this.assets.opaque.map=this.assets.transparent.map=this.texture;this.assets.opaque.needsUpdate=this.assets.transparent.needsUpdate=true;this.assets.refreshCutouts();
      const environment:Record<string,string>={};for(const [key,path] of [['sun','sun'],['moon','moon_phases'],['clouds','clouds']] as const){const found=source('environment/'+path);if(found){const url=URL.createObjectURL(new Blob([found.bytes.slice().buffer],{type:'image/png'}));this.urls.push(url);environment[key]=url;}}
      progress(`Loaded ${replaced} textures`);return {name:file.name.replace(/\.zip$/i,''),replaced,environment,format:meta.pack.pack_format};
    }catch(error){this.reset();throw error;}finally{for(const bitmap of imageCache.values())(await bitmap).close();}
  }
}
