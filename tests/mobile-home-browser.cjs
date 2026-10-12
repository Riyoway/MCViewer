const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');fs.mkdirSync('test-results/home',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try{
  const errors=[],bad=[],url=process.env.HOME_TEST_URL||'http://127.0.0.1:5180/?debug';
  const mobile=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  await mobile.clock.setFixedTime(new Date('2026-10-12T12:00:00+09:00'));
  mobile.on('pageerror',e=>errors.push(e.message));mobile.on('response',r=>{if(r.status()>=400)bad.push([r.status(),r.url()]);});
  await mobile.addInitScript(()=>{
   localStorage.setItem('world-settings',JSON.stringify({volume:0,effects:0}));
   Object.defineProperty(HTMLElement.prototype,'requestFullscreen',{value:()=>Promise.reject(new Error('Emulated unsupported fullscreen')),configurable:true});
  });
  await mobile.goto(url);await mobile.waitForFunction(()=>window.mcViewer,{timeout:90000});
  await mobile.locator('#home-settings').tap();await mobile.locator('#settings-menu').waitFor({state:'visible',timeout:5000});await mobile.locator('#settings-back').tap();
  const labels=()=>mobile.locator('#home-worlds').innerText();
  assert.equal(await labels(),'Play');assert.equal(await mobile.locator('#home-settings').innerText(),'Settings');
  await mobile.locator('#home-logo').evaluate(img=>img.decode());
  assert.equal(await mobile.locator('.title-logo img').count(),1);
  assert.equal(await mobile.locator('.title-logo h1').count(),0);
  assert.equal(await mobile.locator('#home-logo').evaluate(img=>new URL(img.src).pathname),'/menu/logo.png');
  for(const [name,viewport] of [['landscape',{width:844,height:390}],['wide-landscape',{width:1280,height:550}],['portrait',{width:390,height:844}],['small-portrait',{width:320,height:568}],['short-landscape',{width:640,height:300}]]){
   await mobile.setViewportSize(viewport);await mobile.waitForTimeout(300);
   const layout=await mobile.locator('#home-menu').evaluate(home=>{
    const selectors=['.title-logo','#home-worlds','#home-settings','#home-samples','#home-skin','#home-language','#home-player','.home-notice','footer'];
    return selectors.map(selector=>{const r=home.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,inside:r.x>=-.5&&r.y>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5};});
   });
   assert(layout.every(r=>r.inside),`${name}: ${JSON.stringify(layout)}`);
   const box=id=>layout.find(r=>r.selector===id),play=box('#home-worlds'),settings=box('#home-settings'),samples=box('#home-samples'),doll=box('#home-player');
   const skin=box('#home-skin');assert(Math.abs(doll.x+doll.width/2-skin.x-skin.width/2)<1&&doll.bottom<skin.y,`${name}: Steve is centered above Skin`);
   assert(box('.title-logo').bottom<=play.y,`${name}: Logo does not overlap Play`);
   const logo=await mobile.locator('#home-logo').evaluate(img=>{const r=img.getBoundingClientRect();return {width:img.naturalWidth,height:img.naturalHeight,ratio:r.width/r.height};});
   assert.equal(logo.width,999);assert.equal(logo.height,297);assert(Math.abs(logo.ratio-999/297)<.01,'Logo preserves its aspect ratio');
   assert(play.bottom<=settings.y&&settings.bottom<=samples.y,'Native Play / Settings / Samples order');
   assert(play.height>=44&&settings.height>=44&&samples.height>=44,'Touch targets stay usable');
   assert(samples.right<=doll.x||samples.bottom<=doll.y||doll.bottom<=play.y,`${name}: Player preview does not overlap main buttons ${JSON.stringify(layout)}`);
   assert(box('.home-notice').bottom<=box('footer').y,'Notice and copyright stay separate');
   await mobile.screenshot({path:`test-results/home/${name}.png`});
  }
  await mobile.setViewportSize({width:844,height:390});await mobile.waitForTimeout(250);
  const decoded=await mobile.locator('#home-menu button:visible').evaluateAll(async nodes=>Promise.all(nodes.map(node=>new Promise(resolve=>{const style=getComputedStyle(node),url=(style.borderImageSource!=='none'?style.borderImageSource:style.backgroundImage).match(/url\(["']?(.*?)["']?\)/)?.[1];if(!url)return resolve(false);const image=new Image();image.onload=()=>resolve(image.naturalWidth>0);image.onerror=()=>resolve(false);image.src=url;}))));assert(decoded.every(Boolean),'Every mobile Home button uses a decodable native image');
  const doll=await mobile.locator('#home-player').boundingBox(),cdp=await mobile.context().newCDPSession(mobile),before=await mobile.evaluate(()=>window.mcViewer.mobileHome.model.root.rotation.y);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:doll.x+doll.width/2,y:doll.y+doll.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:doll.x+doll.width/2+45,y:doll.y+doll.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await mobile.waitForTimeout(150);
  assert(Math.abs(await mobile.evaluate(()=>window.mcViewer.mobileHome.model.root.rotation.y)-before)>.3,'Dragging rotates the actual player model');
  assert.equal(await mobile.evaluate(()=>window.mcViewer.renderer.getScissorTest()),false,'Preview restores the world scissor state');
  await mobile.locator('#home-settings').tap();await mobile.locator('#settings-menu').waitFor({state:'visible'});await mobile.screenshot({path:'test-results/home/settings.png'});await mobile.locator('#settings-back').tap();
  await mobile.locator('#home-skin').tap();await mobile.locator('#skin-menu').waitFor({state:'visible'});await mobile.locator('#skin-back').tap();
  await mobile.locator('#home-language').tap();await mobile.locator('#languages button').filter({hasText:'日本語'}).tap();await mobile.locator('#language-back').tap();
  await mobile.waitForFunction(()=>document.getElementById('home-worlds').textContent.includes('プレイ'));
  assert((await mobile.locator('#home-player').getAttribute('aria-label')).includes('回転'));
  await mobile.screenshot({path:'test-results/home/japanese.png'});
  await mobile.locator('#home-worlds').tap();await mobile.locator('#map-menu').waitFor({state:'visible'});await mobile.locator('#worlds-back').tap();
  await mobile.locator('#home-samples').tap();await mobile.locator('#maps [role=option]').first().waitFor({timeout:60000});assert.equal(await mobile.locator('#maps [role=option]').count(),14);
  const desktop=await browser.newPage({viewport:{width:960,height:540}});await desktop.clock.setFixedTime(new Date('2026-10-12T12:00:00+09:00'));await desktop.goto(url);await desktop.waitForFunction(()=>window.mcViewer,{timeout:90000});
  assert.equal(await desktop.locator('#home-worlds').innerText(),'Select World');assert.equal(await desktop.locator('#home-settings').innerText(),'Options...');assert.equal(await desktop.locator('#home-player').isVisible(),false);
  assert.equal(await desktop.locator('.title-logo img').count(),1);assert.equal(await desktop.locator('.title-logo h1').count(),0);
  assert.equal(await desktop.locator('#home-logo').evaluate(img=>new URL(img.src).pathname),'/menu/logo.png');
  const desktopLogo=await desktop.locator('.title-logo').boundingBox(),desktopPlay=await desktop.locator('#home-worlds').boundingBox();assert(desktopLogo.y+desktopLogo.height<=desktopPlay.y,'Desktop logo does not overlap buttons');
  const desktopTexture=await desktop.locator('#home-worlds').evaluate(button=>getComputedStyle(button).borderImageSource),mobileTexture=await mobile.locator('#home-worlds').evaluate(button=>getComputedStyle(button).borderImageSource);
  assert.equal(new URL(mobileTexture.match(/url\(["']?(.*?)["']?\)/)[1]).pathname,new URL(desktopTexture.match(/url\(["']?(.*?)["']?\)/)[1]).pathname,'Home uses the same button texture on phone and desktop');
  await desktop.screenshot({path:'test-results/home/desktop.png'});
  await mobile.locator('#worlds-back').tap();
  for(const [date,file,season]of[['2026-03-01','logo-spring.png','spring'],['2026-06-01','logo-summer.png','summer'],['2026-09-01','logo.png','autumn'],['2026-12-01','logo.png','winter']]){
   for(const page of [mobile,desktop]){
    await page.clock.setFixedTime(new Date(date+'T12:00:00+09:00'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(file=>new URL(document.getElementById('home-logo').src).pathname==='/menu/'+file,file);await page.locator('#home-logo').evaluate(img=>img.decode());
   }
   await mobile.screenshot({path:`test-results/home/logo-${season}.png`});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);console.log(JSON.stringify({home:true,viewports:5,playerAboveSkin:true,seasonalLogos:true,nativeTextures:true,rotatingPlayer:true,menuActions:true,japanese:true,desktop:true,errors,bad}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
