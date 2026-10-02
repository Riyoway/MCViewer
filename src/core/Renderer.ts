import { WebGLRenderer, SRGBColorSpace, NoToneMapping } from 'three';
export function createRenderer(canvas:HTMLCanvasElement) {
  const renderer=new WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=NoToneMapping;renderer.localClippingEnabled=true;
  renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.domElement.style.imageRendering='pixelated';
  return renderer;
}
