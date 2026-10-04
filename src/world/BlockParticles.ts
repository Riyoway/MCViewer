import {Group,Mesh,Vector3,type Camera} from 'three';
import {AssetManager} from '../core/AssetManager';
import {emptyMesh} from '../minecraft/Mesher';
import type {BlockHit} from '../minecraft/Target';
import type {World} from '../minecraft/WorldLoader';
import {FACES,type Vec3} from '../minecraft/types';

import {createDebris,debrisBoxes,tickDebris,type TerrainParticle} from './TerrainParticles';
export class BlockParticles {
  readonly root=new Group();private batches:{mesh:Mesh;particles:TerrainParticle[];origin:Vec3;light:number}[]=[];private accumulator=0;
  private right=new Vector3();private up=new Vector3();
  constructor(private assets:AssetManager){}
  clear(){for(const batch of this.batches)batch.mesh.geometry.dispose();this.batches=[];this.root.clear();this.accumulator=0;}
  break(hit:BlockHit,light:number,world?:World){
    const block=this.assets.manifest.blocks[hit.id],data=emptyMesh(),particles=createDebris(debrisBoxes(block),hit.position);
    // The removed opaque voxel still contains its old zero light until the worker
    // finishes. Seed from its exposed face, then sample moving particles each frame.
    if(world){const face=FACES.indexOf(hit.face),p=[...hit.position] as Vec3;p[face>>1]+=face%2?-1:1;const exposed=world.light(...p);light=Math.max(light>>4,exposed>>4)*16+Math.max(light&15,exposed&15);}
    const tile=block.particle??block.tiles[0],tint=block.name==='grass_block'||!block.tinted.some(Boolean)?[1,1,1]:block.tint;
    for(const p of particles){
      const index=data.position.length/3,u=Math.random()*.75,v=Math.random()*.75;
      for(const uv of [[u,v+.25],[u+.25,v+.25],[u+.25,v],[u,v]]){data.position.push(...p.position);data.normal.push(0,0,1);data.uv.push(...uv);data.tile.push(tile);data.color.push(...tint.map(n=>n*.6));data.glow.push(0);data.light.push((light>>4)/15,(light&15)/15);}data.index.push(index,index+1,index+2,index,index+2,index+3);
    }
    if(!particles.length)return;
    const mesh=this.assets.mesh(data);mesh.frustumCulled=false;this.root.add(mesh);this.batches.push({mesh,particles,origin:hit.position,light});
    if(this.batches.length>8){const old=this.batches.shift()!;old.mesh.removeFromParent();old.mesh.geometry.dispose();}
  }
  update(dt:number,camera:Camera,world:World,active:boolean){
    if(active)this.accumulator+=Math.min(dt,.1);
    while(this.accumulator>=.05){this.accumulator-=.05;for(const batch of this.batches)for(const p of batch.particles)if(p.age<=p.life)tickDebris(p,(position,velocity)=>world.collision.particleMove(position,velocity));}
    this.right.set(1,0,0).applyQuaternion(camera.quaternion);this.up.set(0,1,0).applyQuaternion(camera.quaternion);
    const alpha=this.accumulator/.05;
    for(let i=this.batches.length-1;i>=0;i--){const batch=this.batches[i];
      if(batch.particles.every(p=>p.age>p.life)){batch.mesh.removeFromParent();batch.mesh.geometry.dispose();this.batches.splice(i,1);continue;}
      const attribute=batch.mesh.geometry.getAttribute('position'),lighting=batch.mesh.geometry.getAttribute('lightLevel');
      const sourceLight=world.light?.(...batch.origin)??batch.light,pending=world.stats?.editing;
      for(let n=0;n<batch.particles.length;n++){const p=batch.particles[n],size=p.age<=p.life?p.size:0,x=p.previous[0]+(p.position[0]-p.previous[0])*alpha,y=p.previous[1]+(p.position[1]-p.previous[1])*alpha,z=p.previous[2]+(p.position[2]-p.previous[2])*alpha;
        const level=world.light?.(Math.floor(p.position[0]),Math.floor(p.position[1]),Math.floor(p.position[2]))||sourceLight||(pending?batch.light:0);
        for(let j=0;j<4;j++){const a=j===0||j===3?-size:size,b=j<2?-size:size;attribute.setXYZ(n*4+j,x+this.right.x*a+this.up.x*b,y+this.right.y*a+this.up.y*b,z+this.right.z*a+this.up.z*b);lighting.setXY(n*4+j,(level>>4)/15,(level&15)/15);}
      }
      attribute.needsUpdate=true;lighting.needsUpdate=true;
    }
  }
}
