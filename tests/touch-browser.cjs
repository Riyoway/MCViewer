const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');fs.mkdirSync('test-results/touch',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2}),errors=[],bad=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push([r.status(),r.url()]);});
 await page.addInitScript(()=>localStorage.setItem('world-settings',JSON.stringify({volume:0,effects:0})));
 // iOS Safari does not expose Pointer Lock. Exercise the complete mobile flow
 // with those APIs absent, rather than relying on Chromium's desktop methods.
 await page.addInitScript(()=>{Object.defineProperty(document,'exitPointerLock',{value:undefined,configurable:true});Object.defineProperty(HTMLCanvasElement.prototype,'requestPointerLock',{value:undefined,configurable:true});});
 await page.goto((process.env.TOUCH_TEST_URL||'http://127.0.0.1:5180/?debug'),{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.mcViewer,{timeout:90000});
 assert.equal(await page.evaluate(()=>window.mcViewer.config.view),3,'Fresh mobile devices use a smaller render distance');
 await page.screenshot({path:'test-results/touch/mobile-home.png'});
 await page.locator('#home-samples').tap();await page.locator('#maps [role=option]').first().waitFor({timeout:60000});
 await page.locator('#maps [role=option]').first().tap();await page.locator('#enter').tap();
 await page.locator('#touch-controls').waitFor({state:'visible',timeout:90000});
 await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>window.mcViewer.player.active&&!window.mcViewer.player.locked),true);
 await page.screenshot({path:'test-results/touch/mobile-portrait.png'});
 const cdp=await page.context().newCDPSession(page);let touches=[];
 const send=async(type)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:touches});
 const center=async(sel)=>{const b=await page.locator(sel).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
 const joy=await center('.touch-joystick'),look={x:260,y:300},jump=await center('.touch-jump');
 await page.evaluate(()=>{const p=window.mcViewer.player;p.movement.flying=true;p.position[1]+=4;p.update(0);});
 const before=await page.evaluate(()=>({pos:[...window.mcViewer.player.position],yaw:window.mcViewer.player.yaw}));
 touches=[{...joy,id:1}];await send('touchStart');touches[0].y-=60;await send('touchMove');
 touches.push({...look,id:2});await send('touchStart');touches[1].x+=60;await send('touchMove');
 touches.push({...jump,id:3});await send('touchStart');await page.waitForTimeout(550);
 const during=await page.evaluate(()=>({pos:[...window.mcViewer.player.position],yaw:window.mcViewer.player.yaw,motion:{...window.mcViewer.touch.input.motion},fingers:window.mcViewer.touch.input.fingers.size}));
 assert(during.motion.forward>.8&&during.motion.jump,'Move and jump together');assert(Math.abs(before.yaw-during.yaw)>.1,'Independent thumb turns');assert(during.pos[1]>before.pos[1],'Jump button ascends in flight');
 touches=[];await send('touchEnd');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.mcViewer.touch.input.fingers.size),0);
 await page.evaluate(()=>{window.mcViewer.player.stop();window.mcViewer.player.movement.flying=false;window.mcViewer.touch.reset();});
 await page.locator('.touch-jump').tap();await page.waitForTimeout(60);await page.locator('.touch-jump').tap();assert.equal(await page.evaluate(()=>window.mcViewer.player.movement.flying),true,'Touch double jump starts flight');
 await page.locator('.touch-sneak').tap();await page.waitForTimeout(60);await page.locator('.touch-sneak').tap();assert.equal(await page.evaluate(()=>window.mcViewer.player.movement.flying),false,'Touch double Descend stops flight');
 await page.locator('.hotbar-item').nth(2).tap();assert.equal(await page.evaluate(()=>window.mcViewer.hud.inventory.selected),2);
 await page.locator('.touch-inventory').tap();await page.locator('#inventory-screen').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.mcViewer.player.active),false);
 await page.locator('.inventory-slot').nth(9).tap();assert(await page.evaluate(()=>window.mcViewer.hud.inventory.hotbar[2]!==null),'Touch catalog assigns selected slot');
 await page.screenshot({path:'test-results/touch/mobile-inventory.png'});await page.locator('#touch-inventory-close').tap();assert.equal(await page.evaluate(()=>window.mcViewer.player.active),true);
 await page.locator('.touch-pause').tap();await page.locator('#pause-menu').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.mcViewer.player.active),false);
 await page.locator('#pause-settings').tap();await page.locator('[data-submenu="controls-menu"]').tap();await page.locator('[data-submenu="touch-menu"]').tap();
 await page.screenshot({path:'test-results/touch/mobile-settings.png'});
 await page.locator('label:has(#touchMode)').tap();assert.equal(await page.evaluate(()=>window.mcViewer.config.touchMode),'dpad-tap');
 await page.locator('#touch-menu [data-options-back]').tap();await page.locator('#settings-back').tap();await page.locator('#resume').tap();
 assert(await page.locator('.touch-dpad').isVisible());const pad=await page.locator('.touch-dpad').boundingBox();
 touches=[{x:pad.x+pad.width/2,y:pad.y+pad.height/6,id:1}];await send('touchStart');assert.equal(await page.evaluate(()=>window.mcViewer.touch.input.motion.forward),1,'Native D-pad forward');touches[0].x=pad.x+pad.width/6;await send('touchMove');assert.equal(await page.evaluate(()=>window.mcViewer.touch.input.motion.strafe),-1,'Sliding to diagonal works');touches=[];await send('touchEnd');
 await page.locator('.touch-pause').tap();await page.locator('#pause-settings').tap();await page.locator('[data-submenu="controls-menu"]').tap();await page.locator('[data-submenu="touch-menu"]').tap();
 await page.locator('label:has(#touchMode)').tap();assert.equal(await page.evaluate(()=>window.mcViewer.config.touchMode),'joystick-crosshair');
 await page.locator('#touch-menu [data-options-back]').tap();await page.locator('#settings-back').tap();await page.locator('#resume').tap();
 assert(await page.locator('.touch-attack').isVisible());assert(await page.locator('.crosshair').isVisible());
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>Math.round(document.getElementById('world').getBoundingClientRect().width)),844);await page.screenshot({path:'test-results/touch/mobile-landscape.png'});
 const inside=await page.locator('#touch-controls button:visible').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [n.className,r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight];}));assert(inside.every(a=>a[1]),JSON.stringify(inside));
 touches=[{...(await center('.touch-joystick')),id:1}];await send('touchStart');touches[0].y-=50;await send('touchMove');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await page.evaluate(()=>window.mcViewer.touch.input.fingers.size),0);touches=[];await send('touchCancel');
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(bad.length,0,JSON.stringify(bad));
 console.log(JSON.stringify({mobile:true,multitouch:during.fingers,moveLookJump:true,flight:true,dpad:true,inventory:true,settings:true,portrait:true,landscape:true,cancel:true,errors,bad}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
