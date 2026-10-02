import { assetUrl } from './AssetManager';
export class AudioManager {
  private track:HTMLAudioElement|null=null;private volume=.5;private effectVolume=.7;
  private context:AudioContext|null=null;private buffers=new Map<string,Promise<AudioBuffer[]>>();error='';
  constructor(readonly sources:Record<string,string|null>,readonly sounds:Record<string,string[]>={}){}
  select(world:string){this.pause();const file=this.sources[world];this.track=file?new Audio(assetUrl(file)):null;if(this.track){this.track.loop=true;this.track.volume=this.volume;this.track.preload='auto';this.track.addEventListener('error',()=>{this.error='BGMを読み込めません。ページを再読み込みしてください。';});}}
  async start(){this.context??=new AudioContext();await Promise.all([this.context.resume(),this.track?.play()]);for(const key of Object.keys(this.sounds))void this.load(key).catch(cause=>{this.error=String(cause);});}
  private load(key:string){
    if(!this.buffers.has(key))this.buffers.set(key,Promise.all((this.sounds[key]??[]).map(async file=>{const response=await fetch(assetUrl(file));if(!response.ok)throw new Error(`効果音を読み込めません: ${key}`);return this.context!.decodeAudioData(await response.arrayBuffer());})));
    return this.buffers.get(key)!;
  }
  effect(key:string,level=.3){
    if(this.context?.state!=='running'||!this.effectVolume)return;
    void this.load(key).then(buffers=>{if(!buffers.length)return;const source=this.context!.createBufferSource(),gain=this.context!.createGain();source.buffer=buffers[Math.floor(Math.random()*buffers.length)];source.playbackRate.value=.95+Math.random()*.1;gain.gain.value=this.effectVolume*level;source.connect(gain);gain.connect(this.context!.destination);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();}).catch(cause=>{this.error=String(cause);});
  }
  pause(){this.track?.pause();}
  setVolume(value:number){this.volume=value;if(this.track)this.track.volume=value;}
  setEffectVolume(value:number){this.effectVolume=value;}
}
