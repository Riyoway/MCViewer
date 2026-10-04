import type {Block,Vec3} from './types';
import {Voxels} from './Voxels';

// Recompute a bounded light region from actual sources, not yesterday's torch light.
// A changed source cannot reach the boundary 16 blocks away (levels are 0..15).
export function editLighting(voxels:Voxels,blocks:Block[],lights:Voxels,positions:Vec3[],height:number,loaded:(x:number,z:number)=>boolean,read:(x:number,y:number,z:number)=>number){
  const minX=Math.min(...positions.map(p=>p[0]))-16,maxX=Math.max(...positions.map(p=>p[0]))+17,minZ=Math.min(...positions.map(p=>p[2]))-16,maxZ=Math.max(...positions.map(p=>p[2]))+17;
  const width=maxX-minX,depth=maxZ-minZ,stride=width*depth,maxY=Math.min(height,Math.max(...positions.map(p=>p[1]))+17),size=stride*maxY;
  const values=new Uint8Array(size),losses=new Uint8Array(size),active=new Uint8Array(stride),queue:number[]=[];
  const sections=new Map<string,Uint16Array|undefined>();
  const at=(x:number,y:number,z:number)=>{const key=`${x>>4},${y>>4},${z>>4}`;if(!sections.has(key))sections.set(key,voxels.chunks.get(key));return blocks[sections.get(key)?.[((y&15)*16+(z&15))*16+(x&15)]??0];};
  for(let z=minZ;z<maxZ;z++)for(let x=minX;x<maxX;x++){
    const cell=(z-minZ)*width+x-minX;if(!loaded(x,z))continue;active[cell]=1;let sky=15;
    for(let y=height-1;y>=0;y--){const block=at(x,y,z),opacity=block?.opacity??0;sky=Math.max(0,sky-opacity);if(y>=maxY)continue;
      const i=y*stride+cell;losses[i]=Math.max(1,opacity);values[i]=(sky<<4)|(block?.light??0);if(block?.light)queue.push(i);
      if(x===minX||x===maxX-1||z===minZ||z===maxZ-1||maxY<height&&y===maxY-1){const saved=read(x,y,z);values[i]=Math.max(values[i]>>4,saved>>4)*16+Math.max(values[i]&15,saved&15);queue.push(i);}
    }
  }
  const offsets=[1,-1,width,-width,stride,-stride];
  const neighbors=(i:number,fn:(j:number)=>void)=>{
    const cell=i%stride,x=cell%width,z=Math.floor(cell/width),y=Math.floor(i/stride);
    for(let side=0;side<6;side++){if(side===0&&x===width-1||side===1&&x===0||side===2&&z===depth-1||side===3&&z===0||side===4&&y===maxY-1||side===5&&y===0)continue;const j=i+offsets[side];if(active[j%stride])fn(j);}
  };
  // Direct skylight seeds only the frontier, rather than queuing every sky cell.
  for(let i=0;i<size;i++)if(active[i%stride]&&(values[i]>>4)>1){let frontier=false;neighbors(i,j=>{if((values[j]>>4)<(values[i]>>4)-losses[j])frontier=true;});if(frontier)queue.push(i);}
  for(let head=0;head<queue.length;head++){const i=queue[head],source=values[i];neighbors(i,j=>{const old=values[j],sky=Math.max(old>>4,(source>>4)-losses[j]),emitted=Math.max(old&15,(source&15)-losses[j]);if((sky<<4|emitted)!==old){values[j]=sky<<4|emitted;queue.push(j);}});}
  const dirty=new Set<string>();
  for(let i=0;i<size;i++)if(active[i%stride]){const x=i%width+minX,z=Math.floor(i/width)%depth+minZ,y=Math.floor(i/stride),value=values[i];if(read(x,y,z)!==value){lights.set(x,y,z,value);for(let Y=Math.max(0,y-1);Y<=y+1;Y++)for(let Z=z-1;Z<=z+1;Z++)for(let X=x-1;X<=x+1;X++)dirty.add(`${X>>4},${Y>>4},${Z>>4}`);}}
  return dirty;
}
