import {Scene,PerspectiveCamera,type Group,type WebGLRenderer} from 'three';

// Minecraft renders the hand after terrain, liquids and precipitation.
export class ViewModelRenderer {
  readonly scene=new Scene();
  readonly camera=new PerspectiveCamera();
  constructor(){this.scene.add(this.camera);}
  attach(model:Group){this.camera.add(model);}
  render(renderer:WebGLRenderer,camera:PerspectiveCamera){
    this.camera.projectionMatrix.copy(camera.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const clear=renderer.autoClear;
    try{renderer.autoClear=false;renderer.clearDepth();renderer.render(this.scene,this.camera);}
    finally{renderer.autoClear=clear;}
  }
}
