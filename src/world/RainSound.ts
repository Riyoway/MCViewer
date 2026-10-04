import type { Vector3 } from 'three';
import type { Precipitation } from './Climate';
import { LegacyRandom } from './Precipitation';

export interface RainSound {
  key:'rain'|'rain_above';position:[number,number,number];volume:number;pitch:number;
}
// Mojang 1.21.6 WeatherEffectRenderer.tickRainParticles: one-shot sounds overlap.
export class RainSounds {
  private ticks=0;private soundTime=0;
  tick(level:number,eye:Vector3,surface:(x:number,z:number)=>number|null,kind:(x:number,y:number,z:number)=>Precipitation,splash?:(x:number,y:number,z:number)=>void):RainSound|null {
    const random=new LegacyRandom(BigInt(this.ticks++|0)*312987231n);
    if(level<=0)return null;
    const cx=Math.floor(eye.x),cy=Math.floor(eye.y),cz=Math.floor(eye.z);let hit:[number,number,number]|undefined;
    for(let i=0;i<Math.floor(100*level*level);i++){
      const x=cx+random.int(21)-10,z=cz+random.int(21)-10,y=surface(x,z);
      if(y===null||y<=0||y>cy+10||y<cy-10||kind(x,y,z)!=='rain')continue;
      hit=[x+.5,y-.5,z+.5];
      // Sound and particles share the native surface sampling, including its RNG sequence.
      const offsetX=random.double(),offsetZ=random.double();splash?.(x+offsetX,y,z+offsetZ);
    }
    if(!hit||random.int(3)>=this.soundTime++)return null;
    this.soundTime=0;
    const roof=surface(cx,cz),above=Math.floor(hit[1])>cy+1&&roof!==null&&roof>cy;
    return {key:above?'rain_above':'rain',position:hit,volume:above?.1:.2,pitch:above?.5:1};
  }
}
