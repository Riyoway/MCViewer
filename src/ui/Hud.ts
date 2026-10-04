import { WebGLRenderer,Scene,OrthographicCamera,Group,Euler,MeshBasicMaterial,SRGBColorSpace,NearestFilter } from 'three';
import { AssetManager,assetUrl } from '../core/AssetManager';
import { appendElement,emptyMesh } from '../minecraft/Mesher';
import { Inventory,filterItems } from './Inventory';
import type { UIAssets,UITheme,InventoryItem } from './types';

// Native GUI pixels: 182 x 22 hotbar and 195 x 136 creative search inventory.
export class Hud {
  readonly inventory=new Inventory();open=false;
  private theme!:UITheme;private world='';private legacy=true;private row=0;private hovered:InventoryItem|null=null;
  private icons=new Map<string,string>();private catalog:InventoryItem[]=[];private grid:HTMLButtonElement[]=[];private bar:HTMLElement[]=[];private slots:HTMLButtonElement[]=[];
  private iconRenderer?:WebGLRenderer;private scene=new Scene();private camera=new OrthographicCamera(-.8,.8,.8,-.8,.1,10);
  private hotbar=document.getElementById('hotbar')!;private selection=document.createElement('div');
  private overlay=document.getElementById('inventory-screen')!;private panel=document.getElementById('inventory-panel')!;
  private search=document.getElementById('item-search') as HTMLInputElement;private scroller=document.getElementById('inventory-scroll')!;
  private tooltip=document.getElementById('item-tooltip')!;private cursor=document.getElementById('item-cursor')!;
  private material:MeshBasicMaterial;
  private constructor(readonly assets:AssetManager,readonly data:UIAssets){
    this.material=assets.opaque.clone();this.material.map=assets.opaque.map!.clone();this.material.map.minFilter=NearestFilter;this.material.map.needsUpdate=true;
    this.material.fog=false;this.material.onBeforeCompile=shader=>{assets.opaque.onBeforeCompile(shader,this.iconRenderer!);shader.uniforms.daylight={value:1};shader.uniforms.gamma={value:0};shader.uniforms.voxelTime={value:0};};
    this.material.customProgramCacheKey=()=> 'minecraft-gui-items-v1';this.camera.position.z=4;
    this.selection.className='hotbar-selection';this.hotbar.append(this.selection);
    for(let i=0;i<9;i++){
      const cell=document.createElement('div');cell.className='hotbar-item';cell.style.left=`${3+i*20}px`;this.hotbar.append(cell);this.bar.push(cell);
      const button=this.slot(9+i*18,112);button.addEventListener('click',()=>{this.inventory.swap(i);this.save();this.drawHotbar();});
      button.addEventListener('contextmenu',event=>{event.preventDefault();this.inventory.assign(null,i);this.save();this.drawHotbar();});
      button.addEventListener('pointerenter',()=>this.showTooltip(this.item(this.inventory.hotbar[i])??null));this.slots.push(button);
    }
    for(let i=0;i<45;i++){
      const button=this.slot(9+i%9*18,18+Math.floor(i/9)*18);this.grid.push(button);
      button.addEventListener('click',event=>{const item=this.catalog[this.row*9+i];if(!item)return;if(event.shiftKey){const empty=this.inventory.hotbar.indexOf(null);this.inventory.assign(item.id,empty<0?this.inventory.selected:empty);this.save();this.drawHotbar();}else{this.inventory.cursor=item.id;this.drawCursor();}});
      button.addEventListener('pointerenter',()=>{this.hovered=this.catalog[this.row*9+i]??null;this.showTooltip(this.hovered);});
      button.addEventListener('pointerleave',()=>{this.hovered=null;this.tooltip.hidden=true;});
    }
    this.search.addEventListener('input',()=>{this.row=0;this.catalog=filterItems(this.theme.items,this.search.value);this.drawCatalog();});
    this.panel.addEventListener('wheel',event=>{event.preventDefault();this.scroll(this.row+Math.sign(event.deltaY));},{passive:false});
    const drag=(event:PointerEvent)=>{const rect=this.scroller.getBoundingClientRect(),fraction=(event.clientY-rect.top)/rect.height;this.scroll(Math.round(fraction*this.maxRow));};
    this.scroller.addEventListener('pointerdown',event=>{this.scroller.setPointerCapture(event.pointerId);drag(event);});this.scroller.addEventListener('pointermove',event=>{if(this.scroller.hasPointerCapture(event.pointerId))drag(event);});
    this.overlay.addEventListener('contextmenu',event=>event.preventDefault());
    this.overlay.addEventListener('pointermove',event=>{this.cursor.style.left=`${event.clientX}px`;this.cursor.style.top=`${event.clientY}px`;this.tooltip.style.left=`${Math.min(innerWidth-180,event.clientX+14)}px`;this.tooltip.style.top=`${Math.min(innerHeight-32,event.clientY-24)}px`;});
    this.overlay.addEventListener('pointerdown',event=>{if(event.target===this.overlay){this.inventory.cursor=null;this.drawCursor();}});
    window.addEventListener('resize',()=>this.resize());this.resize();
  }
  static async create(assets:AssetManager){const response=await fetch(assetUrl('ui/assets.json'));if(!response.ok)throw new Error('UI素材を読み込めません。');return new Hud(assets,await response.json());}
  private slot(x:number,y:number){const button=document.createElement('button');button.className='inventory-slot';button.style.left=`${x}px`;button.style.top=`${y}px`;button.tabIndex=-1;button.addEventListener('pointerleave',()=>this.tooltip.hidden=true);this.panel.append(button);return button;}
  selectWorld(name:string){
    this.world=name;this.theme=this.data.themes[name.startsWith('tutorial')?'vanilla':name];this.icons.clear();this.catalog=this.theme.items;this.search.value='';this.row=0;
    this.hotbar.style.backgroundImage=`url("${assetUrl(this.theme.hotbar)}")`;this.panel.style.backgroundImage=`url("${assetUrl(this.theme.inventory)}")`;
    this.scroller.style.setProperty('--scroller',`url("${assetUrl(this.theme.scroller)}")`);
    (document.querySelector('.crosshair') as HTMLElement).style.backgroundImage=`url("${assetUrl(this.theme.crosshair)}")`;
    const crosshair=document.querySelector('.crosshair') as HTMLElement;crosshair.style.width=`${this.theme.crosshairSize[0]}px`;crosshair.style.height=`${this.theme.crosshairSize[1]}px`;
    let saved:unknown;try{saved=JSON.parse(localStorage.getItem(`hotbar:${name}`)??'null');}catch{/* storage may be unavailable */}
    this.inventory.load(saved,this.theme.items);this.drawHotbar();this.drawCatalog();this.setLegacy(this.legacy);
  }
  setLegacy(legacy:boolean){this.legacy=legacy;if(this.theme){this.selection.style.backgroundImage=`url("${assetUrl(legacy?this.theme.legacySelection:this.theme.selection)}")`;const [width,height]=legacy?this.theme.legacySelectionSize:this.theme.selectionSize;this.selection.style.width=`${width}px`;this.selection.style.height=`${height}px`;}}
  select(slot:number){this.inventory.select(slot);this.drawHotbar();}
  show(){this.open=true;this.overlay.hidden=false;document.body.classList.add('inventory-open');this.search.focus();this.drawCatalog();}
  hide(){this.open=false;this.overlay.hidden=true;document.body.classList.remove('inventory-open');this.inventory.cursor=null;this.drawCursor();this.tooltip.hidden=true;}
  key(event:KeyboardEvent){
    if(event.code==='Escape')return 'close';
    if(event.code==='KeyE'&&event.target!==this.search)return 'close';
    if(/^Digit[1-9]$/.test(event.code)&&event.target!==this.search){const slot=Number(event.code.slice(-1))-1;if(this.hovered){this.inventory.assign(this.hovered.id,slot);this.save();}this.select(slot);event.preventDefault();}
    return null;
  }
  private get maxRow(){return Math.max(0,Math.ceil(this.catalog.length/9)-5);}
  private scroll(row:number){this.row=Math.max(0,Math.min(this.maxRow,row));this.drawCatalog();this.hovered=null;this.tooltip.hidden=true;}
  private item(id:string|null){return id?this.theme?.items.find(item=>item.id===id):undefined;}
  private save(){try{localStorage.setItem(`hotbar:${this.world}`,JSON.stringify(this.inventory.hotbar));}catch{/* private mode */}}
  private resize(){const scale=Math.max(1,Math.min(4,Math.floor(innerWidth/320),Math.floor(innerHeight/240)));document.documentElement.style.setProperty('--gui-scale',String(scale));}
  private drawHotbar(){this.selection.style.left=`${this.inventory.selected*20-1}px`;for(let i=0;i<9;i++){const item=this.item(this.inventory.hotbar[i]);this.icon(this.bar[i],item);this.icon(this.slots[i],item);}this.drawCursor();}
  private drawCatalog(){for(let i=0;i<45;i++)this.icon(this.grid[i],this.catalog[this.row*9+i]);this.scroller.style.setProperty('--scroll-position',`${this.maxRow?this.row/this.maxRow*75:0}px`);this.scroller.setAttribute('aria-valuenow',String(this.row));this.scroller.setAttribute('aria-valuemax',String(this.maxRow));}
  private drawCursor(){this.cursor.hidden=!this.inventory.cursor;this.icon(this.cursor,this.item(this.inventory.cursor));}
  private showTooltip(item:InventoryItem|null){this.tooltip.hidden=!item||!!this.inventory.cursor;this.tooltip.textContent=item?.name??'';}
  private icon(element:HTMLElement,item?:InventoryItem){
    element.replaceChildren();element.dataset.item=item?.id??'';element.setAttribute('aria-label',item?.name??'空のスロット');if(!item)return;
    const sprite=document.createElement('span');sprite.className='item-icon';
    if(item.icon!==undefined){sprite.style.backgroundImage=`url("${assetUrl(this.theme.itemsTexture)}")`;sprite.style.backgroundSize=`${this.theme.itemColumns*16}px auto`;sprite.style.backgroundPosition=`${-item.icon%this.theme.itemColumns*16}px ${-Math.floor(item.icon/this.theme.itemColumns)*16}px`;}
    else if(item.block!==undefined)sprite.style.backgroundImage=`url("${this.blockIcon(item)}")`;
    element.append(sprite);
  }
  private blockIcon(item:InventoryItem){
    let icon=this.icons.get(item.id);if(icon)return icon;
    if(!this.iconRenderer){this.iconRenderer=new WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:true});this.iconRenderer.setSize(64,64);this.iconRenderer.outputColorSpace=SRGBColorSpace;this.iconRenderer.setClearColor(0,0);}
    const block=this.assets.manifest.blocks[item.block!],data=emptyMesh();for(const element of item.model?.elements??block.elements)appendElement(data,element,[0,0,0],{...block,rotation:[0,0,0]});
    const mesh=this.assets.mesh(data);mesh.material=this.material;mesh.position.set(-.5,-.5,-.5);
    const pose=new Group(),gui=item.model;pose.quaternion.setFromEuler(new Euler(...(gui?.rotation??[30,225,0]).map(n=>n*Math.PI/180) as [number,number,number],'XYZ'));pose.scale.set(...(gui?.scale??[.625,.625,.625]).map(n=>n/.625) as [number,number,number]);if(gui)pose.position.set(...gui.translation.map(n=>n/16) as [number,number,number]);pose.add(mesh);this.scene.add(pose);
    this.iconRenderer.render(this.scene,this.camera);icon=this.iconRenderer.domElement.toDataURL();this.scene.remove(pose);mesh.geometry.dispose();this.icons.set(item.id,icon);return icon;
  }
}
