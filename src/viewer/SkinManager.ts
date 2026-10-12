import {Texture,CanvasTexture,NearestFilter,SRGBColorSpace,type Mesh,type MeshBasicMaterial} from 'three';
import {AssetManager} from '../core/AssetManager';
import {PlayerModel} from '../core/PlayerModel';
import {validateSkinPng,normalizeSkinPixels,type SkinModel} from '../core/Skin';
import {SkinStore,type SavedSkin} from './SkinStore';

export class SkinManager {
  readonly store=new SkinStore();private original:Texture;private imported?:Texture;private saved?:SavedSkin;
  model:SkinModel='classic';name='Default';persistent=true;private generation=0;
  get canChangeModel(){return !!this.imported&&this.imported.image.height!==32;}
  constructor(private assets:AssetManager,private player:PlayerModel,private preview:(texture:Texture,slim:boolean)=>void){this.original=((player.head.children[0] as Mesh).material as MeshBasicMaterial).map!;}
  private apply(texture:Texture,model:SkinModel){this.model=model;this.player.setSkin(texture.image.width,texture.image.height,this.assets.skinMaterial(texture),this.assets.skinMaterial(texture),model==='slim');this.preview(texture,model==='slim');}
  private async decode(blob:Blob){
    if(blob.size>2*1024*1024)throw new Error('Skin file is too large.');
    const {width,height}=validateSkinPng(new Uint8Array(await blob.arrayBuffer()));
    const url=URL.createObjectURL(blob),image=new Image();
    try{image.src=url;await image.decode();}catch{throw new Error('Choose a PNG skin.');}finally{URL.revokeObjectURL(url);}
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d')!;
    context.drawImage(image,0,0);const data=context.getImageData(0,0,width,height);normalizeSkinPixels(data.data,width,height);context.putImageData(data,0,0);
    const texture=new CanvasTexture(canvas);texture.magFilter=texture.minFilter=NearestFilter;texture.generateMipmaps=false;texture.colorSpace=SRGBColorSpace;return texture;
  }
  async restore(){try{const skin=await this.store.get();if(skin)await this.import(skin.blob,skin.name,skin.model,false);}catch{/* Default remains available when browser storage is unavailable. */}}
  async import(blob:Blob,name:string,model:SkinModel,persist=true){
    const request=++this.generation,texture=await this.decode(blob);
    if(request!==this.generation){texture.dispose();return;}
    // Legacy files contain only the classic right arm/leg skin net.
    if(texture.image.height===32)model='classic';
    const previous=this.imported;this.imported=texture;this.saved={blob,name,model};this.name=name;this.apply(texture,model);previous?.dispose();
    if(persist){try{await this.store.put(this.saved);this.persistent=true;}catch{this.persistent=false;}}
  }
  async setModel(model:SkinModel){
    if(!this.imported||!this.saved)return;
    if(this.imported.image.height===32)model='classic';
    this.saved.model=model;this.apply(this.imported,model);
    try{await this.store.put(this.saved);this.persistent=true;}catch{this.persistent=false;}
  }
  async reset(){++this.generation;this.saved=undefined;this.name='Default';this.apply(this.original,'classic');this.imported?.dispose();this.imported=undefined;try{await this.store.clear();this.persistent=true;}catch{this.persistent=false;}}
}
