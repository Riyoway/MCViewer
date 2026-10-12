import type {SkinModel} from '../core/Skin';
export interface SavedSkin {blob:Blob;name:string;model:SkinModel}
export class SkinStore {
  private db?:Promise<IDBDatabase>;
  private open(){return this.db??=new Promise((resolve,reject)=>{const request=indexedDB.open('mcviewer-skins',1);request.onupgradeneeded=()=>request.result.createObjectStore('skins');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  private async transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>){const db=await this.open();return new Promise<T>((resolve,reject)=>{const tx=db.transaction('skins',mode),request=run(tx.objectStore('skins'));tx.oncomplete=()=>resolve(request.result);tx.onabort=tx.onerror=()=>reject(tx.error??request.error);});}
  get(){return this.transaction('readonly',s=>s.get('active')) as Promise<SavedSkin|undefined>;}
  put(skin:SavedSkin){return this.transaction('readwrite',s=>s.put(skin,'active'));}
  clear(){return this.transaction('readwrite',s=>s.delete('active'));}
}
