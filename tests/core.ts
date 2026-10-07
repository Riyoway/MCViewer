// Source-only regression coverage; no original worlds or game texture files required.
import assert from 'node:assert/strict';
import {Vector3,Fog} from 'three';
import {Voxels,encodeColumn,decodeColumn} from '../src/minecraft/Voxels.ts';
import {Collision} from '../src/core/Collision.ts';
import {Movement} from '../src/core/Movement.ts';
import {consoleGammaExponent} from '../src/core/ConsoleGamma.ts';
import {Sky} from '../src/world/Sky.ts';
import {Clouds,cloudGeometry,cloudTint} from '../src/world/Clouds.ts';
import {unpackPalette} from '../scripts/anvil.ts';
import {legacyState} from '../scripts/legacy.ts';
import type {Block} from '../src/minecraft/types.ts';
const cube={name:'stone',solid:true,collision:[{from:[0,0,0],to:[1,1,1]}]} as Block;
const half={name:'oak_slab',solid:true,collision:[{from:[0,0,0],to:[1,.5,1]}]} as Block;
const packs={blocks:[undefined,cube,half] as unknown as Block[]},stone=1,slab=2;
const ground=new Voxels();ground.fill([-20,-1,-20],[20,0,20],stone);ground.fill([2,0,-5],[3,3,5],stone);ground.set(0,0,0,slab);ground.set(-2,0,0,stone);
const collision=new Collision(ground,packs.blocks),body=new Movement(collision);body.position.splice(0,3,0,0,4);
for(let i=0;i<5;i++)body.tick(0,0,0,false,false,false);assert(body.grounded);
let peak=0;for(let i=0;i<40;i++){body.tick(0,0,0,i===0,false,false);peak=Math.max(peak,body.position[1]);}
assert(peak>1.2&&peak<1.3,'Minecraft 20Hz jump reaches about 1.25 blocks');assert.equal(body.position[1],0);assert(body.grounded);
body.position.splice(0,3,0,0,10);body.stop();for(let i=0;i<20;i++)body.tick(1,0,0,false,false,false);const walk=10-body.position[2];
assert(walk>3.9&&walk<4.2,'Native ground acceleration approaches 4.317 blocks per second');
body.position.splice(0,3,0,0,10);body.stop();for(let i=0;i<20;i++)body.tick(1,0,0,false,true,false);assert(10-body.position[2]>walk*1.25,'Sprint is faster than walking');
body.position.splice(0,3,1,0,2);body.stop();for(let i=0;i<30;i++)body.tick(0,1,0,false,false,false);assert(body.position[0]<1.73,'Do not tunnel through walls');
body.position.splice(0,3,0,0,1.5);body.stop();body.grounded=true;for(let i=0;i<7;i++)body.tick(1,0,0,false,false,false);assert.equal(body.position[1],.5,'Auto step onto a slab');
for(let i=0;i<12;i++)body.tick(-1,0,0,false,false,false);assert.equal(body.position[1],0,'Gravity takes the player down from a slab');
body.position.splice(0,3,0,.5,0);body.flying=true;for(let i=0;i<10;i++)body.tick(0,0,0,true,false,false);assert(body.position[1]>2);body.flying=false;

const cells=new Voxels();cells.set(-1,0,-1,stone);const restored=new Voxels(),light=new Voxels();
decodeColumn(encodeColumn(cells,[[-16,0,-16]],()=>0xA7),-16,-16,restored,light);
assert.equal(restored.get(-1,0,-1),stone);assert.equal(light.get(-1,0,-1),0xA7);assert.throws(()=>decodeColumn(new ArrayBuffer(12),0,0,restored));
assert.equal(consoleGammaExponent(0),2);assert.equal(consoleGammaExponent(50),.8);assert.equal(consoleGammaExponent(100),.5);assert.equal(consoleGammaExponent(NaN),.8);
for(const padded of [false,true]) {
  const bits=5,perWord=Math.floor(64/bits),values=Array.from({length:4096},(_,i)=>i%17),words=Array<bigint>(padded?Math.ceil(4096/perWord):Math.ceil(4096*bits/64)).fill(0n);
  values.forEach((v,i)=>{const index=padded?Math.floor(i/perWord):Math.floor(i*bits/64),shift=padded?(i%perWord)*bits:(i*bits)%64;words[index]|=BigInt(v)<<BigInt(shift);if(!padded&&shift+bits>64)words[index+1]|=BigInt(v)>>BigInt(64-shift);words[index]=BigInt.asUintN(64,words[index]);});
  assert.deepEqual(Array.from(unpackPalette(words,17,padded)),values);
}
assert.throws(()=>unpackPalette([],17,true));assert.equal(legacyState(5,1).Name,'minecraft:spruce_planks');

