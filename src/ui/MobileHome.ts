import {Scene,OrthographicCamera,Vector2,Vector4,type Mesh,type MeshBasicMaterial,type Texture,type WebGLRenderer} from 'three';
import {PlayerModel} from '../core/PlayerModel';
import {AssetManager} from '../core/AssetManager';
import './mobile-home.css';

export class MobileHome {
  private scene=new Scene();private camera=new OrthographicCamera(-1,1,1.2,-1.2,.05,20);
  private model:PlayerModel;private yaw=Math.PI/6;private finger:number|null=null;private previousX=0;
  private skinPreview=document.getElementById('skin-preview')!;
  private material(texture:Texture){
    const value=this.assets.skinMaterial(texture),compile=value.onBeforeCompile;
    value.onBeforeCompile=(shader,renderer)=>{compile.call(value,shader,renderer);shader.uniforms.entityLight={value:new Vector2(1,1)};shader.uniforms.daylight={value:1};};
    value.customProgramCacheKey=()=> 'minecraft-home-player-v1';return value;
  }
  setSkin(texture:Texture,slim:boolean){this.model.setSkin(texture.image.width,texture.image.height,this.material(texture),this.material(texture),slim);}
  constructor(private assets:AssetManager,source:PlayerModel,readonly element:HTMLElement){
    const texture=((source.head.children[0] as Mesh).material as MeshBasicMaterial).map!;
    this.model=PlayerModel.fromSkin(texture.image.width,texture.image.height,this.material(texture),this.material(texture),source.slim);
    this.scene.add(this.model.root);const tilt=10*Math.PI/180;this.camera.position.set(0,1+6*Math.sin(tilt),-6*Math.cos(tilt));this.camera.lookAt(0,1,0);
    // Activate touch menus on release. After a captured paper-doll drag, some
    // browsers omit the compatibility click; keyboard/mouse clicks still work.
    for(const button of element.closest('[data-screen]')!.querySelectorAll<HTMLButtonElement>('button')){
      const pressed=new Map<number,{x:number;y:number}>();let touchAction=-Infinity;
      button.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&!button.disabled)pressed.set(event.pointerId,{x:event.clientX,y:event.clientY});});
      button.addEventListener('pointerup',event=>{
        const start=pressed.get(event.pointerId);pressed.delete(event.pointerId);if(!start||button.disabled)return;
        event.preventDefault();touchAction=performance.now();
        if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)return;
        button.click();
      });
      button.addEventListener('pointercancel',event=>pressed.delete(event.pointerId));
      document.addEventListener('pointerup',event=>pressed.delete(event.pointerId));
      document.addEventListener('pointercancel',event=>pressed.delete(event.pointerId));
      button.addEventListener('click',event=>{if(event.isTrusted&&event.detail>0&&performance.now()-touchAction<700){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
      window.addEventListener('blur',()=>pressed.clear());window.addEventListener('resize',()=>pressed.clear());
    }
    for(const target of [element,this.skinPreview]){
      target.addEventListener('pointerdown',event=>{if(this.finger!==null)return;this.finger=event.pointerId;this.previousX=event.clientX;target.setPointerCapture(event.pointerId);});
      target.addEventListener('pointermove',event=>{if(event.pointerId!==this.finger)return;this.yaw+=(event.clientX-this.previousX)/Math.max(1,target.clientWidth)*Math.PI*2;this.previousX=event.clientX;});
      const release=()=>{const finger=this.finger;this.finger=null;if(finger!==null&&target.hasPointerCapture(finger))target.releasePointerCapture(finger);};for(const event of ['pointerup','pointercancel','lostpointercapture'])target.addEventListener(event,release);
      window.addEventListener('blur',release);window.addEventListener('resize',release);
      target.addEventListener('keydown',event=>{if(event.code==='ArrowLeft'||event.code==='ArrowRight'){event.preventDefault();this.yaw+=event.code==='ArrowLeft'?-.2:.2;}});
    }
  }
  render(renderer:WebGLRenderer,dt:number){
    const editing=!this.skinPreview.closest<HTMLElement>('[data-screen]')?.hidden;
    if(!editing&&(!document.body.classList.contains('touch-device')||this.element.closest<HTMLElement>('[data-screen]')?.hidden))return;
    const rect=(editing?this.skinPreview:this.element).getBoundingClientRect(),canvas=renderer.domElement.getBoundingClientRect();
    if(!rect.width||!rect.height||!canvas.width||!canvas.height)return;
    this.model.update(dt,0,0);this.model.root.rotation.y=this.yaw;
    const aspect=rect.width/rect.height;this.camera.left=-1.05*aspect;this.camera.right=1.05*aspect;this.camera.top=1.05;this.camera.bottom=-1.05;this.camera.updateProjectionMatrix();
    const size=renderer.getSize(new Vector2()),viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),test=renderer.getScissorTest(),clear=renderer.autoClear;
    try {
      renderer.setViewport((rect.left-canvas.left)/canvas.width*size.x,(canvas.bottom-rect.bottom)/canvas.height*size.y,rect.width/canvas.width*size.x,rect.height/canvas.height*size.y);
      renderer.setScissor(renderer.getViewport(new Vector4()));renderer.setScissorTest(true);renderer.autoClear=false;renderer.clearDepth();renderer.render(this.scene,this.camera);
    }finally{renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.autoClear=clear;}
  }
}
