const base=`${import.meta.env.BASE_URL}menu/font/`;
const images=new Map<string,Promise<HTMLImageElement>>();
function load(name:string){let value=images.get(name);if(!value){value=new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=base+name;});images.set(name,value);}return value;}
export class MinecraftText {
  private widths:number[]=[];private sizes!:Uint8Array;private ascii!:HTMLImageElement;private observer?:MutationObserver;
  async start(root:HTMLElement){
    [this.ascii,this.sizes]=await Promise.all([load('ascii.png'),fetch(base+'glyph_sizes.bin').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b))]);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.drawImage(this.ascii,0,0);const pixels=ctx.getImageData(0,0,128,128).data;
    for(let c=0;c<128;c++){let width=0;for(let x=0;x<8;x++)for(let y=0;y<8;y++)if(pixels[((c>>4)*8+y)*512+((c&15)*8+x)*4+3])width=Math.max(width,x+1);this.widths[c]=c===32?4:width+1;}
    const scan=(node:Node)=>{if(node.nodeType===Node.TEXT_NODE){const text=node.textContent??'',parent=node.parentElement;if(text.trim()&&parent&&!parent.closest('.mc-text,input,select,textarea,script,style,canvas,.no-bitmap'))void this.paint(node,text);return;}for(const child of [...node.childNodes])scan(child);};
    scan(root);this.observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData')scan(record.target);else for(const node of record.addedNodes)scan(node);}});this.observer.observe(root,{subtree:true,childList:true,characterData:true});
  }
  private async paint(node:Node,text:string){
    const span=document.createElement('span');span.className='mc-text';span.textContent=text;node.parentNode?.replaceChild(span,node);
    const characters=[...text],pages=new Map<number,HTMLImageElement>();
    try{await Promise.all([...new Set(characters.map(c=>c.charCodeAt(0)).filter(n=>n>=128).map(n=>n>>8))].map(async page=>pages.set(page,await load(`unicode_page_${page.toString(16).padStart(2,'0')}.png`))));}catch{return;}
    if(!span.isConnected)return;
    const width=(n:number)=>n<128?this.widths[n]??6:this.sizes[n]?((this.sizes[n]&15)-(this.sizes[n]>>4)+1)/2+1:4;
    const lines=text.split('\n'),w=Math.max(1,...lines.map(line=>[...line].reduce((sum,c)=>sum+width(c.charCodeAt(0)),0))),canvas=document.createElement('canvas');canvas.width=Math.ceil(w*2);canvas.height=lines.length*20;const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;
    const draw=(shadow:boolean)=>{let x=shadow?2:0,y=shadow?2:0;for(const character of characters){const code=character.charCodeAt(0);if(character==='\n'){x=shadow?2:0;y+=20;continue;}if(code!==32){if(code<128)ctx.drawImage(this.ascii,(code&15)*8,(code>>4)*8,8,8,x,y,16,16);else if(this.sizes[code]){const left=this.sizes[code]>>4,right=this.sizes[code]&15,page=pages.get(code>>8)!;ctx.drawImage(page,(code&15)*16+left,(code>>4&15)*16,right-left+1,16,x,y,right-left+1,16);}}x+=width(code)*2;}};
    draw(false);
    // Mask the native glyphs with currentColor so hover/disabled text and its quarter-bright shadow match the client.
    const glyphs=document.createElement('span');glyphs.className='bitmap-glyphs';glyphs.setAttribute('aria-hidden','true');
    glyphs.style.maskImage=`url(${canvas.toDataURL()})`;glyphs.style.width=`${canvas.width/2}px`;glyphs.style.height=`${canvas.height/2}px`;
    span.replaceChildren();const accessible=document.createElement('span');accessible.className='bitmap-label';accessible.textContent=text;span.append(accessible,glyphs);
  }
}
