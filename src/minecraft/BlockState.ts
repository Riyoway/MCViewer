import type {Block,Manifest,Vec3} from './types';

export const directions:Record<string,Vec3>={east:[1,0,0],west:[-1,0,0],up:[0,1,0],down:[0,-1,0],south:[0,0,1],north:[0,0,-1]};
export const opposite:Record<string,string>={east:'west',west:'east',up:'down',down:'up',south:'north',north:'south'};
export function properties(block:Block){return Object.fromEntries((block.state.split('[')[1]??'').replace(']','').split(',').filter(Boolean).map(pair=>pair.split('=')));}
export function stateId(manifest:Pick<Manifest,'lookup'>,block:Block,changes:Record<string,string>){
  const props={...properties(block),...changes},pairs=Object.entries(props).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`);
  return manifest.lookup[`${block.theme}:${block.name}${pairs.length?'['+pairs.join(',')+']':''}`]??0;
}
export function replaceable(block?:Block){return !block||block.fluid||/^(short_grass|tall_grass|fern|large_fern|dead_bush|snow|vine|fire|seagrass|tall_seagrass)$/.test(block.name)&&(!block.state.includes('layers=')||block.state.includes('layers=1'));}
export function soundGroup(name:string){return /glass|ice/.test(name)?'glass':/snow/.test(name)?'snow':/sand|concrete_powder/.test(name)?'sand':/gravel/.test(name)?'gravel':/wool|carpet|bed$/.test(name)?'cloth':/planks|log|wood|oak|birch|spruce|jungle|acacia|fence|chest|bookshelf/.test(name)?'wood':/grass|dirt|leaves|flower|sapling|mushroom|vine|fern/.test(name)?'grass':'stone';}
