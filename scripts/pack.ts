import { readFile, access } from 'node:fs/promises';
import minecraftData from 'minecraft-data';
import sharp from 'sharp';
import { FACES } from '../src/minecraft/types.ts';
import { faceCorners, appendElement, emptyMesh, coversFace } from '../src/minecraft/Mesher.ts';
import { Voxels } from '../src/minecraft/Voxels.ts';
import type { Block, Element, Tile, Vec3 } from '../src/minecraft/types.ts';
import { stateKey } from './anvil.ts';
import type { State } from './anvil.ts';

const reference='minecraft-memory-assets/references/native-data';
const models=JSON.parse(await readFile(`${reference}/1.21.6/blocks_models.json`,'utf8'));
const states=JSON.parse(await readFile(`${reference}/1.21.6/blocks_states.json`,'utf8'));
const nativeData=minecraftData('1.21.6'),blockData=nativeData.blocksByName;
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
const facesDefault = (f: string, a: number[], b: number[]): number[] => {
  if(f==='down')return [a[0],16-b[2],b[0],16-a[2]];
  if(f==='up')return [a[0],a[2],b[0],b[2]];
  if(f==='east')return [16-b[2],16-b[1],16-a[2],16-a[1]];
  if(f==='west')return [a[2],16-b[1],b[2],16-a[1]];
  if(f==='north')return [16-b[0],16-b[1],16-a[0],16-a[1]];
  return [a[0],16-b[1],b[0],16-a[1]];
};

export class Packs {
  blocks: Block[] = [null as unknown as Block];
  lookup: Record<string,number> = {};
  tiles: Tile[] = [];
  images: Buffer[] = [];
  missing = new Set<string>();
  unsupported = new Set<string>();
  private tileCache=new Map<string,number>();
  private modelCache=new Map<string,any>();
  private jsonCache=new Map<string,any>();
  private roots: Record<string,string[]> = {};

