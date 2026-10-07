import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { unzipSync } from 'fflate';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const tutorials=JSON.parse(await readFile('asset-sources/worlds/templates/tutorial/world_templates.json','utf8')) as {templateLocation:string;folderName:string;downloadURI:string}[];
export const tutorialWorlds=tutorials.map(t=>t.templateLocation.split('/').pop()!.replace('.zip','')).map(id=>id==='tutorial14'?'tutorial':id);
export const worldNames=['tutorial','mario','festive','halloween','chinese',...tutorialWorlds.filter(id=>id!=='tutorial')];

export async function fetchBytes(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    // curl uses the host's network/TLS settings when Node cannot reach the CDN.
    const result = await promisify(execFile)(process.platform === 'win32' ? 'curl.exe' : 'curl',
      ['--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '120', '--silent', '--show-error', url],
      { encoding: 'buffer', maxBuffer: 200 * 1024 * 1024 });
    return result.stdout;
  }
}

let soundIndex:Promise<Record<string,{hash:string}>>;
export function vanillaSoundIndex() {
  return soundIndex??=(async()=>{
    const path='.cache/asset-index-1.13.json';let index:Buffer;
    try{index=await readFile(path);}catch{
      const versions=JSON.parse((await fetchBytes('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toString());
      const version=JSON.parse((await fetchBytes(versions.versions.find((v:any)=>v.id==='1.13').url)).toString());
      index=await fetchBytes(version.assetIndex.url);await mkdir('.cache',{recursive:true});await writeFile(path,index);
    }
    return JSON.parse(index.toString()).objects;
  })();
}
export async function downloadSound(name:string) {
  if(!/^[a-z0-9_/-]+$/.test(name)||name.includes('..'))throw new Error('Invalid sound path');
  const entry=(await vanillaSoundIndex())[`minecraft/sounds/${name}.ogg`];if(!entry)throw new Error(`Missing vanilla sound: ${name}`);
  const path=`.cache/sounds/${name}.ogg`;let data:Buffer;
  try{data=await readFile(path);}catch{data=await fetchBytes(`https://resources.download.minecraft.net/${entry.hash.slice(0,2)}/${entry.hash}`);await mkdir(dirname(path),{recursive:true});await writeFile(path,data);}
  if(createHash('sha1').update(data).digest('hex')!==entry.hash)throw new Error(`Sound checksum mismatch: ${name}`);
  return data;
}
if(process.argv.includes('--sound-list'))console.log(Object.keys(await vanillaSoundIndex()).filter(s=>/sounds\/(step|random\/door|block\/wooden_door|liquid\/swim)/.test(s)).join('\n'));

export async function downloadWorld(theme:string) {
  if(!worldNames.includes(theme))throw new Error(`Unknown world: ${theme}`);
  const source = !tutorialWorlds.includes(theme)
    ? 'asset-sources/worlds/templates/legacy/world_templates.json'
    : 'asset-sources/worlds/templates/tutorial/world_templates.json';
  const templates = tutorialWorlds.includes(theme)?tutorials:JSON.parse(await readFile(source, 'utf8'));
  const template = ({mario:'super_mario',tutorial:'tutorial14',chinese:'chinese_mythology'} as Record<string,string>)[theme]??theme;
  const entry = templates.find((t: { templateLocation: string }) => t.templateLocation.split('/').pop()===`${template}.zip`);
  if (!entry) throw new Error(`Missing world template: ${theme}`);
  await mkdir('.cache', { recursive: true });
  const path = `.cache/${theme}.zip`;
  const archive=`asset-sources/worlds/archives/${theme}.zip`;let data:Buffer,archived=true;
  try { data = await readFile(archive); }
  catch {
    archived=false;
    try{data=await readFile(path);}catch{
      console.log(`Downloading ${entry.folderName} from supplied template…`);
      data = await fetchBytes(entry.downloadURI);
      await writeFile(path, data);
    }
  }
  // The supplied checksums omit leading zeroes.
  const expected = new URL(entry.downloadURI).searchParams.get('checksum');
  const checksum = createHash('md5').update(data).digest('hex');
  if (expected && checksum.replace(/^0+/, '') !== expected.replace(/^0+/, '')) {
    throw new Error(`World checksum mismatch: ${theme}. Restore the supplied ZIP or delete ${path} and retry.`);
  }
  if(!archived){await mkdir(dirname(archive),{recursive:true});await writeFile(archive,data);}
  return { files: unzipSync(data), source: entry.downloadURI, checksum, name: entry.folderName };
}

if (process.argv.includes('--inspect')) {
  for (const theme of ['mario', 'tutorial'] as const) {
    const world = await downloadWorld(theme);
    console.log(theme, Object.entries(world.files).filter(([name]) => /level.dat$|region\/.*\.mc[ar]$/.test(name)).map(([name, data]) => [name, data.length]).slice(0, 22));
  }
}
