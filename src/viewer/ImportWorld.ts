import type {Manifest,WorldManifest,Vec3,Block} from '../minecraft/types';
import type {SavedWorld} from './WorldStore';
import type {ClimateData} from '../world/Climate';
export interface WorldSource {read(origin:Vec3):Promise<{meshBuffer:ArrayBuffer;voxelBuffer:ArrayBuffer}>;dispose():void}
export interface ImportResult {manifest:WorldManifest;climate:ClimateData;version:string;warnings:string[];icon?:ArrayBuffer}
export class ImportedWorld implements WorldSource {
  private worker=new Worker(new URL('./ImportWorker.ts',import.meta.url),{type:'module'});
  private serial=0;private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  constructor(){this.worker.onmessage=event=>{const {id,result,error,progress}=event.data;if(progress){this.progress?.(progress);return;}const request=this.pending.get(id);if(!request)return;this.pending.delete(id);if(error)request.reject(new Error(error));else request.resolve(result);};this.worker.onerror=event=>{for(const request of this.pending.values())request.reject(new Error(event.message));this.pending.clear();};}
  progress?:(message:string)=>void;
  private call<T>(type:string,data:unknown,transfer:Transferable[]=[]):Promise<T>{const id=++this.serial;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,type,data},transfer);});}
  async load(world:SavedWorld,manifest:Manifest):Promise<ImportResult>{
    const files=await Promise.all(world.files.map(async file=>({name:file.name,bytes:await file.blob.arrayBuffer()})));
    const [response,data]=await Promise.all([fetch(`${import.meta.env.BASE_URL}menu/viewer-data.json`),Promise.resolve(manifest)]);if(!response.ok)throw new Error('Import data not found');
    const palette:Manifest={...data,blocks:data.blocks.map(b=>b?.theme==='vanilla'?b:null as unknown as Block),lookup:Object.fromEntries(Object.entries(data.lookup).filter(([key])=>key.startsWith('vanilla:'))),worlds:{},audio:{},effects:{}};
    return this.call('load',{files,manifest:palette,reference:await response.json(),name:world.name},files.map(f=>f.bytes));
  }
  read(origin:Vec3){return this.call<{meshBuffer:ArrayBuffer;voxelBuffer:ArrayBuffer}>('column',{origin});}
  dispose(){this.worker.terminate();for(const request of this.pending.values())request.reject(new Error('Loading cancelled'));this.pending.clear();}
}
