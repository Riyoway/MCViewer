import { Voxels } from '../src/minecraft/Voxels.ts';
import type { Block, Vec3 } from '../src/minecraft/types.ts';

// Full skylight above the heightmap stays implicit; only filtered/indirect light is stored.
export function rebuildLighting(voxels:Voxels,blocks:Block[],lights:Voxels,bounds:{min:Vec3;max:Vec3},heights:Int16Array) {
  const [minX,minY,minZ]=bounds.min,[maxX,maxY,maxZ]=bounds.max,width=maxX-minX,depth=maxZ-minZ,stride=width*depth;
  const height=(x:number,z:number)=>x<minX||x>=maxX||z<minZ||z>=maxZ?-1:heights[(z-minZ)*width+x-minX];
  const light=(x:number,y:number,z:number)=>((y>height(x,z)?15:lights.get(x,y,z)>>4)<<4)|(lights.get(x,y,z)&15);
  const queue:number[]=[],code=(x:number,y:number,z:number)=>(y-minY)*stride+(z-minZ)*width+x-minX;
  const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const set=(x:number,y:number,z:number,sky:number,block:number)=>{lights.set(x,y,z,(sky<<4)|block);queue.push(code(x,y,z));};
  for(let z=minZ;z<maxZ;z++)for(let x=minX;x<maxX;x++) {
    let sky=15;
    for(let y=height(x,z);y>=minY;y--) {
      sky-=blocks[voxels.get(x,y,z)]?.opacity??0;if(sky<=0)break;
      set(x,y,z,sky,lights.get(x,y,z)&15);
    }
    const edge=Math.min(height(x-1,z),height(x+1,z),height(x,z-1),height(x,z+1));
    for(let y=height(x,z);y>edge&&y>=minY;y--) {
      const loss=Math.max(1,blocks[voxels.get(x,y,z)]?.opacity??0),value=15-loss;
      if(value>0&&(light(x,y,z)>>4)<value)set(x,y,z,value,lights.get(x,y,z)&15);
    }
  }
  // Preserve baked block light, and seed all emitters (including opaque lamps).
  for(const [key,cells] of voxels.chunks) {
    const [cx,cy,cz]=key.split(',').map(Number),stored=lights.chunks.get(key);
    for(let i=0;i<4096;i++) {
      const emission=Math.max((stored?.[i]??0)&15,blocks[cells[i]]?.light??0);if(!emission)continue;
      const x=cx*16+(i&15),y=cy*16+(i>>8),z=cz*16+((i>>4)&15);
      set(x,y,z,light(x,y,z)>>4,emission);
    }
  }
  for(let head=0;head<queue.length;head++) {
    const encoded=queue[head],x=encoded%width+minX,z=Math.floor(encoded/width)%depth+minZ,y=Math.floor(encoded/stride)+minY,source=light(x,y,z);
    for(const [dx,dy,dz] of directions) {
      const X=x+dx,Y=y+dy,Z=z+dz;if(X<minX||X>=maxX||Z<minZ||Z>=maxZ||Y<minY||Y>=maxY)continue;
      const loss=Math.max(1,blocks[voxels.get(X,Y,Z)]?.opacity??0),old=light(X,Y,Z);
      const sky=Math.max(old>>4,(source>>4)-loss),block=Math.max(old&15,(source&15)-loss);
      if(sky!==(old>>4)||block!==(old&15))set(X,Y,Z,sky,block);
    }
    // Keep consumed entries from retaining the entire world's flood-fill frontier.
    if(head===1048575){queue.splice(0,head+1);head=-1;}
  }
  return light;
}
