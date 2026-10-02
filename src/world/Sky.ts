import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, ShaderMaterial, BackSide, Color, Vector3, TextureLoader, NearestFilter, SRGBColorSpace, RepeatWrapping, Points, BufferGeometry, Float32BufferAttribute, PointsMaterial, Fog } from 'three';
import { assetUrl, AssetManager } from '../core/AssetManager';

export class Sky {
  readonly root=new Group();time=6000;cycle=true;minutes=20;clouds=true;
  private sun!:Mesh;private moon!:Mesh;private cloud!:Mesh;private stars:Points;
  private sphere:Mesh;
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
    const loader=new TextureLoader(),[sun,moon,clouds]=await Promise.all(['sun.png','moon.png','clouds.png'].map(file=>loader.loadAsync(assetUrl(file))));
    for(const texture of [sun,moon,clouds]){texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.colorSpace=SRGBColorSpace;}
    moon.repeat.set(.25,.5);moon.offset.set(0,.5);
    this.sun=new Mesh(new PlaneGeometry(28,28),new MeshBasicMaterial({map:sun,transparent:true,depthWrite:false,fog:false}));
    this.moon=new Mesh(new PlaneGeometry(24,24),new MeshBasicMaterial({map:moon,transparent:true,depthWrite:false,fog:false}));this.root.add(this.sun,this.moon);
    clouds.wrapS=clouds.wrapT=RepeatWrapping;clouds.repeat.set(.33,.33);
    this.cloud=new Mesh(new PlaneGeometry(1000,1000),new MeshBasicMaterial({map:clouds,transparent:true,alphaTest:.5,side:2,fog:true,depthWrite:true}));this.cloud.rotation.x=-Math.PI/2;this.root.add(this.cloud);
  }
  update(dt:number,eye:Vector3,fog:Fog,legacy:boolean,distance:number) {
    if(this.cycle)this.time=(this.time+dt*24000/(this.minutes*60))%24000;
    const angle=this.time/24000*Math.PI*2,elevation=Math.sin(angle),day=Math.max(0,Math.min(1,(elevation+.15)/.35));this.daylight=.08+.92*day;
    this.assets.daylight.value=this.daylight;
    this.root.position.copy(eye);
    const sunrise=Math.pow(1-Math.min(1,Math.abs(elevation)/.22),2),top=this.night.clone().lerp(this.day,day);
    this.horizon.copy(this.night).lerp(new Color(legacy?'#bbd0dd':'#c0d9ff'),day).lerp(this.dusk,sunrise*.7);
    const uniforms=(this.sphere.material as ShaderMaterial).uniforms;uniforms.top.value.copy(top);uniforms.bottom.value.copy(this.horizon);
    fog.color.copy(this.horizon);fog.near=distance*(legacy?.35:.6);fog.far=distance;
    (this.stars.material as PointsMaterial).opacity=(1-day)*.9;this.stars.rotation.z=angle;
    if(this.sun){this.sun.position.set(Math.cos(angle)*250,elevation*250,0);this.sun.lookAt(this.root.position);this.moon.position.copy(this.sun.position).negate();this.moon.lookAt(this.root.position);}
    if(this.cloud){this.cloud.visible=this.clouds;this.cloud.position.set(-eye.x%128+this.assets.time.value*.3,128-eye.y,-eye.z%128);(this.cloud.material as MeshBasicMaterial).color.setScalar(.25+.75*day);}
  }
  get brightness(){return this.daylight;}
}
