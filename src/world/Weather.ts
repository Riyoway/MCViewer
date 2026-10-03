import { Group,Mesh,MeshBasicMaterial,BufferGeometry,Float32BufferAttribute,TextureLoader,NearestFilter,RepeatWrapping,SRGBColorSpace,DoubleSide,Vector3,Texture,Points,PointsMaterial,AdditiveBlending } from 'three';
import { assetUrl,AssetManager } from '../core/AssetManager';
import type { World } from '../minecraft/WorldLoader';
import { Climate,precipitation,type WeatherAssets,type ClimateData,type Precipitation } from './Climate';

export type WeatherMode='clear'|'rain'|'thunder'|'snow';
const modes:WeatherMode[]=['clear','rain','thunder','snow'];
async function readJSON<T>(file:string,signal?:AbortSignal):Promise<T>{
  const response=await fetch(assetUrl(file),{signal});if(!response.ok)throw new Error(`天候データを読み込めません: ${file}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const body=bytes[0]===31&&bytes[1]===139?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):new Blob([bytes]).stream();
  return new Response(body).json();
}
function precipitationMesh(){
  const geometry=new BufferGeometry();for(const [name,size] of [['position',3],['uv',2],['color',4]] as const)geometry.setAttribute(name,new Float32BufferAttribute(new Float32Array(21*21*6*size),size));
  geometry.setDrawRange(0,0);
  const mesh=new Mesh(geometry,new MeshBasicMaterial({transparent:true,depthWrite:false,side:DoubleSide,vertexColors:true,alphaTest:.01}));mesh.frustumCulled=false;return mesh;
}
export class Weather {
  readonly root=new Group();readonly rain=precipitationMesh();readonly snow=precipitationMesh();
  mode:WeatherMode='clear';intensity=1;cycle=false;minutes=10;
  rainLevel=0;thunderLevel=0;flash=0;rainVolume=0;sheltered=false;
  private elapsed=0;private cycleTime=0;private lightningTime=8;private thunderDelay=-1;private thunderEvents=0;
  private precipitationMode:WeatherMode='rain';
  private textures=new Map<string,Texture>();private climate?:Climate;private selection=0;
  private climateRequest?:AbortController;
  private bolt=new Mesh(new BufferGeometry(),new MeshBasicMaterial({color:0xf0d8ff,transparent:true,blending:AdditiveBlending,depthWrite:false,fog:false}));
  private splashes=new Points(new BufferGeometry(),new PointsMaterial({color:0xadc1d5,size:.06,transparent:true,opacity:.65,depthWrite:false}));
  private rainColumns=0;private snowColumns=0;
  constructor(readonly assets:AssetManager,readonly data:WeatherAssets,private random= Math.random){
    this.root.add(this.rain,this.snow,this.bolt,this.splashes);this.bolt.visible=false;this.splashes.geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(48*3),3));this.splashes.frustumCulled=false;
  }
  static async create(assets:AssetManager){
    const data=await readJSON<WeatherAssets>('weather/assets.json'),weather=new Weather(assets,data),loader=new TextureLoader();
    for(const file of new Set(Object.values(data.worlds).flatMap(w=>[w.rain,w.snow]))){const texture=await loader.loadAsync(assetUrl(file));texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.wrapS=texture.wrapT=RepeatWrapping;texture.colorSpace=SRGBColorSpace;weather.textures.set(file,texture);}
    return weather;
  }
  async select(name:string){
    this.climateRequest?.abort();this.climateRequest=new AbortController();
    const token=++this.selection,world=this.data.worlds[name];this.climate=undefined;this.rainVolume=0;this.flash=0;this.bolt.visible=false;this.thunderDelay=-1;this.thunderEvents=0;this.lightningTime=8+this.random()*12;
    this.rain.geometry.setDrawRange(0,0);this.snow.geometry.setDrawRange(0,0);
    if(!world)throw new Error(`天候データがありません: ${name}`);
    for(const type of ['rain','snow'] as const){this[type].material.map=this.textures.get(world[type])!;this[type].material.needsUpdate=true;}
    const data=await readJSON<ClimateData>(world.climate,this.climateRequest.signal);if(token===this.selection)this.climate=new Climate(data);
  }
  setMode(mode:WeatherMode){if(this.mode===mode)return;this.mode=modes.includes(mode)?mode:'clear';if(this.mode!=='clear')this.precipitationMode=this.mode;this.cycleTime=0;if(this.mode!=='thunder'){this.flash=0;this.bolt.visible=false;this.thunderDelay=-1;this.thunderEvents=0;}}
  kind(x:number,y:number,z:number):Precipitation{return this.mode==='clear'&&this.rainLevel<.001?'none':this.precipitationMode==='snow'?'snow':precipitation(this.climate?.at(x,y,z),y);}
  update(dt:number,eye:Vector3,world:World,playing:boolean){
    this.elapsed+=dt;
    if(this.cycle&&playing&&(this.cycleTime+=dt)>=this.minutes*60){this.cycleTime=0;this.setMode(this.mode==='clear'?(this.random()<.2?'thunder':'rain'):'clear');}
    const target=this.mode==='clear'?0:this.intensity,approach=(value:number,to:number)=>value+Math.max(-dt*.25,Math.min(dt*.25,to-value));
    this.rainLevel=approach(this.rainLevel,target);this.thunderLevel=approach(this.thunderLevel,this.mode==='thunder'?this.intensity:0);
    this.flash=Math.max(0,this.flash-dt*3);this.bolt.visible=this.flash>0;
    if(playing&&this.mode==='thunder'&&this.thunderLevel>.5){this.lightningTime-=dt;if(this.lightningTime<=0){this.strike(eye,world);this.lightningTime=20+this.random()*50;}}
    if(playing&&this.thunderDelay>=0){this.thunderDelay-=dt;if(this.thunderDelay<0)this.thunderEvents++;}
    this.rainColumns=0;this.snowColumns=0;const counts={rain:0,snow:0},cx=Math.floor(eye.x),cz=Math.floor(eye.z),splashes:number[]=[];
    let wet=0,near=0;
    for(let dz=-10;dz<=10;dz++)for(let dx=-10;dx<=10;dx++){
      const x=cx+dx,z=cz+dz,surface=world.precipitationSurface(x,z);if(surface===null)continue;
      // Roof height also excludes precipitation in caves and through glass ceilings.
      const bottom=Math.max(surface,eye.y-10),top=eye.y+10;if(bottom>=top)continue;
      const kind=this.kind(x,Math.max(surface,eye.y),z);if(kind==='none')continue;
      if(Math.abs(dx)<=3&&Math.abs(dz)<=3){near++;if(kind==='rain')wet++;}
      if(this.rainLevel<.001)continue;
      const radius=Math.hypot(dx,dz),fade=Math.max(0,1-radius*radius/200),hash=((Math.imul(x,3121)^Math.imul(z,418711))>>>0)/4294967296;
      let vx=z+.5-eye.z,vz=eye.x-x-.5,len=Math.hypot(vx,vz);if(len<.01){vx=1;vz=0;len=1;}vx/=len;vz/=len;
      const mesh=this[kind],geometry=mesh.geometry,position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),color=geometry.getAttribute('color'),column=counts[kind]++;
      const phase=kind==='rain'?this.elapsed*3+hash*16:this.elapsed*.15+hash*16;
      const drift=kind==='snow'?Math.sin(this.elapsed*.4+hash*6)*.2:0;
      const level=world.light(x,Math.floor(Math.max(surface,eye.y)),z),brightness=Math.max(.25,(level>>4)/15*this.assets.daylight.value,(level&15)/15*.8);
      const coords=[[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]];
      for(let i=0;i<6;i++){const [u,v]=coords[i],n=column*6+i;position.setXYZ(n,x+.5+vx*(u-.5)+drift,v?top:bottom,z+.5+vz*(u-.5));uv.setXY(n,u+drift,(v?top:bottom)/4+phase);color.setXYZW(n,brightness,brightness,brightness,fade);}
      if(kind==='rain'&&surface>eye.y-8&&surface<eye.y+1&&splashes.length<48*3&&hash>.85){const t=(this.elapsed*3+hash)%1;splashes.push(x+.5+(hash-.5)*.6,surface+.015+Math.sin(t*Math.PI)*.12,z+.5+Math.cos(t*6)*.08);}
    }
    for(const kind of ['rain','snow'] as const){const mesh=this[kind];mesh.material.opacity=this.rainLevel*(kind==='rain'?.6:.9);mesh.geometry.setDrawRange(0,counts[kind]*6);for(const name of ['position','uv','color'])mesh.geometry.getAttribute(name).needsUpdate=true;mesh.visible=counts[kind]>0&&this.rainLevel>.001;}
    this.rainColumns=counts.rain;this.snowColumns=counts.snow;
    const splashPosition=this.splashes.geometry.getAttribute('position');splashes.forEach((v,i)=>splashPosition.array[i]=v);splashPosition.needsUpdate=true;this.splashes.geometry.setDrawRange(0,splashes.length/3);this.splashes.material.opacity=this.rainLevel*.65;
    const roof=world.precipitationSurface(eye.x,eye.z);this.sheltered=roof!==null&&roof>eye.y;this.rainVolume=playing?this.rainLevel*(near?wet/near:0)*(this.sheltered?.25:1):0;
  }
  strike(eye:Vector3,world:World){
    const angle=this.random()*Math.PI*2,distance=24+this.random()*40,x=Math.floor(eye.x+Math.cos(angle)*distance),z=Math.floor(eye.z+Math.sin(angle)*distance),surface=world.precipitationSurface(x,z);
    if(surface===null||this.kind(x,surface,z)!=='rain')return;
    const positions:number[]=[];let previous=new Vector3(x+.5,surface,z+.5);
    for(let i=1;i<=8;i++){const next=new Vector3(x+.5+(this.random()-.5)*4,surface+i*8,z+.5+(this.random()-.5)*4);for(const axis of [new Vector3(.13,0,0),new Vector3(0,0,.13)])for(const p of [previous.clone().sub(axis),previous.clone().add(axis),next.clone().sub(axis),previous.clone().add(axis),next.clone().add(axis),next.clone().sub(axis)])positions.push(...p.toArray());previous=next;}
    this.bolt.geometry.dispose();this.bolt.geometry=new BufferGeometry();this.bolt.geometry.setAttribute('position',new Float32BufferAttribute(positions,3));this.flash=1;this.bolt.visible=true;this.thunderDelay=distance/80;
  }
  consumeThunder(){const count=this.thunderEvents;this.thunderEvents=0;return count;}
  get stats(){return {rainColumns:this.rainColumns,snowColumns:this.snowColumns,sheltered:this.sheltered,rainVolume:this.rainVolume};}
}
