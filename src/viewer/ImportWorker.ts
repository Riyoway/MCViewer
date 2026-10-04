import {unzipSync} from 'fflate';
import {readNbt,regionChunks,unpackStates} from './Nbt';
import {safePath} from './WorldStore';
import {Voxels,encodeColumn} from '../minecraft/Voxels';
import {meshChunk,emptyMesh} from '../minecraft/Mesher';
import {encodeMeshes} from '../minecraft/binary';
import {properties,stateId} from '../minecraft/BlockState';
import {Building} from '../minecraft/Building';
import {editLighting} from '../minecraft/EditLighting';
import type {Manifest,WorldManifest,Vec3,Block,MeshData} from '../minecraft/types';
import type {ClimateData,BiomeClimate} from '../world/Climate';
import type {ImportResult} from './ImportWorld';

let manifest:Manifest,voxels=new Voxels(),lights=new Voxels(),columns=new Map<string,Vec3[]>();
let lightMin=0,lightMax=256;const needsLighting=new Set<string>(),readyLighting=new Set<string>();
const scope=self as unknown as {postMessage:(data:unknown,transfer?:Transferable[])=>void;onmessage:(event:MessageEvent)=>void};
function canonical(name:string,props:Record<string,string>={}){return name.replace(/^minecraft:/,'')+(Object.keys(props).length?'['+Object.entries(props).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(',')+']':'');}
async function load(data:any):Promise<ImportResult>{
  voxels=new Voxels();lights=new Voxels();columns=new Map();needsLighting.clear();readyLighting.clear();manifest=data.manifest;
  const files:Record<string,Uint8Array>=Object.create(null),decoder=new TextDecoder(),warnings=new Set<string>();
  for(const file of data.files){const bytes=new Uint8Array(file.bytes);if(/\.zip$/i.test(file.name)){scope.postMessage({progress:'ワールドを展開しています…'});for(const [name,value] of Object.entries(unzipSync(bytes,{filter:f=>/level\.dat$|\.mca$|icon\.png$/.test(f.name)})))files[safePath(name)]=value;}else files[safePath(file.name)]=bytes;}
  const levelPath=Object.keys(files).find(n=>/(^|\/)level\.dat$/.test(n));if(!levelPath)throw new Error('level.dat がありません。Java版ワールドのZIPまたはフォルダーを選択してください');
  const base=levelPath.slice(0,-9),level=readNbt(files[levelPath]).Data;
  if(!level)throw new Error('level.dat のDataがありません');
  const regions=Object.keys(files).filter(n=>n.startsWith(base)&&/^region\/r\.-?\d+\.-?\d+\.mca$/.test(n.slice(base.length)));
  if(!regions.length)throw new Error('Overworldの region/*.mca がありません');
  const byName=new Map<string,number[]>();for(const [id,b] of manifest.blocks.entries())if(b?.theme==='vanilla'){const ids=byName.get(b.name)??[];ids.push(id);byName.set(b.name,ids);}
  const stateCache=new Map<string,number>(),originalStates=new Map<string,{Name:string;Properties?:Record<string,string>}>();
  function resolve(state:{Name:string;Properties?:Record<string,string>}):number {
    if(/^(minecraft:)?(air|cave_air|void_air)$/.test(state.Name))return 0;
    const key=canonical(state.Name,state.Properties),cached=stateCache.get(key);if(cached!==undefined)return cached;
    let id=manifest.lookup['vanilla:'+key];if(!id){const name=state.Name.replace(/^minecraft:/,''),ids=byName.get(name)??[];let best=-Infinity;
      for(const candidate of ids){const props=properties(manifest.blocks[candidate]);let score=0;for(const [k,v] of Object.entries(state.Properties??{}))score+=props[k]===v?(['facing','half','axis','shape','type','part','hinge','open','level'].includes(k)?8:2):props[k]===undefined?0:-4;if(score>best){best=score;id=candidate;}}
      if(!id){warnings.add(`未対応ブロック: ${name}`);id=manifest.lookup['vanilla:stone']??byName.get('stone')?.[0]??0;}
      else if(Object.entries(state.Properties??{}).some(([k,v])=>properties(manifest.blocks[id])[k]!==v))warnings.add(`一部の状態を近似: ${name}`);
    }
    stateCache.set(key,id);return id;
  }
  const climate:ClimateData={biomes:[],columns:{}},biomeIds=new Map<string,number>();
  const biome=(name:string|number,old=false)=>{const values=old?data.reference.oldBiomes:data.reference.biomes,b=typeof name==='number'?values.find((v:any)=>v.id===name):values.find((v:any)=>v.name===name.replace(/^minecraft:/,''));const record:BiomeClimate=b?{name:b.name,temperature:b.temperature,precipitation:b.precipitation}:{name:String(name),temperature:.8,precipitation:'rain'};let id=biomeIds.get(record.name);if(id===undefined){id=climate.biomes.length;if(id>=256)id=0;else{biomeIds.set(record.name,id);climate.biomes.push(record);}}return id;};
  const encoded=(values:Uint8Array)=>btoa(String.fromCharCode(...values));let count=0,blocks=0,minY=0,maxY=256,minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  const missingLight=new Set<string>();
  const dimension=level.WorldGenSettings?.dimensions?.['minecraft:overworld']?.type;
  if((level.DataVersion??0)>=2825){minY=-64;maxY=320;}
  if(typeof dimension==='object'&&Number.isInteger(dimension.min_y)&&Number.isInteger(dimension.height)){minY=dimension.min_y;maxY=minY+dimension.height;}
  for(const [rIndex,path] of regions.entries()){
    scope.postMessage({progress:`チャンクを読み込み中… ${rIndex+1} / ${regions.length}`});
    for(const nbt of regionChunks(files[path],path)){
      const root=nbt.Level??nbt,version=nbt.DataVersion??root.DataVersion??0,cx=root.xPos,cz=root.zPos;if(!Number.isInteger(cx)||!Number.isInteger(cz))continue;
      const columnKey=`${cx},${cz}`,origins:Vec3[]=[],climateColumn:ClimateData['columns'][string]={sections:{}};
      if(root.isLightOn===0||root.LightPopulated===0)missingLight.add(columnKey);
      if(root.Biomes?.length===256)climateColumn.legacy=encoded(Uint8Array.from(root.Biomes,(n:number)=>biome(n,true)));
      if(root.Biomes?.length===1024)for(let cy=0;cy<16;cy++)climateColumn.sections![cy]=encoded(Uint8Array.from(root.Biomes.slice(cy*64,cy*64+64),(n:number)=>biome(n,version<2529)));
      for(const section of root.sections??root.Sections??[]){const cy=section.Y;if(!Number.isInteger(cy)||cy*16>=maxY||(cy+1)*16<=minY)continue;const key=`${cx},${cy},${cz}`,cells=new Uint16Array(4096),light=new Uint16Array(4096),palette=section.block_states?.palette??section.Palette;
        if(palette){const states=palette.map(resolve),indices=unpackStates(section.block_states?.data??section.BlockStates??[],palette.length,version>=2529);for(let i=0;i<4096;i++)cells[i]=states[indices[i]];}
        else if(section.Blocks){for(let i=0;i<4096;i++){const id=section.Blocks[i]+(((section.Add?.[i>>1]??0)>>(i%2*4)&15)<<8),meta=(section.Data?.[i>>1]??0)>>(i%2*4)&15,state=data.reference.legacy[`${id}:${meta}`]??data.reference.legacy[`${id}:0`];if(id&&!state){warnings.add(`未対応の旧ブロックID: ${id}`);continue;}if(state){cells[i]=resolve(state);if(/_door$/.test(state.Name))originalStates.set(`${cx*16+(i&15)},${cy*16+(i>>8)},${cz*16+(i>>4&15)}`,state);}}}
        else if(!section.SkyLight&&!section.BlockLight)continue;
        for(let i=0;i<4096;i++){light[i]=((section.SkyLight?.[i>>1]??0)>>(i%2*4)&15)*16+((section.BlockLight?.[i>>1]??0)>>(i%2*4)&15);if(cells[i])blocks++;}
        // In a lit save, absent light arrays mean zero (e.g. air below bedrock).
        if(!section.SkyLight&&root.isLightOn!==1&&root.LightPopulated!==1)missingLight.add(columnKey);
        voxels.chunks.set(key,cells);lights.chunks.set(key,light);origins.push([cx*16,cy*16,cz*16]);minY=Math.min(minY,cy*16);maxY=Math.max(maxY,(cy+1)*16);
        const biomes=section.biomes;if(biomes?.palette){const indices=unpackStates(biomes.data??[],biomes.palette.length,true,64,1);climateColumn.sections![cy]=encoded(Uint8Array.from(indices,n=>biome(biomes.palette[n])));}
      }
      if(!origins.length)continue;count++;columns.set(columnKey,origins);minX=Math.min(minX,cx*16);minZ=Math.min(minZ,cz*16);maxX=Math.max(maxX,(cx+1)*16);maxZ=Math.max(maxZ,(cz+1)*16);
      if(climateColumn.legacy===undefined&&!Object.keys(climateColumn.sections!).length)climateColumn.legacy=biome('plains');climate.columns[columnKey]=climateColumn;
    }
  }
  if(!count)throw new Error('保存された地形がありません');
  for(const [key,state] of originalStates){if(state.Properties?.half!=='lower')continue;const p=key.split(',').map(Number) as Vec3,upper=originalStates.get(`${p[0]},${p[1]+1},${p[2]}`);if(!upper)continue;
    const props={...state.Properties,hinge:upper.Properties?.hinge??'left',powered:upper.Properties?.powered??'false'};for(const half of ['lower','upper'])voxels.set(p[0],p[1]+Number(half==='upper'),p[2],resolve({Name:state.Name,Properties:{...props,half}}));}
  // Legacy saves do not store fence connections; restore the same local rules as placement.
  const building=new Building(voxels,manifest,'vanilla',()=>true);
  for(const [key,cells] of voxels.chunks){const [cx,cy,cz]=key.split(',').map(Number);for(let i=0;i<4096;i++)if(/_fence$|_pane$|_wall$/.test(manifest.blocks[cells[i]]?.name??'')){const p:Vec3=[cx*16+(i&15),cy*16+(i>>8),cz*16+(i>>4&15)];for(const change of building.neighbors(p))voxels.set(...change.position,change.id);}}
  lightMin=minY;lightMax=maxY;for(const key of missingLight)needsLighting.add(key);
  const spawn=level.spawn?.pos??[level.SpawnX??0,level.SpawnY??64,level.SpawnZ??0];let position=Array.from(spawn,Number) as Vec3;
  if(!columns.has(`${Math.floor(position[0]/16)},${Math.floor(position[2]/16)}`)){const first=columns.values().next().value![0];position=[first[0]+8,maxY,first[2]+8];for(let y=maxY-1;y>=minY;y--)if(manifest.blocks[voxels.get(position[0],y,position[2])]?.solid){position[1]=y+1;break;}}
  const world:WorldManifest={name:data.name||level.LevelName||'ワールド',source:'local',checksum:'local',theme:'vanilla',bounds:{min:[minX,minY,minZ],max:[maxX,maxY,maxZ]},spawn:position,yaw:level.spawn?.yaw??level.SpawnAngle??0,blocks,quads:0,triangles:0,unsupported:[...warnings],chunks:[...columns.values()].map(origins=>({origin:[origins[0][0],0,origins[0][2]],file:'',voxels:'',quads:0}))};
  return {manifest:world,climate,version:level.Version?.Name??(level.DataVersion?`DataVersion ${level.DataVersion}`:'1.12以前'),warnings:[...warnings],icon:files[base+'icon.png']?.slice().buffer};
}
function append(target:MeshData,source:MeshData){const offset=target.position.length/3;for(const key of ['position','normal','uv','tile','color','glow','light'] as const)for(const v of source[key])target[key].push(v);for(const n of source.index)target.index.push(n+offset);}
function column(origin:Vec3){const origins=columns.get(`${origin[0]/16},${origin[2]/16}`)??[],result={opaque:emptyMesh(),transparent:emptyMesh()},light=(x:number,y:number,z:number)=>lights.chunks.has(`${x>>4},${y>>4},${z>>4}`)?lights.get(x,y,z):240;
  const key=`${origin[0]/16},${origin[2]/16}`;if(needsLighting.has(key)&&!readyLighting.has(key)){
    // Rebuild only the requested column and a 24-block margin. The GUI stays on
    // the main thread; saved light in valid chunks is otherwise left untouched.
    editLighting(voxels,manifest.blocks,lights,[[origin[0]-8,lightMax-1,origin[2]-8],[origin[0]+24,lightMax-1,origin[2]+24]],lightMax,(x,z)=>columns.has(`${x>>4},${z>>4}`),light,lightMin);readyLighting.add(key);
  }
  for(const p of origins){const mesh=meshChunk(voxels,manifest.blocks,p,light,true);append(result.opaque,mesh.opaque);append(result.transparent,mesh.transparent);}
  return {meshBuffer:encodeMeshes(result),voxelBuffer:encodeColumn(voxels,origins,light)};
}
scope.onmessage=async event=>{const {id,type,data}=event.data;try{const result=type==='load'?await load(data):column(data.origin);scope.postMessage({id,result},type==='column'?[(result as ReturnType<typeof column>).meshBuffer,(result as ReturnType<typeof column>).voxelBuffer]:[]);}catch(error){scope.postMessage({id,error:error instanceof Error?error.message:String(error)});}};
