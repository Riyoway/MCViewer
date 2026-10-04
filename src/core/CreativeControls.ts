export class CreativeControls {
  private buttons=new Set<number>();private breakDelay=0;private useDelay=0;private accumulator=0;
  constructor(private destroy:()=>void,private use:()=>void,private pick:()=>void){}
  down(button:number){if(this.buttons.has(button))return;this.buttons.add(button);if(button===0){this.destroy();this.breakDelay=5;}if(button===2&&this.useDelay===0){this.use();this.useDelay=4;}if(button===1)this.pick();}
  up(button:number){this.buttons.delete(button);}
  reset(){this.buttons.clear();this.breakDelay=0;this.useDelay=0;this.accumulator=0;}
  update(dt:number){this.accumulator+=Math.min(dt,.1);while(this.accumulator>=.05-1e-9){this.accumulator=Math.max(0,this.accumulator-.05);this.breakDelay=Math.max(0,this.breakDelay-1);this.useDelay=Math.max(0,this.useDelay-1);
    if(this.buttons.has(0)&&!this.breakDelay){this.destroy();this.breakDelay=5;}
    if(this.buttons.has(2)&&!this.useDelay){this.use();this.useDelay=4;}
  }}
}
