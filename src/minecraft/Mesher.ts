import { CHUNK, Voxels } from './Voxels';
import { FACES } from './types';
import type { Block, MeshData, Vec3, Element } from './types';
import { fluidKind, fluidHeight, fluidFlow } from './Fluid';

export const emptyMesh = (): MeshData => ({ position: [], normal: [], uv: [], tile: [], color: [], glow: [], light: [], index: [] });
const directions: Vec3[] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const shades = [0.6, 0.6, 1, 0.5, 0.8, 0.8];

// Check the union of face rectangles, including the two boxes of a stair.
export function coversFace(boxes:Block['collision'],face:number,height=1):boolean {
  const axis=Math.floor(face/2),a=(axis+1)%3,b=(axis+2)%3,edge=face%2===0?1:0;
  const A=a===1?height:1,B=b===1?height:1;
  const rects=boxes.filter(box=>Math.abs((face%2===0?box.to:box.from)[axis]-edge)<1e-6);
  if(!rects.length)return false;
  const cuts=(d:number,max:number)=>[...new Set([0,max,...rects.flatMap(r=>[r.from[d],r.to[d]]).filter(v=>v>0&&v<max)])].sort((x,y)=>x-y);
  const u=cuts(a,A),v=cuts(b,B);
  for(let i=1;i<u.length;i++)for(let j=1;j<v.length;j++) {
    const x=(u[i-1]+u[i])/2,y=(v[j-1]+v[j])/2;
    if(!rects.some(r=>r.from[a]<=x&&r.to[a]>=x&&r.from[b]<=y&&r.to[b]>=y))return false;
  }
  return true;
}

// LiquidBlockRenderer: weighted corner heights, flow UVs and same-fluid culling.
function appendFluid(mesh:MeshData,p:Vec3,block:Block,sample:(x:number,y:number,z:number)=>Block|undefined,lighting:(x:number,y:number,z:number)=>number) {
  const kind=fluidKind(block)!,tiles=block.fluidTiles??[block.tiles[2],block.tiles[2]],own=fluidHeight(block,sample(p[0],p[1]+1,p[2]),kind);
  const height=(dx:number,dz:number)=>{const b=sample(p[0]+dx,p[1],p[2]+dz);return fluidKind(b)===kind?fluidHeight(b,sample(p[0]+dx,p[1]+1,p[2]+dz),kind):b?.solid?-1:0;};
  const north=height(0,-1),south=height(0,1),east=height(1,0),west=height(-1,0);
  const corner=(a:number,b:number,dx:number,dz:number)=>{
    if(own>=1||a>=1||b>=1)return 1;
    const levels=[own,a,b];if(a>0||b>0){const diagonal=height(dx,dz);if(diagonal>=1)return 1;levels.push(diagonal);}
    let sum=0,weight=0;for(const h of levels)if(h>=0){const w=h>=.8?10:1;sum+=h*w;weight+=w;}return sum/weight;
  };
  // Same order as faceCorners(up): SW, SE, NE, NW.
  const heights=[corner(south,west,-1,1),corner(south,east,1,1),corner(north,east,1,-1),corner(north,west,-1,-1)];
  const value=lighting(...p),above=lighting(p[0],p[1]+1,p[2]),light=[Math.max(value>>4,above>>4)/15,Math.max(value&15,above&15)/15];
  const occluded=(b:Block|undefined,face:number,h:number)=>!!b?.solid&&!b.transparent&&!b.name.endsWith('_leaves')&&coversFace(b.collision,face,h);
  const emit=(face:number,corners:Vec3[],uv:number[],tile:number,back=false)=>{
    const offset=mesh.position.length/3;
    quad(mesh,corners,directions[face],uv,tile,(kind==='water'?(block.fluid?block.tint:[.29,.55,.95]):[1,1,1]).map(n=>n*shades[face]),block.emissive,light);
    if(back)mesh.index.push(offset+2,offset+1,offset,offset+3,offset+2,offset);
  };
  const upper=sample(p[0],p[1]+1,p[2]);
  const top=fluidKind(upper)!==kind&&!occluded(block,2,1)&&!(Math.min(...heights)>=1&&occluded(upper,3,1));
  const lower=sample(p[0],p[1]-1,p[2]),bottom=fluidKind(lower)!==kind&&!occluded(block,3,1)&&!occluded(lower,2,1);
  const surface=heights.map(h=>h-(top?.001:0)),base=bottom?.001:0;
  if(top) {
    const [fx,,fz]=fluidFlow(sample,p,kind),moving=fx!==0||fz!==0;
    const angle=Math.atan2(fz,fx)-Math.PI/2,s=Math.sin(angle)*.25,c=Math.cos(angle)*.25;
    const uv=moving?[.5-c+s,.5-c-s,.5+c+s,.5-c+s,.5+c-s,.5+c+s,.5-c-s,.5+c-s]:[0,0,1,0,1,1,0,1];
    const corners=faceCorners(p,[p[0]+1,p[1]+1,p[2]+1],2);corners.forEach((v,i)=>v[1]=p[1]+surface[i]);
    emit(2,corners,uv,tiles[moving?1:0],true);
  }
  if(bottom)emit(3,faceCorners([p[0],p[1]+.001,p[2]],[p[0]+1,p[1]+1,p[2]+1],3),[0,0,1,0,1,1,0,1],tiles[0]);
  for(const face of [0,1,4,5]) {
    const dir=directions[face],neighbor=sample(p[0]+dir[0],p[1],p[2]+dir[2]);
    const indices=({0:[1,2],1:[3,0],4:[0,1],5:[2,3]} as Record<number,number[]>)[face],h=indices.map(i=>surface[i]);
    if(fluidKind(neighbor)===kind||occluded(block,face,1)||occluded(neighbor,face^1,Math.max(...h)))continue;
    const corners=faceCorners(p,[p[0]+1,p[1]+1,p[2]+1],face);
    corners.forEach((v,i)=>{v[Math.floor(face/2)]-=dir[Math.floor(face/2)]*.001;v[1]=p[1]+(i<2?base:h[i===2?1:0]);});
    const overlay=kind==='water'&&(neighbor?.transparent||neighbor?.name.endsWith('_leaves'))&&tiles[2]!==undefined;
    emit(face,corners,[0,.5,.5,.5,.5,.5+h[1]*.5,0,.5+h[0]*.5],tiles[overlay?2:1],!overlay);
  }
}