const sky=new Sky({daylight:{value:0},time:{value:0}} as any),fog=new Fog('#fff');sky.time=6000;sky.cycle=false;sky.update(10,new Vector3(),fog,true,96);assert.equal(sky.time,6000);assert.equal(sky.brightness,1);
sky.environment={sky_color:'#3d2300',fog_color:'#e4880b',sun:'',moon:'',clouds:''};sky.update(0,new Vector3(),fog,true,96);assert.equal(fog.color.getHexString(),'e4880b','Halloween keeps the pack’s original orange fog');
sky.time=18000;sky.update(0,new Vector3(),fog,true,96);assert(sky.brightness<.1);sky.cycle=true;sky.time=0;sky.minutes=20;sky.update(1200,new Vector3(),fog,true,96);assert.equal(sky.time,0);
sky.cycle=false;sky.time=6000;sky.update(0,new Vector3(),fog,true,96,{rainLevel:1,thunderLevel:1,flash:0});const stormBrightness=sky.brightness;assert(stormBrightness<.4);assert(fog.far<96,'Rain reduces visibility');sky.update(0,new Vector3(),fog,true,96,{rainLevel:1,thunderLevel:1,flash:1});assert(sky.brightness>stormBrightness,'Lightning briefly lights the sky');

const cloudPattern={width:5,height:5,pixels:new Uint8Array(5*5*4)};cloudPattern.pixels.set([43,8,69,255],(2*5+2)*4);
const cloudCell=cloudGeometry(cloudPattern,2,2,0),cloudColor=cloudCell.getAttribute('color');
assert.equal(cloudCell.index!.count,36,'One native cloud pixel becomes a closed cuboid');
cloudCell.computeBoundingBox();assert.deepEqual(cloudCell.boundingBox!.getSize(new Vector3()).toArray(),[12,4,12]);
for(const [face,shade] of [.9,.9,1,.7,.8,.8].entries()){assert(Math.abs(cloudColor.getX(face*4)-43/255*shade)<1e-7,'Pack cloud colors retain native face shading');assert(Math.abs(cloudColor.getW(face*4)-.8)<1e-7);}
const wrappedCloud=cloudGeometry(cloudPattern,-3,-3,0);assert.deepEqual(Array.from(wrappedCloud.getAttribute('color').array),Array.from(cloudColor.array),'Native cloud pattern repeats at negative coordinates');
cloudPattern.pixels.set([255,255,255,255],(2*5+3)*4);const adjacentCloud=cloudGeometry(cloudPattern,2,2,1);assert.equal(adjacentCloud.index!.count,60,'Adjacent cloud pixels omit their two internal faces');
assert.deepEqual(cloudTint(6000,0,0),[1,1,1]);assert.deepEqual(cloudTint(18000,0,0),[.1,.1,.15]);assert.deepEqual(cloudTint(6000,1,0),[.62,.62,.62]);
for(const color of cloudTint(6000,1,1))assert(Math.abs(color-.1488)<1e-10,'Native thunder darkens cloud color with its grey blend');
const clouds=new Clouds();clouds.setPattern(cloudPattern);const cloudEye=new Vector3(0,70,0);clouds.update(cloudEye,0,6000,true,true,0,0);const cachedCloud=clouds.color.geometry;
assert.equal(clouds.root.position.y+cloudEye.y,128.33);assert(clouds.color.renderOrder<0&&clouds.depth.renderOrder<clouds.color.renderOrder);
cloudEye.x=10;clouds.update(cloudEye,1,18000,true,true,0,0);assert.equal(clouds.color.geometry,cachedCloud);assert(Math.abs(cloudEye.x+clouds.root.position.x+.6)<1e-10,'Clouds move 0.03 blocks per native tick without following the camera');
cloudEye.y=200;clouds.update(cloudEye,1,6000,false,true,0,0);assert.equal(clouds.root.position.y+cloudEye.y,192);assert(clouds.depth.renderOrder>0,'Above the cloud layer, clouds follow translucent terrain');
assert.equal(clouds.depth.material.colorWrite,false);assert.equal(clouds.depth.material.depthWrite,true);assert.equal(clouds.color.material.depthWrite,false);assert.equal(clouds.depth.material.forceSinglePass,true);
clouds.update(cloudEye,1,6000,true,false,0,0);assert.equal(clouds.root.visible,false);

for(const geometry of [cloudCell,wrappedCloud,adjacentCloud,clouds.color.geometry])geometry.dispose();
console.log('Core checks passed: jumping, sprinting, stepping, flight, collision, voxel/light roundtrips, palette formats, gamma, skies and cloud/glass render order.');
