import type { Element,Vec3 } from '../minecraft/types';
export interface InventoryItem {id:string;name:string;icon?:number;block?:number;model?:{elements:Element[];rotation:Vec3;translation:Vec3;scale:Vec3}}
export interface UITheme {
  hotbar:string;selection:string;legacySelection:string;crosshair:string;inventory:string;scroller:string;itemsTexture:string;particles:string;
  selectionSize:[number,number];legacySelectionSize:[number,number];crosshairSize:[number,number];
  itemColumns:number;items:InventoryItem[];
}
export interface UIAssets {themes:Record<string,UITheme>}
