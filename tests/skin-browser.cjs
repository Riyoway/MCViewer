const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const fs=require('node:fs');fs.mkdirSync('test-results/skin',{recursive:true});
(async()=>{
 const fixtures={};
 for(const [name,width,height] of [['classic',64,64],['legacy',64,32],['hd',128,128],['invalid',32,32]]){
  const pixels=Buffer.alloc(width*height*4),scale=width/64;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;pixels[i]=x/scale<32?220:40;pixels[i+1]=y/scale<32?60:200;pixels[i+2]=100;pixels[i+3]=y/scale>=32&&x/scale<16?96:255;}
  fixtures[name]=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
 }
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('world-settings'))localStorage.setItem('world-settings',JSON.stringify({volume:0,effects:0}));Object.defineProperty(HTMLElement.prototype,'requestFullscreen',{value:()=>Promise.reject(new Error('Emulated fullscreen unavailable')),configurable:true});});
  await page.goto(process.env.SKIN_TEST_URL||'http://127.0.0.1:5180/?debug');await page.waitForFunction(()=>window.mcViewer,{timeout:90000});
  await page.locator('#home-skin').tap();await page.locator('#skin-menu').waitFor({state:'visible'});
  await page.locator('#skin-file').setInputFiles({name:'classic.png',mimeType:'image/png',buffer:fixtures.classic});
  await page.waitForFunction(()=>window.mcViewer.skins.name==='classic.png');
  await page.locator('label:has(#skin-model)').tap();
  await page.waitForFunction(()=>window.mcViewer.skins.model==='slim'&&window.mcViewer.mobileHome.model.slim);
  await page.screenshot({path:'test-results/skin/slim.png'});
  await page.locator('#skin-file').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:fixtures.invalid});
  await page.waitForFunction(()=>document.getElementById('skin-status').textContent.includes('64×64'));
  assert.equal(await page.evaluate(()=>window.mcViewer.skins.name),'classic.png','Invalid input preserves the current skin');
  await page.locator('#skin-file').setInputFiles({name:'not-png.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await page.waitForFunction(()=>document.getElementById('skin-status').textContent.includes('Choose a PNG'));
  await page.reload();await page.waitForFunction(()=>window.mcViewer?.skins.model==='slim',{timeout:90000});
  assert.equal(await page.evaluate(()=>window.mcViewer.skins.name),'classic.png','PNG and model survive a reload');
  await page.locator('#home-samples').tap();await page.locator('#maps [role=option]').first().tap();await page.locator('#enter').tap();await page.locator('#touch-controls').waitFor({state:'visible',timeout:90000});
  assert.equal(await page.evaluate(()=>{const v=window.mcViewer;return v.player.model.slim&&v.player.model.head.children[0].material.map===v.mobileHome.model.head.children[0].material.map;}),true,'World and menu use the same imported texture');
  await page.evaluate(()=>{const p=window.mcViewer.player;p.perspective=2;p.movement.flying=true;p.position[1]+=4;p.update(0);});await page.waitForTimeout(150);await page.screenshot({path:'test-results/skin/world.png'});
  await page.evaluate(()=>{window.skinPlayer=window.mcViewer.player.model;window.skinHand=window.mcViewer.player.model.hand;});
  await page.locator('.touch-pause').tap();await page.locator('#pause-settings').tap();await page.locator('#settings-skin').tap();
  await page.locator('#skin-file').setInputFiles({name:'legacy.png',mimeType:'image/png',buffer:fixtures.legacy});await page.waitForFunction(()=>window.mcViewer.skins.name==='legacy.png');
  assert.equal(await page.evaluate(()=>window.mcViewer.player.model===window.skinPlayer&&window.mcViewer.player.model.hand===window.skinHand&&!window.mcViewer.player.model.slim),true,'Legacy files keep the classic model and live player references');
  assert.equal(await page.locator('label:has(#skin-model)').getAttribute('aria-disabled'),'true','Legacy skins cannot select an incompatible arm layout');
  await page.locator('#skin-file').setInputFiles({name:'hd.png',mimeType:'image/png',buffer:fixtures.hd});await page.waitForFunction(()=>window.mcViewer.skins.name==='hd.png');assert.equal(await page.evaluate(()=>window.mcViewer.player.model.head.children[0].material.map.image.width),128);
  await page.locator('#default-skin').tap();await page.waitForFunction(()=>window.mcViewer.skins.name==='Default');
  await page.reload();await page.waitForFunction(()=>window.mcViewer,{timeout:90000});assert.equal(await page.evaluate(()=>window.mcViewer.skins.name),'Default','Reset also removes the persisted skin');
  await page.setViewportSize({width:390,height:844});await page.locator('#home-skin').tap();await page.screenshot({path:'test-results/skin/portrait.png'});
  const fit=await page.locator('#skin-menu').evaluate(panel=>[...panel.querySelectorAll('button,#skin-preview')].filter(e=>e.getBoundingClientRect().width).every(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));assert(fit,'Skin screen fits portrait');
  const desktop=await browser.newPage({viewport:{width:960,height:540}});await desktop.goto(process.env.SKIN_TEST_URL||'http://127.0.0.1:5180/?debug');await desktop.waitForFunction(()=>window.mcViewer,{timeout:90000});await desktop.locator('#home-settings').click();await desktop.locator('#settings-skin').click();await desktop.locator('#skin-file').setInputFiles({name:'desktop.png',mimeType:'image/png',buffer:fixtures.classic});await desktop.waitForFunction(()=>window.mcViewer.skins.name==='desktop.png');await desktop.screenshot({path:'test-results/skin/desktop.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({import:true,classic:true,slim:true,legacy:true,hd:true,reload:true,reset:true,invalid:true,liveWorld:true,portrait:true,desktop:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
