import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, ShaderMaterial, BackSide, Color, Vector3, TextureLoader, NearestFilter, SRGBColorSpace, RepeatWrapping, Points, BufferGeometry, Float32BufferAttribute, PointsMaterial, Fog, AdditiveBlending, Texture } from 'three';
import { assetUrl, AssetManager } from '../core/AssetManager';

export class Sky {
  readonly root=new Group();time=6000;cycle=true;minutes=20;clouds=true;
  private sun!:Mesh;private moon!:Mesh;private cloud!:Mesh;private stars:Points;
  private sphere:Mesh;
  environment:AssetManager['manifest']['worlds'][string]['environment'];
  private textures=new Map<string,Texture>();
  private daylight=1;private horizon=new Color();private day=new Color('#8ebaff');private night=new Color('#060b19');private dusk=new Color('#dd9872');
  constructor(readonly assets:AssetManager) {
    const material=new ShaderMaterial({side:BackSide,depthWrite:false,fog:false,uniforms:{top:{value:new Color()},bottom:{value:new Color()}},vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying vec3 direction;void main(){float y=normalize(direction).y;gl_FragColor=vec4(mix(bottom,top,smoothstep(-.05,.65,y)),1.0);\n#include <colorspace_fragment>\n}'});
    this.sphere=new Mesh(new SphereGeometry(290,24,16),material);this.sphere.renderOrder=-2;this.root.add(this.sphere);
    let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},positions:number[]=[];
    for(let i=0;i<1100;i++){const v=new Vector3(random()*2-1,random()*2-1,random()*2-1).normalize().multiplyScalar(270);positions.push(...v.toArray());}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    this.stars=new Points(geometry,new PointsMaterial({color:0xffffff,size:1.2,sizeAttenuation:false,transparent:true,depthWrite:false,fog:false}));this.root.add(this.stars);
  }
  async load() {
    const loader=new TextureLoader();
    const files=new Set(['sun.png','moon.png','clouds.png',...Object.values(this.assets.manifest.worlds).flatMap(w=>w.environment?[w.environment.sun,w.environment.moon,w.environment.clouds]:[])]);
    await Promise.all([...files].map(async file=>{const texture=await loader.loadAsync(assetUrl(file));texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.colorSpace=SRGBColorSpace;this.textures.set(file,texture);}));
    const [sun,moon,clouds]=['sun.png','moon.png','clouds.png'].map(file=>this.textures.get(file)!);
    for(const texture of [sun,moon,clouds]){texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.colorSpace=SRGBColorSpace;}
    moon.repeat.set(.25,.5);moon.offset.set(0,.5);
    this.sun=new Mesh(new PlaneGeometry(150,150),new MeshBasicMaterial({map:sun,transparent:true,blending:AdditiveBlending,depthWrite:false,fog:false}));
    this.moon=new Mesh(new PlaneGeometry(100,100),new MeshBasicMaterial({map:moon,transparent:true,blending:AdditiveBlending,depthWrite:false,fog:false}));this.root.add(this.sun,this.moon);
    clouds.wrapS=clouds.wrapT=RepeatWrapping;clouds.repeat.set(.33,.33);
    this.cloud=new Mesh(new PlaneGeometry(1000,1000),new MeshBasicMaterial({map:clouds,transparent:true,alphaTest:.5,side:2,fog:true,depthWrite:true}));this.cloud.rotation.x=-Math.PI/2;this.root.add(this.cloud);
  }
  select(name:string){
    this.environment=this.assets.manifest.worlds[name]?.environment;
    for(const [mesh,key,fallback] of [[this.sun,'sun','sun.png'],[this.moon,'moon','moon.png'],[this.cloud,'clouds','clouds.png']] as const){
      const texture=this.textures.get(this.environment?.[key]??fallback)!;
      if(key==='moon'){texture.repeat.set(.25,.5);texture.offset.set(0,.5);}
      if(key==='clouds'){texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(.33,.33);}
      (mesh.material as MeshBasicMaterial).map=texture;
    }
  }
  update(dt:number,eye:Vector3,fog:Fog,legacy:boolean,distance:number,weather={rainLevel:0,thunderLevel:0,flash:0}) {
    if(this.cycle)this.time=(this.time+dt*24000/(this.minutes*60))%24000;
    const angle=this.time/24000*Math.PI*2,elevation=Math.sin(angle),day=Math.max(0,Math.min(1,(elevation+.15)/.35)),rain=weather.rainLevel,thunder=weather.thunderLevel;this.daylight=Math.min(1,.08+.92*day*(1-rain*.5)*(1-thunder*.5)+weather.flash*.6);
    this.assets.daylight.value=this.daylight;
    this.root.position.copy(eye);
    const sunrise=Math.pow(1-Math.min(1,Math.abs(elevation)/.22),2),top=this.night.clone().lerp(this.environment?.sky_color?new Color(this.environment.sky_color):this.day,day);
    this.horizon.copy(this.night).lerp(new Color(this.environment?.fog_color??(legacy?'#bbd0dd':'#c0d9ff')),day).lerp(this.dusk,sunrise*.7);
    for(const color of [top,this.horizon]){const grey=color.r*.3+color.g*.59+color.b*.11;color.lerp(new Color().setRGB(grey*.6,grey*.6,grey*.6),rain*.75).multiplyScalar(1-thunder*.35).lerp(new Color('#d4d9ff'),weather.flash*.55);}
    const uniforms=(this.sphere.material as ShaderMaterial).uniforms;uniforms.top.value.copy(top);uniforms.bottom.value.copy(this.horizon);
    fog.color.copy(this.horizon);fog.near=distance*(legacy?.35:.6)*(1-rain*.45);fog.far=distance*(1-rain*.2);
    (this.stars.material as PointsMaterial).opacity=(1-day)*.9*(1-rain);this.stars.rotation.z=angle;
    if(this.sun){(this.sun.material as MeshBasicMaterial).opacity=1-rain;(this.moon.material as MeshBasicMaterial).opacity=1-rain;this.sun.position.set(Math.cos(angle)*250,elevation*250,0);this.sun.quaternion.setFromUnitVectors(new Vector3(0,0,1),this.sun.position.clone().normalize().negate());this.moon.position.copy(this.sun.position).negate();this.moon.quaternion.setFromUnitVectors(new Vector3(0,0,1),this.moon.position.clone().normalize().negate());}
    if(this.cloud){this.cloud.visible=this.clouds;this.cloud.position.set(-eye.x%128+this.assets.time.value*.3,128-eye.y,-eye.z%128);(this.cloud.material as MeshBasicMaterial).color.setScalar((.25+.75*day)*(1-rain*.35)*(1-thunder*.35)+weather.flash*.3);}
  }
  get brightness(){return this.daylight;}
}
