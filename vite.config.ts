import { defineConfig,loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir,rename } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
let version=process.env.VERCEL_GIT_COMMIT_SHA??'local';
try{version=execFileSync('git',['log','-1','--format=%H','--','public/generated'],{encoding:'utf8'}).trim()||version;}catch{/* Git metadata is optional outside the repository. */}
if(!/^[a-f0-9]{40}$/.test(version))version='local';
export default defineConfig(({mode})=>{
  const external=loadEnv(mode,process.cwd(),'VITE_').VITE_ASSET_BASE_URL;
  return {
  publicDir:external?false:'public',
  define:{__ASSET_VERSION__:JSON.stringify(version)},
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: { ignored: ['**/minecraft-memory-assets/**', '**/.cache/**', '**/public/generated/**'] },
  },
  plugins:external?[]:[{name:'version-generated-assets',apply:'build',async writeBundle(options){
    const output=resolve(options.dir??'dist'),source=resolve(output,'generated'),temporary=resolve(output,'generated-staging'),target=resolve(source,version);
    if(dirname(source)!==output||dirname(temporary)!==output||dirname(target)!==source)throw new Error('Invalid generated asset output');
    await rename(source,temporary);await mkdir(source);await rename(temporary,target);
  }}],
};});
