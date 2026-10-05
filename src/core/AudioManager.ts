import { assetUrl } from './AssetManager';
import { Vector3,type Camera } from 'three';
import type { RainSound } from '../world/RainSound';
export class AudioManager {
  private track:HTMLAudioElement|null=null;private volume=.5;private effectVolume=.7;
  private context:AudioContext|null=null;private buffers=new Map<string,Promise<AudioBuffer[]>>();error='';
  private rainVoices=new Set<AudioBufferSourceNode>();private rainGain:GainNode|null=null;private rainGeneration=0;private rainAudible=false;
  private forward=new Vector3();private up=new Vector3();
  constructor(readonly sources:Record<string,string|null>,readonly sounds:Record<string,string[]>={}){}
  select(world:string){this.pause();this.error='';this.rainGeneration++;this.rainAudible=false;for(const source of this.rainVoices)source.stop();this.rainVoices.clear();if(this.track){this.track.removeAttribute('src');this.track.load();}const file=this.sources[world];this.track=file?new Audio(assetUrl(file)):null;if(this.track){const track=this.track;track.loop=true;track.volume=this.volume;track.preload='none';track.addEventListener('error',()=>{if(this.track===track&&track.error?.code!==1)this.error='Unable to load music. Please reload the page.';});}}
  async start(){
    this.context??=new AudioContext();const track=this.track;
    const playing=track?.play().catch(cause=>{
      // pause()/load() cancel an outstanding play promise when changing music.
      // Autoplay restrictions can be retried on the next trusted click.
      if(track!==this.track||cause?.name==='AbortError'||cause?.name==='NotAllowedError')return;
      throw cause;
    });
    await Promise.all([this.context.resume(),playing]);for(const key of Object.keys(this.sounds))if(!['rain','rain_above','thunder'].includes(key))void this.load(key).catch(cause=>{this.error=String(cause);});
  }
  private load(key:string){
    if(!this.buffers.has(key))this.buffers.set(key,Promise.all((this.sounds[key]??[]).map(async file=>{const response=await fetch(assetUrl(file));if(!response.ok)throw new Error(`Unable to load sound effect: ${key}`);return this.context!.decodeAudioData(await response.arrayBuffer());})));
    return this.buffers.get(key)!;
  }
  effect(key:string,level=.3,pitch?:number){
    if(this.context?.state!=='running'||!this.effectVolume)return;
    void this.load(key).then(buffers=>{if(!buffers.length)return;const source=this.context!.createBufferSource(),gain=this.context!.createGain();source.buffer=buffers[Math.floor(Math.random()*buffers.length)];source.playbackRate.value=pitch??(.95+Math.random()*.1);gain.gain.value=this.effectVolume*level;source.connect(gain);gain.connect(this.context!.destination);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();}).catch(cause=>{this.error=String(cause);});
  }
  weather(sounds:readonly RainSound[],camera:Camera,audible:boolean){
    if(!audible&&this.rainAudible)this.rainGeneration++;
    this.rainAudible=audible;
    const context=this.context;if(!context)return;
    if(!this.rainGain){this.rainGain=context.createGain();this.rainGain.gain.value=0;this.rainGain.connect(context.destination);}
    this.rainGain.gain.setTargetAtTime(audible?this.effectVolume:0,context.currentTime,.05);
    if(!audible||context.state!=='running'||!this.effectVolume)return;
    camera.getWorldDirection(this.forward);this.up.set(0,1,0).applyQuaternion(camera.quaternion);
    const listener=context.listener,eye=camera.position;
    if(listener.positionX){
      for(const [parameter,value] of [[listener.positionX,eye.x],[listener.positionY,eye.y],[listener.positionZ,eye.z],[listener.forwardX,this.forward.x],[listener.forwardY,this.forward.y],[listener.forwardZ,this.forward.z],[listener.upX,this.up.x],[listener.upY,this.up.y],[listener.upZ,this.up.z]] as const)parameter.setValueAtTime(value,context.currentTime);
    }else {listener.setPosition(eye.x,eye.y,eye.z);listener.setOrientation(this.forward.x,this.forward.y,this.forward.z,this.up.x,this.up.y,this.up.z);}
    for(const sound of sounds){
      const generation=this.rainGeneration,when=context.currentTime;
      void this.load(sound.key).then(buffers=>{
        // Late downloads and map changes must not replay a backlog of old rain impacts.
        if(!buffers.length||generation!==this.rainGeneration||!this.rainAudible||!this.effectVolume||context.state!=='running'||context.currentTime-when>.2)return;
        const source=context.createBufferSource(),gain=context.createGain(),panner=context.createPanner();
        source.buffer=buffers[Math.floor(Math.random()*buffers.length)];source.playbackRate.value=sound.pitch;gain.gain.value=sound.volume;
        panner.panningModel='equalpower';panner.distanceModel='linear';panner.refDistance=0;panner.maxDistance=16;panner.rolloffFactor=1;
        [panner.positionX.value,panner.positionY.value,panner.positionZ.value]=sound.position;
        source.connect(gain);gain.connect(panner);panner.connect(this.rainGain!);this.rainVoices.add(source);
        source.onended=()=>{this.rainVoices.delete(source);source.disconnect();gain.disconnect();panner.disconnect();};source.start(context.currentTime);
      }).catch(cause=>{this.error=String(cause);});
    }
  }
  pause(){this.track?.pause();}
  setVolume(value:number){this.volume=value;if(this.track)this.track.volume=value;}
  setEffectVolume(value:number){this.effectVolume=value;if(this.rainGain&&this.context)this.rainGain.gain.setTargetAtTime(this.rainAudible?value:0,this.context.currentTime,.05);}
}
