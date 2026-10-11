import { Group, BoxGeometry, Mesh, MeshBasicMaterial, Matrix4, TextureLoader, NearestFilter, SRGBColorSpace } from 'three';
import { assetUrl, AssetManager } from './AssetManager';

export function skinBox(w:number,h:number,d:number,u:number,v:number,material:MeshBasicMaterial,textureWidth:number,textureHeight:number,mirror=false,inflate=0) {
  const geometry=new BoxGeometry((w+inflate*2)/16,(h+inflate*2)/16,(d+inflate*2)/16),uv=geometry.attributes.uv;
  // Our forward axis is -Z. The right side of the skin net therefore belongs
  // on +X, with the front on -Z. Legacy left limbs reflect the right limb.
  const rectangles=[ [u,v+d,d,h],[u+d+w,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+d+w+d,v+d,w,h],[u+d,v+d,w,h] ];
  if(mirror)[rectangles[0],rectangles[1]]=[rectangles[1],rectangles[0]];
  rectangles.forEach(([x,y,width,height],i)=>{
    const cap=i===2||i===3,reverse=cap!==mirror,U=reverse?x:x+width,V=reverse?x+width:x,top=i===2?y+height:y,bottom=i===2?y:y+height;
    uv.setXY(i*4,U/textureWidth,1-top/textureHeight);uv.setXY(i*4+1,V/textureWidth,1-top/textureHeight);
    uv.setXY(i*4+2,U/textureWidth,1-bottom/textureHeight);uv.setXY(i*4+3,V/textureWidth,1-bottom/textureHeight);
  });
  return new Mesh(geometry,material);
}
export class PlayerModel {
  readonly root=new Group(); readonly upper=new Group(); readonly head=new Group();
  readonly leftArm=new Group(); readonly rightArm=new Group();
  readonly leftLeg=new Group(); readonly rightLeg=new Group();
  readonly hand=new Group();
  private swingTime=.3;
  private phase=0; private amount=0; private bodyYaw=0; private age=0;private initialized=false;
  holding=false;
  static async create(assets:AssetManager) {
    const texture=await new TextureLoader().loadAsync(assetUrl('steve.png'));
    texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.generateMipmaps=false;texture.colorSpace=SRGBColorSpace;
    return PlayerModel.fromSkin(texture.image.width,texture.image.height,assets.skinMaterial(texture),assets.skinMaterial(texture));
  }
  static fromSkin(width:number,height:number,material:MeshBasicMaterial,overlay:MeshBasicMaterial) {
    overlay.alphaTest=.1;
    const model=new PlayerModel();
    const body=skinBox(8,12,4,16,16,material,width,height);body.position.y=.375;
    model.upper.position.y=.75;model.upper.add(body);model.root.add(model.upper);
    model.head.position.y=.75;model.upper.add(model.head);model.root.scale.setScalar(.9375);
    const head=skinBox(8,8,8,0,0,material,width,height);head.position.y=.25;model.head.add(head);
    const hat=skinBox(8,8,8,32,0,overlay,width,height,false,.5);hat.position.y=.25;model.head.add(hat);
    if(height>=64){const jacket=skinBox(8,12,4,16,32,overlay,width,height,false,.25);jacket.position.y=.375;model.upper.add(jacket);}
    const handMaterial=material;
    const hand=skinBox(4,12,4,40,16,handMaterial,width,height);hand.scale.y=-1;hand.position.set(-6/16,6/16,0);hand.renderOrder=1000;
    // ItemInHandRenderer's resting right arm, including its native model pivot.
    const pose=new Group();pose.matrixAutoUpdate=false;
    pose.matrix.makeTranslation(-1,3.6,3.5)
      .multiply(new Matrix4().makeRotationZ(120*Math.PI/180))
      .multiply(new Matrix4().makeRotationX(200*Math.PI/180))
      .multiply(new Matrix4().makeRotationY(-135*Math.PI/180))
      .multiply(new Matrix4().makeTranslation(5.6,0,0));
    pose.add(hand);model.hand.add(pose);
    for(const [pivot,x,u,v,h,w,d] of [
      [model.rightArm,5/16,40,16,12,4,4],[model.leftArm,-5/16,height>=64?32:40,height>=64?48:16,12,4,4],
      [model.rightLeg,.125,0,16,12,4,4],[model.leftLeg,-.125,height>=64?16:0,height>=64?48:16,12,4,4],
    ] as const) {
      const arm=pivot===model.rightArm||pivot===model.leftArm;
      pivot.position.set(x,arm?10/16:.75,0);
      const left=x<0,mesh=skinBox(w,h,d,u,v,material,width,height,left&&height<64);mesh.position.set(arm?(left?-1:1)/16:0,arm?-4/16:-6/16,0);pivot.add(mesh);
      if(height>=64){const layer=skinBox(w,h,d,arm?(left?48:40):0,left?48:32,overlay,width,height,false,.25);layer.position.copy(mesh.position);pivot.add(layer);}
      (arm?model.upper:model.root).add(pivot);
    }
    return model;
  }
  swing(){if(this.swingTime>=.15)this.swingTime=0;}
  get swingProgress(){return this.swingTime/.3;}
  update(dt:number,yaw:number,pitch:number,forward:number,strafe:number,speed:number,reducedMotion:boolean,sneaking=false,flying=false,dx?:number,dz?:number) {
    this.age+=dt;
    this.swingTime=Math.min(.3,this.swingTime+dt);
    const attack=this.swingTime/.3,arc=attack<1?Math.sin(Math.sqrt(attack)*Math.PI):0,twist=attack<1?Math.sin(attack*attack*Math.PI):0;
    this.hand.position.set(.64-.3*arc,-.6+(attack<1?.4*Math.sin(Math.sqrt(attack)*2*Math.PI):0),-.72-(attack<1?.4*Math.sin(attack*Math.PI):0));
    this.hand.quaternion.setFromRotationMatrix(new Matrix4().makeRotationY((45+70*arc)*Math.PI/180).multiply(new Matrix4().makeRotationZ(-20*twist*Math.PI/180)));
    const ease=1-Math.exp(-dt*12),turn=(target:number,current:number)=>Math.atan2(Math.sin(target-current),Math.cos(target-current));
    if(!this.initialized){this.bodyYaw=yaw;this.initialized=true;}
    // Face the travel direction, retaining a forward-facing torso when backing up.
    let targetYaw=yaw;
    if(speed>.1){
      targetYaw=dx!==undefined&&dz!==undefined?Math.atan2(-dx,-dz):yaw+Math.atan2(-strafe,forward);
      if(Math.abs(turn(targetYaw,yaw))>Math.PI/2)targetYaw+=Math.PI;
    }
    this.bodyYaw+=turn(targetYaw,this.bodyYaw)*ease;
    const headDelta=turn(yaw,this.bodyYaw),limit=75*Math.PI/180;
    if(Math.abs(headDelta)>limit)this.bodyYaw=yaw-Math.sign(headDelta)*limit;
    this.root.rotation.y=this.bodyYaw;
    const attackYaw=attack<1?Math.sin(Math.sqrt(attack)*Math.PI*2)*5*Math.PI/180:0;
    this.upper.rotation.y=attackYaw;
    this.head.rotation.y=turn(yaw,this.bodyYaw)-attackYaw;
    const crouch=sneaking&&!flying;
    this.upper.rotation.x=crouch?.5:0;
    this.head.rotation.x=pitch-this.upper.rotation.x;
    this.head.position.set(0,crouch?.65:.75,0);
    this.amount+=(Math.min(1,speed/5)-this.amount)*(1-Math.exp(-dt*9));
    this.phase+=speed*dt*4*.6662;
    const stride=Math.cos(this.phase)*this.amount*(forward<0?-1:1);
    for(const [part,sign,arm] of [[this.leftLeg,1,false],[this.rightLeg,-1,false],[this.leftArm,-1,true],[this.rightArm,1,true]] as const) {
      let target=stride*sign*1.4;
      if(part===this.rightArm&&this.holding)target=target*.5-.314;
      if(arm&&crouch)target+=.4;
      if(attack<1&&arm){const hit=Math.sin((1-(1-attack)**4)*Math.PI)*1.2+Math.sin(attack*Math.PI);target-=hit*(part===this.rightArm?30:10)*Math.PI/180;}
      part.rotation.x=target;
      part.rotation.z=arm?-sign*(Math.cos(this.age*1.8)*.05+.05):0;
      if(!arm){part.position.y=crouch?.56:.75;part.position.z=crouch?.25:0;}
    }
    this.rightArm.rotation.y=attack<1?-arc*.4:0;
    this.upper.position.y=crouch?.65:.75;this.root.rotation.z=0;
    // Camera view bobbing is independent of the visible player's walk cycle.
    return {vertical:0,side:0};
  }
}
