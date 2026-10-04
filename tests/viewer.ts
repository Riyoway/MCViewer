import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {writeUncompressed} from 'prismarine-nbt';
import {gzipSync,zlibSync,zipSync} from 'fflate';
import sharp from 'sharp';
import {readNbt,unpackStates,regionChunks} from '../src/viewer/Nbt.ts';
import {safePath} from '../src/viewer/WorldStore.ts';
import {Voxels,decodeColumn} from '../src/minecraft/Voxels.ts';
import {decodeMeshes} from '../src/minecraft/binary.ts';
import {properties} from '../src/minecraft/BlockState.ts';
import {editLighting} from '../src/minecraft/EditLighting.ts';
import {meshChunk} from '../src/minecraft/Mesher.ts';

const manifest=JSON.parse(await readFile('public/generated/manifest.json','utf8')),reference=JSON.parse(await readFile('public/menu/viewer-data.json','utf8'));
const tag=(type:string,value:any)=>({type,value:type==='byteArray'?Array.from(value as Uint8Array,n=>n>127?n-256:n):value}),compound=(value:any)=>tag('compound',value),list=(type:string,value:any[])=>tag('list',{type,value});
const nbt=(value:any)=>new Uint8Array(writeUncompressed({name:'',type:'compound',value} as any));
const level=nbt({Data:compound({LevelName:tag('string','Fixture'),SpawnX:tag('int',8),SpawnY:tag('int',0),SpawnZ:tag('int',8),DataVersion:tag('int',3465),Version:compound({Name:tag('string','1.20.1')})})});
assert.equal(readNbt(gzipSync(level)).Data.LevelName,'Fixture');assert.throws(()=>readNbt(level.subarray(0,15)),/途中/);
assert.equal(safePath('World\\region/r.0.0.mca'),'World/region/r.0.0.mca');assert.throws(()=>safePath('world/../secret'));assert.throws(()=>safePath('C:/secret'));
for(const padded of [false,true]){const values=Array.from({length:4096},(_,i)=>i%17),words:bigint[]=Array(padded?Math.ceil(4096/12):320).fill(0n);for(const [i,value] of values.entries()){const word=padded?Math.floor(i/12):Math.floor(i*5/64),shift=padded?i%12*5:i*5%64;words[word]|=BigInt(value)<<BigInt(shift);if(!padded&&shift+5>64)words[word+1]|=BigInt(value)>>BigInt(64-shift);}assert.deepEqual([...unpackStates(words,17,padded)],values);}
assert.throws(()=>unpackStates([],2,true),/途中/);
function region(chunk:Uint8Array){const bytes=zlibSync(chunk),sectors=Math.ceil((bytes.length+5)/4096),output=new Uint8Array((2+sectors)*4096),view=new DataView(output.buffer);view.setUint32(0,2*256+sectors);view.setUint32(8192,bytes.length+1);output[8196]=2;output.set(bytes,8197);return output;}
const modern=region(nbt({DataVersion:tag('int',3465),xPos:tag('int',0),zPos:tag('int',0),isLightOn:tag('byte',1),sections:list('compound',[
  {Y:tag('byte',-2),block_states:compound({palette:list('compound',[{Name:tag('string','minecraft:air')}])})},
  {Y:tag('byte',-1),block_states:compound({palette:list('compound',[{Name:tag('string','minecraft:stone')}])}),SkyLight:tag('byteArray',new Uint8Array(2048)),BlockLight:tag('byteArray',new Uint8Array(2048)),biomes:compound({palette:list('string',['minecraft:snowy_plains'])})},
  {Y:tag('byte',0),block_states:compound({palette:list('compound',[{Name:tag('string','minecraft:air')}])}),SkyLight:tag('byteArray',new Uint8Array(2048).fill(255)),biomes:compound({palette:list('string',['minecraft:snowy_plains'])})}
])}));
assert.equal([...regionChunks(modern,'r.0.0.mca')][0].sections[0].Y,-2);assert.throws(()=>[...regionChunks(modern.subarray(0,8200),'bad.mca')]);
const legacyBlocks=new Uint8Array(4096),legacyMeta=new Uint8Array(2048);legacyBlocks.fill(1,0,256);legacyBlocks[256+17]=64;legacyBlocks[512+17]=64;legacyMeta[(512+17)>>1]=8<<4;legacyBlocks[256+34]=85;legacyBlocks[256+35]=85;
const legacy=region(nbt({DataVersion:tag('int',1343),Level:compound({xPos:tag('int',0),zPos:tag('int',0),Sections:list('compound',[{Y:tag('byte',0),Blocks:tag('byteArray',legacyBlocks),Data:tag('byteArray',legacyMeta),SkyLight:tag('byteArray',new Uint8Array(2048).fill(255)),BlockLight:tag('byteArray',new Uint8Array(2048))}]),Biomes:tag('byteArray',new Uint8Array(256).fill(1))})}));
const messages:any[]=[];const worker:any={postMessage:(message:any)=>messages.push(message)};Object.assign(globalThis,{self:worker});await import('../src/viewer/ImportWorker.ts');
const worldZip=zipSync({'Fixture/level.dat':gzipSync(level),'Fixture/region/r.0.0.mca':modern});
await worker.onmessage({data:{id:1,type:'load',data:{files:[{name:'fixture.zip',bytes:worldZip.buffer}],manifest,reference,name:'Imported fixture'}}});
let result=messages.find(m=>m.id===1);assert(!result.error,result.error);assert.equal(result.result.manifest.bounds.min[1],-64);assert.equal(result.result.manifest.bounds.max[1],320);assert.equal(result.result.manifest.chunks.length,1);assert.equal(result.result.climate.biomes[0].name,'snowy_plains');
await worker.onmessage({data:{id:2,type:'column',data:{origin:[0,0,0]}}});result=messages.find(m=>m.id===2);assert(!result.error,result.error);const voxels=new Voxels(),lights=new Voxels();decodeColumn(result.result.voxelBuffer,0,0,voxels,lights);assert.equal(manifest.blocks[voxels.get(8,-1,8)].name,'stone');assert.equal(lights.get(8,0,8),240);assert(decodeMeshes(result.result.meshBuffer)[0].indices.length>0);
assert.equal(lights.get(8,-20,8),0,'Missing arrays in a lit underground section stay dark');
const customBlocks=manifest.blocks.slice(),stone=voxels.get(8,-1,8);customBlocks[stone]={...customBlocks[stone],cube:false};assert(meshChunk(voxels,customBlocks,[0,-16,0]).opaque.index.length>0,'A full section with Resource Pack models must remain visible');
await worker.onmessage({data:{id:3,type:'load',data:{files:[{name:'level.dat',bytes:gzipSync(level).buffer},{name:'region/r.0.0.mca',bytes:legacy.buffer}],manifest,reference,name:'Legacy'}}});assert(!messages.find(m=>m.id===3).error);
await worker.onmessage({data:{id:4,type:'column',data:{origin:[0,0,0]}}});const old=new Voxels();decodeColumn(messages.find(m=>m.id===4).result.voxelBuffer,0,0,old);const lower=manifest.blocks[old.get(1,1,1)],upper=manifest.blocks[old.get(1,2,1)];assert.equal(lower.name,'oak_door');assert.equal(properties(lower).half,'lower');assert.equal(properties(upper).half,'upper');assert.equal(properties(manifest.blocks[old.get(2,1,2)]).east,'true');assert.equal(properties(manifest.blocks[old.get(3,1,2)]).west,'true');
await worker.onmessage({data:{id:5,type:'load',data:{files:[{name:'not-a-world.zip',bytes:zipSync({'hello.txt':new Uint8Array([1])}).buffer}],manifest,reference,name:'Invalid'}}});assert.match(messages.find(m=>m.id===5).error,/level.dat/);
const negativeLight=new Voxels();editLighting(voxels,manifest.blocks,negativeLight,[[8,-1,8]],16,(x,z)=>x>=0&&x<16&&z>=0&&z<16,()=>0,-16);assert.equal(negativeLight.get(8,0,8)>>4,15);assert.equal(negativeLight.get(8,-1,8)>>4,0);
// Browser fixtures exercise real file inputs, IndexedDB persistence and pack pixels.
await mkdir('.cache/viewer-fixtures',{recursive:true});await writeFile('.cache/viewer-fixtures/modern.zip',worldZip);await writeFile('.cache/viewer-fixtures/legacy.zip',zipSync({'Legacy/level.dat':gzipSync(level),'Legacy/region/r.0.0.mca':legacy}));
const png=await sharp({create:{width:16,height:16,channels:4,background:'#ef2040'}}).png().toBuffer();
await writeFile('.cache/viewer-fixtures/red-pack.zip',zipSync({'pack.mcmeta':new TextEncoder().encode(JSON.stringify({pack:{pack_format:3,description:'Fixture resource pack'}})),'assets/minecraft/textures/blocks/stone.png':png,'assets/minecraft/models/block/stone.json':new TextEncoder().encode(JSON.stringify({parent:'block/cube_all',textures:{all:'blocks/stone'}}))}));
const gradient=Buffer.alloc(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++)gradient.set([x*3,y*3,80,255],(y*64+x)*4);
await writeFile('.cache/viewer-fixtures/entity-pack.zip',zipSync({'pack.mcmeta':new TextEncoder().encode(JSON.stringify({pack:{pack_format:3,description:'Entity and namespaced model fixture'}})),'assets/minecraft/textures/entity/chest/normal.png':await sharp(gradient,{raw:{width:64,height:64,channels:4}}).png().toBuffer(),'assets/minecraft/models/block/stone.json':new TextEncoder().encode(JSON.stringify({parent:'fixture:block/stone'})),'assets/fixture/models/block/stone.json':new TextEncoder().encode(JSON.stringify({parent:'minecraft:block/cube_all',textures:{all:'fixture:block/stone'}})),'assets/fixture/textures/block/stone.png':png}));
console.log('Viewer checks passed: bounded NBT parsing, Java ZIP/folder imports, negative heights, saved light/biomes, legacy doors/fences, lazy meshes, invalid file handling and pack browser fixtures.');
