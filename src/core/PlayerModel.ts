import { Group, BoxGeometry, Mesh, MeshBasicMaterial, Matrix4, TextureLoader, NearestFilter, SRGBColorSpace } from 'three';
import { assetUrl, AssetManager } from './AssetManager';

export function skinBox(w:number,h:number,d:number,u:number,v:number,material:MeshBasicMaterial,textureWidth:number,textureHeight:number) {
  const geometry=new BoxGeometry(w/16,h/16,d/16),uv=geometry.attributes.uv;
  const rectangles=[ [u+d+w,v+d,d,h],[u,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+d+w+d,v+d,w,h],[u+d,v+d,w,h] ];
  rectangles.forEach(([x,y,width,height],i)=>{
    const cap=i===2||i===3,U=cap?x:x+width,V=cap?x+width:x,top=i===2?y+height:y,bottom=i===2?y:y+height;
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
  private phase=0; private amount=0; private bodyYaw=0; private upperYaw=0;
  static async create(assets:AssetManager) {
    const texture=await new TextureLoader().loadAsync(assetUrl('steve.png'));
    texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.generateMipmaps=false;texture.colorSpace=SRGBColorSpace;
    const material=assets.skinMaterial(texture);
    const model=new PlayerModel(),width=texture.image.width,height=texture.image.height;
    const body=skinBox(8,12,4,16,16,material,width,height);body.position.y=.375;
    model.upper.position.y=.75;model.upper.add(body);model.root.add(model.upper);
    model.head.position.y=1;model.upper.add(model.head);model.root.scale.setScalar(.9);
    const head=skinBox(8,8,8,0,0,material,width,height);model.head.add(head);
    const handMaterial=assets.skinMaterial(texture);handMaterial.depthTest=false;handMaterial.depthWrite=false;handMaterial.transparent=true;
    const hand=skinBox(4,12,4,40,16,handMaterial,width,height);hand.scale.y=-1;hand.position.set(-6/16,6/16,0);model.hand.renderOrder=1000;
    // ItemInHandRenderer's resting right arm, including its native model pivot.
    const pose=new Group();pose.matrixAutoUpdate=false;
    pose.matrix.makeTranslation(-1,3.6,3.5)
      .multiply(new Matrix4().makeRotationZ(120*Math.PI/180))
      .multiply(new Matrix4().makeRotationX(200*Math.PI/180))
      .multiply(new Matrix4().makeRotationY(-135*Math.PI/180))
      .multiply(new Matrix4().makeTranslation(5.6,0,0));
    pose.add(hand);model.hand.add(pose);
    for(const [pivot,x,u,v,h,w,d] of [
      [model.rightArm,.375,40,16,12,4,4],[model.leftArm,-.375,height===64?32:40,height===64?48:16,12,4,4],
      [model.rightLeg,.125,0,16,12,4,4],[model.leftLeg,-.125,height===64?16:0,height===64?48:16,12,4,4],
    ] as const) {
      const arm=pivot===model.rightArm||pivot===model.leftArm;
      pivot.position.set(x,arm?.7:.75,0);
      const mesh=skinBox(w,h,d,u,v,material,width,height);mesh.position.y=-.375;pivot.add(mesh);
      (arm?model.upper:model.root).add(pivot);
    }
    model.head.position.z=-.025;
    return model;
  }
  swing(){if(this.swingTime>=.15)this.swingTime=0;}
  update(dt:number,yaw:number,pitch:number,forward:number,strafe:number,speed:number,reducedMotion:boolean) {
    this.swingTime=Math.min(.3,this.swingTime+dt);
    const attack=this.swingTime/.3,arc=attack<1?Math.sin(Math.sqrt(attack)*Math.PI):0,twist=attack<1?Math.sin(attack*attack*Math.PI):0;
    this.hand.position.set(.64-.3*arc,-.6+(attack<1?.4*Math.sin(Math.sqrt(attack)*2*Math.PI):0),-.72-(attack<1?.4*Math.sin(attack*Math.PI):0));
    this.hand.quaternion.setFromRotationMatrix(new Matrix4().makeRotationY((45+70*arc)*Math.PI/180).multiply(new Matrix4().makeRotationZ(-20*twist*Math.PI/180)));
    const ease=1-Math.exp(-dt*12),turn=(target:number,current:number)=>Math.atan2(Math.sin(target-current),Math.cos(target-current));
    const delta=turn(yaw,this.bodyYaw);
    this.bodyYaw+=Math.max(-.8,Math.min(.8,delta))*ease;
    // Clamp head twist while retaining a small, ordered following delay.
    if(Math.abs(turn(yaw,this.bodyYaw))>.75)this.bodyYaw=yaw-Math.sign(delta)*.75;
    this.upperYaw+=turn(yaw,this.upperYaw)*(1-Math.exp(-dt*20));
    this.root.rotation.y=this.bodyYaw;
    this.upper.rotation.y=turn(this.upperYaw,this.bodyYaw);
    this.head.rotation.y=turn(yaw,this.upperYaw);this.head.rotation.x=-pitch;
    this.amount+=(Math.min(1,speed/2.8)-this.amount)*(1-Math.exp(-dt*9));
    this.phase+=speed*dt*3.3;
    const stride=Math.sin(this.phase)*this.amount;
    const f=forward, s=strafe;
    for(const [part,sign,arm] of [[this.leftLeg,1,false],[this.rightLeg,-1,false],[this.leftArm,-1,true],[this.rightArm,1,true]] as const) {
      const target=stride*sign*(arm?.48:.58)*f-(part===this.rightArm&&attack<1?Math.sin(attack*Math.PI)*1.2:0);
      part.rotation.x+=(target-part.rotation.x)*ease;
      part.rotation.z+=(-stride*sign*(arm?.22:.38)*s-part.rotation.z)*ease;
    }
    const bob=reducedMotion?0:(1-Math.cos(this.phase*2))*.008*this.amount;
    this.rightArm.rotation.y=-arc*.4;
    this.upper.position.y=.75+bob;this.root.rotation.z=reducedMotion?0:Math.sin(this.phase)*.009*this.amount;
    return {vertical:bob,side:reducedMotion?0:Math.sin(this.phase)*.008*this.amount};
  }
}
