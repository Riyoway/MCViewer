import './style.css';
import { Scene, PerspectiveCamera, Fog, Color, NearestFilter, NearestMipmapLinearFilter } from 'three';
import { createRenderer } from './core/Renderer';
import { AssetManager, assetUrl } from './core/AssetManager';
import { Player } from './core/Player';
import { PlayerModel } from './core/PlayerModel';
import { AudioManager } from './core/AudioManager';
import { World } from './minecraft/WorldLoader';
import { Sky } from './world/Sky';
import { Weather,type WeatherMode } from './world/Weather';
import { fluidHeight } from './minecraft/Fluid';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('world'),enter=$<HTMLButtonElement>('enter'),loading=$('loading'),error=$('error');
// The old bob option defaulted on; the revised option starts off without resetting other settings.
const defaults={gamma:50,legacy:true,view:6,fov:70,resolution:720,mipmap:true,viewBobbing:false,clouds:true,sensitivity:100,volume:50,effects:70,cycle:true,minutes:20,weather:'clear' as WeatherMode,weatherIntensity:100,weatherCycle:false,weatherMinutes:10};
const config={...defaults};
try{const saved=JSON.parse(localStorage.getItem('world-settings')??'{}');for(const key of Object.keys(config) as (keyof typeof config)[])if(typeof saved[key]===typeof defaults[key])Object.assign(config,{[key]:saved[key]});}catch{/* storage may be unavailable */}
if(![0,480,720].includes(config.resolution))config.resolution=defaults.resolution;
if(!['clear','rain','thunder','snow'].includes(config.weather))config.weather='clear';
let world:World|null=null,player:Player|null=null,selected='tutorial',entered=false,request=0,ui='map-menu',settingsReturn='map-menu',slot=0,debug=false,worldReady=false;
function menu(id:string){ui=id;for(const panel of ['map-menu','pause-menu','settings-menu'])$(panel).hidden=panel!==id;}
function report(cause:unknown){error.hidden=false;error.textContent=cause instanceof Error?cause.message:cause instanceof Event?'画像を読み込めません。ページを再読み込みしてください。':String(cause);}
async function init() {
  const renderer=createRenderer(canvas),scene=new Scene(),camera=new PerspectiveCamera(70,innerWidth/innerHeight,.05,350);
  const fog=new Fog('#bbd0dd',35,96);scene.fog=fog;scene.background=new Color('#89b7ef');scene.add(camera);
  const assets=await AssetManager.load(),sky=new Sky(assets),model=await PlayerModel.create(assets),weather=await Weather.create(assets),audio=new AudioManager(assets.manifest.audio,{...assets.manifest.effects,...weather.data.sounds});
  for(const [name,data] of Object.entries(assets.manifest.worlds)){
    const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
    button.className=`map${name===selected?' selected':''}`;button.dataset.world=name;button.setAttribute('aria-pressed',String(name===selected));
    image.src=assetUrl(`${name}-icon.png`);image.alt='';label.textContent=data.name;button.append(image,label);$('maps').append(button);
  }
  await sky.load();scene.add(sky.root,model.root,weather.root);model.root.visible=false;
  const resize=()=>{const height=config.resolution?Math.min(innerHeight,config.resolution):innerHeight,width=Math.floor(height*innerWidth/innerHeight);renderer.setSize(width,height,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};
  window.addEventListener('resize',resize);
  function applySettings() {
    for(const [key,value] of Object.entries(config)) {
      const field=$<HTMLInputElement|HTMLSelectElement>(key);if(!field)continue;
      if(field instanceof HTMLInputElement&&field.type==='checkbox')field.checked=Boolean(value);else field.value=String(value);
      if(field instanceof HTMLInputElement&&field.type==='range')Object.assign(config,{[key]:Number(field.value)});
      const output=document.getElementById(`${key}-value`);if(output)output.textContent=`${config[key as keyof typeof config]}${['gamma','sensitivity','volume','effects','weatherIntensity'].includes(key)?'%':['minutes','weatherMinutes'].includes(key)?'分':key==='view'?' chunks':''}`;
    }
    assets.gamma.value=config.gamma/100;assets.opaque.map!.minFilter=config.mipmap?NearestMipmapLinearFilter:NearestFilter;assets.opaque.map!.needsUpdate=true;
    sky.cycle=config.cycle;sky.minutes=config.minutes;sky.clouds=config.clouds;
    weather.setMode(config.weather);weather.intensity=config.weatherIntensity/100;weather.cycle=config.weatherCycle;weather.minutes=config.weatherMinutes;
    audio.setVolume(config.volume/100);audio.setEffectVolume(config.effects/100);if(world)world.radius=config.view;
    if(player){player.fov=config.fov;player.motionEnabled=config.viewBobbing;player.sensitivity=config.sensitivity*.00002;}
    resize();try{localStorage.setItem('world-settings',JSON.stringify(config));}catch{/* private mode */}
  }
  for(const key of Object.keys(config) as (keyof typeof config)[])$(key).addEventListener('input',event=>{
    const field=event.target as HTMLInputElement|HTMLSelectElement;
    Object.assign(config,{[key]:typeof defaults[key]==='boolean'?(field instanceof HTMLInputElement?field.checked:field.value==='true'):typeof defaults[key]==='string'?field.value:Number(field.value)});applySettings();
  });
  const updateTime=()=>{const hours=((sky.time+6000)%24000)/1000;$('time-value').textContent=`${String(Math.floor(hours)).padStart(2,'0')}:${String(Math.floor(hours%1*60)).padStart(2,'0')}`;};
  $('time').addEventListener('input',event=>{sky.time=Number((event.target as HTMLInputElement).value);updateTime();});
  document.querySelectorAll<HTMLButtonElement>('[data-time]').forEach(button=>button.addEventListener('click',()=>{sky.time=Number(button.dataset.time);$<HTMLInputElement>('time').value=String(sky.time);updateTime();}));
  $('reset-settings').addEventListener('click',()=>{Object.assign(config,defaults);sky.time=6000;applySettings();updateTime();});
  const settings=()=>{settingsReturn=ui;menu('settings-menu');$('settings-back').focus();void audio.start().catch(cause=>report(`音声を再生できません: ${cause}`));};
  $('map-settings').addEventListener('click',settings);$('pause-settings').addEventListener('click',settings);$('settings-back').addEventListener('click',()=>{menu(settingsReturn);$(settingsReturn==='map-menu'?'map-settings':'pause-settings').focus();});
  const spawn=()=>{if(!player||!world)return;player.stop();player.position.splice(0,3,...world.data.spawn);player.yaw=Math.PI-world.data.yaw*Math.PI/180;player.pitch=0;player.movement.flying=false;player.movement.grounded=false;while(player.collision.overlaps(...player.position)&&player.position[1]<world.data.bounds.max[1])player.position[1]++;player.update(0);};
  async function choose(name:string) {
    const token=++request;selected=name;entered=false;enter.disabled=true;error.hidden=true;loading.textContent='ワールドを読み込み中…';
    document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(button=>{const active=button.dataset.world===name;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
    worldReady=false;player?.stop();audio.weather([],camera,false);if(world){scene.remove(world.root);world.dispose();}world=new World(assets,name);world.radius=config.view;scene.add(world.root);sky.select(name);
    const current=world;
    try {
      await Promise.all([current.start((done,total)=>{if(token===request)loading.textContent=`ワールドを読み込み中… ${Math.round(done/total*100)}%`;}),weather.select(name)]);
      if(token!==request)return;
      if(!player){player=new Player(camera,model,current.collision,canvas,locked=>{
        document.body.classList.toggle('playing',locked);$('hud').hidden=!locked;$('menus').inert=locked;
        if(locked){entered=true;error.hidden=true;}else {if(entered&&ui!=='map-menu')menu('pause-menu');if(entered)$('resume').focus();}
      });}player.collision=current.collision;player.movement.collision=current.collision;worldReady=true;spawn();audio.select(name);applySettings();enter.disabled=false;loading.textContent='';
    }catch(cause){if(token===request){report(cause);loading.textContent='読み込みに失敗しました。別のワールドを選択してください。';}}
  }
  document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.world!==selected)void choose(button.dataset.world!);}));
  const play=()=>{if(!player)return;ui='playing';void player.lock().catch(cause=>{menu(entered?'pause-menu':'map-menu');report(cause);});void audio.start().catch(cause=>report(`音声を再生できません: ${cause}`));};
  enter.addEventListener('click',play);$('resume').addEventListener('click',play);
  $('respawn').addEventListener('click',()=>{spawn();play();});
  $('change-map').addEventListener('click',()=>{entered=false;menu('map-menu');document.exitPointerLock();enter.focus();});
  for(let i=0;i<9;i++){const cell=document.createElement('div');cell.className=`slot${i===0?' selected':''}`;cell.innerHTML=`<span>${i+1}</span>`;$('hotbar').append(cell);}
  const selectSlot=(next:number)=>{slot=(next+9)%9;Array.from($('hotbar').children).forEach((cell,i)=>cell.classList.toggle('selected',i===slot));};
  window.addEventListener('wheel',event=>{if(player?.locked){event.preventDefault();selectSlot(slot+Math.sign(event.deltaY));}},{passive:false});
  const interact=()=>{if(!player?.locked||!world)return;const sound=world.interact(player.eye.toArray(),player.look.toArray());if(sound){model.swing();audio.effect(sound,.9);}};
  canvas.addEventListener('pointerdown',event=>{if(event.button===2){event.preventDefault();interact();}else if(event.button===0&&player?.locked)model.swing();});
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  window.addEventListener('keydown',event=>{
    if(player?.locked){if(event.code==='KeyE'&&!event.repeat)interact();if(event.code==='F3'){event.preventDefault();debug=!debug;$('debug').hidden=!debug;}if(/^Digit[1-9]$/.test(event.code))selectSlot(Number(event.code.slice(-1))-1);}
    else if(event.code==='Escape'&&ui==='settings-menu')menu(settingsReturn);
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();document.exitPointerLock();report('描画が中断されました。ページを再読み込みしてください。');});
  applySettings();let last=performance.now(),elapsed=0,frames=0,fps=0,fpsTime=0,stepPosition:number[]|null=null,stepDistance=0,wasGrounded=false;
  renderer.setAnimationLoop(time=>{
    const dt=Math.min((time-last)/1000,.1);last=time;if(document.hidden)return;
    elapsed+=dt;assets.time.value=elapsed;
    if(player&&world&&worldReady){if(player.locked)player.update(dt);world.update(player.position,player.locked?world.radius:1);if(player.position[1]<-20)spawn();if(world.error&&error.hidden){if(player.locked)document.exitPointerLock();report(world.error);}}
    if(player&&world&&worldReady){
      const p=player.position,m=player.movement,distance=stepPosition?Math.hypot(p[0]-stepPosition[0],p[2]-stepPosition[2]):0;
      if(distance>2)stepDistance=0;else stepDistance+=distance;
      const landing=!!stepPosition&&!wasGrounded&&m.grounded&&p[1]<stepPosition[1];
      if(player.locked&&!m.flying&&!player.keys.has('ShiftLeft')&&!player.keys.has('ShiftRight')&&(landing||stepDistance>1.65&&(m.grounded||m.swimming))){
        const block=assets.manifest.blocks[world.voxels.get(Math.floor(p[0]),Math.floor(p[1]-.1),Math.floor(p[2]))]?.name??'stone';
        const sound=m.swimming?'swim':/snow/.test(block)?'snow':/sand/.test(block)?'sand':/gravel/.test(block)?'gravel':/wool|carpet|bed$/.test(block)?'cloth':/planks|log|wood|oak|birch|spruce|jungle|acacia|fence/.test(block)?'wood':/grass|dirt|leaves/.test(block)?'grass':'stone';
        audio.effect(sound,landing?.6:.35);stepDistance=0;
      }
      stepPosition=[...p];wasGrounded=m.grounded;
    }
    if(audio.error&&error.hidden)report(audio.error);
    if(world&&worldReady){weather.update(dt,camera.position,world,!!player?.locked);if(weather.mode!==config.weather){config.weather=weather.mode;$<HTMLSelectElement>('weather').value=weather.mode;try{localStorage.setItem('world-settings',JSON.stringify(config));}catch{/* private mode */}}if(weather.consumeThunder())audio.effect('thunder',.8);}
    sky.update(player?.locked?dt:0,camera.position,fog,config.legacy,config.view*16,weather);
    if(player&&world){const light=world.light(...player.eye.toArray());assets.entityLight.value.set((light>>4)/15,(light&15)/15);}
    const underwater=!!player&&world?.voxels.get(Math.floor(camera.position.x),Math.floor(camera.position.y),Math.floor(camera.position.z));
    const aboveWater=world?.voxels.get(Math.floor(camera.position.x),Math.floor(camera.position.y)+1,Math.floor(camera.position.z));
    const inWater=!!underwater&&camera.position.y-Math.floor(camera.position.y)<fluidHeight(assets.manifest.blocks[underwater],assets.manifest.blocks[aboveWater??0],'water');document.body.classList.toggle('underwater',inWater);
    if(inWater){fog.color.set(sky.environment?.water_fog_color??'#20417b');fog.near=0;fog.far=sky.environment?.water_fog_distance??24;}
    audio.weather(weather.consumeRainSounds(),camera,!!player?.locked&&worldReady&&!inWater);
    renderer.render(scene,camera);frames++;fpsTime+=dt;if(fpsTime>1){fps=Math.round(frames/fpsTime);frames=0;fpsTime=0;}
    if(ui==='settings-menu'){$<HTMLInputElement>('time').value=String(sky.time);updateTime();}
    if(debug&&player&&world)$('debug').textContent=`${fps} FPS\nXYZ ${player.position.map(n=>n.toFixed(1)).join(' / ')}\n${world.data.name}\n${player.movement.flying?'Flying':player.movement.swimming?'Swimming':'Walking'}`;
  });
  await choose(selected);
  if(new URLSearchParams(location.search).has('debug'))Object.defineProperty(window,'memorySpace',{configurable:true,get:()=>({player,world,renderer,scene,camera,assets,sky,audio,weather,config})});
}
void init().catch(report);
