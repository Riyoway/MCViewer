export type Precipitation='none'|'rain'|'snow';
export interface BiomeClimate {name:string;temperature:number;precipitation:Precipitation}
export type ClimateCells=number|string;
export interface ClimateData {biomes:BiomeClimate[];columns:Record<string,{legacy?:ClimateCells;sections?:Record<string,ClimateCells>}>}
export interface WeatherAssets {
  worlds:Record<string,{climate:string;rain:string;snow:string}>;
  sounds:Record<string,string[]>;
}
export class Climate {
  private cells=new Map<string,Uint8Array>();
  constructor(readonly data:ClimateData){}
  at(x:number,y:number,z:number):BiomeClimate|undefined {
    x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
    const key=`${Math.floor(x/16)},${Math.floor(z/16)}`,column=this.data.columns[key];if(!column)return;
    const ys=Object.keys(column.sections??{}).map(Number),sy=Math.floor(y/16);
    const section=ys.includes(sy)?sy:ys.reduce((a,b)=>Math.abs(b-sy)<Math.abs(a-sy)?b:a,ys[0]);
    const value=column.legacy??column.sections?.[section];if(value===undefined)return;
    if(typeof value==='number')return this.data.biomes[value];
    const cacheKey=`${key},${column.legacy!==undefined?'legacy':section}`;let cells=this.cells.get(cacheKey);
    if(!cells){cells=Uint8Array.from(atob(value),c=>c.charCodeAt(0));this.cells.set(cacheKey,cells);}
    const index=column.legacy!==undefined?(z&15)*16+(x&15):((y&15)>>2)*16+((z&15)>>2)*4+((x&15)>>2);
    return this.data.biomes[cells[index]];
  }
}
export function precipitation(biome:BiomeClimate|undefined,y:number):Precipitation {
  if(!biome||biome.precipitation==='none')return 'none';
  return biome.temperature-Math.max(0,y-80)/600<.15?'snow':'rain';
}
