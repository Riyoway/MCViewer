import assert from 'node:assert/strict';
import {Box3,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {PlayerModel,skinBox} from '../src/core/PlayerModel';
import {MobileDisplay} from '../src/core/MobileDisplay';

const material=new MeshBasicMaterial(),overlay=new MeshBasicMaterial();
const cube=skinBox(8,8,8,0,0,material,64,32),uv=cube.geometry.attributes.uv;
assert.equal(uv.getX(0),0/64,'Right head face uses the right skin region');
assert.equal(uv.getX(4),16/64,'Left head face uses the left skin region');
assert.equal(uv.getX(8),16/64,'Top face joins the front without a horizontal reflection');
assert.equal(uv.getX(20),16/64,'Front face retains the skin face, not the back');
const normal=skinBox(4,12,4,40,16,material,64,32),mirror=skinBox(4,12,4,40,16,material,64,32,true);
const normalUv=normal.geometry.attributes.uv,mirrorUv=mirror.geometry.attributes.uv;
assert.equal(mirrorUv.getX(0),normalUv.getX(5),'Mirrored legacy limb swaps and reflects its side faces');
assert.equal(mirrorUv.getX(20),normalUv.getX(21),'Mirrored legacy limb reflects its front face');
for(const height of [32,64]){
  const model=PlayerModel.fromSkin(64,height,material,overlay);
  assert.equal(model.head.children.length,2,'Both skin formats have a hat layer');
  assert.equal(model.rightArm.children.length,height===64?2:1,'Modern skins have sleeves');
  assert.equal(overlay.alphaTest,.1,'Transparent hat pixels reveal the base skin');
  model.update(0,0,.6);
  model.root.updateMatrixWorld(true);
  const headDirection=new Vector3(0,0,-1).transformDirection(model.head.matrixWorld);
  assert(headDirection.y>0,'Looking up pitches the visible head up');
  assert.equal(model.rightArm.position.x,5/16,'Native shoulder pivot');
  assert.equal(model.rightArm.children[0].position.x,1/16,'Arm center is offset from the shoulder pivot');
  assert(new Box3().setFromObject(model.rightLeg.children[0]).min.y>=-.0001,'Standing feet sit on the floor');
  for(let i=0;i<20;i++){model.tick(0,0,.2,0);model.update(.05,0,0);}
  assert(Math.abs(model.leftLeg.rotation.x)>.1,'Strafing drives the walking cycle');
  assert.equal(model.leftLeg.rotation.x,-model.rightLeg.rotation.x,'Legs walk in opposition');
  assert.equal(model.leftLeg.rotation.z,0,'Strafing does not roll legs sideways');
  assert(Math.abs(model.root.rotation.y)>.2,'Torso follows travel while the head retains the view');
  model.tick(0,0,0,0);model.update(.05,0,0,true);
  assert.equal(model.upper.rotation.x,-.5,'Sneaking bends the torso forward in the viewer coordinate system');
  assert.equal(model.head.rotation.x,0,'The head looks independently of the crouched torso');
  model.update(.05,0,0,true,true);
  assert.equal(model.upper.rotation.x,0,'Creative flight descend does not crouch the torso');
  for(let i=0;i<30;i++)model.tick(0,0,0,0);
  model.holding=true;model.update(1,0,0);
  assert(model.rightArm.rotation.x>.25&&model.rightArm.rotation.x<.37,'Held items retain the native forward tilt and idle sway');
  model.swing();model.update(.1,0,0);
  assert(model.rightArm.rotation.x>.5,'Attacking swings the visible arm forward');
}

const makeModel=()=>PlayerModel.fromSkin(64,64,new MeshBasicMaterial(),new MeshBasicMaterial());
const reference=makeModel();reference.resetPose(0,0);
const nativeAngles=new Map([[1,-.5402341382686439],[2,-.6894093084270749],[5,.9602360744622942],[20,-1.3592778556834633]]);
for(let tick=1;tick<=20;tick++){
  reference.tick(0,0,0,-.3);reference.update(0,0,0);
  if(nativeAngles.has(tick))assert(Math.abs(reference.rightLeg.rotation.x-nativeAngles.get(tick)!)<1e-10,`Native capped leg pose at tick ${tick}`);
}
const moving=makeModel(),fastFlight=makeModel();
moving.resetPose(0,0);fastFlight.resetPose(0,0);
for(let tick=0;tick<80;tick++){
  moving.tick(0,0,0,-5.612/20);fastFlight.tick(0,0,0,-21.78/20);
  for(const partial of [0,.25,.5,.75,1]){
    moving.update(0,0,0,false,false,partial);fastFlight.update(0,0,0,false,true,partial);
    assert(Math.abs(moving.rightLeg.rotation.x-fastFlight.rightLeg.rotation.x)<1e-10,'Fast creative flight shares the native capped sprint cycle');
    assert(Math.abs(moving.rightArm.rotation.x+moving.rightLeg.rotation.x/1.4)<1e-10,'Arm swing is smaller than the opposing leg swing');
  }
}
let crossings=0,previous=moving.rightLeg.rotation.x;
for(let tick=0;tick<200;tick++){
  moving.tick(0,0,0,-21.78/20);moving.update(0,0,0,false,true);
  const value=moving.rightLeg.rotation.x;if(previous<=0&&value>0)crossings++;previous=value;
}
assert(crossings>=21&&crossings<=22,'Fast flight stays near the native maximum of 2.12 complete leg cycles per second');
for(let tick=0;tick<30;tick++){moving.tick(0,0,0,0);moving.update(0,0,0,false,true);}
assert(Math.abs(moving.rightLeg.rotation.x)<1e-6,'Hovering and vertical-only flight settle the legs instead of running in place');
const idle=makeModel(),radians=(degrees:number)=>degrees*Math.PI/180;
idle.resetPose(0,0);
for(let tick=0;tick<20;tick++){idle.tick(radians(30),radians(40),0,0);idle.update(.05,radians(30),radians(40));}
assert(Math.abs(idle.root.rotation.y)<1e-10,'A small stationary look turns only the head');
assert(Math.abs(idle.head.rotation.y-radians(30))<1e-10);
for(const crouch of [false,true]){
  idle.update(0,radians(30),radians(40),crouch);
  idle.root.updateMatrixWorld(true);
  const actual=new Vector3(0,0,-1).transformDirection(idle.head.matrixWorld),expected=new Vector3(-Math.sin(radians(30))*Math.cos(radians(40)),Math.sin(radians(40)),-Math.cos(radians(30))*Math.cos(radians(40)));
  assert(actual.distanceTo(expected)<1e-10,'Looking up and sideways retains the world gaze while crouching');
}
idle.tick(radians(120),0,0,0);idle.update(0,radians(120),0);
assert(Math.abs(idle.head.rotation.y-radians(60))<1e-10,'Beyond the native neck limit, the body catches up with the extra 20 percent turn');
const wrap=makeModel();wrap.resetPose(radians(179),0);wrap.tick(radians(-179),0,0,0);wrap.update(0,0,0,false,false,.5);
assert(Math.abs(wrap.head.rotation.y-radians(1))<1e-10,'Head interpolation crosses the angle boundary without turning a full circle');
const backward=makeModel();backward.resetPose(0,0);
for(let tick=0;tick<20;tick++){backward.tick(0,0,0,.2);backward.update(.05,0,0);}
assert(Math.abs(backward.root.rotation.y)<1e-10,'Backing up keeps the torso facing forward');
const wall=makeModel();wall.resetPose(0,0);
for(let tick=0;tick<20;tick++){wall.tick(0,0,0,0);wall.update(.05,0,0);}
assert.equal(Math.abs(wall.rightLeg.rotation.x),0,'Holding movement against a wall does not animate distance that was not travelled');
idle.resetPose(radians(30),radians(40));idle.swing();idle.update(.1,radians(30),radians(40));idle.root.updateMatrixWorld(true);
assert(new Vector3(0,0,-1).transformDirection(idle.head.matrixWorld).distanceTo(new Vector3(-Math.sin(radians(30))*Math.cos(radians(40)),Math.sin(radians(40)),-Math.cos(radians(30))*Math.cos(radians(40))))<1e-10,'Attack torso twisting does not drag the head off the view direction');
const stance=makeModel();stance.update(0,0,0,true);stance.root.updateMatrixWorld(true);
assert(new Box3().setFromObject(stance.rightLeg.children[0]).min.y>-.02,'Crouching does not sink the feet into the floor');
assert.equal(stance.head.parent,stance.root);assert.equal(stance.rightArm.parent,stance.root,'Shoulders do not inherit the torso crouch angle');
assert(stance.upper.rotation.x<0&&stance.rightArm.rotation.x<0,'The torso leans forward while the native crouch arm compensation remains independent');

const calls:string[]=[];
let complete!:()=>void;
const fakeDoc={hidden:false,fullscreenElement:null as unknown,addEventListener:()=>{},documentElement:{requestFullscreen:()=>{calls.push('fullscreen');return new Promise<void>(resolve=>{complete=()=>{fakeDoc.fullscreenElement={};resolve();};});}}};
const fakeScreen={orientation:{lock:async(direction:string)=>{calls.push(direction);}}};
const mobile=new MobileDisplay(fakeDoc as unknown as Document,fakeScreen as unknown as Screen);
const first=mobile.enter();void mobile.enter();
assert.deepEqual(calls,['fullscreen'],'Repeated fingers cannot issue concurrent fullscreen requests');
complete();await first;
assert.deepEqual(calls,['fullscreen','landscape'],'Landscape locks only after fullscreen completes');
await mobile.enter();assert.equal(calls.length,2,'Already fullscreen and locked taps are no-ops');
const unavailable={...fakeDoc,fullscreenElement:null,documentElement:{}};
await new MobileDisplay(unavailable as unknown as Document,fakeScreen as unknown as Screen).enter();
assert.equal(calls.length,2,'Missing fullscreen APIs do not break gameplay');
const rejected={...unavailable,documentElement:{requestFullscreen:()=>Promise.reject(new Error('Unsupported'))}};
await new MobileDisplay(rejected as unknown as Document,fakeScreen as unknown as Screen).enter();
assert.equal(calls.length,2,'Rejected requests do not attempt orientation or leak exceptions');
console.log('Player rendering passed: skin sides, legacy mirrors, layers, pivots, head look, strafe, crouch, flight, attack and mobile fullscreen ordering.');
