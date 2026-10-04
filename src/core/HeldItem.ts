import {Group,Mesh,MeshBasicMaterial,Matrix4,TextureLoader,NearestFilter,SRGBColorSpace,BufferGeometry,Float32BufferAttribute} from 'three';
import {AssetManager,assetUrl} from './AssetManager';
import {appendElement,emptyMesh} from '../minecraft/Mesher';
import type {InventoryItem,UITheme} from '../ui/types';
import type {PlayerModel} from './PlayerModel';

export class HeldItem {
  readonly root=new Group();private pose=new Group();private key='';private pending='';private height=1;private requested?:InventoryItem;private theme?:UITheme;
  private textures=new Map<string,Promise<MeshBasicMaterial>>();private blockMaterial:MeshBasicMaterial;
  constructor(private assets:AssetManager){
    this.root.matrixAutoUpdate=false;this.root.add(this.pose);
    this.blockMaterial=assets.opaque.clone();this.blockMaterial.depthTest=false;this.blockMaterial.depthWrite=false;
    this.blockMaterial.onBeforeCompile=(shader,renderer)=>{assets.opaque.onBeforeCompile(shader,renderer);shader.uniforms.entityLight=assets.entityLight;shader.vertexShader=shader.vertexShader.replace('attribute vec3 tileInfo;','uniform vec2 entityLight;attribute vec3 tileInfo;').replace('vLight=lightLevel;','vLight=entityLight;');};
    this.blockMaterial.customProgramCacheKey=()=> 'minecraft-held-block-v1';
  }
  select(item:InventoryItem|undefined,theme:UITheme){this.requested=item;this.theme=theme;this.pending=item?`${theme.itemsTexture}:${item.id}`:'';}
  clear(){this.key=this.pending='';this.requested=undefined;this.height=0;for(const object of [...this.pose.children]){object.removeFromParent();if(object instanceof Mesh)object.geometry.dispose();}this.blockMaterial.map=this.assets.opaque.map;this.blockMaterial.needsUpdate=true;}
  private async replace(item:InventoryItem|undefined,theme:UITheme,key:string){
    for(const object of [...this.pose.children]){this.pose.remove(object);if(object instanceof Mesh)object.geometry.dispose();}
    if(!item)return;
    let mesh:Mesh;
    if(item.icon!==undefined){
      if(!this.textures.has(theme.itemsTexture))this.textures.set(theme.itemsTexture,new TextureLoader().loadAsync(assetUrl(theme.itemsTexture)).then(texture=>{texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.generateMipmaps=false;texture.colorSpace=SRGBColorSpace;const material=this.assets.skinMaterial(texture);material.depthTest=false;material.depthWrite=false;material.transparent=true;material.alphaTest=.1;return material;}));
      const material=await this.textures.get(theme.itemsTexture)!;if(this.key!==key)return;
      mesh=new Mesh(spriteGeometry(material.map!.image,item.icon,theme.itemColumns),material);
    }else if(item.block!==undefined){
      const block=this.assets.manifest.blocks[item.block],data=emptyMesh();for(const element of item.model?.elements??block.elements)appendElement(data,element,[0,0,0],{...block,rotation:[0,0,0]});mesh=this.assets.mesh(data);mesh.material=this.blockMaterial;mesh.position.set(-.5,-.5,-.5);
    }else return;
    const display=item.firstPerson??{rotation:[0,45,0],translation:[0,0,0],scale:[.4,.4,.4]};
    this.pose.rotation.set(...display.rotation.map(n=>n*Math.PI/180) as [number,number,number]);this.pose.position.set(...display.translation.map(n=>n/16) as [number,number,number]);this.pose.scale.set(...display.scale);
    mesh.renderOrder=1001;mesh.frustumCulled=false;this.pose.add(mesh);
  }
  update(dt:number,model:PlayerModel,visible:boolean){
    const changing=this.pending!==this.key,target=changing?0:1;this.height+=Math.max(-dt*8,Math.min(dt*8,target-this.height));
    if(changing&&this.height<.1&&this.theme){this.key=this.pending;void this.replace(this.requested,this.theme,this.key);}
    this.root.visible=visible&&!!this.key;if(this.root.visible)model.hand.visible=false;
    const t=model.swingProgress,arc=t<1?Math.sin(Math.sqrt(t)*Math.PI):0,twist=t<1?Math.sin(t*t*Math.PI):0;
    this.root.matrix.makeTranslation(.56-.4*arc,-.52-(1-this.height)*.6+(t<1?.2*Math.sin(Math.sqrt(t)*2*Math.PI):0),-.72-(t<1?.2*Math.sin(t*Math.PI):0))
      .multiply(new Matrix4().makeRotationY((45-20*twist)*Math.PI/180)).multiply(new Matrix4().makeRotationZ(-20*arc*Math.PI/180)).multiply(new Matrix4().makeRotationX(-80*arc*Math.PI/180)).multiply(new Matrix4().makeRotationY(-Math.PI/4));
    this.root.matrixWorldNeedsUpdate=true;
  }
}

// Minecraft's generated item: two textured faces and thin edges along opaque pixels.
function spriteGeometry(image:HTMLImageElement,icon:number,columns:number){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=false;context.drawImage(image,icon%columns*32,Math.floor(icon/columns)*32,32,32,0,0,16,16);
  const pixels=context.getImageData(0,0,16,16).data,position:number[]=[],uv:number[]=[],normal:number[]=[];
  const U=(x:number)=>(icon%columns*32+x*32)/image.width,V=(y:number)=>1-(Math.floor(icon/columns)*32+y*32)/image.height;
  const quad=(points:number[][],coords:number[][],n:number[])=>{for(const i of [0,1,2,0,2,3]){position.push(...points[i]);uv.push(U(coords[i][0]),V(coords[i][1]));normal.push(...n);}};
  const front=1/32,back=-1/32;
  quad([[-.5,-.5,front],[.5,-.5,front],[.5,.5,front],[-.5,.5,front]],[[0,1],[1,1],[1,0],[0,0]],[0,0,1]);
  quad([[.5,-.5,back],[-.5,-.5,back],[-.5,.5,back],[.5,.5,back]],[[1,1],[0,1],[0,0],[1,0]],[0,0,-1]);
  const solid=(x:number,y:number)=>x>=0&&x<16&&y>=0&&y<16&&pixels[(y*16+x)*4+3]>25;
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)if(solid(x,y)){
    const a=x/16-.5,b=.5-y/16,c=a+1/16,d=b-1/16,coords=Array(4).fill([(x+.5)/16,(y+.5)/16]);
    if(!solid(x-1,y))quad([[a,d,back],[a,d,front],[a,b,front],[a,b,back]],coords,[-1,0,0]);
    if(!solid(x+1,y))quad([[c,d,front],[c,d,back],[c,b,back],[c,b,front]],coords,[1,0,0]);
    if(!solid(x,y-1))quad([[a,b,front],[c,b,front],[c,b,back],[a,b,back]],coords,[0,1,0]);
    if(!solid(x,y+1))quad([[a,d,back],[c,d,back],[c,d,front],[a,d,front]],coords,[0,-1,0]);
  }
  return new BufferGeometry().setAttribute('position',new Float32BufferAttribute(position,3)).setAttribute('normal',new Float32BufferAttribute(normal,3)).setAttribute('uv',new Float32BufferAttribute(uv,2));
}
