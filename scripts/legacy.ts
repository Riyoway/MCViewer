import minecraftData from 'minecraft-data';
import type { State } from './anvil.ts';
export function legacyState(id: number, meta: number): State {
  const value = minecraftData.legacy.pc.blocks[`${id}:${meta}`] ?? minecraftData.legacy.pc.blocks[`${id}:0`] ?? 'minecraft:air';
  const [name, properties] = value.replace(/\]$/, '').split('[');
  return { Name: name === 'minecraft:grass' ? 'minecraft:short_grass' : name,
    Properties: properties ? Object.fromEntries(properties.split(',').map(p => p.split('='))) : {} };
}
export function doorHalves(lower:State,upper:State):[State,State] {
  const properties={...lower.Properties,hinge:upper.Properties?.hinge??'left',powered:upper.Properties?.powered??'false'};
  return ['lower','upper'].map(half=>({Name:lower.Name,Properties:{...properties,half}})) as [State,State];
}
