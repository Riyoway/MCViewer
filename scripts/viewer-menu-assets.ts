import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import sharp from 'sharp';

// Extract only the menu resources; never execute the supplied offline client.
const source=process.argv[2]??'C:/Users/Riyo/Developments/Samples/Minecraft-1.12.2-js.html';
const html=await readFile(source,'utf8'),encoded=html.match(/assetsURI\s*=\s*"data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/)?.[1];
if(!encoded)throw new Error('Embedded EPK assets not found');
const epk=Buffer.from(encoded,'base64');if(epk.toString('ascii',0,8)!=='EAGPKG$$')throw new Error('Invalid EPK');
const compressed=epk.indexOf(Buffer.from([31,139,8]));if(compressed<0)throw new Error('Gzip EPK expected');
const bytes=gunzipSync(epk.subarray(compressed,epk.length-8)),files=new Map<string,Buffer>();let offset=0;
while(offset<bytes.length){const type=bytes.toString('ascii',offset,offset+4);offset+=4;if(type==='END$')break;
  const length=bytes[offset++],name=bytes.toString('utf8',offset,offset+length);offset+=length;
  const size=bytes.readUInt32BE(offset);offset+=4;
  if(offset+size>=bytes.length)throw new Error('Truncated EPK');
  if(type==='FILE')files.set(name,bytes.subarray(offset+4,offset+size-1));
  offset+=size;if(bytes[offset++]!==62)throw new Error('Invalid EPK entry');
}
const output='public/menu',prefix='assets/minecraft/';await mkdir(output,{recursive:true});
for(const [name,data] of files){let target:string|undefined;
  if(name.startsWith(prefix+'textures/gui/title/background/'))target=name.split('/').at(-1);
  if(name.startsWith(prefix+'textures/font/'))target='font/'+name.split('/').at(-1);
  if(name===prefix+'font/glyph_sizes.bin')target='font/glyph_sizes.bin';
  if(name===prefix+'textures/gui/options_background.png')target='dirt.png';
  if(name===prefix+'textures/gui/widgets.png')target='widgets.png';
  if(name===prefix+'textures/gui/title/minecraft.png')target='minecraft.png';
  if(name===prefix+'sounds/random/click.ogg')target='click.ogg';
  if(name===prefix+'sounds/music/menu/menu1.ogg')target='menu.ogg';
  if(target){await mkdir(output+'/'+target.split('/').slice(0,-1).join('/'),{recursive:true});await writeFile(output+'/'+target,data);}
}
const widgets=files.get(prefix+'textures/gui/widgets.png')!;
for(const [name,y] of [['language',106],['language-hover',126]] as const)await sharp(widgets).extract({left:0,top:y,width:20,height:20}).png().toFile(`${output}/${name}.png`);
for(const [name,y] of [['disabled',46],['button',66],['hover',86]] as const)await sharp(widgets).extract({left:0,top:y,width:200,height:20}).png().toFile(`${output}/${name}.png`);
await sharp({create:{width:150,height:20,channels:4,background:'#0000'}}).composite([
  {input:await sharp(widgets).extract({left:0,top:46,width:75,height:20}).toBuffer(),left:0,top:0},
  {input:await sharp(widgets).extract({left:125,top:46,width:75,height:20}).toBuffer(),left:75,top:0}
]).png().toFile(output+'/slider-track.png');
// GuiOptionSlider draws the first and last four pixels of the normal button.
await sharp({create:{width:8,height:20,channels:4,background:'#0000'}}).composite([
  {input:await sharp(widgets).extract({left:0,top:66,width:4,height:20}).toBuffer(),left:0,top:0},
  {input:await sharp(widgets).extract({left:196,top:66,width:4,height:20}).toBuffer(),left:4,top:0}
]).png().toFile(output+'/slider-thumb.png');
const logo=files.get(prefix+'textures/gui/title/minecraft.png')!;
await sharp({create:{width:274,height:44,channels:4,background:'#0000'}}).composite([
  {input:await sharp(logo).extract({left:0,top:0,width:155,height:44}).toBuffer(),left:0,top:0},
  {input:await sharp(logo).extract({left:0,top:45,width:119,height:44}).toBuffer(),left:155,top:0}
]).png().toFile(output+'/logo.png');
await writeFile(output+'/SOURCE.md','Menu textures and bitmap fonts extracted from the user-provided Minecraft-1.12.2-js.html (Eaglercraft 1.12.2 Offline), embedded EPK v2 resources. Original texture pixels preserved. Extraction: npm run menu-assets -- <path-to-html>.\nSlider track and handle use the native GuiOptionSlider 150 x 20 and 8 x 20 slices (https://github.com/WangTingZheng/mcp940/blob/master/src/minecraft/net/minecraft/client/gui/GuiOptionSlider.java).\nInventory names in locales/*.json come from official Minecraft 1.13 language resources, with 1.21.6 translations for newer IDs. Viewer-specific menu labels are translated separately. item-names.json retains the English fallback. Regenerate with npm run ui-language.\n');
console.log(`Extracted native menu resources from ${files.size} EPK entries.`);