function quad(mesh: MeshData, corners: Vec3[], normal: Vec3, uv: number[], tile: number, tint: number[], glow: number, light=[1,0], ao=[3,3,3,3]) {
  const offset = mesh.position.length / 3;
  for (let i = 0; i < 4; i++) {
    mesh.position.push(...corners[i]); mesh.normal.push(...normal);
    mesh.uv.push(uv[i * 2], uv[i * 2 + 1]); mesh.tile.push(tile);
    mesh.color.push(...tint.map(n=>n*(.4+ao[i]*.2))); mesh.glow.push(glow);mesh.light.push(...(light.length===2?light:light.slice(i*2,i*2+2)));
  }
  mesh.index.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

export function faceCorners(from: Vec3, to: Vec3, face: number): Vec3[] {
  const [x,y,z] = from, [X,Y,Z] = to;
  return [
    [[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]], [[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],
    [[x,Y,Z],[X,Y,Z],[X,Y,z],[x,Y,z]], [[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],
    [[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]], [[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]],
  ][face] as Vec3[];
}

function rotate(v: Vec3, origin: Vec3, axis: number, angle: number, rescale = false): Vec3 {
  const a = (axis + 1) % 3, b = (axis + 2) % 3;
  const c = Math.cos(angle), s = Math.sin(angle), u = v[a] - origin[a], w = v[b] - origin[b];
  const scale = rescale ? 1 / Math.cos(angle) : 1;
  v[a] = origin[a] + (u * c - w * s) * scale;
  v[b] = origin[b] + (u * s + w * c) * scale;
  return v;
}

export function appendElement(mesh: MeshData, element: Element, position: Vec3, block: Block, voxels?: Voxels, blocks?: Block[], light:number[]|((x:number,y:number,z:number)=>number)=[1,0]) {
  const transform=element.transform??block.rotation;
  for (let face = 0; face < 6; face++) {
    const info = element.faces[FACES[face]];
    if (!info) continue;
    if (info.cull && voxels && blocks) {
      const dir = [...directions[FACES.indexOf(info.cull)]] as Vec3;
      for(const axis of [0,1,2])if(transform[axis])rotate(dir,[0,0,0],axis,-transform[axis]*Math.PI/180);
      dir.forEach((n,i)=>dir[i]=Math.round(n));
      const neighbor = blocks[voxels.get(position[0]+dir[0],position[1]+dir[1],position[2]+dir[2])];
      if (neighbor?.occludes) continue;
    }
    const corners = faceCorners(element.from, element.to, face);
    const n = [...directions[face]] as Vec3;
    if (element.rotation) {
      const r = element.rotation, axis = 'xyz'.indexOf(r.axis), angle = r.angle * Math.PI / 180;
      corners.forEach(v => rotate(v, r.origin, axis, angle, r.rescale));
      rotate(n, [0,0,0], axis, angle);
    }
    for (const axis of [0,1,2]) if (transform[axis]) {
      const angle = -transform[axis] * Math.PI / 180;
      corners.forEach(v => rotate(v, [.5,.5,.5], axis, angle)); rotate(n,[0,0,0],axis,angle);
    }
    corners.forEach(v => { v[0]+=position[0]; v[1]+=position[1]; v[2]+=position[2]; });
    const [u,v,U,V] = info.uv.map(n => n / 16);
    const pairs = [[u,1-V],[U,1-V],[U,1-v],[u,1-v]];
    for (let i = 0; i < (info.rotation ?? 0) / 90; i++) pairs.unshift(pairs.pop()!);
    const shade=n[0]**2*.6+n[1]**2*(n[1]>0?1:.5)+n[2]**2*.8;
    const tint = (info.tint ? block.tint : [1,1,1]).map(n => n * shade);
    const center=corners.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/4) as Vec3,[0,0,0] as Vec3);
    const value=typeof light==='function'?light(...center.map((v,i)=>Math.floor(v+n[i]*.001)) as Vec3):0;
    quad(mesh, corners, n, pairs.flat(), info.tile, tint, block.emissive,typeof light==='function'?[(value>>4)/15,(value&15)/15]:light);
  }
}

// Faces merge only within a 16³ chunk; neighbors across chunk boundaries still cull.
export function meshChunk(voxels: Voxels, blocks: Block[], origin: Vec3, lighting=(x:number,y:number,z:number):number=>240, dynamicDoors=false): { opaque: MeshData; transparent: MeshData } {
  const opaque = emptyMesh(), transparent = emptyMesh();
  const mask = new Uint32Array(CHUNK * CHUNK), skyLevels=new Uint32Array(CHUNK*CHUNK), blockLevels=new Uint32Array(CHUNK*CHUNK), occlusion=new Uint8Array(CHUNK*CHUNK);
  // Cache the 27 neighboring arrays: meshing never builds a Map key per block face.
  const chunks=new Map<number,Uint16Array>();
  for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++) {
    const data=voxels.chunks.get(`${origin[0]/16+x},${origin[1]/16+y},${origin[2]/16+z}`);
    if(data)chunks.set((y+1)*9+(z+1)*3+x+1,data);
  }
  const sample=(x:number,y:number,z:number)=>chunks.get((Math.floor(y/16)+1)*9+(Math.floor(z/16)+1)*3+Math.floor(x/16)+1)?.[((y&15)*16+(z&15))*16+(x&15)]??0;
  const opaqueAt=(x:number,y:number,z:number)=>{const block=blocks[sample(x,y,z)];return !!block&&(block.occludes||block.name.endsWith('_leaves'));};
  const level=(p:Vec3)=>lighting(p[0]+origin[0],p[1]+origin[1],p[2]+origin[2]);
  const own=chunks.get(13);if(!own)return {opaque,transparent};
  const full=own.every(id=>blocks[id]?.occludes&&blocks[id]?.cube);
  for (let face = 0; face < 6; face++) {
    const axis = Math.floor(face / 2), a = (axis + 1) % 3, b = (axis + 2) % 3, dir = directions[face];
    for (let slice = 0; slice < CHUNK; slice++) {
      if(full&&slice!==(face%2===0?15:0))continue;
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
        const p:Vec3=[0,0,0];p[axis]=slice;p[a]=i;p[b]=j;
        const id=sample(...p),block=blocks[id],q:Vec3=[p[0]+dir[0],p[1]+dir[1],p[2]+dir[2]];
        const neighborId=sample(...q),neighbor=blocks[neighborId],cell=j*CHUNK+i;
        mask[cell]=block?.cube&&!block.fluid&&(!neighbor||!neighbor.occludes&&(!block.transparent||neighborId!==id))?id:0;
        if(!mask[cell])continue;
        const centerLight=level(q);let packed=0,packedSky=0,packedBlock=0;
        const corners=faceCorners([0,0,0],[1,1,1],face);
        for(let n=0;n<4;n++) {
          const u=corners[n][a]===0?-1:1,w=corners[n][b]===0?-1:1;
          const s=[...q] as Vec3,t=[...q] as Vec3,c=[...q] as Vec3;s[a]+=u;t[b]+=w;c[a]+=u;c[b]+=w;
          const A=Number(opaqueAt(...s)),B=Number(opaqueAt(...t)),C=Number(opaqueAt(...c));
          const value=block.transparent||block.emissive?3:A&&B?0:3-A-B-C;packed|=value<<(n*2);
          const levels=[centerLight,level(s)||centerLight,level(t)||centerLight,level(c)||centerLight];
          packedSky|=levels.reduce((sum,l)=>sum+(l>>4),0)<<(n*8);
          packedBlock|=levels.reduce((sum,l)=>sum+(l&15),0)<<(n*8);
        }
        occlusion[cell]=packed;skyLevels[cell]=packedSky;blockLevels[cell]=packedBlock;
      }
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK;) {
        const id = mask[j * CHUNK + i];
        if (!id) { i++; continue; }
        const cell=j*CHUNK+i,sky=skyLevels[cell],torch=blockLevels[cell],ao=Array.from({length:4},(_,n)=>(occlusion[cell]>>(n*2))&3),levels=Array.from({length:4},(_,n)=>[(sky>>>(n*8)&255)/60,(torch>>>(n*8)&255)/60]),merge=ao.every(n=>n===ao[0])&&levels.every(l=>l[0]===levels[0][0]&&l[1]===levels[0][1]);
        const same=(cell:number)=>mask[cell]===id&&skyLevels[cell]===sky&&blockLevels[cell]===torch&&occlusion[cell]===occlusion[j*CHUNK+i];
        let width = 1, height = 1;
        while (merge&&i+width < CHUNK && same(j*CHUNK+i+width)) width++;
        outer: while (j+height < CHUNK) {
          if(!merge)break;
          for (let k = 0; k < width; k++) if (!same((j+height)*CHUNK+i+k)) break outer;
          height++;
        }
        const block = blocks[id], from = [...origin] as Vec3, to = [...origin] as Vec3;
        from[axis]+=slice; to[axis]+=slice+1;
        from[a]+=i; to[a]+=i+width; from[b]+=j; to[b]+=j+height;
        const corners = faceCorners(from, to, face);
        // X and Y faces start along the mask's second axis; Z faces start along its first.
        const w = axis < 2 ? height : width, h = axis < 2 ? width : height;
        const uv = [0,0,w,0,w,h,0,h];
        for(let rotation=0;rotation<block.uvRotations[face];rotation++)for(let n=0;n<8;n+=2){const u=uv[n];uv[n]=uv[n+1];uv[n+1]=1-u;}
        const tint = (block.tinted[face] ? block.tint : [1,1,1]).map(n => n * shades[face]);
        quad(block.transparent ? transparent : opaque, corners, dir, uv, block.tiles[face], tint, block.emissive,levels.flat(),ao);
        for (let v=0; v<height; v++) for (let u=0; u<width; u++) mask[(j+v)*CHUNK+i+u]=0;
        i+=width;
      }
    }
  }
  if(full)return {opaque,transparent};
  for (let y=0;y<CHUNK;y++) for (let z=0;z<CHUNK;z++) for (let x=0;x<CHUNK;x++) {
    const p: Vec3 = [origin[0]+x,origin[1]+y,origin[2]+z], block=blocks[sample(x,y,z)];
    if (!block)continue;
    if(fluidKind(block))appendFluid(block.name==='lava'?opaque:transparent,p,block,(X,Y,Z)=>blocks[sample(X-origin[0],Y-origin[1],Z-origin[2])],lighting);
    if (block.fluid||block.cube||dynamicDoors&&/door$/.test(block.name)) continue;
    for (const element of block.elements) appendElement(block.transparent ? transparent : opaque,element,p,block,voxels,blocks,lighting);
  }
  return { opaque, transparent };
}
