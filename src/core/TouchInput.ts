export type TouchMode='joystick-tap'|'dpad-tap'|'joystick-crosshair';
export type TouchRole='move'|'look'|'jump'|'descend'|'sneak'|'sprint'|'attack'|'use';
export interface TouchOptions {touchMode:TouchMode;touchSensitivity:number;touchSize:number;touchOpacity:number;fixedJoystick:boolean;sprintOnMovement:boolean;showActionButtons:boolean;autoJump:boolean;delayedBreaking:boolean}
export const touchDefaults:TouchOptions={touchMode:'joystick-tap',touchSensitivity:100,touchSize:100,touchOpacity:65,fixedJoystick:true,sprintOnMovement:false,showActionButtons:true,autoJump:true,delayedBreaking:true};
export interface TouchMotion {forward:number;strafe:number;jump:boolean;descend:boolean;sneak:boolean;sprint:boolean}
export function joystickVector(dx:number,dy:number,radius:number){
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(radius))return {strafe:0,forward:0,sprint:false};
  const length=Math.hypot(dx,dy),distance=Math.min(1,length/Math.max(1,radius)),strength=distance<.12?0:(distance-.12)/.88;
  return {strafe:strength&&length?dx/length*strength:0,forward:strength&&length?-dy/length*strength:0,sprint:length>radius&&-dy/Math.max(1,length)>.8};
}
interface Finger {role:TouchRole;x:number;y:number;startX:number;startY:number;time:number;dragged:boolean;breaking:boolean;cx:number;cy:number;radius:number}
interface TouchEvents {look:(dx:number,dy:number)=>void;jump:()=>void;descend?:()=>void;action:(button:0|2,down:boolean)=>void;aim:(x:number|null,y?:number)=>void}
// Every finger owns its gesture until release. A second thumb never replaces the
// camera pointer, and moving a mining finger cancels mining before turning.
export class TouchInput {
  readonly fingers=new Map<number,Finger>();
  readonly motion:TouchMotion={forward:0,strafe:0,jump:false,descend:false,sneak:false,sprint:false};
  private sprint=false;private lastForward=-Infinity;private moveSprint=false;
  constructor(public options:TouchOptions,readonly events:TouchEvents){}
  down(id:number,role:TouchRole,x:number,y:number,time:number,cx=x,cy=y,radius=50){
    if(this.fingers.has(id)||[...this.fingers.values()].some(f=>f.role===role&&(role==='move'||role==='look')))return false;
    this.fingers.set(id,{role,x,y,startX:x,startY:y,time,dragged:false,breaking:false,cx,cy,radius});
    if(role==='jump')this.events.jump();
    if(role==='descend')this.events.descend?.();
    if(role==='sneak')this.motion.sneak=!this.motion.sneak;
    if(role==='sprint')this.sprint=!this.sprint;
    if(role==='attack'||role==='use')this.events.action(role==='attack'?0:2,true);
    if(role==='look'&&this.options.touchMode!=='joystick-crosshair')this.events.aim(x,y);
    if(role==='move'){this.move(id,x,y);if(this.options.touchMode==='dpad-tap'&&this.motion.forward>0){if(time-this.lastForward<350)this.sprint=true;this.lastForward=time;}}
    this.refresh();return true;
  }
  move(id:number,x:number,y:number){
    const finger=this.fingers.get(id);if(!finger||!Number.isFinite(x)||!Number.isFinite(y))return;
    if(finger.role==='move'){
      let vector=joystickVector(x-finger.cx,y-finger.cy,finger.radius);
      if(this.options.touchMode==='dpad-tap'){
        const dx=x-finger.cx,dy=y-finger.cy;
        vector={strafe:Math.abs(dx)>finger.radius*.32?Math.sign(dx):0,forward:Math.abs(dy)>finger.radius*.32?-Math.sign(dy):0,sprint:false};
      }
      this.motion.forward=vector.forward;this.motion.strafe=vector.strafe;this.moveSprint=vector.sprint;
      if(vector.forward<=0)this.sprint=false;
    }
    if(finger.role==='look'){
      const displaced=Math.hypot(x-finger.startX,y-finger.startY)>7;
      if(displaced&&!finger.dragged){finger.dragged=true;if(finger.breaking){this.events.action(0,false);finger.breaking=false;}this.events.aim(null);this.events.look(x-finger.startX,y-finger.startY);}
      else if(finger.dragged)this.events.look(x-finger.x,y-finger.y);
    }
    finger.x=x;finger.y=y;this.refresh();
  }
  update(time:number){
    for(const finger of this.fingers.values())if(finger.role==='look'&&!finger.dragged&&!finger.breaking&&time-finger.time>=(this.options.delayedBreaking?250:0)){
      if(this.options.touchMode==='joystick-crosshair'&&this.options.showActionButtons)continue;
      finger.breaking=true;this.events.action(0,true);
    }
  }
  up(id:number,cancel=false){
    const finger=this.fingers.get(id);if(!finger)return;
    this.fingers.delete(id);
    if(finger.role==='move'){this.motion.forward=0;this.motion.strafe=0;this.sprint=false;this.moveSprint=false;}
    if(finger.breaking)this.events.action(0,false);
    if(finger.role==='look'){
      if(!cancel&&!finger.dragged&&!finger.breaking&&(this.options.touchMode!=='joystick-crosshair'||!this.options.showActionButtons)){this.events.action(2,true);this.events.action(2,false);}
      this.events.aim(null);
    }
    if((finger.role==='attack'||finger.role==='use')&&![...this.fingers.values()].some(f=>f.role===finger.role))this.events.action(finger.role==='attack'?0:2,false);
    this.refresh();
  }
  reset(){for(const id of [...this.fingers.keys()])this.up(id,true);this.sprint=false;this.lastForward=-Infinity;this.motion.sneak=false;this.refresh();}
  private refresh(){this.motion.jump=[...this.fingers.values()].some(f=>f.role==='jump');this.motion.descend=[...this.fingers.values()].some(f=>f.role==='descend');this.motion.sprint=this.sprint||(this.options.sprintOnMovement&&this.moveSprint);}
}
