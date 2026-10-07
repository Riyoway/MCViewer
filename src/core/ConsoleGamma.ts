// Legacy4J e434f31 corrected this curve against the Console render-library decompile.
// The Console slider is 0..100 (default 50), independent of Java lightmap brightness.
// Reference and verification notes: docs/rendering.md, Gamma section.
export function consoleGammaExponent(percentage:number){
  const value=Number.isFinite(percentage)?Math.min(100,Math.max(0,percentage)):50;
  return 1/(.5+1.5*value/100);
}

// Apply the display ramp after composition, including translucent terrain, fog,
// sky and the HTML HUD/menus. Per-material correction would change alpha blending.
export class ConsoleGamma {
  private readonly channels:SVGElement[]=[];
  private readonly svg:SVGSVGElement;
  private previous='';
  constructor(private readonly screen:HTMLElement){
    const namespace='http://www.w3.org/2000/svg',make=(name:string)=>document.createElementNS(namespace,name);
    this.svg=make('svg') as SVGSVGElement;this.svg.setAttribute('aria-hidden','true');this.svg.setAttribute('width','0');this.svg.setAttribute('height','0');this.svg.style.position='absolute';this.svg.style.pointerEvents='none';
    const defs=make('defs'),filter=make('filter'),transfer=make('feComponentTransfer');
    filter.id='console-gamma';filter.setAttribute('x','0');filter.setAttribute('y','0');filter.setAttribute('width','100%');filter.setAttribute('height','100%');filter.setAttribute('color-interpolation-filters','sRGB');
    for(const channel of ['R','G','B']){const fn=make('feFunc'+channel);fn.setAttribute('type','gamma');fn.setAttribute('amplitude','1');fn.setAttribute('offset','0');transfer.append(fn);this.channels.push(fn);}
    filter.append(transfer);defs.append(filter);this.svg.append(defs);screen.append(this.svg);
  }
  set(percentage:number,legacy:boolean){
    const exponent=consoleGammaExponent(percentage),state=`${legacy}:${exponent}`;if(state===this.previous)return;this.previous=state;
    for(const channel of this.channels)channel.setAttribute('exponent',String(exponent));
    this.screen.style.filter=legacy?'url(#console-gamma)':'';
  }
  dispose(){this.screen.style.filter='';this.svg.remove();}
}
