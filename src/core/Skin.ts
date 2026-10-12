export type SkinModel='classic'|'slim';
export function skinDimensions(width:number,height:number){return width===64&&(height===32||height===64)||width===128&&height===128;}
export function validateSkinPng(bytes:Uint8Array){
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<33||signature.some((v,i)=>bytes[i]!==v)||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw new Error('Choose a PNG skin.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  if(!skinDimensions(width,height))throw new Error('Use a 64×64, 64×32 or 128×128 skin.');
  return {width,height};
}
// Minecraft keeps the base skin opaque, while hats/clothing retain their alpha.
export function normalizeSkinPixels(pixels:Uint8ClampedArray,width:number,height:number){
  const scale=width/64,legacy=height/scale===32;
  const region=(x:number,y:number,w:number,h:number,visit:(i:number)=>void)=>{for(let row=y*scale;row<(y+h)*scale;row++)for(let col=x*scale;col<(x+w)*scale;col++)visit((row*width+col)*4+3);};
  if(legacy){let opaque=true;region(32,0,32,32,i=>{if(pixels[i]<128)opaque=false;});if(opaque)region(32,0,32,16,i=>{pixels[i]=0;});}
  region(0,0,32,16,i=>{pixels[i]=255;});region(0,16,64,16,i=>{pixels[i]=255;});
  if(!legacy)region(16,48,32,16,i=>{pixels[i]=255;});
}
