import {Group,Mesh,Vector3,type Camera} from 'three';
import {AssetManager} from '../core/AssetManager';
import {emptyMesh} from '../minecraft/Mesher';
import {FACES,type Vec3} from '../minecraft/types';
import type {BlockHit} from '../minecraft/Target';
import type {World} from '../minecraft/WorldLoader';

interface Debris {position:Vector3;velocity:Vector3;size:number;age:number;life:number}
export class BlockParticles {
  readonly root=new Group();private batches:{mesh:Mesh;particles:Debris[]}[]=[];private accumulator=0;
  private right=new Vector3();private up=new Vector3();
  constructor(private assets:AssetManager){}
  clear(){for(const batch of this.batches)batch.mesh.geometry.dispose();this.batches=[];this.root.clear();}
  break(hit:BlockHit,light:number){
    const block=this.assets.manifest.blocks[hit.id],data=emptyMesh(),particles:Debris[]=[];
    const tile=block.cube?block.tiles[FACES.indexOf(hit.face)]:block.elements.flatMap(e=>Object.values(e.faces)).find(Boolean)?.tile??block.tiles[0];
    const tint=block.tinted.some(Boolean)?block.tint:[1,1,1];
    for(let y=0;y<4;y++)for(let z=0;z<4;z++)for(let x=0;x<4;x++){
      const offset=new Vector3((x+.5)/4,(y+.5)/4,(z+.5)/4),position=new Vector3(...hit.position).add(offset);
      particles.push({position,velocity:offset.clone().subScalar(.5),size:.05*(.5+Math.random()*.5),age:0,life:Math.floor(4/(Math.random()*.9+.1))});
      const index=data.position.length/3,u=Math.random()*.75,v=Math.random()*.75;
      for(const uv of [[u,v],[u+.25,v],[u+.25,v+.25],[u,v+.25]]){data.position.push(...position.toArray());data.normal.push(0,0,1);data.uv.push(...uv);data.tile.push(tile);data.color.push(...tint.map(n=>n*.6));data.glow.push(0);data.light.push((light>>4)/15,(light&15)/15);}data.index.push(index,index+1,index+2,index,index+2,index+3);
    }
    const mesh=this.assets.mesh(data);mesh.frustumCulled=false;this.root.add(mesh);this.batches.push({mesh,particles});
    if(this.batches.length>8){const old=this.batches.shift()!;old.mesh.removeFromParent();old.mesh.geometry.dispose();}
  }
  update(dt:number,camera:Camera,world:World,active:boolean){
    if(active)this.accumulator+=Math.min(dt,.1);
    while(this.accumulator>=.05){this.accumulator-=.05;for(const batch of this.batches)for(const p of batch.particles){
      if(p.age>=p.life)continue;p.age++;p.velocity.y-=.04;const next=p.position.clone().add(p.velocity),top=world.particleCollision(next.x,next.y,next.z);
      if(top!==null&&p.position.y>=top&&next.y<=top){next.y=top;p.velocity.y=0;p.velocity.x*=.7;p.velocity.z*=.7;}p.position.copy(next);p.velocity.multiplyScalar(.98);
    }}
    this.right.set(1,0,0).applyQuaternion(camera.quaternion);this.up.set(0,1,0).applyQuaternion(camera.quaternion);
    for(const batch of [...this.batches]){
      if(batch.particles.every(p=>p.age>=p.life)){batch.mesh.removeFromParent();batch.mesh.geometry.dispose();this.batches.splice(this.batches.indexOf(batch),1);continue;}
      const attribute=batch.mesh.geometry.getAttribute('position');
      for(const [i,p] of batch.particles.entries())for(const [j,[a,b]] of [[-1,-1],[1,-1],[1,1],[-1,1]].entries()){const size=p.age<p.life?p.size:0,point=p.position.clone().addScaledVector(this.right,a*size).addScaledVector(this.up,b*size);attribute.setXYZ(i*4+j,point.x,point.y,point.z);}attribute.needsUpdate=true;
    }
  }
}
