// Fullscreen must be requested synchronously from a trusted touch gesture.
// Browsers may omit either API (notably on iPhone); gameplay remains available.
export class MobileDisplay {
  private pending=false;
  private locked=false;
  constructor(private doc:Document=document,private display:Screen=screen){
    doc.addEventListener('fullscreenchange',()=>{if(!doc.fullscreenElement)this.locked=false;});
  }
  async enter(){
    if(this.pending||this.doc.hidden||this.locked&&this.doc.fullscreenElement)return;
    this.pending=true;
    try {
      const root=this.doc.documentElement as HTMLElement&{webkitRequestFullscreen?:()=>Promise<void>|void};
      if(!this.doc.fullscreenElement){
        if(root.requestFullscreen)await root.requestFullscreen({navigationUI:'hide'});
        else if(root.webkitRequestFullscreen)await root.webkitRequestFullscreen();
        else return;
      }
      const orientation=this.display.orientation as ScreenOrientation&{lock?:(orientation:string)=>Promise<void>};
      if(orientation?.lock){await orientation.lock('landscape');this.locked=true;}
    }catch{/* Unsupported or declined requests must not interrupt a tap or show an error. */}
    finally{this.pending=false;}
  }
}
