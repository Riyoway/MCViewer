import {TouchInput,touchDefaults,type TouchOptions,type TouchRole} from '../core/TouchInput';
import {t} from './Language';
import type {Player} from '../core/Player';
import type {CreativeControls} from '../core/CreativeControls';
import './touch.css';
import {MobileDisplay} from '../core/MobileDisplay';

export const touchDevice=()=>navigator.maxTouchPoints>0&&matchMedia('(any-pointer:coarse)').matches;
// Set the menu layout before loading assets, including on iOS without Pointer Lock.
document.body.classList.toggle('touch-device',touchDevice());
const mobileDisplay=new MobileDisplay();
let lastTouch=-Infinity;
document.addEventListener('pointerup',event=>{
  if(!event.isTrusted||event.pointerType!=='touch')return;
  lastTouch=performance.now();
  if((event.target as HTMLElement).closest('canvas,#touch-controls'))void mobileDisplay.enter();
},{capture:true});
// Run after menu handlers so fullscreen cannot consume the activation needed
// by a file picker. Pointer events in the world do not need a synthetic click.
document.addEventListener('click',event=>{if(event.isTrusted&&event.detail>0&&performance.now()-lastTouch<1000)void mobileDisplay.enter();});
document.addEventListener('pointerup',event=>{if(event.isTrusted&&event.pointerType==='touch'&&(event.target as HTMLElement).closest('#home-menu button'))void mobileDisplay.enter();});
export class TouchControls {
  readonly root=document.createElement('div');readonly input:TouchInput;
  enabled=touchDevice();private playing=false;private buttons=new Map<string,HTMLButtonElement>();
  private joystick=document.createElement('div');private knob=document.createElement('div');private pad=document.createElement('div');
  private close=document.createElement('button');private previousFlight=false;private previousSwim=false;
  private labels:Record<string,string>={jump:'Jump / Fly Up',descend:'Sneak / Fly Down',sneak:'Sneak',sprint:'Sprint',attack:'Attack',use:'Use',pause:'Pause',inventory:'Inventory',perspective:'Perspective'};
  constructor(readonly canvas:HTMLCanvasElement,readonly player:()=>Player|null,readonly controls:CreativeControls,readonly aim:(x:number|null,y?:number)=>void,readonly pause:()=>void,readonly inventory:()=>void,readonly resume:()=>void){
    this.root.id='touch-controls';this.root.hidden=true;document.body.append(this.root);
    this.input=new TouchInput({...touchDefaults},{look:(dx,dy)=>{const p=this.player();if(!p)return;const sensitivity=Math.PI/Math.min(innerWidth,innerHeight)*this.input.options.touchSensitivity/100;p.turn(dx*sensitivity,dy*sensitivity);},jump:()=>this.player()?.jumpPress(performance.now(),false),descend:()=>this.player()?.descendPress(),action:(button,down)=>down?controls.down(button):controls.up(button),aim});
    this.joystick.className='touch-joystick';this.joystick.dataset.touchRole='move';this.knob.className='touch-knob';this.joystick.append(this.knob);this.root.append(this.joystick);
    this.pad.className='touch-dpad';this.pad.dataset.touchRole='move';
    for(const [name,x,y] of [['up_left',0,0],['up',1,0],['up_right',2,0],['left',0,1],['sneak',1,1],['right',2,1],['down',1,2]] as const){const cell=document.createElement('span');cell.dataset.direction=name;cell.style.gridColumn=String(x+1);cell.style.gridRow=String(y+1);cell.style.backgroundImage=`url('${import.meta.env.BASE_URL}menu/touch/${name}.png')`;if(name==='sneak')cell.dataset.touchRole='sneak';this.pad.append(cell);}
    this.root.append(this.pad);
    for(const role of Object.keys(this.labels)){const button=document.createElement('button');button.className=`touch-button touch-${role}`;button.dataset.touchRole=role;this.buttons.set(role,button);if(role==='inventory')button.textContent='•••';if(role==='perspective')button.textContent='↻';this.root.append(button);}
    this.close.id='touch-inventory-close';this.close.textContent='×';this.close.hidden=true;document.getElementById('inventory-screen')!.append(this.close);this.close.onclick=()=>this.resume();
    const down=(event:PointerEvent)=>{
      if(event.pointerType!=='touch')return;
      if(!this.enabled){this.enabled=true;document.body.classList.add('touch-device');window.dispatchEvent(new Event('resize'));}
      if(!this.playing||!this.player()?.active)return;
      event.preventDefault();const target=event.target as HTMLElement,role=target.closest<HTMLElement>('[data-touch-role]')?.dataset.touchRole;
      const node=(event.currentTarget as HTMLElement);node.setPointerCapture(event.pointerId);
      if(role==='pause'||role==='inventory'||role==='perspective'){
        if(role==='pause')this.pause();else if(role==='inventory')this.inventory();else {const p=this.player();if(p)p.perspective=(p.perspective+1)%3;}return;
      }
      let chosen=(role??'look') as TouchRole;
      if(chosen==='sneak'&&(this.player()!.movement.flying||this.player()!.movement.swimming))chosen='descend';
      let rect=this.input.options.touchMode==='dpad-tap'?this.pad.getBoundingClientRect():this.joystick.getBoundingClientRect();
      if(!role&&!this.input.options.fixedJoystick&&this.input.options.touchMode!=='dpad-tap'&&event.clientX<innerWidth*.4&&event.clientY>innerHeight*.5&&![...this.input.fingers.values()].some(f=>f.role==='move')){chosen='move';this.joystick.style.left=`${event.clientX-rect.width/2}px`;this.joystick.style.top=`${event.clientY-rect.height/2}px`;this.joystick.style.bottom='auto';rect=this.joystick.getBoundingClientRect();}
      this.input.down(event.pointerId,chosen,event.clientX,event.clientY,performance.now(),rect.x+rect.width/2,rect.y+rect.height/2,rect.width*.38);this.paint();
    };
    const move=(event:PointerEvent)=>{if(event.pointerType==='touch'&&this.input.fingers.has(event.pointerId)){event.preventDefault();this.input.move(event.pointerId,event.clientX,event.clientY);this.paint();}};
    const up=(event:PointerEvent)=>{if(event.pointerType!=='touch')return;this.input.up(event.pointerId,event.type!=='pointerup');this.paint();};
    for(const node of [canvas,this.root] as HTMLElement[]){node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);node.addEventListener('lostpointercapture',up);}
    window.addEventListener('blur',()=>{if(this.playing)this.pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.playing)this.pause();});
    window.addEventListener('resize',()=>{this.reset();this.layout();});this.configure(touchDefaults);
  }
  configure(options:TouchOptions){this.reset();this.input.options={...options};this.layout();this.refreshLabels();this.paint();}
  refreshLabels(){for(const [role,button] of this.buttons)button.setAttribute('aria-label',t(this.labels[role]));this.close.setAttribute('aria-label',t('Back to World'));this.joystick.setAttribute('aria-label',t('Move'));this.pad.setAttribute('aria-label',t('Move'));}
  setScreen(screen:string){this.playing=this.enabled&&screen==='playing';if(!this.playing)this.reset();const p=this.player();if(p)p.touchActive=this.playing;this.root.hidden=!this.playing;this.close.hidden=!(this.enabled&&screen==='inventory');document.body.classList.toggle('touch-tap',this.enabled&&this.input.options.touchMode!=='joystick-crosshair');}
  reset(){this.input.reset();this.controls.reset();this.player()?.stop();this.paint();}
  update(){if(!this.playing)return;const p=this.player();if(!p)return;this.input.update(performance.now());Object.assign(p.touch,this.input.motion);p.touchAutoJump=this.input.options.autoJump;if(p.movement.flying!==this.previousFlight||p.movement.swimming!==this.previousSwim){this.previousFlight=p.movement.flying;this.previousSwim=p.movement.swimming;this.paint();}}
  private layout(){
    const options=this.input.options;this.root.dataset.mode=options.touchMode;const size=Math.max(36,Math.min(Math.max(40,Math.min(76,Math.min(innerWidth,innerHeight)*.145))*options.touchSize/100,(innerHeight-150)/3.6));this.root.style.setProperty('--touch-size',`${size}px`);this.root.style.setProperty('--touch-opacity',String(options.touchOpacity/100));
    this.joystick.style.removeProperty('left');this.joystick.style.removeProperty('top');this.joystick.style.removeProperty('bottom');
    this.joystick.hidden=options.touchMode==='dpad-tap';this.pad.hidden=options.touchMode!=='dpad-tap';for(const role of ['attack','use'])this.buttons.get(role)!.hidden=options.touchMode!=='joystick-crosshair'||!options.showActionButtons;this.buttons.get('sprint')!.hidden=options.sprintOnMovement||options.touchMode==='dpad-tap';this.buttons.get('sneak')!.hidden=options.touchMode==='dpad-tap';
  }
  private paint(){
    const motion=this.input.motion,p=this.player();const swimming=p?.movement.swimming,flying=p?.movement.flying;
    for(const [role,button] of this.buttons){const inputRole=role==='sneak'&&(flying||swimming)?'descend':role;const pressed=[...this.input.fingers.values()].some(f=>f.role===inputRole)||(role==='sneak'&&motion.sneak)||(role==='sprint'&&motion.sprint);button.classList.toggle('pressed',pressed);if(['sneak','sprint'].includes(role))button.setAttribute('aria-pressed',String(pressed));let icon=role;if(role==='use')icon='interact';if(role==='jump')icon=flying?'flyingascend':swimming?'waterascend':'jump';if(role==='sneak')icon=flying?'flyingdescend':swimming?'waterdescend':'sneak';if(role==='pause')icon='pause_icon';if(!['inventory','perspective','descend'].includes(role))button.style.backgroundImage=`url('${import.meta.env.BASE_URL}menu/touch/${icon}${pressed&&!['pause'].includes(role)?'_pressed':''}.png')`;}
    this.buttons.get('descend')!.hidden=this.input.options.touchMode!=='dpad-tap'||!(flying||swimming);this.buttons.get('descend')!.style.backgroundImage=`url('${import.meta.env.BASE_URL}menu/touch/${swimming?'waterdescend':'flyingdescend'}.png')`;
    const r=this.joystick.clientWidth*.28;this.knob.style.transform=`translate(${motion.strafe*r}px,${-motion.forward*r}px)`;
    for(const cell of this.pad.children){const span=cell as HTMLElement,name=span.dataset.direction!,active=name==='sneak'?motion.sneak||motion.descend:name==='up_left'?motion.forward>0&&motion.strafe<0:name==='up_right'?motion.forward>0&&motion.strafe>0:name==='up'?motion.forward>0&&motion.strafe===0:name==='down'?motion.forward<0:name==='left'?motion.strafe<0&&motion.forward===0:motion.strafe>0&&motion.forward===0;const icon=name==='sneak'?(flying?'flyingdescend':swimming?'waterdescend':'sneak'):name;span.classList.toggle('pressed',active);span.style.backgroundImage=`url('${import.meta.env.BASE_URL}menu/touch/${icon}${active?'_pressed':''}.png')`;}
  }
}
