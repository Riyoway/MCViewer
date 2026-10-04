import type { InventoryItem } from './types';

export class Inventory {
  readonly hotbar:(string|null)[]=Array(9).fill(null);selected=0;cursor:string|null=null;
  select(slot:number){this.selected=(slot%9+9)%9;}
  assign(item:string|null,slot=this.selected){if(slot>=0&&slot<9)this.hotbar[slot]=item;}
  swap(slot:number){const item=this.hotbar[slot];this.hotbar[slot]=this.cursor;this.cursor=item;}
  load(value:unknown,items:InventoryItem[]){
    this.hotbar.fill(null);this.cursor=null;
    if(!Array.isArray(value))return;
    const valid=new Set(items.map(item=>item.id));for(let i=0;i<9;i++)if(typeof value[i]==='string'&&valid.has(value[i]))this.hotbar[i]=value[i];
  }
}
export function filterItems(items:InventoryItem[],query:string){
  const text=query.trim().normalize('NFKC').toLocaleLowerCase();return items.filter(item=>`${item.name} ${item.id}`.normalize('NFKC').toLocaleLowerCase().includes(text));
}
