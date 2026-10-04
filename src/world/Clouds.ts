import { Group,Mesh,MeshBasicMaterial,BufferGeometry,Float32BufferAttribute,DoubleSide,Color,Vector3,type Texture } from 'three';
import { faceCorners } from '../minecraft/Mesher';

export interface CloudPattern {width:number;height:number;pixels:Uint8ClampedArray|Uint8Array}
export const CLOUD_CELL=12,CLOUD_THICKNESS=4,CLOUD_SPEED=.03*20;
const wrap=(value:number,size:number)=>(value%size+size)%size;
function pixel(pattern:CloudPattern,x:number,z:number){return (wrap(z,pattern.height)*pattern.width+wrap(x,pattern.width))*4;}
export function cloudGeometry(pattern:CloudPattern,cx:number,cz:number,radius:number){
  const positions:number[]=[],colors:number[]=[],indices:number[]=[],shades=[.9,.9,1,.7,.8,.8];
  const occupied=(x:number,z:number)=>pattern.pixels[pixel(pattern,x,z)+3]>=10;
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
    const x=cx+dx,z=cz+dz;if(!occupied(x,z))continue;
    const offset=pixel(pattern,x,z),rgba=Array.from(pattern.pixels.subarray(offset,offset+4),v=>v/255),neighbors=[[1,0],[-1,0],null,null,[0,1],[0,-1]];
    for(let face=0;face<6;face++){
      const neighbor=neighbors[face];if(neighbor&&occupied(x+neighbor[0],z+neighbor[1]))continue;
      const first=positions.length/3,corners=faceCorners([dx*CLOUD_CELL,0,dz*CLOUD_CELL],[(dx+1)*CLOUD_CELL,CLOUD_THICKNESS,(dz+1)*CLOUD_CELL],face);
      for(const corner of corners){positions.push(...corner);colors.push(rgba[0]*shades[face],rgba[1]*shades[face],rgba[2]*shades[face],rgba[3]*.8);}
      indices.push(first,first+1,first+2,first,first+2,first+3);
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,4));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}
// World.getCloudColor from the official 1.13 client, including its celestial-angle easing.
export function cloudTint(time:number,rain:number,thunder:number):[number,number,number]{
  const raw=wrap(time/24000-.25,1),angle=raw+(1-(Math.cos(raw*Math.PI)+1)/2-raw)/3;
  const day=Math.max(0,Math.min(1,Math.cos(angle*Math.PI*2)*2+.5)),wet=1-.38*rain;
  const rgb:[number,number,number]=[wet*(day*.9+.1),wet*(day*.9+.1),wet*(day*.85+.15)];
  const grey=(rgb[0]*.3+rgb[1]*.59+rgb[2]*.11)*.2,amount=thunder*.95;
  return rgb.map(c=>c*(1-amount)+grey*amount) as [number,number,number];
}
export class Clouds {
  readonly root=new Group();readonly color:Mesh;readonly depth:Mesh;
  readonly tint={value:new Color(1,1,1)};readonly fogEnd={value:384};
  private pattern?:CloudPattern;private cx=NaN;private cz=NaN;
  private patterns=new WeakMap<Texture,CloudPattern>();
  constructor(){
    const material=new MeshBasicMaterial({transparent:true,depthWrite:false,side:DoubleSide,vertexColors:true,alphaTest:.001,fog:false});material.forceSinglePass=true;
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{cloudTint:this.tint,cloudFogEnd:this.fogEnd});
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nvarying float cloudDistance;`).replace('#include <project_vertex>',`#include <project_vertex>\ncloudDistance=length(mvPosition.xyz);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform vec3 cloudTint;uniform float cloudFogEnd;varying float cloudDistance;`).replace('#include <color_fragment>',`#include <color_fragment>\ndiffuseColor.rgb*=cloudTint;diffuseColor=sRGBTransferEOTF(diffuseColor);`).replace('#include <alphatest_fragment>',`diffuseColor.a*=max(0.0,1.0-cloudDistance/cloudFogEnd);\n#include <alphatest_fragment>`);
    };
    material.customProgramCacheKey=()=> 'minecraft-clouds-v1';
    const depth=material.clone();depth.colorWrite=false;depth.depthWrite=true;depth.onBeforeCompile=material.onBeforeCompile;depth.customProgramCacheKey=material.customProgramCacheKey;
    const geometry=new BufferGeometry();this.color=new Mesh(geometry,material);this.depth=new Mesh(geometry,depth);this.root.add(this.depth,this.color);
  }
  setPattern(pattern:CloudPattern){this.pattern=pattern;this.cx=this.cz=NaN;}
  setTexture(texture:Texture){
    let pattern=this.patterns.get(texture);
    if(!pattern){const image=texture.image,canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);pattern={width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};this.patterns.set(texture,pattern);}
    this.setPattern(pattern);
  }
  update(eye:Vector3,elapsed:number,time:number,legacy:boolean,visible:boolean,rain:number,thunder:number){
    this.root.visible=visible&&!!this.pattern;if(!this.root.visible)return;
    const x=eye.x+elapsed*CLOUD_SPEED,z=eye.z+.33*CLOUD_CELL,cx=Math.floor(x/CLOUD_CELL),cz=Math.floor(z/CLOUD_CELL),height=legacy?128.33:192;
    if(cx!==this.cx||cz!==this.cz){const geometry=cloudGeometry(this.pattern!,cx,cz,32);this.color.geometry.dispose();this.color.geometry=this.depth.geometry=geometry;this.cx=cx;this.cz=cz;}
    this.root.position.set(-(x-cx*CLOUD_CELL),height-eye.y,-(z-cz*CLOUD_CELL));
    this.tint.value.setRGB(...cloudTint(time,rain,thunder));
    // Classic rendering draws clouds before translucent terrain below the layer, after it above.
    this.depth.renderOrder=eye.y>height+CLOUD_THICKNESS?20:-20;this.color.renderOrder=this.depth.renderOrder+1;
  }
}
