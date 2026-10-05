import { PerspectiveCamera, Vector3 } from 'three';
import { Collision } from './Collision';
import { Movement } from './Movement';
import { PlayerModel } from './PlayerModel';
import type { Vec3 } from '../minecraft/types';

export async function lockPointer(canvas:HTMLCanvasElement){try{await canvas.requestPointerLock({unadjustedMovement:true});}catch(error){if(error instanceof DOMException&&error.name==='NotSupportedError')await canvas.requestPointerLock();else throw error;}}

export class Player {
  readonly keys=new Set<string>();readonly movement:Movement;readonly position;
  yaw=0;pitch=0;locked=false;perspective=0;motionEnabled=false;sensitivity=.002;fov=70;
  private accumulator=0;private lastForward=-1000;private lastJump=-1000;private sprintToggle=false;
  readonly look=new Vector3();readonly eye=new Vector3();private bob=0;
  private previous:Vec3=[0,80,0];
  private ignoreMouse=true;private mouseTime=0;
  constructor(readonly camera:PerspectiveCamera,readonly model:PlayerModel,public collision:Collision,readonly canvas:HTMLCanvasElement,onLock:(locked:boolean)=>void) {
    this.movement=new Movement(collision);this.position=this.movement.position;this.locked=document.pointerLockElement===canvas;camera.rotation.order='YXZ';
    camera.add(model.hand);model.hand.position.set(.64,-.6,-.72);model.hand.rotation.set(0,Math.PI/4,0);
    document.addEventListener('pointerlockchange',()=>{this.locked=document.pointerLockElement===canvas;this.ignoreMouse=true;this.mouseTime=performance.now();if(!this.locked){this.stop();this.model.hand.visible=false;}onLock(this.locked);});
    document.addEventListener('mousemove',event=>{
      if(!this.locked)return;
      const now=performance.now(),elapsed=now-this.mouseTime;this.mouseTime=now;
      if(this.ignoreMouse||elapsed>250){this.ignoreMouse=false;return;}
      const x=event.movementX,y=event.movementY;
      // Chromium can emit a screen-sized warp when locking/focusing or crossing displays.
      if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>Math.max(300,canvas.clientWidth*.75)||Math.abs(y)>Math.max(300,canvas.clientHeight*.75))return;
      this.yaw-=x*this.sensitivity;this.pitch=Math.max(-Math.PI/2+.001,Math.min(Math.PI/2-.001,this.pitch-y*this.sensitivity));
    });
    window.addEventListener('keydown',event=>{
      if(!this.locked)return;
      if(event.code==='Escape'){document.exitPointerLock();return;}
      if(['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','ControlRight','ShiftLeft','ShiftRight','F5','KeyV','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();
      if(!event.repeat){
        const now=performance.now();
        if(event.code==='F5'||event.code==='KeyV')this.perspective=(this.perspective+1)%3;
        if(event.code==='KeyW'){if(now-this.lastForward<350)this.sprintToggle=true;this.lastForward=now;}
        if(event.code==='Space'){if(now-this.lastJump<350){this.movement.flying=!this.movement.flying;this.movement.vy=0;this.lastJump=-1000;}else this.lastJump=now;}
      }
      this.keys.add(event.code);
    });
    window.addEventListener('keyup',event=>{this.keys.delete(event.code);if(event.code==='KeyW')this.sprintToggle=false;});
    window.addEventListener('blur',()=>{this.stop();if(this.locked)document.exitPointerLock();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.stop();if(this.locked)document.exitPointerLock();}});
  }
  stop(){this.keys.clear();this.movement.stop();this.accumulator=0;this.sprintToggle=false;}
  lock(){return lockPointer(this.canvas);}
  update(dt:number) {
    if(dt===0)this.previous=[...this.position];
    const forward=this.locked?(Number(this.keys.has('KeyW')||this.keys.has('ArrowUp'))-Number(this.keys.has('KeyS')||this.keys.has('ArrowDown'))):0;
    const strafe=this.locked?(Number(this.keys.has('KeyD')||this.keys.has('ArrowRight'))-Number(this.keys.has('KeyA')||this.keys.has('ArrowLeft'))):0;
    const sprint=this.locked&&(this.sprintToggle||this.keys.has('ControlLeft')||this.keys.has('ControlRight')),sneak=this.locked&&(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'));
    this.accumulator+=dt;
    while(this.accumulator>=.05){this.previous=[...this.position];this.movement.tick(forward,strafe,this.yaw,this.locked&&this.keys.has('Space'),sprint,sneak);this.accumulator-=.05;}
    const rendered=this.position.map((n,i)=>this.previous[i]+(n-this.previous[i])*this.accumulator/.05) as Vec3;
    const speed=Math.hypot(this.position[0]-this.previous[0],this.position[2]-this.previous[2])*20;
    this.model.update(dt,this.yaw,this.pitch,forward,strafe,speed,!this.motionEnabled);
    this.model.root.position.set(...rendered);this.model.root.visible=this.perspective!==0;this.model.hand.visible=this.locked&&this.perspective===0;
    this.bob+=speed*dt*2.3;const amount=this.motionEnabled&&this.movement.grounded?Math.min(1,speed/4.3):0;
    this.eye.set(rendered[0],rendered[1]+(sneak&&!this.movement.flying?1.27:1.62),rendered[2]);
    this.look.set(-Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),-Math.cos(this.yaw)*Math.cos(this.pitch));
    if(this.perspective===0){
      this.camera.position.copy(this.eye);this.camera.position.y+=Math.abs(Math.sin(this.bob))*.035*amount;
      this.camera.rotation.set(this.pitch,this.yaw,Math.sin(this.bob)*.012*amount);
      this.model.hand.position.y+=Math.sin(this.bob)*.035*amount;
    }else {
      const side=this.perspective===1?-1:1;let distance=.3;
      for(let d=.3;d<=4;d+=.1){const p=this.eye.clone().addScaledVector(this.look,d*side);if(this.collision.point(p.x,p.y,p.z))break;distance=d;}
      this.camera.position.copy(this.eye).addScaledVector(this.look,distance*side);this.camera.lookAt(this.eye);
    }
    const target=this.fov*(sprint&&forward>0&&!sneak?1.15:1);this.camera.fov+=(target-this.camera.fov)*(1-Math.exp(-dt*8));this.camera.updateProjectionMatrix();
  }
}
