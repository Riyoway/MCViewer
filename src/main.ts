import './style.css';
import './ui/menu.css';
import menuMarkup from './ui/menus.html?raw';
import {MinecraftText} from './ui/MinecraftText';
import {Panorama} from './ui/Panorama';
import {nativeOptions} from './ui/NativeOptions';
import {languages,locale,loadLanguage,savedLanguage,bindLanguage,renderLanguage,t,setText,setLiteral,setMessage,type Locale} from './ui/Language';
import {WorldStore,type SavedWorld,type LocalFile} from './viewer/WorldStore';
import {ImportedWorld,type ImportResult} from './viewer/ImportWorld';
import {ResourcePack} from './viewer/ResourcePack';
import {ConsoleGamma} from './core/ConsoleGamma';
import { Scene, PerspectiveCamera, Fog, Color, NearestFilter, NearestMipmapLinearFilter } from 'three';
import { createRenderer } from './core/Renderer';
import { AssetManager, assetUrl } from './core/AssetManager';
import { Player,lockPointer } from './core/Player';
import { PlayerModel } from './core/PlayerModel';
import { AudioManager } from './core/AudioManager';
import { World } from './minecraft/WorldLoader';
import { Sky } from './world/Sky';
import { Weather,type WeatherMode } from './world/Weather';
import { fluidHeight } from './minecraft/Fluid';
import { Hud } from './ui/Hud';
import {CreativeControls} from './core/CreativeControls';
import {HeldItem} from './core/HeldItem';
import {BlockOutline} from './world/BlockOutline';
import {BlockParticles} from './world/BlockParticles';
import {soundGroup} from './minecraft/BlockState';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
$('menus').innerHTML=menuMarkup;
$('menus').inert=true;$('menus').setAttribute('aria-busy','true');
document.body.classList.add('panorama-menu');
document.title='Minecraft World Viewer';
const panoramaShade=document.createElement('div');panoramaShade.id='panorama-shade';$('world').after(panoramaShade);
const canvas=$<HTMLCanvasElement>('world'),enter=$<HTMLButtonElement>('enter'),loading=$('loading');
// The old bob option defaulted on; the revised option starts off without resetting other settings.
const defaults={gamma:50,legacy:true,view:6,fov:70,resolution:720,mipmap:true,viewBobbing:false,clouds:true,sensitivity:100,volume:50,effects:70,cycle:true,minutes:20,weather:'clear' as WeatherMode,weatherIntensity:100,weatherCycle:false,weatherMinutes:10};
const config={...defaults};
try{const saved=JSON.parse(localStorage.getItem('world-settings')??'{}');for(const key of Object.keys(config) as (keyof typeof config)[])if(typeof saved[key]===typeof defaults[key])Object.assign(config,{[key]:saved[key]});}catch{/* storage may be unavailable */}
if(![0,480,720].includes(config.resolution))config.resolution=defaults.resolution;
if(!['clear','rain','thunder','snow'].includes(config.weather))config.weather='clear';
let world:World|null=null,player:Player|null=null,selected='',entered=false,request=0,ui='home-menu',settingsReturn='home-menu',debug=false,worldReady=false,defaultWorldName=true;
function menu(id:string){ui=id;document.querySelectorAll<HTMLElement>('[data-screen]').forEach(panel=>panel.hidden=panel.id!==id);const panorama=!entered&&['home-menu','settings-menu','video-menu','sound-menu','controls-menu','world-settings-menu','help-menu','language-menu'].includes(id);document.body.classList.toggle('panorama-menu',panorama);document.body.classList.toggle('dirt-menu',!panorama&&(!entered||['map-menu','add-menu','loading-menu','pack-menu','delete-menu'].includes(id)));document.body.classList.toggle('pause-background',entered&&!document.body.classList.contains('dirt-menu'));}
function report(cause:unknown){console.warn('[World Viewer]',cause instanceof Event?'Unable to load an image.':cause);}
async function init() {
  const preferred=savedLanguage();await loadLanguage('en');bindLanguage(document.body);if(preferred!=='en'){try{await loadLanguage(preferred);renderLanguage(document.body);}catch(cause){report(cause);}}
  $<HTMLInputElement>('world-name').value=t('New World');
  $('world-name').addEventListener('input',()=>{defaultWorldName=false;});
  const renderer=createRenderer(canvas),consoleGamma=new ConsoleGamma(document.body),scene=new Scene(),camera=new PerspectiveCamera(70,innerWidth/innerHeight,.05,350);
  const fog=new Fog('#bbd0dd',35,96);scene.fog=fog;scene.background=new Color('#89b7ef');scene.add(camera);
  const assets=await AssetManager.load(),sky=new Sky(assets),model=await PlayerModel.create(assets),weather=await Weather.create(assets),audio=new AudioManager(assets.manifest.audio,{...assets.manifest.effects,...weather.data.sounds});
  const hud=await Hud.create(assets);let lastWorldError='',lastAudioError='';
  hud.setLanguage();
  audio.sources.menu=new URL(`${import.meta.env.BASE_URL}menu/menu.ogg`,location.href).href;audio.sounds.ui_click=[new URL(`${import.meta.env.BASE_URL}menu/click.ogg`,location.href).href];audio.select('menu');
  $('menus').addEventListener('click',event=>{const button=(event.target as HTMLElement).closest('button');if(button&&!button.disabled)void audio.start().then(()=>audio.effect('ui_click',.25,1)).catch(()=>{/* A later trusted click can resume audio. */});});
  const panorama=new Panorama(),store=new WorldStore(),resourcePack=new ResourcePack(assets),samples=structuredClone(assets.manifest.worlds),records=new Map<string,SavedWorld>();
  let listMode:'samples'|'local'='local',helpReturn='home-menu',packReturn='settings-menu',pendingImport:ImportedWorld|undefined,importFiles:LocalFile[]=[],importPack:LocalFile|undefined,materialQueue:Promise<unknown>=Promise.resolve();
  const bitmap=new MinecraftText();void bitmap.start($('menus')).catch(()=>{/* fallback to readable browser text */});await panorama.load();
  const held=new HeldItem(assets),outline=new BlockOutline(),debris=new BlockParticles(assets);camera.add(held.root);scene.add(outline.mesh,debris.root);
  const listUrls:string[]=[];
  async function refreshList(mode=listMode){
    listMode=mode;for(const url of listUrls)URL.revokeObjectURL(url);listUrls.length=0;
    try{records.clear();for(const record of await store.list())records.set(record.id,record);}catch(cause){report(`Unable to open browser storage: ${cause}`);}
    const entries=mode==='samples'?Object.entries(samples).map(([id,data])=>({id,name:data.name,version:'Sample Worlds',pack:records.get('sample:'+id)?.pack?.name,icon:assetUrl(`${id}-icon.png`)})):[...records.values()].filter(r=>!r.sample).map(r=>{const icon=r.icon?URL.createObjectURL(r.icon):`${import.meta.env.BASE_URL}menu/dirt.png`;if(r.icon)listUrls.push(icon);return {id:r.id,name:r.name,version:r.version??'Java Edition',pack:r.pack?.name,icon};});
    if(!entries.some(e=>e.id===selected))selected='';$('maps').replaceChildren();
    for(const entry of entries){const button=document.createElement('button'),image=document.createElement('img'),info=document.createElement('div');button.className='world-entry';button.dataset.world=entry.id;button.setAttribute('role','option');image.src=entry.icon;image.alt='';info.className='world-info';
      for(const [text,style,localized] of [[entry.name,'',false],[entry.version,'world-details',mode==='samples'||entry.version==='1.12 or earlier'],[entry.pack??'Creative Mode','world-details',!entry.pack]] as const){const line=document.createElement('p');if(localized)setText(line,text);else setLiteral(line,text);line.className=style;info.append(line);}button.append(image,info);button.addEventListener('click',()=>selectEntry(entry.id));button.addEventListener('dblclick',()=>void openSelected());$('maps').append(button);}
    if(!entries.length){const empty=document.createElement('p');empty.className='empty-worlds';setText(empty,'No worlds found');$('maps').append(empty);}
    setText($('world-list-title'),mode==='samples'?'Sample Worlds':'Select World');setText($('switch-worlds'),mode==='samples'?'Your Worlds':'Samples');selectEntry(selected);
  }
  function selectEntry(id:string){selected=id;document.querySelectorAll<HTMLElement>('[data-world]').forEach(button=>{const active=button.dataset.world===id;button.classList.toggle('selected',active);button.setAttribute('aria-selected',String(active));});enter.disabled=!id;$<HTMLButtonElement>('delete-world').disabled=!id||listMode==='samples';}
  $('home-worlds').onclick=()=>{entered=false;menu('map-menu');void refreshList('local');};$('home-samples').onclick=()=>{entered=false;menu('map-menu');void refreshList('samples');};
  $('switch-worlds').onclick=()=>void refreshList(listMode==='samples'?'local':'samples');$('worlds-back').onclick=()=>menu('home-menu');
  $('add-world').onclick=()=>{menu('add-menu');$<HTMLInputElement>('world-name').focus();};$('cancel-import').onclick=()=>menu('map-menu');
  $('pick-world').onclick=()=>$('world-zip').click();$('pick-folder').onclick=()=>$('world-folder').click();$('pick-import-pack').onclick=()=>$('import-pack-file').click();
  for(const id of ['world-zip','world-folder'])$(id).onchange=()=>{const files=[...($<HTMLInputElement>(id).files??[])];importFiles=files.map(file=>({name:file.webkitRelativePath||file.name,blob:file}));if(files[0])setLiteral($('world-file-name'),id==='world-folder'?files[0].webkitRelativePath.split('/')[0]:files[0].name);else setText($('world-file-name'),'None selected');if(files[0])defaultWorldName=false;if(files[0])$<HTMLInputElement>('world-name').value=(id==='world-folder'?files[0].webkitRelativePath.split('/')[0]:files[0].name.replace(/\.zip$/i,''));$<HTMLButtonElement>('confirm-import').disabled=!importFiles.length;};
  $('import-pack-file').onchange=()=>{const file=$<HTMLInputElement>('import-pack-file').files?.[0];importPack=file?{name:file.name,blob:file}:undefined;if(file)setLiteral($('import-pack-name'),file.name);else setText($('import-pack-name'),'Default');};$('clear-import-pack').onclick=()=>{importPack=undefined;$<HTMLInputElement>('import-pack-file').value='';setText($('import-pack-name'),'Default');};
  $('confirm-import').onclick=()=>void (async()=>{captureLoading();const record:SavedWorld={id:'local:'+crypto.randomUUID(),name:$<HTMLInputElement>('world-name').value.trim()||t('New World'),added:Date.now(),files:importFiles.slice(),pack:importPack};records.set(record.id,record);selected=record.id;const opened=await choose(record.id);if(!opened){records.delete(record.id);return;}record.manifest=opened.data;await store.put(record);importFiles=[];importPack=undefined;$<HTMLButtonElement>('confirm-import').disabled=true;if(world===opened)play();})().catch(report);
  $('delete-world').onclick=()=>{if(!selected||listMode==='samples')return;setLiteral($('delete-map-name'),records.get(selected)?.name??'');menu('delete-menu');};$('cancel-delete').onclick=()=>menu('map-menu');$('confirm-delete').onclick=()=>void (async()=>{if(selected&&!samples[selected]){await store.delete(selected);localStorage.removeItem('world-edits:'+selected);localStorage.removeItem('hotbar:'+selected);selected='';}menu('map-menu');await refreshList();})().catch(report);
  const openPack=()=>{packReturn=ui;menu('pack-menu');const record=records.get(samples[selected]?'sample:'+selected:selected);if(record?.pack)setLiteral($('active-pack-name'),record.pack.name);else if(samples[selected])setText($('active-pack-name'),'{name} (Included)',{name:samples[selected].name});else setText($('active-pack-name'),'Default');setText($('pack-status'),selected?'':'Select a world first.');$<HTMLButtonElement>('pick-active-pack').disabled=$<HTMLButtonElement>('default-active-pack').disabled=!selected;};
  $('settings-pack').onclick=openPack;$('pause-pack').onclick=openPack;$('pack-back').onclick=()=>menu(packReturn);$('pick-active-pack').onclick=()=>$('active-pack-file').click();
  async function changePack(pack?:LocalFile){if(!selected)return;const id=samples[selected]?'sample:'+selected:selected,record=records.get(id)??{id,name:samples[selected].name,added:Date.now(),files:[],sample:selected};const old=record.pack;record.pack=pack;records.set(id,record);const position=player?[...player.position]:undefined,yaw=player?.yaw,pitch=player?.pitch,returnEntered=entered,opened=await choose(selected);if(!opened){record.pack=old;return;}if(position&&returnEntered&&player){player.position.splice(0,3,...position);player.yaw=yaw!;player.pitch=pitch!;player.update(0);}entered=returnEntered;await store.put(record);if(pack)setLiteral($('active-pack-name'),pack.name);else setText($('active-pack-name'),'Default');menu('pack-menu');}
  $('active-pack-file').onchange=()=>{const file=$<HTMLInputElement>('active-pack-file').files?.[0];if(file)void changePack({name:file.name,blob:file}).catch(report);};$('default-active-pack').onclick=()=>void changePack().catch(report);
  $('home-help').onclick=()=>{helpReturn='home-menu';menu('help-menu');};$('help-back').onclick=()=>menu(helpReturn);
  document.querySelectorAll<HTMLButtonElement>('[data-submenu]').forEach(button=>button.onclick=()=>{if(button.dataset.submenu==='help-menu')helpReturn=ui;menu(button.dataset.submenu!);});document.querySelectorAll<HTMLButtonElement>('[data-options-back]').forEach(button=>button.onclick=()=>menu('settings-menu'));
  await sky.load();scene.add(sky.root,model.root,weather.root);model.root.visible=false;
  const resize=()=>{const height=config.resolution?Math.min(innerHeight,config.resolution):innerHeight,width=Math.floor(height*innerWidth/innerHeight);renderer.setSize(width,height,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();document.documentElement.style.setProperty('--menu-scale',String(Math.max(1,Math.min(4,Math.floor(innerWidth/320),Math.floor(innerHeight/240)))));};
  window.addEventListener('resize',resize);
  const refreshOptions=nativeOptions($('menus'));
  function applySettings() {
    for(const [key,value] of Object.entries(config)) {
      const field=$<HTMLInputElement|HTMLSelectElement>(key);if(!field)continue;
      if(field instanceof HTMLInputElement&&field.type==='checkbox')field.checked=Boolean(value);else field.value=String(value);
      if(field instanceof HTMLInputElement&&field.type==='range')Object.assign(config,{[key]:Number(field.value)});
      const output=document.getElementById(`${key}-value`);if(output){
        let caption=`${config[key as keyof typeof config]}${['gamma','sensitivity','volume','effects','weatherIntensity'].includes(key)?'%':['minutes','weatherMinutes'].includes(key)?` ${t('min')}`:key==='view'?` ${t('chunks')}`:''}`;
        if(key==='fov')caption=config.fov===70?t('Normal'):config.fov===110?t('Quake Pro'):String(config.fov);
        if(key==='gamma'&&!config.legacy)caption=config.gamma===0?t('Moody'):config.gamma===100?t('Bright'):`+${config.gamma}%`;
        if((key==='volume'||key==='effects')&&value===0)caption=t('OFF');
        if(output.textContent!==caption)output.textContent=caption;
      }
    }
    assets.gamma.value=config.legacy?0:config.gamma/100;consoleGamma.set(config.gamma,config.legacy);const gammaLabel=config.legacy?'Gamma':'Brightness';setText($('gamma-label'),gammaLabel);
    const filter=config.mipmap?NearestMipmapLinearFilter:NearestFilter;if(assets.opaque.map!.minFilter!==filter){assets.opaque.map!.minFilter=filter;assets.opaque.map!.needsUpdate=true;}
    sky.cycle=config.cycle;sky.minutes=config.minutes;sky.clouds=config.clouds;
    hud.setLegacy(config.legacy);
    weather.setMode(config.weather);weather.intensity=config.weatherIntensity/100;weather.cycle=config.weatherCycle;weather.minutes=config.weatherMinutes;
    audio.setVolume(config.volume/100);audio.setEffectVolume(config.effects/100);if(world)world.radius=config.view;
    if(player){player.fov=config.fov;player.motionEnabled=config.viewBobbing;player.sensitivity=config.sensitivity*.00002;}
    resize();refreshOptions();try{localStorage.setItem('world-settings',JSON.stringify(config));}catch{/* private mode */}
  }
  for(const key of Object.keys(config) as (keyof typeof config)[])$(key).addEventListener('input',event=>{
    const field=event.target as HTMLInputElement|HTMLSelectElement;
    Object.assign(config,{[key]:typeof defaults[key]==='boolean'?(field instanceof HTMLInputElement?field.checked:field.value==='true'):typeof defaults[key]==='string'?field.value:Number(field.value)});applySettings();
  });
  const updateTime=()=>{const hours=((sky.time+6000)%24000)/1000,text=`${String(Math.floor(hours)).padStart(2,'0')}:${String(Math.floor(hours%1*60)).padStart(2,'0')}`;if($('time-value').textContent!==text)$('time-value').textContent=text;refreshOptions();};
  $('time').addEventListener('input',event=>{sky.time=Number((event.target as HTMLInputElement).value);updateTime();});
  document.querySelectorAll<HTMLButtonElement>('[data-time]').forEach(button=>button.addEventListener('click',()=>{sky.time=Number(button.dataset.time);$<HTMLInputElement>('time').value=String(sky.time);updateTime();}));
  $('reset-settings').addEventListener('click',()=>{Object.assign(config,defaults);sky.time=6000;applySettings();updateTime();});
  let languageReturn='home-menu';
  function refreshLanguages(){for(const button of document.querySelectorAll<HTMLElement>('[data-language]')){const selected=button.dataset.language===locale();button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));}}
  for(const [code,name] of languages){const button=document.createElement('button');button.className='language-entry';button.dataset.language=code;button.textContent=name;button.setAttribute('role','option');button.lang=code;button.onclick=()=>void (async()=>{if(!await loadLanguage(code as Locale))return;renderLanguage(document.body);hud.setLanguage();if(defaultWorldName)$<HTMLInputElement>('world-name').value=t('New World');applySettings();updateTime();refreshLanguages();})().catch(report);$('languages').append(button);}
  refreshLanguages();
  const openLanguage=()=>{languageReturn=ui;menu('language-menu');document.querySelector<HTMLButtonElement>('.language-entry.selected')?.focus();};
  $('home-language').onclick=openLanguage;$('settings-language').onclick=openLanguage;$('language-back').onclick=()=>{menu(languageReturn);$(languageReturn==='home-menu'?'home-language':'settings-language').focus();};
  const settings=()=>{settingsReturn=ui;menu('settings-menu');$('settings-back').focus();void audio.start().catch(cause=>report(`Unable to play audio: ${cause}`));};
  $('home-settings').addEventListener('click',settings);$('pause-settings').addEventListener('click',settings);$('settings-back').addEventListener('click',()=>{menu(settingsReturn);$(settingsReturn==='home-menu'?'home-settings':'pause-settings').focus();});
  const spawn=()=>{if(!player||!world)return;player.stop();player.position.splice(0,3,...world.data.spawn);player.yaw=Math.PI-world.data.yaw*Math.PI/180;player.pitch=0;player.movement.flying=false;player.movement.grounded=false;while(player.collision.overlaps(...player.position)&&player.position[1]<world.data.bounds.max[1])player.position[1]++;player.update(0);};
  async function choose(name:string) {
    const token=++request;selected=name;entered=false;hud.hide();enter.disabled=true;lastWorldError='';setMessage(loading,'Loading world...');menu('loading-menu');$<HTMLProgressElement>('load-progress').removeAttribute('value');
    worldReady=false;player?.stop();controls.reset();debris.clear();held.clear();audio.weather([],camera,false);pendingImport?.dispose();pendingImport=undefined;if(world){scene.remove(world.root);world.dispose();world=null;}
    let imported:ImportResult|undefined,source:ImportedWorld|undefined;
    try {
      const record=records.get(samples[name]?'sample:'+name:name),theme=samples[name]?(name.startsWith('tutorial')?'vanilla':name):'vanilla';
      let pack:Awaited<ReturnType<ResourcePack['apply']>>|undefined;
      const materials=materialQueue.catch(()=>{}).then(async()=>{if(token!==request)return;resourcePack.reset();if(record?.pack)return resourcePack.apply(record.pack,message=>{if(token===request)setMessage(loading,message);},theme);});materialQueue=materials;pack=await materials;
      if(token!==request)return;
      if(samples[name])assets.manifest.worlds[name]=structuredClone(samples[name]);
      else {if(!record)throw new Error('Saved world not found');source=new ImportedWorld();pendingImport=source;source.progress=message=>{if(token===request)setMessage(loading,message);};imported=await source.load(record,assets.manifest);if(token!==request){source.dispose();return;}record.version=imported.version;if(imported.icon)record.icon=new Blob([imported.icon],{type:'image/png'});assets.manifest.worlds[name]=imported.manifest;}
      if(pack){const original=assets.manifest.worlds[name].environment??{sun:'sun.png',moon:'moon.png',clouds:'clouds.png'};assets.manifest.worlds[name].environment={...original,...pack.environment};await sky.loadEnvironment(assets.manifest.worlds[name].environment!);}
      if(token!==request){source?.dispose();return;}
      held.clear();hud.selectWorld(name,theme);world=new World(assets,name,source);pendingImport=undefined;world.radius=config.view;scene.add(world.root);sky.select(name);const current=world;
      await Promise.all([current.start((done,total)=>{if(token===request){setMessage(loading,`Loading world... ${Math.round(done/Math.max(1,total)*100)}%`);const bar=$<HTMLProgressElement>('load-progress');bar.max=total||1;bar.value=done;}}),weather.select(name,imported?.climate)]);
      if(token!==request)return;
      if(!player){player=new Player(camera,model,current.collision,canvas,locked=>{
        if(!worldReady)return;document.body.classList.toggle('playing',locked);$('hud').hidden=!locked;$('menus').inert=locked;
        if(locked){entered=true;hud.hide();}else {if(entered&&ui!=='map-menu'&&ui!=='inventory')menu('pause-menu');if(entered&&ui!=='inventory')$('resume').focus();}
      });}player.collision=current.collision;player.movement.collision=current.collision;worldReady=true;spawn();audio.select(samples[name]?name:'tutorial');applySettings();enter.disabled=false;setLiteral(loading,'');
      if(imported?.warnings.length)console.info('World import:',imported.warnings);
      return current;
    }catch(cause){source?.dispose();if(pendingImport===source)pendingImport=undefined;if(token===request){document.exitPointerLock();report(cause);menu('map-menu');void refreshList();}}
  }
  function captureLoading(){const token=request+1;void lockPointer(canvas).then(()=>{if(token!==request)document.exitPointerLock();}).catch(()=>{/* The canvas click can retry if this browser requires another gesture. */});}
  async function openSelected(){if(!selected)return;captureLoading();const opened=await choose(selected);if(opened&&world===opened)play();}
  const play=()=>{if(!player||!worldReady)return;entered=true;menu('playing');document.body.classList.add('playing');document.body.classList.remove('pause-background');$('hud').hidden=false;$('menus').inert=true;hud.hide();canvas.focus({preventScroll:true});setText($('resume'),'Back to World');if(!player.locked)void player.lock().catch(()=>{/* Keep the world visible; a canvas click retries pointer lock. */});void audio.start().catch(report);};
  enter.addEventListener('click',()=>void openSelected());$('resume').addEventListener('click',play);
  const cancelLoading=()=>{request++;document.exitPointerLock();pendingImport?.dispose();pendingImport=undefined;worldReady=false;if(world){scene.remove(world.root);world.dispose();world=null;}entered=false;menu('map-menu');void refreshList();};$('cancel-loading').onclick=cancelLoading;
  $('respawn').addEventListener('click',()=>{spawn();play();});
  $('reset-map').addEventListener('click',()=>{if(!worldReady||!world)return;setLiteral($('reset-map-name'),world.data.name);menu('reset-menu');$('cancel-reset').focus();});
  const cancelReset=()=>{menu('pause-menu');$('reset-map').focus();};
  $('cancel-reset').addEventListener('click',cancelReset);
  $('confirm-reset').addEventListener('click',()=>{if(!worldReady||!world)return;world.edits.clear();captureLoading();void choose(selected).then(opened=>{if(opened&&world===opened)play();});});
  $('change-map').addEventListener('click',()=>{entered=false;worldReady=false;hud.hide();controls.reset();debris.clear();if(world){scene.remove(world.root);world.dispose();world=null;}audio.select('menu');menu('home-menu');document.exitPointerLock();$('home-worlds').focus();});
  window.addEventListener('wheel',event=>{if(player?.locked){event.preventDefault();hud.select(hud.inventory.selected+Math.sign(event.deltaY));}},{passive:false});
  const controls=new CreativeControls(()=>{
    if(!player?.locked||!world||!worldReady)return;model.swing();const hit=world.target(player.eye.toArray(),player.look.toArray());
    if(!hit||hud.selectedItem?.id.endsWith('_sword'))return;const block=assets.manifest.blocks[hit.id],light=world.light(...hit.position);
    if(world.destroy(hit)){debris.break(hit,light,world);audio.effect(`dig_${soundGroup(block.name)}`,1,.8);}
  },()=>{
    if(!player?.locked||!world||!worldReady)return;
    const sneaking=player.keys.has('ShiftLeft')||player.keys.has('ShiftRight'),hit=world.target(player.eye.toArray(),player.look.toArray());if(!hit)return;
    if(!sneaking){const sound=world.interact(player.eye.toArray(),player.look.toArray());if(sound){model.swing();audio.effect(sound,.9);return;}}
    const item=hud.selectedItem;if(item&&world.place(item.id,hit,player.look.toArray(),player.position)){model.swing();const base=assets.manifest.blocks[assets.manifest.building?.[world.building.theme]?.[item.id]??0];const group=soundGroup(base?.name??'stone');audio.effect(group==='glass'?'stone':group,1,.8);}
  },()=>{if(player?.locked&&world){const hit=world.target(player.eye.toArray(),player.look.toArray());if(hit)hud.pick(assets.manifest.blocks[hit.id].name);}});
  canvas.addEventListener('pointerdown',event=>{if(ui==='playing'&&worldReady&&!player?.locked){event.preventDefault();play();return;}if(player?.locked){event.preventDefault();controls.down(event.button);}});
  window.addEventListener('pointerup',event=>controls.up(event.button));
  document.addEventListener('pointerlockchange',()=>controls.reset());window.addEventListener('blur',()=>controls.reset());window.addEventListener('pagehide',()=>world?.edits.flush());
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  window.addEventListener('keydown',event=>{
    if(event.code==='Escape'&&ui==='loading-menu'){event.preventDefault();cancelLoading();return;}
    if(event.code==='Escape'&&ui==='playing'&&!player?.locked){document.body.classList.remove('playing');$('hud').hidden=true;$('menus').inert=false;menu('pause-menu');$('resume').focus();return;}
    if(hud.open){if(hud.key(event)==='close'&&!event.repeat){event.preventDefault();hud.hide();play();}return;}
    if(player?.locked){if(event.code==='KeyE'&&!event.repeat){event.preventDefault();ui='inventory';hud.show();document.exitPointerLock();}if(event.code==='F3'){event.preventDefault();debug=!debug;$('debug').hidden=!debug;}if(/^Digit[1-9]$/.test(event.code))hud.select(Number(event.code.slice(-1))-1);}
    else if(event.code==='Escape'&&ui==='settings-menu')menu(settingsReturn);
    else if(event.code==='Escape'&&ui==='language-menu')menu(languageReturn);
    else if(event.code==='Escape'&&ui==='reset-menu')cancelReset();
    else if(event.code==='Escape'){if(ui==='loading-menu')cancelLoading();else if(ui==='pack-menu')menu(packReturn);else if(ui==='help-menu')menu(helpReturn);else if(ui==='map-menu')menu('home-menu');else if(ui==='add-menu'||ui==='delete-menu')menu('map-menu');else if(ui.endsWith('-menu')&&ui!=='home-menu'&&ui!=='pause-menu')menu('settings-menu');}
    else if(ui==='map-menu'&&event.target instanceof HTMLElement&&!event.target.closest('input,select')){const buttons=[...document.querySelectorAll<HTMLButtonElement>('[data-world]')];if(event.code==='ArrowDown'||event.code==='ArrowUp'){event.preventDefault();const index=buttons.findIndex(b=>b.dataset.world===selected),next=buttons[Math.max(0,Math.min(buttons.length-1,index+(event.code==='ArrowDown'?1:-1)))];if(next){selectEntry(next.dataset.world!);next.focus();next.scrollIntoView({block:'nearest'});}}else if(event.code==='Enter'&&selected&&event.target.id!=='enter')void openSelected();}
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();document.exitPointerLock();report('Rendering was interrupted. Please reload the page.');});
  applySettings();let last=performance.now(),elapsed=0,frames=0,fps=0,fpsTime=0,stepPosition:number[]|null=null,stepDistance=0,wasGrounded=false;
  renderer.setAnimationLoop(time=>{
    const dt=Math.min((time-last)/1000,.1);last=time;if(document.hidden)return;
    elapsed+=dt;assets.time.value=elapsed;
    if(player&&world&&worldReady){if(player.locked){player.update(dt);controls.update(dt);}world.update(player.position,player.locked?world.radius:1);if(player.position[1]<world.data.bounds.min[1]-20)spawn();if(world.error&&world.error!==lastWorldError){lastWorldError=world.error;report(world.error);}}
    if(player&&world){held.select(hud.selectedItem,hud.worldTheme);held.update(dt,model,player.locked&&player.perspective===0);outline.update(worldReady&&player.locked?world.target(player.eye.toArray(),player.look.toArray()):null,assets.manifest.blocks,player.locked);debris.update(dt,camera,world,player.locked);}
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
    if(audio.error&&audio.error!==lastAudioError){lastAudioError=audio.error;report(audio.error);}
    if(world&&worldReady){weather.update(dt,camera.position,world,!!player?.locked,camera);if(weather.mode!==config.weather){config.weather=weather.mode;$<HTMLSelectElement>('weather').value=weather.mode;try{localStorage.setItem('world-settings',JSON.stringify(config));}catch{/* private mode */}}if(weather.consumeThunder())audio.effect('thunder',.8);}
    sky.update(player?.locked?dt:0,camera.position,fog,config.legacy,config.view*16,weather);
    if(player&&world){const light=world.light(...player.eye.toArray());assets.entityLight.value.set((light>>4)/15,(light&15)/15);}
    const underwater=!!player&&world?.voxels.get(Math.floor(camera.position.x),Math.floor(camera.position.y),Math.floor(camera.position.z));
    const aboveWater=world?.voxels.get(Math.floor(camera.position.x),Math.floor(camera.position.y)+1,Math.floor(camera.position.z));
    const inWater=!!underwater&&camera.position.y-Math.floor(camera.position.y)<fluidHeight(assets.manifest.blocks[underwater],assets.manifest.blocks[aboveWater??0],'water');document.body.classList.toggle('underwater',inWater);
    if(inWater){fog.color.set(sky.environment?.water_fog_color??'#20417b');fog.near=0;fog.far=sky.environment?.water_fog_distance??24;}
    audio.weather(weather.consumeRainSounds(),camera,!!player?.locked&&worldReady&&!inWater);
    if(document.body.classList.contains('panorama-menu'))panorama.render(renderer,dt);else renderer.render(scene,camera);frames++;fpsTime+=dt;if(fpsTime>1){fps=Math.round(frames/fpsTime);frames=0;fpsTime=0;}
    if(ui==='world-settings-menu'){$<HTMLInputElement>('time').value=String(sky.time);updateTime();}
    if(debug&&player&&world)$('debug').textContent=`${fps} FPS\nXYZ ${player.position.map(n=>n.toFixed(1)).join(' / ')}\n${world.data.name}\n${t(player.movement.flying?'Flying':player.movement.swimming?'Swimming':'Walking')}`;
  });
  await refreshList();menu('home-menu');$('menus').inert=false;$('menus').removeAttribute('aria-busy');
  if(new URLSearchParams(location.search).has('debug'))Object.defineProperty(window,'mcViewer',{configurable:true,get:()=>({player,world,renderer,scene,camera,assets,sky,audio,weather,hud,config,controls,held,outline,debris,store,resourcePack,records})});
}
void init().catch(report);
