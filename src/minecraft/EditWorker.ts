import {runEditJob,type EditJob} from './EditJob';
import type {Block} from './types';

let blocks:Block[]=[];
self.onmessage=(event:MessageEvent<{blocks:Block[]}|EditJob>)=>{
  if('blocks' in event.data){blocks=event.data.blocks;return;}
  try{
    const result=runEditJob(event.data,blocks);
    const buffers=[...result.lights.map(([,data])=>data.buffer),...result.meshes.flatMap(m=>m.data.flatMap(d=>[...d.attributes.map(a=>a.buffer),d.indices.buffer]))];
    self.postMessage(result,{transfer:buffers});
  }catch(error){self.postMessage({error:String(error)});}
};
