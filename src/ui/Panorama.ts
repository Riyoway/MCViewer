import {Scene,CubeTextureLoader,PerspectiveCamera,type WebGLRenderer} from 'three';
export class Panorama {
  readonly scene=new Scene();readonly camera=new PerspectiveCamera(120,1,.1,100);
  private time=0;
  async load(){this.scene.background=await new CubeTextureLoader().loadAsync([1,3,4,5,0,2].map(n=>`${import.meta.env.BASE_URL}menu/panorama_${n}.png`));}
  render(renderer:WebGLRenderer,dt:number){this.time+=dt;this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.camera.rotation.set((25+Math.sin(this.time/20)*5)*Math.PI/180,-this.time*.005,0);renderer.render(this.scene,this.camera);}
}
