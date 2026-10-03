import type { Vec3 } from '../minecraft/types';
import { Collision } from './Collision';
import { fluidHeight } from '../minecraft/Fluid';

export class Movement {
  readonly position:Vec3=[0,80,0];vx=0;vz=0;vy=0;grounded=false;flying=false;swimming=false;
  private jumpDelay=0;
  constructor(public collision:Collision){}
  stop(){this.vx=0;this.vz=0;this.vy=0;this.jumpDelay=0;}
  tick(forward:number,strafe:number,yaw:number,jump:boolean,sprint:boolean,sneak:boolean) {
    if(!this.collision.loaded(this.position[0],this.position[2]))return;
    const blockAt=(y:number)=>this.collision.blocks[this.collision.voxels.get(Math.floor(this.position[0]),Math.floor(y),Math.floor(this.position[2]))];
    this.swimming=!this.flying&&[.01,.9,1.79].some(offset=>{const y=this.position[1]+offset;return y-Math.floor(y)<fluidHeight(blockAt(y),blockAt(Math.floor(y)+1),'water');});
    const running=sprint&&forward>0&&!sneak,ground=blockAt(this.position[1]-.01);
    const friction=this.grounded&&!this.flying?(ground?.name==='blue_ice'?.989:/ice/.test(ground?.name??'')?.98:ground?.name==='slime_block'?.8:.6):1;
    const drag=this.swimming?.8:friction*.91;
    const acceleration=this.flying?(running?.1:.05):this.swimming?.02:this.grounded?(running?.13:.1)*.216/(friction**3):running?.026:.02;
    forward*=.98*(sneak&&!this.flying?.3:1);strafe*=.98*(sneak&&!this.flying?.3:1);
    const length=Math.max(1,Math.hypot(forward,strafe));forward/=length;strafe/=length;
    if(Math.abs(this.vx)<.003)this.vx=0;if(Math.abs(this.vz)<.003)this.vz=0;if(Math.abs(this.vy)<.003)this.vy=0;
    this.vx+=(strafe*Math.cos(yaw)-forward*Math.sin(yaw))*acceleration;
    this.vz+=(-strafe*Math.sin(yaw)-forward*Math.cos(yaw))*acceleration;
    if(this.jumpDelay)this.jumpDelay--;if(!jump)this.jumpDelay=0;
    if(this.flying)this.vy+=(Number(jump)-Number(sneak))*.15;
    else if(this.swimming){if(jump)this.vy+=.04;}
    else if(jump&&this.grounded&&!this.jumpDelay){this.vy=.42;this.jumpDelay=10;if(running){this.vx-=Math.sin(yaw)*.2;this.vz-=Math.cos(yaw)*.2;}}
    const [x,y,z]=this.position,dx=this.vx,dz=this.vz;
    this.collision.move(this.position,this.vx,this.vz,this.grounded&&!this.flying,sneak&&!this.flying);
    const horizontalHit=Math.abs(this.position[0]-x-dx)>.00001||Math.abs(this.position[2]-z-dz)>.00001;
    if(Math.abs(this.position[0]-x-dx)>.00001)this.vx=0;if(Math.abs(this.position[2]-z-dz)>.00001)this.vz=0;
    const descending=this.vy<=0,hit=this.collision.vertical(this.position,this.vy||-.001);
    if(this.flying&&descending&&hit)this.flying=false;
    this.grounded=descending&&hit&&!this.flying&&!this.swimming;
    if(hit)this.vy=0;
    this.vx*=drag;this.vz*=drag;
    if(this.flying)this.vy*=.6;
    else if(this.swimming){this.vy=this.vy*.8-.005;if(horizontalHit&&!this.collision.overlaps(this.position[0]+this.vx,y+.6,this.position[2]+this.vz))this.vy=.3;}
    else this.vy=(this.vy-.08)*.98;
  }
}
