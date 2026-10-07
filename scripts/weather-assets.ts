import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import minecraftData from 'minecraft-data';
import { readChunks } from './anvil.ts';
import { downloadSound } from './download.ts';
import type { ClimateData,ClimateCells,BiomeClimate,WeatherAssets } from '../src/world/Climate.ts';
import type { Manifest } from '../src/minecraft/types.ts';

export function unpackBiomes(data:([number,number]|bigint)[],length:number):Uint8Array {
  const out=new Uint8Array(64);if(length===1)return out;
  const bits=Math.max(1,Math.ceil(Math.log2(length))),perWord=Math.floor(64/bits),mask=(1n<<BigInt(bits))-1n;
  if(data.length<Math.ceil(64/perWord))throw new Error('Truncated biome palette');
  const words=data.map(v=>typeof v==='bigint'?BigInt.asUintN(64,v):(BigInt(v[0]>>>0)<<32n)|BigInt(v[1]>>>0));
  for(let i=0;i<64;i++){out[i]=Number(words[Math.floor(i/perWord)]>>BigInt((i%perWord)*bits)&mask);if(out[i]>=length)throw new Error('Invalid biome palette');}
  return out;
}
export async function prepareWeather(){
  const manifest:Manifest=JSON.parse(await readFile('public/generated/manifest.json','utf8'));
  const modern=minecraftData('1.21.6'),legacy=minecraftData('1.13'),output='public/generated/weather';await mkdir(output,{recursive:true});
  const assets:WeatherAssets={worlds:{},sounds:{}};
  for(const [name,world] of Object.entries(manifest.worlds)){
    const tutorial=name.startsWith('tutorial'),pack=tutorial?'vanilla':name;
    for(const type of ['rain','snow']){const target=`weather/${pack}-${type}.png`;try{await copyFile(`asset-sources/resourcepacks/${pack}/assets/minecraft/textures/environment/${type}.png`,`public/generated/${target}`);}catch{await copyFile(`asset-sources/references/native-data/1.13/environment/${type}.png`,`public/generated/${target}`);}}
    const files=unzipSync(await readFile(`asset-sources/worlds/archives/${name}.zip`)),climate:ClimateData={biomes:[],columns:{}},ids=new Map<string,number>();
    const id=(value:string|number)=>{
      const b=typeof value==='number'?legacy.biomes[value]:modern.biomesByName[value.replace('minecraft:','')];
      if(!b)throw new Error(`Unknown saved biome ${value} in ${name}`);
      if(!ids.has(b.name)){ids.set(b.name,climate.biomes.length);climate.biomes.push({name:b.name,temperature:b.temperature,precipitation:b.precipitation} as BiomeClimate);}
      return ids.get(b.name)!;
    };
    const cells=(values:number[]):ClimateCells=>values.every(v=>v===values[0])?values[0]:Buffer.from(values).toString('base64');
    for await(const {root} of readChunks(files,world.bounds)){
      const column:ClimateData['columns'][string]={sections:{}};
      for(const section of root.sections??root.Sections??[]){if(!section.biomes||section.Y<0)continue;const palette=section.biomes.palette.map(id),values=unpackBiomes(section.biomes.data??[],palette.length);column.sections![section.Y]=cells(Array.from(values,v=>palette[v]));}
      if(!Object.keys(column.sections!).length){
        if(root.Biomes?.length===256)column.legacy=cells(Array.from(root.Biomes,(v:any)=>id((v&255)===255?1:v&255)));
        else if(root.Biomes?.length>=1024)for(let y=0;y<16;y++)column.sections![y]=cells(Array.from(root.Biomes.slice(y*64,y*64+64),(v:any)=>id(v)));
      }
      if(column.legacy===undefined&&!Object.keys(column.sections!).length)throw new Error(`Missing climate: ${name} ${root.xPos},${root.zPos}`);
      climate.columns[`${root.xPos},${root.zPos}`]=column;
    }
    if(!Object.keys(climate.columns).length)throw new Error(`No climate columns: ${name}`);
    const file=`weather/${name}-climate.json.gz`;await writeFile(`public/generated/${file}`,gzipSync(JSON.stringify(climate)));
    assets.worlds[name]={climate:file,rain:`weather/${pack}-rain.png`,snow:`weather/${pack}-snow.png`};
    console.log(`Weather: ${name}, ${Object.keys(climate.columns).length} columns, ${climate.biomes.length} biomes`);
  }
  // Official 1.13 sounds.json: all eight samples outdoors, rain1..4 above a roof.
  for(const [key,names] of Object.entries({rain:[1,2,3,4,5,6,7,8].map(i=>`rain${i}`),rain_above:[1,2,3,4].map(i=>`rain${i}`),thunder:[1,2,3].map(i=>`thunder${i}`)})){
    assets.sounds[key]=[];for(const name of names){const file=`weather/${name}.ogg`;await writeFile(`public/generated/${file}`,await downloadSound(`ambient/weather/${name}`));assets.sounds[key].push(file);}
  }
  await writeFile(`${output}/assets.json`,JSON.stringify(assets));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareWeather();
