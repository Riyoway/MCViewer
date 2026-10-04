import assert from 'node:assert/strict';
import {join} from 'node:path';
import sharp from 'sharp';

// Capture tests/gamma-check.html at 512x256 as probe-java.png and probe-0/25/50/75/100.png.
// Screenshot readback tests the browser compositor; WebGL readPixels cannot see CSS filters.
const directory=process.argv[2]??'.cache/legacy-gamma';
async function read(name:string){const {data,info}=await sharp(join(directory,`probe-${name}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,512);assert.equal(info.height,256);return (x:number,y:number)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+3)];}
const baseline=await read('java'),colors=[[0,0,0],[32,32,32],[64,64,64],[128,128,128],[192,192,192],[255,255,255],[64,128,192],[255,0,0]];
for(const [i,color] of colors.entries())for(const c of [0,1,2]){const expected=i===6?[128,96,112][c]:color[c];assert(Math.abs(baseline(i*64+32,32)[c]-expected)<=1,'Java output and alpha composition stay unmodified');}
let checks=0,maxError=0;const samples=[];
// Independent reference anchors from the Console gamma ramp, including its default.
for(const [setting,exponent] of [[0,2],[25,8/7],[50,.8],[75,8/13],[100,.5]]){
  const pixels=await read(String(setting));
  for(const y of [32,96])for(let i=0;i<(y===32?8:7);i++){
    const actual=pixels(i*64+32,y),input=baseline(i*64+32,y);
    for(let c=0;c<3;c++){const expected=Math.round(255*(input[c]/255)**exponent),error=Math.abs(actual[c]-expected);maxError=Math.max(maxError,error);assert(error<=2,`Gamma ${setting}% at ${i},${y}: ${actual}, expected channel ${c}=${expected}`);checks++;}
  }
  assert.deepEqual(pixels(32,32),[0,0,0],'Gamma preserves black');assert.deepEqual(pixels(352,32),[255,255,255],'Gamma preserves white');samples.push({setting,midGrey:pixels(224,96)[0]});
}
console.log(JSON.stringify({checks,maxError,samples}));
