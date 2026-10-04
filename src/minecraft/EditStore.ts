import type {Manifest,Vec3} from './types';

export class EditStore {
  readonly cells=new Map<string,string|null>();private timer:ReturnType<typeof setTimeout>|undefined;
  readonly originals=new Map<string,number>();
  constructor(readonly name:string,private storage:Pick<Storage,'getItem'|'setItem'>|undefined=typeof localStorage==='undefined'?undefined:localStorage){
    try{const data=JSON.parse(storage?.getItem(this.key)??'null');if(data?.version===1&&data.cells&&typeof data.cells==='object')for(const [key,value] of Object.entries(data.cells))if(/^-?\d+,-?\d+,-?\d+$/.test(key)&&(typeof value==='string'||value===null))this.cells.set(key,value);}catch{/* Invalid/unavailable browser storage leaves the original map intact. */}
  }
  private get key(){return `world-edits:${this.name}`;}
  record(position:Vec3,oldId:number,id:number,manifest:Manifest){
    const key=position.join(',');if(!this.originals.has(key))this.originals.set(key,oldId);
    const original=this.originals.get(key)!;
    if(original===id||original!==0&&id!==0&&manifest.blocks[original].state===manifest.blocks[id].state)this.cells.delete(key);else this.cells.set(key,id?manifest.blocks[id].state:null);
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),250);
  }
  apply(x:number,z:number,theme:string,manifest:Manifest,set:(position:Vec3,id:number)=>void,get:(position:Vec3)=>number){
    let changed=false;
    for(const [key,state] of this.cells){const p=key.split(',').map(Number) as Vec3;if(Math.floor(p[0]/16)!==x||Math.floor(p[2]/16)!==z)continue;
      const id=state===null?0:manifest.lookup[`${theme}:${state}`];if(id===undefined)continue;
      this.originals.set(key,get(p));set(p,id);changed=true;
    }
    return changed;
  }
  flush(){clearTimeout(this.timer);this.timer=undefined;try{this.storage?.setItem(this.key,JSON.stringify({version:1,cells:Object.fromEntries(this.cells)}));}catch{/* Quota/private mode: current session remains editable. */}}
}
