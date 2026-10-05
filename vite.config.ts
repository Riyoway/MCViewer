import { defineConfig,loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir,rename,cp,copyFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { externalAssetUrl,checkAppOutput } from './scripts/hosting';
let version=process.env.VERCEL_GIT_COMMIT_SHA??'local';
try{version=execFileSync('git',['log','-1','--format=%H','--','public/generated'],{encoding:'utf8'}).trim()||version;}catch{/* Git metadata is optional outside the repository. */}
if(!/^[a-f0-9]{40}$/.test(version))version='local';
export default defineConfig(({mode,command})=>{
  const vercel=command==='build'&&(process.env.VERCEL==='1'||mode==='vercel');
  const external=externalAssetUrl(loadEnv(mode,process.cwd(),'VITE_').VITE_ASSET_BASE_URL,vercel);
  return {
  publicDir:command==='build'&&external?false:'public',
  define:{__ASSET_VERSION__:JSON.stringify(version),'import.meta.env.VITE_ASSET_BASE_URL':JSON.stringify(external??'')},
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: { ignored: ['**/minecraft-memory-assets/**', '**/.cache/**', '**/public/generated/**'] },
  },
  plugins:external?[{name:'viewer-menu-assets',apply:'build',async writeBundle(options){const output=resolve(options.dir??'dist');await cp(resolve('public/menu'),resolve(output,'menu'),{recursive:true});await copyFile(resolve('public/favicon.svg'),resolve(output,'favicon.svg'));const size=await checkAppOutput(output);console.log(`App output: ${(size.bytes/1024**2).toFixed(2)} MiB, ${size.files} files.`);}}]:[{name:'version-generated-assets',apply:'build',async writeBundle(options){
    const output=resolve(options.dir??'dist'),source=resolve(output,'generated'),temporary=resolve(output,'generated-staging'),target=resolve(source,version);
    if(dirname(source)!==output||dirname(temporary)!==output||dirname(target)!==source)throw new Error('Invalid generated asset output');
    await rename(source,temporary);await mkdir(source);await rename(temporary,target);
  }}],
};});
