import { Group, BoxGeometry, Mesh, MeshBasicMaterial, Matrix4, TextureLoader, NearestFilter, SRGBColorSpace, DoubleSide } from 'three';
import { assetUrl, AssetManager } from './AssetManager';

const angleDelta=(target:number,current:number)=>Math.atan2(Math.sin(target-current),Math.cos(target-current));

export function skinBox(w:number,h:number,d:number,u:number,v:number,material:MeshBasicMaterial,textureWidth:number,textureHeight:number,mirror=false,inflate=0) {
  const geometry=new BoxGeometry((w+inflate*2)/16,(h+inflate*2)/16,(d+inflate*2)/16),uv=geometry.attributes.uv;
  // Our forward axis is -Z. The right side of the skin net therefore belongs
  // on +X, with the front on -Z. Legacy left limbs reflect the right limb.
  const rectangles=[ [u,v+d,d,h],[u+d+w,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+d+w+d,v+d,w,h],[u+d,v+d,w,h] ];
  if(mirror)[rectangles[0],rectangles[1]]=[rectangles[1],rectangles[0]];
  rectangles.forEach(([x,y,width,height],i)=>{
    const reverse=(i===0||i===1)!==mirror,U=reverse?x:x+width,V=reverse?x+width:x,top=i===2?y+height:y,bottom=i===2?y:y+height;
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
  private phase=0;private amount=0;private previousAmount=0;
  private bodyYaw=0;private previousBodyYaw=0;private headYaw=0;private previousHeadYaw=0;private headPitch=0;private previousHeadPitch=0;
  private age=0;private initialized=false;
  holding=false;
  slim=false;private skinMeshes:Mesh[]=[];private materials:MeshBasicMaterial[]=[];
  static async create(assets:AssetManager) {
    const texture=await new TextureLoader().loadAsync(assetUrl('steve.png'));
    texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.generateMipmaps=false;texture.colorSpace=SRGBColorSpace;
    return PlayerModel.fromSkin(texture.image.width,texture.image.height,assets.skinMaterial(texture),assets.skinMaterial(texture));
  }
  static fromSkin(width:number,height:number,material:MeshBasicMaterial,overlay:MeshBasicMaterial,slim=false) {
    const model=new PlayerModel();model.setSkin(width,height,material,overlay,slim);return model;
  }
  setSkin(width:number,height:number,material:MeshBasicMaterial,overlay:MeshBasicMaterial,slim=false) {
    for(const mesh of this.skinMeshes){mesh.removeFromParent();mesh.geometry.dispose();}
    for(const old of new Set(this.materials))if(old!==material&&old!==overlay)old.dispose();
    this.skinMeshes=[];this.materials=[material,overlay];this.hand.clear();
    // HD skins use the same 64-unit skin net; only texel density changes.
    height=height/(width/64);width=64;slim=slim&&height>=64;this.slim=slim;
    overlay.alphaTest=.1;overlay.transparent=true;overlay.side=DoubleSide;
    const model=this,armWidth=slim?3:4,armOffset=slim?.5:1;
    const remember=(mesh:Mesh)=>{this.skinMeshes.push(mesh);return mesh;};
    const box=(w:number,h:number,d:number,u:number,v:number,mat=material,mirror=false,inflate=0)=>remember(skinBox(w,h,d,u,v,mat,width,height,mirror,inflate));
    const body=box(8,12,4,16,16);body.position.y=-.375;
    model.upper.position.y=1.5;model.upper.rotation.order='ZYX';model.upper.add(body);model.root.add(model.upper);
    model.head.position.y=1.5;model.head.rotation.order='YXZ';model.root.add(model.head);model.root.scale.setScalar(.9375);
    const head=box(8,8,8,0,0);head.position.y=.25;model.head.add(head);
    const hat=box(8,8,8,32,0,overlay,false,.5);hat.position.y=.25;model.head.add(hat);
    if(height>=64){const jacket=box(8,12,4,16,32,overlay,false,.25);jacket.position.y=.375;model.upper.add(jacket);}
    const handMaterial=material;
    const hand=box(armWidth,12,4,40,16,handMaterial);hand.scale.y=-1;hand.position.set(-(5+armOffset)/16,(6+(slim?.5:0))/16,0);hand.renderOrder=1000;
    // ItemInHandRenderer's resting right arm, including its native model pivot.
    const pose=new Group();pose.matrixAutoUpdate=false;
    pose.matrix.makeTranslation(-1,3.6,3.5)
      .multiply(new Matrix4().makeRotationZ(120*Math.PI/180))
      .multiply(new Matrix4().makeRotationX(200*Math.PI/180))
      .multiply(new Matrix4().makeRotationY(-135*Math.PI/180))
      .multiply(new Matrix4().makeTranslation(5.6,0,0));
    pose.add(hand);model.hand.add(pose);
    if(height>=64){const sleeve=box(armWidth,12,4,40,32,overlay,false,.25);sleeve.position.copy(hand.position);sleeve.scale.copy(hand.scale);sleeve.renderOrder=1001;pose.add(sleeve);}
    for(const [pivot,x,u,v,h,w,d] of [
      [model.rightArm,5/16,40,16,12,armWidth,4],[model.leftArm,-5/16,height>=64?32:40,height>=64?48:16,12,armWidth,4],
      [model.rightLeg,.125,0,16,12,4,4],[model.leftLeg,-.125,height>=64?16:0,height>=64?48:16,12,4,4],
    ] as const) {
      const arm=pivot===model.rightArm||pivot===model.leftArm;
      pivot.position.set(x,arm?1.5-(slim?2.5:2)/16:.75,0);pivot.rotation.order='ZYX';
      const left=x<0,mesh=box(w,h,d,u,v,material,left&&height<64);mesh.position.set(arm?(left?-armOffset:armOffset)/16:0,arm?-4/16:-6/16,0);pivot.add(mesh);
      if(height>=64){const layer=box(w,h,d,arm?(left?48:40):0,left?48:32,overlay,false,.25);layer.position.copy(mesh.position);pivot.add(layer);}
      model.root.add(pivot);
    }
  }
  swing(){if(this.swingTime>=.15)this.swingTime=0;}
  get swingProgress(){return this.swingTime/.3;}
  resetPose(yaw:number,pitch:number){
    this.phase=this.amount=this.previousAmount=0;
    this.bodyYaw=this.previousBodyYaw=this.headYaw=this.previousHeadYaw=yaw;
    this.headPitch=this.previousHeadPitch=pitch;this.initialized=true;
  }
  // EntityLivingBase's 20 Hz limb and body updates; render frames only interpolate.
  tick(yaw:number,pitch:number,dx:number,dz:number){
    if(!this.initialized)this.resetPose(yaw,pitch);
    this.previousAmount=this.amount;
    this.amount+=(Math.min(1,Math.hypot(dx,dz)*4)-this.amount)*.4;
    this.phase+=this.amount;
    this.previousBodyYaw=this.bodyYaw;this.previousHeadYaw=this.headYaw;this.previousHeadPitch=this.headPitch;
    this.headYaw=yaw;this.headPitch=pitch;
    let targetYaw=this.bodyYaw;
    if(dx*dx+dz*dz>.0025){
      targetYaw=Math.atan2(-dx,-dz);
      if(Math.abs(angleDelta(yaw,targetYaw))>95*Math.PI/180)targetYaw+=Math.PI;
    }
    if(this.swingTime<.3)targetYaw=yaw;
    this.bodyYaw+=angleDelta(targetYaw,this.bodyYaw)*.3;
    const headDelta=Math.max(-75*Math.PI/180,Math.min(75*Math.PI/180,angleDelta(yaw,this.bodyYaw)));
    this.bodyYaw=yaw-headDelta;
    if(Math.abs(headDelta)>50*Math.PI/180)this.bodyYaw+=headDelta*.2;
  }
  update(dt:number,yaw:number,pitch:number,sneaking=false,flying=false,partialTick=1) {
    if(!this.initialized)this.resetPose(yaw,pitch);
    partialTick=Math.max(0,Math.min(1,partialTick));
    this.age+=dt;
    this.swingTime=Math.min(.3,this.swingTime+dt);
    const attack=this.swingTime/.3,arc=attack<1?Math.sin(Math.sqrt(attack)*Math.PI):0,twist=attack<1?Math.sin(attack*attack*Math.PI):0;
    this.hand.position.set(.64-.3*arc,-.6+(attack<1?.4*Math.sin(Math.sqrt(attack)*2*Math.PI):0),-.72-(attack<1?.4*Math.sin(attack*Math.PI):0));
    this.hand.quaternion.setFromRotationMatrix(new Matrix4().makeRotationY((45+70*arc)*Math.PI/180).multiply(new Matrix4().makeRotationZ(-20*twist*Math.PI/180)));
    const bodyYaw=this.previousBodyYaw+angleDelta(this.bodyYaw,this.previousBodyYaw)*partialTick;
    const headYaw=this.previousHeadYaw+angleDelta(this.headYaw,this.previousHeadYaw)*partialTick;
    const headPitch=this.previousHeadPitch+(this.headPitch-this.previousHeadPitch)*partialTick;
    this.root.rotation.y=bodyYaw;
    const attackYaw=attack<1?-Math.sin(Math.sqrt(attack)*Math.PI*2)*.2:0;
    this.upper.rotation.y=attackYaw;
    this.head.rotation.y=angleDelta(headYaw,bodyYaw);
    const crouch=sneaking&&!flying;
    this.upper.rotation.x=crouch?-.5:0;
    this.head.rotation.x=headPitch;
    this.head.position.set(0,1.5-(crouch?.2+1/16:0),0);
    const amount=this.previousAmount+(this.amount-this.previousAmount)*partialTick;
    const phase=(this.phase-this.amount*(1-partialTick))*.6662;
    const stride=Math.cos(phase)*amount;
    // Native model X/Y point left/down; our skin groups point right/up.
    for(const [part,sign,arm] of [[this.leftLeg,1,false],[this.rightLeg,-1,false],[this.leftArm,-1,true],[this.rightArm,1,true]] as const) {
      let target=stride*sign*(arm?1:1.4);
      if(part===this.rightArm&&this.holding)target=target*.5+Math.PI/10;
      if(arm&&crouch)target-=.4;
      if(attack<1&&part===this.rightArm)target+=Math.sin((1-(1-attack)**4)*Math.PI)*1.2+Math.sin(attack*Math.PI)*(headPitch+.7)*.75;
      if(part===this.leftArm)target+=attackYaw;
      if(arm)target-=sign*Math.sin(this.age*1.34)*.05;
      part.rotation.x=target;
      part.rotation.z=arm?sign*(Math.cos(this.age*1.8)*.05+.05):0;
      if(arm){
        part.position.set(sign*Math.cos(attackYaw)*5/16,1.5-(this.slim?2.5:2)/16-(crouch?.2:0),-sign*Math.sin(attackYaw)*5/16);
        part.rotation.y=attackYaw*(part===this.rightArm?3:1);
      }else{part.position.y=crouch?15/16-.2:.75;part.position.z=crouch?.25:.1/16;}
    }
    if(attack<1)this.rightArm.rotation.z-=Math.sin(attack*Math.PI)*.4;
    this.upper.position.y=1.5-(crouch?.2:0);this.root.rotation.z=0;
    // Camera view bobbing is independent of the visible player's walk cycle.
    return {vertical:0,side:0};
  }
}
