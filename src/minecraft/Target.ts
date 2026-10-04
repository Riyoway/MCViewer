import type {Block,Vec3,FaceName} from './types';
import {FACES} from './types';
import {Voxels} from './Voxels';
import {appendElement,emptyMesh} from './Mesher';

export interface BlockHit {position:Vec3;point:Vec3;face:FaceName;id:number;distance:number}
const shapes=new WeakMap<Block,Block['collision']>();
export function outlineBoxes(block:Block):Block['collision']{
  let boxes=shapes.get(block);if(boxes)return boxes;
  if(block.collision.length)boxes=block.collision.map(box=>({from:box.from,to:box.to.map((n,i)=>i===1?Math.min(1,n):n) as Vec3}));
  else {
    boxes=block.elements.map(element=>{
      const data=emptyMesh();appendElement(data,element,[0,0,0],block);
      return {from:[0,1,2].map(axis=>Math.max(0,Math.min(...data.position.filter((_,i)=>i%3===axis)))) as Vec3,to:[0,1,2].map(axis=>Math.min(1,Math.max(...data.position.filter((_,i)=>i%3===axis)))) as Vec3};
    }).filter(box=>box.from.every(Number.isFinite)&&box.to.every(Number.isFinite));
    // Crossed plants have a selectable native outline despite having no collider.
    if(/^(short_grass|fern|dead_bush|.*_sapling|.*flower|dandelion|poppy)$/.test(block.name))boxes=[{from:[.125,0,.125],to:[.875,.8125,.875]}];
  }
  shapes.set(block,boxes);return boxes;
}
function intersect(eye:Vec3,direction:Vec3,position:Vec3,box:Block['collision'][number],reach:number){
  let near=-Infinity,far=Infinity,face=0;
  for(let axis=0;axis<3;axis++){
    const min=position[axis]+box.from[axis],max=position[axis]+box.to[axis],d=direction[axis];
    if(Math.abs(d)<1e-10){if(eye[axis]<min||eye[axis]>max)return null;continue;}
    const first=(min-eye[axis])/d,last=(max-eye[axis])/d,start=Math.min(first,last),end=Math.max(first,last);
    if(start>near){near=start;face=axis*2+(d>0?1:0);}far=Math.min(far,end);if(far<near)return null;
  }
  if(far<0||near>reach)return null;
  return {distance:Math.max(0,near),face:FACES[face]};
}
export function traceBlock(voxels:Voxels,blocks:Block[],eye:Vec3,direction:Vec3,reach=5):BlockHit|null{
  const end=eye.map((n,i)=>n+direction[i]*reach),min=eye.map((n,i)=>Math.floor(Math.min(n,end[i]))),max=eye.map((n,i)=>Math.floor(Math.max(n,end[i])));
  let hit:BlockHit|null=null;
  // A five-block ray spans at most 216 cells. Exact shape clipping avoids the old
  // inflated collision/marching hit, which could pick empty space beside a fence.
  for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
    const position:Vec3=[x,y,z],id=voxels.get(x,y,z),block=blocks[id];if(!block||block.fluid)continue;
    for(const box of outlineBoxes(block)){const result=intersect(eye,direction,position,box,hit?.distance??reach);if(result&&(!hit||result.distance<hit.distance))hit={...result,position,id,point:eye.map((n,i)=>n+direction[i]*result.distance) as Vec3};}
  }
  return hit;
}
