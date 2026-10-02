import type { Vec3 } from '../minecraft/types';
import { Collision } from './Collision';

export class Movement {
  readonly position:Vec3=[0,80,0];vx=0;vz=0;vy=0;grounded=false;flying=false;swimming=false;
  constructor(public collision:Collision){}
  stop(){this.vx=0;this.vz=0;this.vy=0;}
  tick(forward:number,strafe:number,yaw:number,jump:boolean,sprint:boolean,sneak:boolean) {
    if(!this.collision.loaded(this.position[0],this.position[2]))return;
    const length=Math.max(1,Math.hypot(forward,strafe));forward/=length;strafe/=length;
    const b=this.collision.blocks[this.collision.voxels.get(Math.floor(this.position[0]),Math.floor(this.position[1]+.5),Math.floor(this.position[2]))];
    this.swimming=!!b?.fluid&&b.name==='water';
    const speed=this.flying?(sprint?.55:.3):this.swimming?.1:sneak?.065:sprint&&forward>0?.2806:.21585;
    const targetX=(strafe*Math.cos(yaw)-forward*Math.sin(yaw))*speed,targetZ=(-strafe*Math.sin(yaw)-forward*Math.cos(yaw))*speed;
    const ease=this.grounded||this.flying||this.swimming?.45:.12;
    this.vx+=(targetX-this.vx)*ease;this.vz+=(targetZ-this.vz)*ease;
    if(!forward&&!strafe){this.vx*=this.grounded?.65:.98;this.vz*=this.grounded?.65:.98;}
    if(this.flying)this.vy=jump?.25:sneak?-.25:0;
    else if(this.swimming)this.vy=(this.vy+(jump?.04:-.02))*.8;
    else if(jump&&this.grounded){this.vy=.42;this.grounded=false;if(sprint&&forward>0){this.vx-=Math.sin(yaw)*.2;this.vz-=Math.cos(yaw)*.2;}}
    const x=this.position[0],z=this.position[2];
    this.collision.move(this.position,this.vx,this.vz,this.grounded&&!this.flying,sneak&&!this.flying);
    if(Math.abs(this.position[0]-x)<.00001)this.vx=0;if(Math.abs(this.position[2]-z)<.00001)this.vz=0;
    const descending=this.vy<=0,hit=this.collision.vertical(this.position,this.vy||-.001);
    this.grounded=descending&&hit&&!this.flying&&!this.swimming;
    if(hit)this.vy=0;
    if(!this.flying&&!this.swimming)this.vy=(this.vy-.08)*.98;
  }
}
