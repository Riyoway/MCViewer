import type {Block,Vec3} from './types';
import {Voxels} from './Voxels';

// Recompute a bounded light region from actual sources, not yesterday's torch light.
// A changed source cannot reach the boundary 16 blocks away (levels are 0..15).
export function editLighting(voxels:Voxels,blocks:Block[],lights:Voxels,positions:Vec3[],height:number,loaded:(x:number,z:number)=>boolean,read:(x:number,y:number,z:number)=>number,minY=0){
  const minX=Math.min(...positions.map(p=>p[0]))-16,maxX=Math.max(...positions.map(p=>p[0]))+17,minZ=Math.min(...positions.map(p=>p[2]))-16,maxZ=Math.max(...positions.map(p=>p[2]))+17;
  const width=maxX-minX,depth=maxZ-minZ,stride=width*depth,maxY=Math.min(height,Math.max(...positions.map(p=>p[1]))+17),levels=maxY-minY,size=stride*levels,firstSection=Math.floor(minY/16);
  const values=new Uint8Array(size),losses=new Uint8Array(size),active=new Uint8Array(stride),queue:number[]=[];
  const columns=new Map<string,(Uint16Array|undefined)[]>();
  for(let z=minZ;z<maxZ;z++)for(let x=minX;x<maxX;x++){
    const cell=(z-minZ)*width+x-minX;if(!loaded(x,z))continue;active[cell]=1;let sky=15;
    const key=`${x>>4},${z>>4}`;let sections=columns.get(key);if(!sections){sections=Array.from({length:Math.ceil(height/16)-firstSection},(_,cy)=>voxels.chunks.get(`${x>>4},${cy+firstSection},${z>>4}`));columns.set(key,sections);}
    for(let y=height-1;y>=minY;y--){const block=blocks[sections[(y>>4)-firstSection]?.[((y&15)*16+(z&15))*16+(x&15)]??0],opacity=block?.opacity??0;sky=Math.max(0,sky-opacity);if(y>=maxY)continue;
      const i=(y-minY)*stride+cell;losses[i]=Math.max(1,opacity);values[i]=(sky<<4)|(block?.light??0);if(block?.light)queue.push(i);
      if(x===minX||x===maxX-1||z===minZ||z===maxZ-1||maxY<height&&y===maxY-1){const saved=read(x,y,z);values[i]=Math.max(values[i]>>4,saved>>4)*16+Math.max(values[i]&15,saved&15);queue.push(i);}
    }
  }
  const offsets=[1,-1,width,-width,stride,-stride];
  const neighbors=(i:number,fn:(j:number)=>void)=>{
    const cell=i%stride,x=cell%width,z=Math.floor(cell/width),y=Math.floor(i/stride);
    for(let side=0;side<6;side++){if(side===0&&x===width-1||side===1&&x===0||side===2&&z===depth-1||side===3&&z===0||side===4&&y===levels-1||side===5&&y===0)continue;const j=i+offsets[side];if(active[j%stride])fn(j);}
  };
  // Direct skylight seeds only the frontier, rather than queuing every sky cell.
  for(let i=0;i<size;i++)if(active[i%stride]&&(values[i]>>4)>1){let frontier=false;neighbors(i,j=>{if((values[j]>>4)<(values[i]>>4)-losses[j])frontier=true;});if(frontier)queue.push(i);}
  for(let head=0;head<queue.length;head++){const i=queue[head],source=values[i];neighbors(i,j=>{const old=values[j],sky=Math.max(old>>4,(source>>4)-losses[j]),emitted=Math.max(old&15,(source&15)-losses[j]);if((sky<<4|emitted)!==old){values[j]=sky<<4|emitted;queue.push(j);}});}
  const dirty=new Set<string>();
  for(let i=0;i<size;i++)if(active[i%stride]){const x=i%width+minX,z=Math.floor(i/width)%depth+minZ,y=minY+Math.floor(i/stride),value=values[i];if(read(x,y,z)!==value){lights.set(x,y,z,value);for(let Y=Math.max(minY,y-1)>>4;Y<=(y+1)>>4;Y++)for(let Z=(z-1)>>4;Z<=(z+1)>>4;Z++)for(let X=(x-1)>>4;X<=(x+1)>>4;X++)dirty.add(`${X},${Y},${Z}`);}}
  return dirty;
}
