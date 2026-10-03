import type { Block, Vec3 } from './types';

export const fluidKind=(block?:Block):string|undefined=>block?.fluid?block.name:block?.fluidLevel!==undefined?'water':undefined;
export function fluidOwnHeight(block:Block|undefined,kind:string):number {
  if(fluidKind(block)!==kind)return 0;
  const level=block!.fluidLevel??Number(block!.state.match(/level=(\d+)/)?.[1]??0);
  return (level>=8?8:8-level)/9;
}
export function fluidHeight(block:Block|undefined,above:Block|undefined,kind:string):number {
  return fluidKind(block)===kind?(fluidKind(above)===kind?1:fluidOwnHeight(block,kind)):0;
}
// FlowingFluid.getFlow: height gradients also look down into an adjacent drop.
export function fluidFlow(sample:(x:number,y:number,z:number)=>Block|undefined,p:Vec3,kind:string):Vec3 {
  const own=fluidOwnHeight(sample(...p),kind),flow:Vec3=[0,0,0];
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const neighbor=sample(p[0]+dx,p[1],p[2]+dz),other=fluidKind(neighbor);
    if(other&&other!==kind)continue;
    const height=fluidOwnHeight(neighbor,kind);
    let difference=height>0?own-height:0;
    if(!height&&!neighbor?.solid){const below=fluidOwnHeight(sample(p[0]+dx,p[1]-1,p[2]+dz),kind);if(below>0)difference=own-(below-8/9);}
    flow[0]+=dx*difference;flow[2]+=dz*difference;
  }
  const length=Math.hypot(flow[0],flow[2]);return length?flow.map(n=>n/length) as Vec3:flow;
}
