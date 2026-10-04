import { TextureLoader, NearestFilter, NearestMipmapLinearFilter, SRGBColorSpace, MeshBasicMaterial, BufferGeometry, Float32BufferAttribute, BufferAttribute, Mesh, Vector2 } from 'three';
import type { Texture } from 'three';
import type { Manifest, MeshData } from '../minecraft/types';
import type { PackedMesh } from '../minecraft/binary';

const external=import.meta.env?.VITE_ASSET_BASE_URL,base=(external||`${import.meta.env?.BASE_URL??'/'}generated`).replace(/\/$/,'');
const version=typeof __ASSET_VERSION__==='undefined'?'local':__ASSET_VERSION__;
export const assetUrl=(file:string)=>`${base}/${!external&&import.meta.env?.PROD?`${version}/`:''}${file}`;
// Mojang's lightmap.fsh: independent sky/block light, warm block-light curve and Gamma.
export const lightmap=`uniform float daylight;uniform float gamma;
vec3 minecraftLight(vec2 level,float glow) {
  vec2 brightness=level/max(vec2(.01),4.0-3.0*level);
  float block=brightness.y*1.5;
  vec3 light=vec3(block,block*((block*.6+.4)*.6+.4),block*(block*block*.6+.4));
  light+=mix(vec3(daylight,daylight,1.0),vec3(1.0),.35)*brightness.x*(daylight*.95+.05);
  light=mix(light,vec3(.75),.04);
  light=clamp(max(light,vec3(glow)),0.0,1.0);
  light=mix(light,1.0-pow(1.0-light,vec3(4.0)),gamma);
  return clamp(mix(light,vec3(.75),.04),0.0,1.0);
}`;
export class AssetManager {
  readonly time={value:0};
  readonly daylight={value:1};readonly gamma={value:.5};
  readonly entityLight={value:new Vector2(1,0)};
  readonly opaque:MeshBasicMaterial;
  readonly transparent:MeshBasicMaterial;
  readonly manifest:Manifest;
  private constructor(manifest:Manifest, material:MeshBasicMaterial) {
    this.manifest=manifest;this.opaque=material;
    this.transparent=material.clone();
    this.transparent.transparent=true;this.transparent.depthWrite=false;
    this.transparent.onBeforeCompile=material.onBeforeCompile;
    this.transparent.customProgramCacheKey=()=> 'minecraft-atlas-v4';
  }
  static async load() {
    const response=await fetch(assetUrl('manifest.json'));
    if(!response.ok)throw new Error('素材が見つかりません。npm run assets を実行してください。');
    const manifest:Manifest=await response.json();
    const texture=await new TextureLoader().loadAsync(assetUrl('atlas.png'));
    texture.magFilter=NearestFilter;texture.minFilter=NearestMipmapLinearFilter;texture.generateMipmaps=true;texture.colorSpace=SRGBColorSpace;
    const material=new MeshBasicMaterial({map:texture,vertexColors:true,alphaTest:.1});
    const assets=new AssetManager(manifest,material);
    material.onBeforeCompile=shader=>{
      shader.uniforms.voxelTime=assets.time;
      shader.uniforms.daylight=assets.daylight;shader.uniforms.gamma=assets.gamma;
      // Tile IDs must stay exact: interpolation can round into the previous atlas row.
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 tileInfo; attribute vec2 tileSize; attribute float glow; attribute vec2 lightLevel;
        flat varying vec3 vTileInfo; flat varying vec2 vTileSize; varying vec2 vPixelUv; varying float vGlow; varying vec2 vLight;`)
        .replace('#include <uv_vertex>',`#include <uv_vertex>
        vTileInfo=tileInfo; vTileSize=tileSize; vPixelUv=uv; vGlow=glow;vLight=lightLevel;`);
      const {size,cell,pixels}=manifest.atlas,columns=Math.floor(size/cell),padding=(cell-pixels)/2;
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform float voxelTime;${lightmap}
        flat varying vec3 vTileInfo; flat varying vec2 vTileSize; varying vec2 vPixelUv; varying float vGlow;varying vec2 vLight;`)
        .replace('#include <map_fragment>',`
        float frame=vTileInfo.x+mod(floor(voxelTime*20.0/max(1.0,vTileInfo.z)),max(1.0,vTileInfo.y));
        vec2 tileOrigin=vec2(mod(frame,${columns}.0),floor(frame/${columns}.0))*${cell}.0;
        vec2 pixel=vec2(fract(vPixelUv.x),1.0-fract(vPixelUv.y));
        vec2 atlasUv=(tileOrigin+vec2(${padding}.0)+(vec2(${pixels}.0)-vTileSize)*.5+pixel*vTileSize)/${size}.0;
        atlasUv.y=1.0-atlasUv.y;
        // Derivatives of unwrapped UVs avoid false mip levels at every fract() seam.
        vec2 dx=dFdx(vPixelUv)*vTileSize/${size}.0;
        vec2 dy=dFdy(vPixelUv)*vTileSize/${size}.0;
        float maxFootprint=${cell}.0/${size}.0;
        dx*=min(1.0,maxFootprint/max(length(dx),0.000001));
        dy*=min(1.0,maxFootprint/max(length(dy),0.000001));
        vec4 sampledDiffuseColor=textureGrad(map,atlasUv,dx,dy);
        // Minecraft multiplies texture/tint/light in display space; Three decodes maps to linear.
        diffuseColor*=sRGBTransferOETF(sampledDiffuseColor);`)
        .replace('#include <color_fragment>',`#include <color_fragment>
        diffuseColor.rgb*=minecraftLight(vLight,vGlow);
        diffuseColor=sRGBTransferEOTF(diffuseColor);`);
    };
    assets.transparent.onBeforeCompile=material.onBeforeCompile;
    material.customProgramCacheKey=()=> 'minecraft-atlas-v4';
    return assets;
  }
  skinMaterial(texture:Texture) {
    const material=new MeshBasicMaterial({map:texture,fog:false});
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{daylight:this.daylight,gamma:this.gamma,entityLight:this.entityLight});
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        varying float vEntityShade;`).replace('#include <begin_vertex>',`#include <begin_vertex>
        vec3 n=normalize(mat3(modelMatrix)*normal);
        vEntityShade=min(1.0,(max(0.0,dot(normalize(vec3(.2,1.0,-.7)),n))+max(0.0,dot(normalize(vec3(-.2,1.0,.7)),n)))*.6+.4);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        ${lightmap} uniform vec2 entityLight;varying float vEntityShade;`)
        .replace('#include <map_fragment>',`#include <map_fragment>
        diffuseColor=sRGBTransferOETF(diffuseColor);`)
        .replace('#include <color_fragment>',`#include <color_fragment>
        diffuseColor.rgb*=vEntityShade*minecraftLight(entityLight,0.0);
        diffuseColor=sRGBTransferEOTF(diffuseColor);`);
    };
    material.customProgramCacheKey=()=> 'minecraft-skin-v1';return material;
  }
  block(theme:string,name:string) {
    const id=this.manifest.lookup[`${theme}:${name}`];
    if(!id)throw new Error(`Block asset missing: ${theme}:${name}`);
    return id;
  }
  mesh(data:MeshData|PackedMesh, transparent=false) {
    const geometry=new BufferGeometry();
    const attrs='attributes' in data?data.attributes:[data.position,data.normal,data.uv,data.tile,data.color,data.glow,data.light].map(a=>new Float32Array(a));
    for(const [i,name,size] of [[0,'position',3],[1,'normal',3],[2,'uv',2],[4,'color',3],[5,'glow',1],[6,'lightLevel',2]] as const) geometry.setAttribute(name,new BufferAttribute(attrs[i],size));
    const info=new Float32Array(attrs[3].length*3),size=new Float32Array(attrs[3].length*2);
    for(let i=0;i<attrs[3].length;i++) {
      const tile=this.manifest.atlas.tiles[attrs[3][i]];if(!tile)throw new Error('チャンクと素材のバージョンが一致しません。npm run assets を実行してください。');info[i*3]=tile.start;info[i*3+1]=tile.frames;info[i*3+2]=tile.ticks??1;
      size.set(tile.size??[this.manifest.atlas.pixels-1,this.manifest.atlas.pixels-1],i*2);
    }
    geometry.setAttribute('tileInfo',new Float32BufferAttribute(info,3));
    geometry.setAttribute('tileSize',new Float32BufferAttribute(size,2));
    geometry.setIndex(new BufferAttribute('indices' in data?data.indices:new Uint32Array(data.index),1));
    geometry.computeBoundingSphere();geometry.computeBoundingBox();
    const mesh=new Mesh(geometry,transparent?this.transparent:this.opaque);
    mesh.frustumCulled=true;
    return mesh;
  }
}
