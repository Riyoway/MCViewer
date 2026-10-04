import { BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,Vector3,type Camera,type Texture } from 'three';
import { lightmap,type AssetManager } from '../core/AssetManager';

export interface ParticleTerrain {
  particleSurface(x:number,y:number,z:number):number|null;
  particleCollision?(x:number,y:number,z:number):number|null;
  light(x:number,y:number,z:number):number;
}
// Mojang WaterDropParticle / SingleQuadParticle: velocities are blocks per 20 Hz tick.
export class RainDrop {
  position:Vector3;previous:Vector3;velocity:Vector3;size:number;frame:number;life:number;dead=false;age=0;shade=1;readonly lifetime:number;
  constructor(x:number,y:number,z:number,private random= Math.random,readonly smoke=false){
    this.position=new Vector3(x,y,z);this.previous=this.position.clone();
    const velocity=new Vector3((random()*2-1)*.4,(random()*2-1)*.4,(random()*2-1)*.4);
    const speed=(random()+random()+1)*.15;
    velocity.multiplyScalar(speed/Math.max(velocity.length(),1e-9)*.4);
    const baseVelocity=velocity.clone();baseVelocity.y+=.1;
    this.velocity=velocity;this.velocity.x*=.3;this.velocity.z*=.3;this.velocity.y=random()*.2+.1;
    this.size=.1*(random()*.5+.5)*2;this.life=Math.floor(8/(random()*.8+.2));this.frame=Math.floor(random()*4);
    if(smoke){this.velocity.copy(baseVelocity).multiplyScalar(.1);this.shade=random()*.3;this.frame=11;this.size*=.75;}
    this.lifetime=this.life;
  }
  tick(terrain:ParticleTerrain){
    this.previous.copy(this.position);if(this.life--<=0){this.dead=true;return;}
    this.age++;
    if(this.smoke){this.velocity.y+=.004;this.position.add(this.velocity);this.velocity.multiplyScalar(.96);this.frame=11-Math.min(7,Math.floor(this.age*8/this.lifetime));return;}
    this.velocity.y-=.06;this.position.add(this.velocity);
    const surface=terrain.particleCollision?terrain.particleCollision(this.position.x,this.previous.y,this.position.z):terrain.particleSurface(this.position.x,this.previous.y,this.position.z);
    if(surface!==null&&this.velocity.y<0&&this.position.y<surface&&this.previous.y>=surface-.01){
      this.position.y=surface;this.velocity.y=0;if(this.random()<.5)this.dead=true;this.velocity.x*=.7;this.velocity.z*=.7;
    }
    this.velocity.multiplyScalar(.98);
    const immersed=terrain.particleSurface(this.position.x,this.position.y,this.position.z);
    if(immersed!==null&&this.position.y<immersed)this.dead=true;
  }
}

export class RainParticles {
  readonly mesh:Mesh<BufferGeometry,MeshBasicMaterial>;readonly drops:RainDrop[]=[];
  private right=new Vector3();private up=new Vector3();private point=new Vector3();private capacity=4096;
  constructor(assets:AssetManager,private random=Math.random){
    const geometry=new BufferGeometry();for(const [name,size] of [['position',3],['uv',2],['lightLevel',2],['color',3]] as const)geometry.setAttribute(name,new Float32BufferAttribute(new Float32Array(this.capacity*6*size),size));
    geometry.setDrawRange(0,0);
    const material=new MeshBasicMaterial({alphaTest:.1,vertexColors:true});
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{daylight:assets.daylight,gamma:assets.gamma});
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nattribute vec2 lightLevel;varying vec2 vLight;`).replace('#include <begin_vertex>',`#include <begin_vertex>\nvLight=lightLevel;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${lightmap}\nvarying vec2 vLight;`).replace('#include <map_fragment>',`#include <map_fragment>\ndiffuseColor=sRGBTransferOETF(diffuseColor);`).replace('#include <color_fragment>',`#include <color_fragment>\ndiffuseColor.rgb*=minecraftLight(vLight,0.0);diffuseColor=sRGBTransferEOTF(diffuseColor);`);
    };
    material.customProgramCacheKey=()=> 'minecraft-rain-drops-v1';this.mesh=new Mesh(geometry,material);this.mesh.frustumCulled=false;
  }
  select(texture:Texture){this.clear();this.mesh.material.map=texture;this.mesh.material.needsUpdate=true;}
  clear(){this.drops.length=0;this.mesh.geometry.setDrawRange(0,0);}
  spawn(x:number,y:number,z:number,smoke=false){if(this.drops.length<this.capacity)this.drops.push(new RainDrop(x,y,z,this.random,smoke));}
  tick(terrain:ParticleTerrain){for(let i=this.drops.length-1;i>=0;i--){this.drops[i].tick(terrain);if(this.drops[i].dead)this.drops.splice(i,1);}}
  render(camera:Camera,terrain:ParticleTerrain,partial:number){
    this.right.set(1,0,0).applyQuaternion(camera.quaternion);this.up.set(0,1,0).applyQuaternion(camera.quaternion);
    const geometry=this.mesh.geometry,position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),light=geometry.getAttribute('lightLevel'),color=geometry.getAttribute('color');
    const corners=[[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]];
    for(const [i,drop] of this.drops.entries()){
      const center=drop.previous.clone().lerp(drop.position,partial),level=terrain.light(center.x,center.y,center.z);
      for(let j=0;j<6;j++){
        const [u,v]=corners[j],n=i*6+j;this.point.copy(center).addScaledVector(this.right,(u*2-1)*drop.size).addScaledVector(this.up,(v*2-1)*drop.size);
        position.setXYZ(n,this.point.x,this.point.y,this.point.z);uv.setXY(n,(drop.frame+u)/12,v);light.setXY(n,(level>>4)/15,(level&15)/15);color.setXYZ(n,drop.shade,drop.shade,drop.shade);
      }
    }
    geometry.setDrawRange(0,this.drops.length*6);for(const name of ['position','uv','lightLevel','color'])geometry.getAttribute(name).needsUpdate=true;
  }
}
