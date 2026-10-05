import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import minecraftData from 'minecraft-data';
import {fetchBytes,vanillaSoundIndex} from './download.ts';
import {translations} from './ui-translations.ts';
import type {UIAssets} from '../src/ui/types.ts';

// Use the client language that matches the native inventory; keep CDN geometry unchanged.
let client:Buffer;
try{client=await readFile('.cache/client-1.13.jar');}catch{
  const versions=JSON.parse((await fetchBytes('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toString());
  const version=JSON.parse((await fetchBytes(versions.versions.find((v:{id:string})=>v.id==='1.13').url)).toString());
  client=await fetchBytes(version.downloads.client.url);
}
const path='assets/minecraft/lang/en_us.json',files=unzipSync(client,{filter:file=>file.name===path});
const language:Record<string,string>=JSON.parse(new TextDecoder().decode(files[path]));
const ui:UIAssets=JSON.parse(await readFile('public/generated/ui/assets.json','utf8'));
const native=minecraftData('1.13'),modern=minecraftData('1.21.6'),names:Record<string,string>={};
for(const theme of Object.values(ui.themes))for(const item of theme.items){
  names[item.id]=language[`block.minecraft.${item.id}`]??language[`item.minecraft.${item.id}`]??modern.itemsByName[item.id]?.displayName??native.itemsByName[item.id]?.displayName??item.id.replaceAll('_',' ');
}
await writeFile('public/menu/item-names.json',JSON.stringify(names)+'\n');
console.log(`Generated ${Object.keys(names).length} English item names.`);
const codes=['en','ja','zh-CN','zh-TW','ko'],tags=['en_us','ja_jp','zh_cn','zh_tw','ko_kr'];
const nativeIndex=await vanillaSoundIndex();
let modernIndex:Record<string,{hash:string}>;
try{modernIndex=JSON.parse(await readFile('.cache/asset-index-1.21.6.json','utf8')).objects;}catch{
  let meta;try{meta=JSON.parse(await readFile('.cache/client-1.21.6-meta.json','utf8'));}catch{const versions=JSON.parse((await fetchBytes('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toString());meta=JSON.parse((await fetchBytes(versions.versions.find((v:{id:string})=>v.id==='1.21.6').url)).toString());}
  const bytes=await fetchBytes(meta.assetIndex.url);await writeFile('.cache/asset-index-1.21.6.json',bytes);modernIndex=JSON.parse(bytes.toString()).objects;
}
async function officialLanguage(index:Record<string,{hash:string}>,tag:string,version:string){
  const entry=index[`minecraft/lang/${tag}.json`];if(!entry)throw new Error(`Missing official language ${tag}`);
  const path=`.cache/lang-${tag}-${version}.json`;let bytes:Buffer;
  try{bytes=await readFile(path);}catch{bytes=await fetchBytes(`https://resources.download.minecraft.net/${entry.hash.slice(0,2)}/${entry.hash}`);await writeFile(path,bytes);}
  if(createHash('sha1').update(bytes).digest('hex')!==entry.hash)throw new Error(`Language checksum mismatch: ${tag}`);
  return JSON.parse(bytes.toString()) as Record<string,string>;
}
await mkdir('public/menu/locales',{recursive:true});
for(let i=0;i<codes.length;i++){
  const items={...names},ui=Object.fromEntries(Object.entries(translations).map(([key,values])=>[key,i?values[i-1]:key]));
  if(i){const [nativeLang,modernLang]=await Promise.all([officialLanguage(nativeIndex,tags[i],'1.13'),officialLanguage(modernIndex,tags[i],'1.21.6')]);for(const id of Object.keys(items))items[id]=nativeLang[`block.minecraft.${id}`]??nativeLang[`item.minecraft.${id}`]??modernLang[`block.minecraft.${id}`]??modernLang[`item.minecraft.${id}`]??items[id];}
  await writeFile(`public/menu/locales/${codes[i]}.json`,JSON.stringify({ui,items})+'\n');console.log(`Generated ${codes[i]} UI and ${Object.keys(items).length} item names.`);
}
