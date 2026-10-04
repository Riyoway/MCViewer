// WeatherEffectRenderer / LegacyRandomSource from Mojang's 1.21.6 client.
// Generate once per world column: re-randomizing on each frame would make snow flicker.
class ColumnRandom {
  private seed:bigint;
  private spare:number|undefined;
  constructor(seed:number){this.seed=(BigInt(seed)^0x5deece66dn)&((1n<<48n)-1n);}
  private next(bits:number){this.seed=(this.seed*0x5deece66dn+11n)&((1n<<48n)-1n);return Number(this.seed>>BigInt(48-bits));}
  float(){return this.next(24)/16777216;}
  double(){return (this.next(26)*134217728+this.next(27))/9007199254740992;}
  gaussian():number {
    if(this.spare!==undefined){const value=this.spare;this.spare=undefined;return value;}
    let x:number,y:number,length:number;
    do{x=this.double()*2-1;y=this.double()*2-1;length=x*x+y*y;}while(length>=1||length===0);
    const scale=Math.sqrt(-2*Math.log(length)/length);this.spare=y*scale;return x*scale;
  }
}
export function precipitationColumn(x:number,z:number) {
  const X=(Math.imul(Math.imul(x,x),3121)+Math.imul(x,45238971))|0;
  const Z=(Math.imul(Math.imul(z,z),418711)+Math.imul(z,13761))|0;
  const rain=new ColumnRandom(X^Z),snow=new ColumnRandom(X^Z);
  return {rainSpeed:Math.fround(3+rain.float()),rainPhase:(X+Z)&255,
    snowU:snow.double(),snowDriftU:snow.gaussian(),snowV:snow.double(),snowDriftV:snow.gaussian()};
}
export function precipitationOffsets(column:ReturnType<typeof precipitationColumn>,kind:'rain'|'snow',time:number) {
  const ticks=Math.floor(time*20),partial=time*20-ticks;
  if(kind==='rain')return [0,-((ticks&131071)+column.rainPhase+partial)/32*column.rainSpeed%32];
  return [column.snowU+(ticks+partial)*.01*column.snowDriftU,
    column.snowV-((ticks&511)+partial)/512+(ticks+partial)*.001*column.snowDriftV];
}
