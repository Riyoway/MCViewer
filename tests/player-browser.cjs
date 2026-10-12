const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');fs.mkdirSync('test-results/player',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:960,height:540},hasTouch:true,isMobile:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Preserve real trusted tap dispatch, but emulate mobile fullscreen APIs:
  // desktop emulation cannot physically rotate an Android screen.
  await page.addInitScript(()=>{
   localStorage.setItem('world-settings',JSON.stringify({volume:0,effects:0}));window.displayCalls=[];
   Object.defineProperty(HTMLElement.prototype,'requestFullscreen',{value:async()=>{window.displayCalls.push('fullscreen');Object.defineProperty(document,'fullscreenElement',{value:document.documentElement,configurable:true});},configurable:true});
   Object.defineProperty(screen.orientation,'lock',{value:async(direction)=>window.displayCalls.push(direction)});
  });
  await page.goto(process.env.PLAYER_TEST_URL||'http://127.0.0.1:5180/?debug');
  await page.waitForFunction(()=>window.mcViewer,{timeout:90000});
  await page.locator('#home-samples').tap();
  await page.waitForFunction(()=>window.displayCalls.length===2);
  assert.deepEqual(await page.evaluate(()=>window.displayCalls),['fullscreen','landscape']);
  await page.locator('#maps [role=option]').first().tap();await page.locator('#enter').tap();
  await page.locator('#touch-controls').waitFor({state:'visible',timeout:90000});
  assert.equal(await page.evaluate(()=>window.displayCalls.length),2,'Later taps do not re-request fullscreen');
  const probe=await page.evaluate(async()=>{
   const {Scene,PerspectiveCamera,Mesh,BoxGeometry,PlaneGeometry,MeshBasicMaterial,WebGLRenderTarget}=await import('/node_modules/three/build/three.module.js');
   const {ViewModelRenderer}=await import('/src/core/ViewModelRenderer.ts');
   const renderer=window.mcViewer.renderer,previous=renderer.getRenderTarget(),target=new WebGLRenderTarget(64,64);
   const scene=new Scene(),camera=new PerspectiveCamera(70,1,.05,10);
   const water=new Mesh(new PlaneGeometry(10,10),new MeshBasicMaterial({color:0x0000ff,transparent:true,opacity:.75,depthWrite:false}));water.position.z=-.25;scene.add(water);
   const overlay=new ViewModelRenderer(),block=new Mesh(new BoxGeometry(.5,.5,.5),new MeshBasicMaterial({color:0xff0000}));block.position.z=-1;overlay.attach(block);
   const center=new Uint8Array(4),outside=new Uint8Array(4);
   try{renderer.setRenderTarget(target);renderer.render(scene,camera);overlay.render(renderer,camera);renderer.readRenderTargetPixels(target,32,32,1,1,center);renderer.readRenderTargetPixels(target,4,4,1,1,outside);}
   finally{renderer.setRenderTarget(previous);target.dispose();water.geometry.dispose();water.material.dispose();block.geometry.dispose();block.material.dispose();}
   return {center:[...center],outside:[...outside],autoClear:renderer.autoClear};
  });
  assert.deepEqual(probe.center.slice(0,3),[255,0,0],'Water in front of the camera cannot tint or reveal through a held block');
  assert(probe.outside[2]>probe.outside[0],'The transparent world is still visible around the block');
  assert.equal(probe.autoClear,true,'World clearing is restored after the hand pass');
  const animation=await page.evaluate(()=>{
   const {player:p}=window.mcViewer,model=p.model,collision=p.collision,movementCollision=p.movement.collision;
   const tick=model.tick.bind(model),physics=p.movement.tick.bind(p.movement),poses=[];
   const empty={blocks:[],voxels:{get:()=>0},loaded:()=>true,move:(position,x,z)=>{position[0]+=x;position[2]+=z;},vertical:(position,y)=>{position[1]+=y;return false;},overlaps:()=>false,point:()=>false};
   try{
    p.collision=p.movement.collision=empty;
    for(const fps of [30,60,144]){
     p.stop();p.position.splice(0,3,0,80,0);p.yaw=p.pitch=0;p.movement.flying=true;p.touchActive=true;p.touch.forward=1;p.touch.sprint=true;p.update(0);
     let ticks=0;model.tick=(...args)=>{ticks++;tick(...args);};
     for(let frame=0;frame<fps*2;frame++)p.update(1/fps);
     model.update(0,p.yaw,p.pitch,false,true,1);
     poses.push({fps,ticks,leg:model.rightLeg.rotation.x,head:model.head.rotation.y});
    }
    // Vertical-only flight still moves the player but must not generate a stride.
    p.stop();p.position.splice(0,3,0,80,0);p.movement.flying=true;p.touch.jump=true;p.update(0);
    for(let frame=0;frame<120;frame++)p.update(1/60);
    model.update(0,p.yaw,p.pitch,false,true,1);
    const vertical={height:p.position[1]-80,leg:model.rightLeg.rotation.x};
    // Actual blocked displacement, rather than key input or intended velocity, drives limbs.
    p.stop();p.movement.flying=true;p.touch.forward=1;p.update(0);p.movement.tick=()=>{};
    for(let frame=0;frame<60;frame++)p.update(1/60);
    return {poses,vertical,blockedLeg:model.rightLeg.rotation.x};
   }finally{model.tick=tick;p.movement.tick=physics;p.collision=collision;p.movement.collision=movementCollision;p.stop();p.movement.flying=true;p.position.splice(0,3,...window.mcViewer.world.data.spawn);p.position[1]+=5;p.update(0);}
  });
  assert(animation.poses.every(p=>p.ticks===40),'Every rendering rate advances the native 20 Hz animation clock');
  assert(animation.poses.every(p=>Math.abs(p.leg-animation.poses[0].leg)<1e-10),'30/60/144 FPS render the same fast-flight stride');
  assert(animation.vertical.height>5&&animation.vertical.leg===0,'Ascending in creative flight does not run in place');
  assert.equal(Math.abs(animation.blockedLeg),0,'Movement keys with no actual travel keep the legs still');
  assert.equal(await page.evaluate(()=>window.mcViewer.hud.pick('oak_planks')),true);
  await page.waitForFunction(()=>window.mcViewer.held.thirdPerson.children.length===1);
  assert.equal(await page.evaluate(()=>{const v=window.mcViewer;return v.held.thirdPerson.parent===v.player.model.rightArm&&v.held.thirdPerson.children[0].material.depthTest;}),true,'Third-person item follows the right hand and respects world depth');
  await page.evaluate(()=>{const p=window.mcViewer.player;p.perspective=2;p.movement.flying=true;p.position[1]+=5;p.yaw=0;p.pitch=0;p.update(0);});
  await page.waitForTimeout(400);await page.screenshot({path:'test-results/player/front.png'});
  await page.evaluate(()=>{window.mcViewer.player.perspective=1;window.mcViewer.player.pitch=-.15;});
  await page.waitForTimeout(400);await page.screenshot({path:'test-results/player/back.png'});
  assert.equal(await page.evaluate(()=>{const p=window.mcViewer.player;return p.model.root.visible&&!p.model.hand.visible&&!window.mcViewer.held.root.visible&&window.mcViewer.viewRenderer.camera.children.includes(p.viewModel);}),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({fullscreenSequence:true,heldWaterOcclusion:true,frontAndBack:true,nativeAnimation:animation,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
