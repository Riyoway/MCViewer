import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {externalAssetUrl} from './hosting.ts';
import type {Manifest} from '../src/minecraft/types.ts';

// Commit hashes, not the generated asset files themselves.
const release=JSON.parse(await readFile('deployment/asset-release.json','utf8'));
const url=externalAssetUrl(release.baseUrl,true)!;
if(new URL(url).pathname.split('/').pop()!==release.assetVersion)throw new Error('Release URL and version must match.');
const root='public/generated',manifest:Manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const paths=new Set(['manifest.json','atlas.png','steve.png','weather/assets.json','ui/assets.json']);
for(const world of Object.values(manifest.worlds)){
  const nearest=[...world.chunks].sort((a,b)=>Math.hypot(a.origin[0]-world.spawn[0],a.origin[2]-world.spawn[2])-Math.hypot(b.origin[0]-world.spawn[0],b.origin[2]-world.spawn[2]))[0];
  if(!nearest)throw new Error('Sample world has no spawn chunks.');
  paths.add(nearest.file);paths.add(nearest.voxels);
}
const files:Record<string,string>={};
for(const file of paths){
  if(!file||file.startsWith('/')||file.includes('\\')||file.split('/').includes('..'))throw new Error('Unsafe generated asset path.');
  files[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
}
await writeFile('deployment/asset-checks.json',JSON.stringify({assetVersion:release.assetVersion,sampleWorlds:Object.keys(manifest.worlds).length,files},null,2)+'\n');
console.log(`Pinned ${paths.size} files for ${release.assetVersion}.`);