  async init(theme: string) {
    if (this.roots[theme]) return;
    const root=`minecraft-memory-assets/resourcepacks/${theme}`;
    this.roots[theme]=theme==='vanilla'?[]:[root];
    if(theme!=='vanilla') {
      const meta=JSON.parse(await readFile(`${root}/pack.mcmeta`,'utf8'));
      // The converted Java world targets the supplied pack's 26.1 overlay.
      for(const overlay of meta.overlays?.entries ?? []) {
        if ((overlay.min_format ?? overlay.formats?.[0] ?? 0) <= 84) this.roots[theme].unshift(`${root}/${overlay.directory}`);
      }
    }
  }
  private async packJson(theme: string, kind: string, name: string) {
    const key=`${theme}:${kind}:${name}`;
    if(this.jsonCache.has(key)) return this.jsonCache.get(key);
    for(const root of this.roots[theme]) {
      const path=`${root}/assets/minecraft/${kind}/${name}.json`;
      if(await exists(path)) { const json=JSON.parse(await readFile(path,'utf8')); this.jsonCache.set(key,json); return json; }
    }
    const result=kind==='models/block'?models[name]:states[name];
    this.jsonCache.set(key,result); return result;
  }
  private async model(theme: string, name: string, depth=0): Promise<any> {
    name=name.replace('minecraft:','').replace(/^block\//,'');
    const key=`${theme}:${name}`;
    if(this.modelCache.has(key)) return this.modelCache.get(key);
    if(depth>16) throw new Error(`Cyclic model: ${key}`);
    const model=await this.packJson(theme,'models/block',name);
    if(!model) return null;
    const parent=model.parent ? await this.model(theme,model.parent,depth+1) : {};
    const result={...parent,...model,textures:{...parent?.textures,...model.textures},elements:model.elements ?? parent?.elements};
    this.modelCache.set(key,result); return result;
  }
  async tile(theme: string, texture: string, region?: number[]): Promise<number> {
    texture=texture.replace('minecraft:','').replace(/^block\//,'');
    const entity=texture.startsWith('entity/')||texture.startsWith('painting/'),texturePath=entity?texture:`block/${texture}`,referencePath=entity?texture:`blocks/${texture}`;
    const key=`${theme}:${texture}${region?':'+region.join(','):''}`;
    if(this.tileCache.has(key)) return this.tileCache.get(key)!;
    let path='';
    for(const root of this.roots[theme]) {
      const candidate=`${root}/assets/minecraft/textures/${texturePath}.png`;
      if(await exists(candidate)) {path=candidate;break;}
    }
    if(!path) for(const version of texture.startsWith('entity/chest/')?['1.21.6','1.13']:['1.13','1.21.6']) {
      const candidate=`${reference}/${version}/${referencePath}.png`;
      if(await exists(candidate)) {path=candidate;break;}
    }
    if(!path) { this.missing.add(key); path=`${reference}/1.13/blocks/stone.png`; }
    const input=sharp(await readFile(path)).ensureAlpha(), meta=await input.metadata();
    const width=meta.width!, height=meta.height!;
    let animation: any;
    try { animation=JSON.parse(await readFile(`${path}.mcmeta`,'utf8')).animation; } catch { /* static */ }
    const frameWidth=animation?(animation.width??Math.min(width,height)):width,frameHeight=animation?(animation.height??Math.min(width,height)):height;
    const columns=Math.floor(width/frameWidth),frameCount=columns*Math.floor(height/frameHeight);
    const crop=region?{left:Math.round(Math.min(region[0],region[2])/16*frameWidth),top:Math.round(Math.min(region[1],region[3])/16*frameHeight),width:Math.round(Math.abs(region[2]-region[0])/16*frameWidth),height:Math.round(Math.abs(region[3]-region[1])/16*frameHeight)}:{left:0,top:0,width:frameWidth,height:frameHeight};
    // Match the Bedrock flipbook tick rate (20Hz), preserving Java frame order/durations.
    let order:number[]=[0],ticks=1;
    if(animation && frameCount>1) {
      order=[];
      const frames=animation.frames ?? Array.from({length:frameCount},(_,i)=>i);
      const duration=(frame:any)=>typeof frame==='number'?(animation.frametime??1):(frame.time??animation.frametime??1);
      const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
      for(const frame of frames)if(!Number.isInteger(duration(frame))||duration(frame)<1)throw new Error(`Invalid animation timing: ${path}`);
      ticks=frames.reduce((value:number,frame:any)=>gcd(value,duration(frame)),0)||1;
      for(const frame of frames) {
        const index=typeof frame==='number'?frame:frame.index, time=typeof frame==='number'?(animation.frametime??1):(frame.time??animation.frametime??1);
        for(let n=0;n<time/ticks;n++) order.push(index);
      }
    }
    if(order.some(frame=>frame<0||frame>=frameCount)){console.warn(`Ignoring out-of-range animation frames: ${path}`);order=order.filter(frame=>frame>=0&&frame<frameCount);}
    if(!order.length)order=[0];
    const id=this.tiles.length, start=this.images.length;
    this.tiles.push({start,frames:order.length,ticks});this.tileCache.set(key,id);
    const resized=new Map<number,Buffer>();
    for(const frame of order) {
      if(frame<0 || frame>=frameCount) throw new Error(`Invalid texture frame: ${path}`);
      if(!resized.has(frame)) resized.set(frame,await sharp(await readFile(path)).extract({...crop,left:frame%columns*frameWidth+crop.left,top:Math.floor(frame/columns)*frameHeight+crop.top}).resize(32,32,{kernel:'nearest'}).extend({top:16,bottom:16,left:16,right:16,extendWith:'copy'}).png().toBuffer());
      this.images.push(resized.get(frame)!);
    }
    return id;
  }
  async painting(theme:string,entity:any):Promise<{position:Vec3;elements:Element[];rotation:Vec3}> {
    await this.init(theme);
    const name=String(entity.variant??entity.Motive??'').replace('minecraft:','').replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
    if(!/^[a-z0-9_]+$/.test(name))throw new Error('Invalid painting variant');
    const position=entity.Pos as Vec3;
    if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw new Error('Invalid painting position');
    const meta=await sharp(`${reference}/1.21.6/painting/${name}.png`).metadata(),width=meta.width!/16,height=meta.height!/16;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8||height>8)throw new Error(`Invalid painting size: ${name}`);
    const facing=entity.facing??entity.Facing??0;
    if(!Number.isInteger(facing)||facing<0||facing>3)throw new Error('Invalid painting facing');
    const elements:Element[]=[],back=await this.tile(theme,'painting/back');
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const front=await this.tile(theme,`painting/${name}`,[x*16/width,y*16/height,(x+1)*16/width,(y+1)*16/height]);
      const faces:Element['faces']={south:{tile:front,uv:[0,0,16,16]},north:{tile:back,uv:[0,0,16,16]}};
      for(const face of ['east','west','up','down'] as const)if(face==='east'&&x===width-1||face==='west'&&x===0||face==='up'&&y===0||face==='down'&&y===height-1)faces[face]={tile:back,uv:face==='up'||face==='down'?[0,0,16,1]:[0,0,1,16]};
      elements.push({from:[x-width/2,height/2-y-1,-1/32],to:[x+1-width/2,height/2-y,1/32],faces});
    }
    return {position,elements:elements.map(e=>({...e,rotation:{origin:[0,0,0],axis:'y',angle:-facing*90}})),rotation:[0,0,0]};
  }
  private async entityElements(theme:string,name:string,props:Record<string,string>):Promise<Element[]> {
    let texture='',size=64,boxes:{from:Vec3;to:Vec3;u:number;v:number;rotation?:Element['rotation'];transform?:Vec3;bedBody?:boolean}[]=[],angle=({north:0,east:90,south:180,west:270} as Record<string,number>)[props.facing]??0;
    if(/^(chest|trapped_chest|ender_chest)$/.test(name)) {
      const type=name==='ender_chest'?'single':props.type??'single',left=type==='left',double=type!=='single';
      texture=`entity/chest/${name==='ender_chest'?'ender':name==='trapped_chest'?'trapped':'normal'}${double?'_'+type:''}`;
      const x=left?0:1,X=double?(left?15:16):15,lock=double?(left?0:15):7;
      // Mojang ChestModel: lid overlaps the bottom by one pixel; native Y points up.
      boxes=[{from:[x,0,1],to:[X,10,15],u:0,v:19},{from:[x,9,1],to:[X,14,15],u:0,v:0},{from:[lock,7,15],to:[lock+(double?1:2),11,16],u:0,v:0}];
      angle+=180;
    }else if(name.endsWith('_bed')) {
      texture=`entity/bed/${name.replace('_bed','')}`;
      const head=props.part==='head';
      boxes=[{from:[0,-2,5],to:[16,14,11],u:0,v:head?0:22,rotation:{axis:'x',angle:90,origin:[.5,.375,.5]},transform:[0,180+angle,0],bedBody:true}];
      for(const [x,v] of [[0,0],[13,6]])boxes.push({from:[x,0,head?0:13],to:[x+3,3,head?3:16],u:50,v});
    }else if(/head$|skull$/.test(name)) {
      texture=`entity/${name.includes('skeleton')?'skeleton/'+(name.includes('wither')?'wither_skeleton':'skeleton'):name.includes('zombie')?'zombie/zombie':name.includes('creeper')?'creeper/creeper':'steve'}`;
      boxes=[{from:[4,0,4],to:[12,8,12],u:0,v:0}];angle=Number(props.rotation??0)*22.5;
    }else if(name.endsWith('_sign')) {
      texture='oak_planks';size=16;
      boxes=name.includes('wall')?[{from:[0,4,14],to:[16,12,16],u:0,v:0}]:[{from:[7,0,7],to:[9,8,9],u:0,v:0},{from:[0,8,7],to:[16,16,9],u:0,v:0}];
      if(!name.includes('wall'))angle=Number(props.rotation??0)*22.5;
    }else return [];
    const elements:Element[]=[];
    for(const box of boxes){
      const [w,h,d]=box.to.map((v,i)=>v-box.from[i]),u=box.u,v=box.v;
      const rectangles=[[u+d+w,v+d,d,h],[u,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+d+w+d,v+d,w,h],[u+d,v+d,w,h]];
      const faces:Element['faces']={};
      for(const [i,face] of FACES.entries()){
        if(box.bedBody&&(props.part==='head'?face==='down':face==='up'))continue;
        const [x,y,W,H]=rectangles[i];let rect=[x,y,x+W,y+H];
        if(texture.startsWith('entity/chest/')) {
          if(face==='up')rect=[u+d+w,v+d,u+d+2*w,v];
          else if(face==='down')rect=[u+d,v,u+d+w,v+d];
          else rect=[x+W,y+H,x,y];
        }
        if(box.bedBody&&face==='up')rect=[22,6,6,0];
        if(box.bedBody&&face==='down')rect=[38,22,22,28];
        const region=rect.map(n=>n*16/size),tile=await this.tile(theme,texture,size===16?undefined:region);
        faces[face]={tile,uv:[region[0]>region[2]?16:0,region[1]>region[3]?16:0,region[0]>region[2]?0:16,region[1]>region[3]?0:16]};
      }
      elements.push({from:box.from.map(n=>n/16) as Vec3,to:box.to.map(n=>n/16) as Vec3,faces,transform:box.transform??[0,angle,0],rotation:box.rotation});
    }
    return elements;
  }
  async block(theme: string, state: State): Promise<number> {
    if(/(^|:)(air|cave_air|void_air|structure_void|barrier|light)$/.test(state.Name)) return 0;
    await this.init(theme);
    const key=`${theme}:${stateKey(state)}`;
    if(this.lookup[key]) return this.lookup[key];
    const name=state.Name.replace('minecraft:',''),data=blockData[name],defaults:Record<string,string>={};
    let index=data?data.defaultState-data.minStateId:0;
    for(const property of [...data?.states??[]].reverse()) {
      const value=index%property.num_values;index=Math.floor(index/property.num_values);
      defaults[property.name]=property.type==='bool'?(value===0?'true':'false'):String(property.values?.[value]??value);
    }
    const props={...defaults,...state.Properties};
    const blockstate=await this.packJson(theme,'blockstates',name);
    let variants:any[]=[];
    const matches=(when:any):boolean => !when || (when.OR ? when.OR.some(matches) : when.AND ? when.AND.every(matches) : Object.entries(when).every(([k,v])=>String(v).split('|').includes(props[k])));
    if(blockstate?.variants) {
      const match=Object.entries(blockstate.variants).find(([k])=>!k || k.split(',').every(pair=>{const [p,v]=pair.split('=');return v.split('|').includes(props[p]);}));
      if(match) variants.push(Array.isArray(match[1])?match[1][0]:match[1]);
    }
    for(const part of blockstate?.multipart??[]) if(matches(part.when)) variants.push(Array.isArray(part.apply)?part.apply[0]:part.apply);
    const fluid=name==='water'||name==='lava';
    if(fluid) variants=[];
    const elements:Element[]=[], rotation:Vec3=[0,0,0];
    for(const variant of variants) {
      const model=await this.model(theme,variant.model);
      if(!model?.elements) { this.unsupported.add(key);continue; }
      const resolveTexture=(value:string,depth=0):string => {
        if(depth>16) throw new Error(`Cyclic texture: ${key}`);
        return value?.startsWith('#')?resolveTexture(model.textures[value.slice(1)],depth+1):value;
      };
      for(const e of model.elements) {
        const element:Element={from:e.from.map((n:number)=>n/16),to:e.to.map((n:number)=>n/16),faces:{},transform:[variant.x??0,variant.y??0,0],uvlock:!!variant.uvlock};
        if(e.rotation) element.rotation={...e.rotation,origin:e.rotation.origin.map((n:number)=>n/16)};
        for(const [face,f] of Object.entries(e.faces) as [any,any][]) {
          const texture=resolveTexture(f.texture);
          if(!texture) {this.missing.add(key);continue;}
          element.faces[face as keyof Element['faces']]={tile:await this.tile(theme,texture),uv:f.uv??facesDefault(face,e.from,e.to),tint:f.tintindex>=0,cull:f.cullface,rotation:f.rotation};
        }
        elements.push(element);
      }
    }
    const fluidLevel=fluid?Number(props.level??0):props.waterlogged==='true'?0:undefined;
    if(fluidLevel!==undefined&&(!Number.isInteger(fluidLevel)||fluidLevel<0||fluidLevel>15))throw new Error(`Invalid fluid level: ${key}`);
    const fluidTiles=fluidLevel===undefined?undefined:await Promise.all([`${fluid?name:'water'}_still`,`${fluid?name:'water'}_flow`,...(name==='lava'?[]:['water_overlay'])].map(t=>this.tile(theme,t)));
    if(fluid) {
      const tile=fluidTiles![0];
      elements.push({from:[0,0,0],to:[1,1,1],faces:Object.fromEntries(FACES.map(f=>[f,{tile,uv:[0,0,16,16],tint:name==='water'}]))});
    }
    if(!elements.length) {elements.push(...await this.entityElements(theme,name,props));if(elements.length)this.unsupported.delete(key);else {this.unsupported.add(key);return 0;}}
    // Bake coincident cube layers (grass's tinted overlay) once into the atlas.
    // They can then use the same hidden-face/greedy path as other full blocks.
    if(elements.length>1 && elements.every(e=>!e.rotation && e.from.every(n=>n===0) && e.to.every(n=>n===1))) {
      const base=elements[0];
      for(const layer of elements.slice(1))for(const face of FACES) {
        const top=layer.faces[face],bottom=base.faces[face];if(!top||!bottom)continue;
        const color=theme==='mario'?[.54,.92,.28]:[.52,.76,.35];
        const tileKey=`${theme}:layer:${bottom.tile}:${top.tile}:${top.tint}`;
        let tile=this.tileCache.get(tileKey);
        if(tile===undefined) {
          const input=this.images[this.tiles[top.tile].start];
          const overlay=top.tint?await sharp(input).linear([...color,1],[0,0,0,0]).png().toBuffer():input;
          const image=await sharp(this.images[this.tiles[bottom.tile].start]).composite([{input:overlay}]).png().toBuffer();
          tile=this.tiles.length;this.tiles.push({start:this.images.length,frames:1});this.images.push(image);this.tileCache.set(tileKey,tile);
        }
        base.faces[face]={...bottom,tile,tint:false};
      }
      elements.splice(1);
    }
    let cube=elements.length===1 && !elements[0].rotation && elements[0].from.every(n=>n===0) && elements[0].to.every(n=>n===1) && FACES.every(f=>elements[0].faces[f]);
    if(fluid||rotation.some(n=>n%90!==0)) cube=false;
    const transparent=name==='water'||/glass/.test(name)||['ice','frosted_ice','slime_block','honey_block'].includes(name);
    const solid=!fluid && blockData[name]?.boundingBox!=='empty';
    const power=Number(props.power??0)/15;
    const foliage=/_leaves$|^vine$|grass|fern|lily_pad/.test(name);
    const tint=name==='redstone_wire'?[power*.6+(power>0?.4:.3),Math.max(0,power*power*.7-.5),Math.max(0,power*power*.6-.7)]:name==='water'?[.29,.55,.95]:foliage?(theme==='mario'?[.54,.92,.28]:[.52,.76,.35]):[1,1,1];
    const tiles=FACES.map(f=>elements[0].faces[f]?.tile??0),tinted=FACES.map(f=>!!elements[0].faces[f]?.tint);
    const uvRotations=FACES.map(f=>(elements[0].faces[f]?.rotation??0)/90);
    const transform=elements[0].transform??rotation;
    if(cube&&transform.some(Boolean)) {
      const dirs:Vec3[]=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      dirs.forEach((dir,face)=>{
        const normal=[...dir];
        for(const axis of [0,1,2]) {
          const a=(axis+1)%3,b=(axis+2)%3,c=Math.cos(-transform[axis]*Math.PI/180),s=Math.sin(-transform[axis]*Math.PI/180),u=normal[a],v=normal[b];
          normal[a]=Math.round(u*c-v*s);normal[b]=Math.round(u*s+v*c);
        }
        const target=dirs.findIndex(d=>d.every((n,i)=>n===normal[i]));
        tiles[target]=elements[0].faces[FACES[face]]!.tile;tinted[target]=!!elements[0].faces[FACES[face]]!.tint;
        const corner=[...faceCorners([0,0,0],[1,1,1],face)[0]];
        for(const axis of [0,1,2]){const a=(axis+1)%3,b=(axis+2)%3,c=Math.cos(-transform[axis]*Math.PI/180),s=Math.sin(-transform[axis]*Math.PI/180),u=corner[a]-.5,v=corner[b]-.5;corner[a]=.5+u*c-v*s;corner[b]=.5+u*s+v*c;}
        const offset=elements[0].uvlock?0:faceCorners([0,0,0],[1,1,1],target).findIndex(p=>p.every((n,i)=>Math.abs(n-corner[i])<1e-6));
        uvRotations[target]=((elements[0].faces[FACES[face]]!.rotation??0)/90+offset)%4;
      });
    }
    const light=props.lit==='false'?0:props.lit==='true'&&name==='redstone_lamp'?15:props.lit==='true'&&/furnace$|^smoker$/.test(name)?13:data?.emitLight??0;
    const emissive=/glowstone|sea_lantern|jack_o_lantern|lava|fire/.test(name)?1:0;
    let collision=solid?elements.filter(e=>e.from.every((n,i)=>n<e.to[i])).map(e=>{
      const mesh=emptyMesh();appendElement(mesh,e,[0,0,0],{rotation,tint,emissive} as Block);
      return {from:[0,1,2].map(i=>Math.min(...mesh.position.filter((_,n)=>n%3===i))) as Vec3,to:[0,1,2].map(i=>Math.max(...mesh.position.filter((_,n)=>n%3===i))) as Vec3};
    }):[];
    let stateIndex=0;
    for(const property of data?.states??[]) {const value=property.type==='bool'?(props[property.name]==='true'?0:1):property.values?property.values.indexOf(props[property.name]):Number(props[property.name]);stateIndex=stateIndex*property.num_values+value;}
    const shapes=nativeData.blockCollisionShapes,shapeIds=shapes.blocks[name],shape=shapes.shapes[Array.isArray(shapeIds)?shapeIds[stateIndex]:shapeIds]??[];
    const nativeBoxes=shape.map((b:number[])=>({from:b.slice(0,3) as Vec3,to:b.slice(3,6) as Vec3}));
    // Fences block jumping with 1.5-high boxes; render rails stay at their model height.
    if(/_fence$|_fence_gate$/.test(name))collision=nativeBoxes;
    const sturdyFaces=FACES.reduce((bits,_,i)=>bits|(coversFace(nativeBoxes,i)?1<<i:0),0);
    const block:Block={name,theme,solid,cube,occludes:cube&&solid&&!transparent&&!data?.transparent,transparent,fluid,fluidLevel,fluidTiles,sturdyFaces,emissive,tiles,uvRotations,tinted,tint,elements,rotation,collision,opacity:cube||fluid?(data?.filterLight??0):props.waterlogged==='true'?1:0,light,state:stateKey({Name:state.Name,Properties:props})};
    const id=this.blocks.length;if(id>=65536)throw new Error('Block palette exceeds 16-bit voxel storage');this.blocks.push(block);this.lookup[key]=id;
    this.lookup[`${theme}:${block.state}`]=id;
    if(/door$/.test(name))await this.block(theme,{Name:state.Name,Properties:{...props,open:props.open==='true'?'false':'true'}});
    return id;
  }
  async connectFences(voxels:Voxels):Promise<number> {
    const fences=new Set(this.blocks.map((b,i)=>b?.name.endsWith('_fence')?i:0));fences.delete(0);
    let changed=0;
    for(const [key,cells] of voxels.chunks) {
      const [cx,cy,cz]=key.split(',').map(n=>Number(n)*16);
      for(let i=0;i<4096;i++)if(fences.has(cells[i])) {
        const block=this.blocks[cells[i]],p:Vec3=[cx+(i&15),cy+(i>>8),cz+((i>>4)&15)];
        const props=Object.fromEntries((block.state.split('[')[1]??'').replace(']','').split(',').filter(Boolean).map(s=>s.split('=')));
        for(const [direction,dx,dz,face] of [['east',1,0,0],['west',-1,0,1],['south',0,1,4],['north',0,-1,5]] as const) {
          const neighbor=this.blocks[voxels.get(p[0]+dx,p[1],p[2]+dz)],name=neighbor?.name??'';
          const same=name.endsWith('_fence')&&(name==='nether_brick_fence')===(block.name==='nether_brick_fence');
          const gate=name.endsWith('_fence_gate')&&(dx!==0?/facing=(north|south)/.test(neighbor.state):/facing=(east|west)/.test(neighbor.state));
          const exception=/_leaves$|shulker_box$/.test(name)||['barrier','pumpkin','carved_pumpkin','jack_o_lantern','melon'].includes(name);
          props[direction]=String(same||gate||!exception&&!!((neighbor?.sturdyFaces??0)&(1<<(face^1))));
        }
        const state={Name:`minecraft:${block.name}`,Properties:props};
        if(stateKey(state)===block.state)continue;
        cells[i]=await this.block(block.theme,state);changed++;
      }
    }
    return changed;
  }
  async atlas(path:string) {
    // Power-of-two cells with a full gutter keep each mip level inside its own tile.
    const cell=64, pixels=32, size=2**Math.ceil(Math.log2(Math.ceil(Math.sqrt(this.images.length))*cell));
    if(size>8192)throw new Error(`Atlas exceeds supported texture size: ${size}`);
    const columns=Math.floor(size/cell);
    await sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(this.images.map((input,i)=>({input,left:(i%columns)*cell,top:Math.floor(i/columns)*cell}))).png().toFile(path);
    return {size,cell,pixels,tiles:this.tiles};
  }
}
