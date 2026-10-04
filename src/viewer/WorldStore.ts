import type {WorldManifest} from '../minecraft/types';
export interface LocalFile {name:string;blob:Blob}
export interface SavedWorld {id:string;name:string;added:number;files:LocalFile[];pack?:LocalFile;manifest?:WorldManifest;icon?:Blob;version?:string;sample?:string}
export function safePath(name:string){const path=name.replaceAll('\\','/').replace(/^\.\//,'');if(path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.split('/').includes('..'))throw new Error('不正なファイルパスです');return path;}
export class WorldStore {
  private db?:Promise<IDBDatabase>;
  private open(){return this.db??=new Promise((resolve,reject)=>{const r=indexedDB.open('minecraft-world-viewer',1);r.onupgradeneeded=()=>r.result.createObjectStore('worlds',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  private async transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>){const db=await this.open();return new Promise<T>((resolve,reject)=>{const tx=db.transaction('worlds',mode),request=run(tx.objectStore('worlds'));tx.oncomplete=()=>resolve(request.result);tx.onabort=tx.onerror=()=>reject(tx.error??request.error);});}
  async list(){const values=await this.transaction('readonly',s=>s.getAll()) as SavedWorld[];return values.sort((a,b)=>b.added-a.added);}
  get(id:string){return this.transaction('readonly',s=>s.get(id)) as Promise<SavedWorld|undefined>;}
  put(world:SavedWorld){return this.transaction('readwrite',s=>s.put(world));}
  delete(id:string){return this.transaction('readwrite',s=>s.delete(id));}
}
