import type {Block,Vec3} from '../minecraft/types';
import {outlineBoxes} from '../minecraft/Target';
import {appendElement,emptyMesh} from '../minecraft/Mesher';

export interface TerrainParticle {position:Vec3;previous:Vec3;velocity:Vec3;size:number;age:number;life:number;stopped:boolean;grounded:boolean}
const shapes=new WeakMap<Block,Block['collision']>();
export function debrisBoxes(block:Block):Block['collision'] {
  let boxes=shapes.get(block);if(boxes)return boxes;
  let source=outlineBoxes(block);
  if(block.name.endsWith('_bed'))source=[{from:[0,0,0],to:[1,.5625,1]}];
  if(/_fence$|_fence_gate$/.test(block.name))source=block.elements.map(e=>{const m=emptyMesh();appendElement(m,e,[0,0,0],block);return{from:[0,1,2].map(a=>Math.min(...m.position.filter((_,i)=>i%3===a))) as Vec3,to:[0,1,2].map(a=>Math.max(...m.position.filter((_,i)=>i%3===a))) as Vec3};});
  // VoxelShape.forAllBoxes enumerates a union, not overlapping model/collision boxes.
  const axes=[0,1,2].map(a=>[...new Set(source.flatMap(b=>[b.from[a],b.to[a]]))].sort((a,b)=>a-b)),[xs,ys,zs]=axes;
  const nx=xs.length-1,ny=ys.length-1,nz=zs.length-1,cells=new Set<number>(),index=(x:number,y:number,z:number)=>(y*nz+z)*nx+x;
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)if(source.some(b=>xs[x]>=b.from[0]&&xs[x+1]<=b.to[0]&&ys[y]>=b.from[1]&&ys[y+1]<=b.to[1]&&zs[z]>=b.from[2]&&zs[z+1]<=b.to[2]))cells.add(index(x,y,z));
  boxes=[];
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)if(cells.has(index(x,y,z))){
    let X=x+1,Y=y+1,Z=z+1;while(X<nx&&cells.has(index(X,y,z)))X++;
    while(Y<ny&&Array.from({length:X-x},(_,i)=>cells.has(index(x+i,Y,z))).every(Boolean))Y++;
    while(Z<nz&&Array.from({length:(X-x)*(Y-y)},(_,i)=>cells.has(index(x+i%(X-x),y+Math.floor(i/(X-x)),Z))).every(Boolean))Z++;
    for(let a=x;a<X;a++)for(let b=y;b<Y;b++)for(let c=z;c<Z;c++)cells.delete(index(a,b,c));
    boxes.push({from:[xs[x],ys[y],zs[z]],to:[xs[X],ys[Y],zs[Z]]});
  }
  shapes.set(block,boxes);return boxes;
}

// Mojang ParticleEngine.destroy / Particle / TerrainParticle: cells <= 1/4 block,
// at least two per axis, randomized normalized launch, .04 gravity and .98 drag.
export function createDebris(boxes:Block['collision'],origin:Vec3,random=Math.random):TerrainParticle[] {
  const particles:TerrainParticle[]=[];
  for(const box of boxes){const extent=box.to.map((n,i)=>Math.min(1,n-box.from[i])),count=extent.map(n=>Math.max(2,Math.ceil(n/.25)));
    for(let x=0;x<count[0];x++)for(let y=0;y<count[1];y++)for(let z=0;z<count[2];z++){
      const fraction=[(x+.5)/count[0],(y+.5)/count[1],(z+.5)/count[2]],position=fraction.map((n,i)=>origin[i]+box.from[i]+n*extent[i]) as Vec3;
      const life=Math.floor(4/(random()*.9+.1)),velocity=fraction.map(n=>n-.5+(random()*2-1)*.4) as Vec3,speed=(random()+random()+1)*.15*.4,length=Math.hypot(...velocity)||1;
      for(let i=0;i<3;i++)velocity[i]=velocity[i]/length*speed;velocity[1]+=.1;
      particles.push({position,previous:[...position],velocity,size:.1*(random()*.5+.5),age:0,life,stopped:false,grounded:false});
    }
  }
  return particles;
}
export function tickDebris(p:TerrainParticle,move:(position:Vec3,velocity:Vec3)=>Vec3){
  p.previous.splice(0,3,...p.position);if(p.age++>=p.life)return;
  p.velocity[1]-=.04;
  if(!p.stopped){const delta=move(p.position,p.velocity);for(let i=0;i<3;i++)p.position[i]+=delta[i];
    if(Math.abs(p.velocity[1])>=.00001&&Math.abs(delta[1])<.00001)p.stopped=true;
    p.grounded=p.velocity[1]!==delta[1]&&p.velocity[1]<0;
    for(const i of [0,2])if(delta[i]!==p.velocity[i])p.velocity[i]=0;
  }
  for(let i=0;i<3;i++)p.velocity[i]*=.98;if(p.grounded){p.velocity[0]*=.7;p.velocity[2]*=.7;}
}
