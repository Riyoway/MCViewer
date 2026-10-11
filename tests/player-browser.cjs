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
  assert.equal(await page.evaluate(()=>window.mcViewer.hud.pick('oak_planks')),true);
  await page.waitForFunction(()=>window.mcViewer.held.thirdPerson.children.length===1);
  assert.equal(await page.evaluate(()=>{const v=window.mcViewer;return v.held.thirdPerson.parent===v.player.model.rightArm&&v.held.thirdPerson.children[0].material.depthTest;}),true,'Third-person item follows the right hand and respects world depth');
  await page.evaluate(()=>{const p=window.mcViewer.player;p.perspective=2;p.movement.flying=true;p.position[1]+=5;p.yaw=0;p.pitch=0;p.update(0);});
  await page.waitForTimeout(400);await page.screenshot({path:'test-results/player/front.png'});
  await page.evaluate(()=>{window.mcViewer.player.perspective=1;window.mcViewer.player.pitch=-.15;});
  await page.waitForTimeout(400);await page.screenshot({path:'test-results/player/back.png'});
  assert.equal(await page.evaluate(()=>{const p=window.mcViewer.player;return p.model.root.visible&&!p.model.hand.visible&&!window.mcViewer.held.root.visible&&window.mcViewer.viewRenderer.camera.children.includes(p.viewModel);}),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({fullscreenSequence:true,heldWaterOcclusion:true,frontAndBack:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
