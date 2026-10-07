import { defineConfig,loadEnv } from 'vite';
import { cp,copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { externalAssetUrl,checkAppOutput,publishedAssetUrl } from './scripts/hosting';

export default defineConfig(({mode,command})=>{
  const requested=loadEnv(mode,process.cwd(),'VITE_').VITE_ASSET_BASE_URL;
  const external=externalAssetUrl(requested||publishedAssetUrl,true)!;
  return {
    // Never copy ignored, multi-GB asset workspaces into a deployment.
    publicDir:command==='serve'?'public':false,
    define:{'import.meta.env.VITE_ASSET_BASE_URL':JSON.stringify(external)},
    optimizeDeps:{entries:['index.html']},
    server:{watch:{ignored:['**/minecraft-memory-assets/**','**/.cache/**','**/public/generated/**']}},
    plugins:[{
      name:'viewer-menu-assets',
      async writeBundle(options){
        const output=resolve(options.dir??'dist');
        await cp(resolve('public/menu'),resolve(output,'menu'),{recursive:true});
        await copyFile(resolve('public/favicon.svg'),resolve(output,'favicon.svg'));
        const size=await checkAppOutput(output);
        console.log(`App output: ${(size.bytes/1024**2).toFixed(2)} MiB, ${size.files} files.`);
      },
    }],
  };
});
