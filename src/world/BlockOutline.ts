import {BufferGeometry,Float32BufferAttribute,LineBasicMaterial,LineSegments} from 'three';
import type {Block} from '../minecraft/types';
import type {BlockHit} from '../minecraft/Target';
import {outlineBoxes} from '../minecraft/Target';

export class BlockOutline {
  readonly mesh=new LineSegments(new BufferGeometry(),new LineBasicMaterial({color:0x000000,transparent:true,opacity:.4,depthWrite:false}));private key='';
  constructor(){this.mesh.renderOrder=10;this.mesh.visible=false;}
  update(hit:BlockHit|null,blocks:Block[],visible:boolean){
    this.mesh.visible=!!hit&&visible;if(!hit)return;const key=`${hit.id}:${hit.position.join(',')}`;if(key===this.key)return;this.key=key;
    const points:number[]=[];
    for(const box of outlineBoxes(blocks[hit.id])){
      const min=box.from.map(n=>n-.002),max=box.to.map(n=>n+.002);
      const vertices=Array.from({length:8},(_,i)=>[i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]]);
      for(let i=0;i<8;i++)for(const mask of [1,2,4])if(!(i&mask))points.push(...vertices[i],...vertices[i|mask]);
    }
    this.mesh.geometry.dispose();this.mesh.geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(points,3));this.mesh.position.set(...hit.position);
  }
}
