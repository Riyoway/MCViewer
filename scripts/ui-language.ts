import {readFile,writeFile} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import minecraftData from 'minecraft-data';
import {fetchBytes} from './download.ts';
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
