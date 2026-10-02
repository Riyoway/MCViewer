import { Voxels } from '../minecraft/Voxels';
import type { Block, Vec3 } from '../minecraft/types';
export interface Collider { min:Vec3; max:Vec3; enabled?:boolean }
export const RADIUS=.28, HEIGHT=1.8, STEP=.6;

export class Collision {
  readonly extra:Collider[]=[];
  loaded=(x:number,z:number)=>true;
  constructor(readonly voxels:Voxels,readonly blocks:Block[]) {}
  private each(min:Vec3,max:Vec3,fn:(a:Vec3,b:Vec3)=>void) {
    for(let y=Math.floor(min[1]);y<=Math.floor(max[1]);y++) for(let z=Math.floor(min[2]);z<=Math.floor(max[2]);z++) for(let x=Math.floor(min[0]);x<=Math.floor(max[0]);x++) {
      const block=this.blocks[this.voxels.get(x,y,z)];if(!block?.solid)continue;
      // Axis-aligned stair/slab/fence collision boxes from the pack's block model.
      for(const box of block.collision) {
        const from=box.from,to=box.to;
        fn([x+from[0],y+from[1],z+from[2]],[x+to[0],y+to[1],z+to[2]]);
      }
    }
    for(const collider of this.extra) if(collider.enabled!==false)fn(collider.min,collider.max);
  }
  overlaps(x:number,y:number,z:number):boolean {
    const min:Vec3=[x-RADIUS,y+.001,z-RADIUS],max:Vec3=[x+RADIUS,y+HEIGHT,z+RADIUS];let hit=false;
    this.each(min,max,(a,b)=>{if(min[0]<b[0]&&max[0]>a[0]&&min[1]<b[1]&&max[1]>a[1]&&min[2]<b[2]&&max[2]>a[2])hit=true;});
    return hit;
  }
  ground(x:number,y:number,z:number):number {
    const min:Vec3=[x-RADIUS,y-1,z-RADIUS],max:Vec3=[x+RADIUS,y+STEP+.002,z+RADIUS];let top=-Infinity;
    this.each(min,max,(a,b)=>{
      if(min[0]<b[0]&&max[0]>a[0]&&min[2]<b[2]&&max[2]>a[2]&&b[1]<=max[1]&&b[1]>=min[1])top=Math.max(top,b[1]);
    });return top;
  }
  move(position:Vec3,dx:number,dz:number,grounded=true,sneak=false) {
    // Substeps prevent tunneling during a slow frame; resolve axes for wall sliding.
    const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dz))/.12));
    for(let n=0;n<steps;n++)for(const axis of [0,2]) {
      const next=position[axis]+(axis===0?dx:dz)/steps;
      const x=axis===0?next:position[0],z=axis===2?next:position[2];
      if(!this.loaded(x-RADIUS,z-RADIUS)||!this.loaded(x+RADIUS,z+RADIUS))continue;
      const ground=this.ground(x,position[1],z);
      if(sneak&&grounded&&(!Number.isFinite(ground)||ground<position[1]-.6))continue;
      if(!this.overlaps(x,position[1],z))position[axis]=next;
      else if(grounded&&ground>=position[1]&&ground-position[1]<=STEP+.001&&!this.overlaps(x,ground,z)) {position[axis]=next;position[1]=ground;}
    }
  }
  vertical(position:Vec3,dy:number):boolean {
    if(!this.loaded(position[0],position[2]))return true;
    const [x,y,z]=position,min:Vec3=[x-RADIUS,Math.min(y,y+dy)-.001,z-RADIUS],max:Vec3=[x+RADIUS,Math.max(y,y+dy)+HEIGHT+.001,z+RADIUS];
    let target=y+dy;
    this.each(min,max,(a,b)=>{
      if(min[0]>=b[0]||max[0]<=a[0]||min[2]>=b[2]||max[2]<=a[2])return;
      if(dy<0&&b[1]<=y+.001&&b[1]>target)target=b[1];
      if(dy>0&&a[1]>=y+HEIGHT-.001&&a[1]<target+HEIGHT)target=a[1]-HEIGHT;
    });
    position[1]=target;return Math.abs(target-y-dy)>.00001;
  }
  point(x:number,y:number,z:number):boolean {
    let hit=false;this.each([x-.08,y-.08,z-.08],[x+.08,y+.08,z+.08],(a,b)=>{if(x+.08>a[0]&&x-.08<b[0]&&y+.08>a[1]&&y-.08<b[1]&&z+.08>a[2]&&z-.08<b[2])hit=true;});return hit;
  }
}
