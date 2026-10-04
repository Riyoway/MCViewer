import type {Block,Manifest,Vec3} from './types';
import type {BlockHit} from './Target';
import {directions,opposite,properties,replaceable,stateId} from './BlockState';
import {Voxels} from './Voxels';
import {HEIGHT,RADIUS} from '../core/Collision';

export type BlockChange={position:Vec3;id:number};
const left:Record<string,string>={north:'west',west:'south',south:'east',east:'north'};
export function horizontalFacing(direction:Vec3){return Math.abs(direction[0])>Math.abs(direction[2])?direction[0]>0?'east':'west':direction[2]>0?'south':'north';}
export class Building {
  constructor(readonly voxels:Voxels,readonly manifest:Manifest,readonly theme:string,readonly valid:(p:Vec3)=>boolean){}
  private block(p:Vec3){return this.manifest.blocks[this.voxels.get(...p)];}
  private next(p:Vec3,face:string){return p.map((n,i)=>n+directions[face][i]) as Vec3;}
  private sturdy(p:Vec3,face:string){const b=this.block(p);return !!b&&!!((b.sturdyFaces??0)&(1<<['east','west','up','down','south','north'].indexOf(face)));}
  place(item:string,hit:BlockHit,direction:Vec3,player:Vec3):BlockChange[]|null{
    const baseId=this.manifest.building?.[this.theme]?.[item],base=this.manifest.blocks[baseId??0];if(!base)return null;
    let position=replaceable(this.block(hit.position))?[...hit.position] as Vec3:this.next(hit.position,hit.face),props=properties(base);
    const target=this.block(hit.position),p=target&&properties(target),sameSlab=target?.name===base.name&&base.name.endsWith('_slab')&&p?.type!=='double';
    if(sameSlab&&(p!.type==='bottom'&&hit.face==='up'||p!.type==='top'&&hit.face==='down')){position=[...hit.position];props.type='double';}
    else {
      const adjacent=this.block(position),a=adjacent&&properties(adjacent);
      if(adjacent?.name===base.name&&base.name.endsWith('_slab')&&a?.type!=='double')props.type='double';
      else if(!replaceable(adjacent))return null;
    }
    const forward=horizontalFacing(direction);
    if('waterlogged' in props)props.waterlogged=String(this.block(position)?.name==='water'&&(this.block(position)?.fluidLevel??0)===0);
    if('axis' in props)props.axis=hit.face==='up'||hit.face==='down'?'y':hit.face==='east'||hit.face==='west'?'x':'z';
    if('facing' in props)props.facing=base.name.endsWith('_stairs')||base.name.endsWith('_door')||base.name.endsWith('_bed')||base.name.endsWith('_fence_gate')?forward:opposite[forward];
    if(/^(piston|sticky_piston|observer|dispenser|dropper|end_rod)$/.test(base.name)&&Math.abs(direction[1])>Math.max(Math.abs(direction[0]),Math.abs(direction[2])))props.facing=direction[1]>0?'down':'up';
    if(base.name.endsWith('_stairs')||base.name.endsWith('_trapdoor'))props.half=hit.face==='down'||hit.face!=='up'&&hit.point[1]-Math.floor(hit.point[1])>.5?'top':'bottom';
    if(base.name.endsWith('_slab')&&props.type!=='double')props.type=hit.face==='down'||hit.face!=='up'&&hit.point[1]-Math.floor(hit.point[1])>.5?'top':'bottom';
    let chosen=base;
    if(/^(torch|redstone_torch|soul_torch)$/.test(base.name)&&hit.face!=='up'){
      if(hit.face==='down')return null;
      const name=base.name.replace('torch','wall_torch'),id=this.manifest.lookup[`${this.theme}:${name}`]??this.manifest.blocks.findIndex(b=>b?.theme===this.theme&&b.name===name);
      chosen=this.manifest.blocks[id];if(!chosen)return null;props={...properties(chosen),facing:hit.face};
    }
    if(base.name==='ladder'||base.name.endsWith('_wall_sign')){if(hit.face==='up'||hit.face==='down')return null;props.facing=hit.face;}
    if('face' in props){props.face=hit.face==='up'?'floor':hit.face==='down'?'ceiling':'wall';if(props.face==='wall')props.facing=hit.face;}
    if('rotation' in props){const yaw=Math.atan2(-direction[0],direction[2]);props.rotation=String((Math.floor(yaw*8/Math.PI+.5)+16)%16);}
    if(base.name.endsWith('_door')){
      props.half='lower';props.open='false';props.powered='false';
      const L=this.next(position,left[forward]),R=this.next(position,opposite[left[forward]]);
      const obstruction=(q:Vec3)=>Number(!!this.block(q)?.occludes)+Number(!!this.block(this.next(q,'up'))?.occludes);
      const side=directions[left[forward]],offset=hit.point.map((n,i)=>n-Math.floor(n)-.5);
      props.hinge=this.block(L)?.name===base.name||obstruction(L)>obstruction(R)?'right':this.block(R)?.name===base.name||obstruction(R)>obstruction(L)?'left':offset[0]*side[0]+offset[2]*side[2]>0?'right':'left';
      if(!this.sturdy(this.next(position,'down'),'up')||!replaceable(this.block(this.next(position,'up'))))return null;
    }
    if(base.name.endsWith('_bed')){props.part='foot';props.occupied='false';if(!replaceable(this.block(this.next(position,forward)))||!this.sturdy(this.next(position,'down'),'up')||!this.sturdy(this.next(this.next(position,forward),'down'),'up'))return null;}
    if(/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony)$/.test(base.name)){props.half='lower';if(!replaceable(this.block(this.next(position,'up'))))return null;}
    // Wall attachments need the clicked supporting face, rather than floating in air.
    if(chosen.name.includes('wall_torch')||base.name==='ladder'||props.face==='wall')if(!this.sturdy(this.next(position,opposite[hit.face]),hit.face))return null;
    if(chosen.name.endsWith('torch')&&!chosen.name.includes('wall'))if(!this.sturdy(this.next(position,'down'),'up'))return null;
    if(/rail$|_carpet$|_pressure_plate$|^redstone_wire$|^repeater$|^comparator$/.test(base.name)&&!this.sturdy(this.next(position,'down'),'up'))return null;
    if(/_sapling$|^short_grass$|^fern$|^dandelion$|^poppy$|^sunflower$|^lilac$|^rose_bush$|^peony$|^tall_grass$|^large_fern$/.test(base.name)&&!/^grass_block$|^dirt$|^coarse_dirt$|^podzol$|^farmland$|^rooted_dirt$|^moss_block$/.test(this.block(this.next(position,'down'))?.name??''))return null;
    const id=stateId(this.manifest,chosen,props);if(!id)return null;
    const changes:BlockChange[]=[{position,id}];
    if(base.name.endsWith('_door')){const upper=stateId(this.manifest,base,{...props,half:'upper'});if(!upper)return null;changes.push({position:this.next(position,'up'),id:upper});}
    if(base.name.endsWith('_bed')){const head=stateId(this.manifest,base,{...props,part:'head'});if(!head)return null;changes.push({position:this.next(position,forward),id:head});}
    if(props.half==='lower'&&/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony)$/.test(base.name)){const upper=stateId(this.manifest,base,{...props,half:'upper'});if(!upper)return null;changes.push({position:this.next(position,'up'),id:upper});}
    const min=player.map((n,i)=>n-(i===1?0:RADIUS)),max=player.map((n,i)=>n+(i===1?HEIGHT:RADIUS));
    for(const change of changes){if(!this.valid(change.position))return null;const block=this.manifest.blocks[change.id];if(block.solid)for(const box of block.collision)if(min.every((n,i)=>n<change.position[i]+box.to[i]-1e-6)&&max.every((n,i)=>n>change.position[i]+box.from[i]+1e-6))return null;}
    return changes;
  }
  destroy(hit:BlockHit):BlockChange[]{
    const block=this.manifest.blocks[hit.id];if(!block||block.fluid||!this.valid(hit.position))return [];
    const props=properties(block),water=props.waterlogged==='true'?this.manifest.lookup[`${block.theme}:water[level=0]`]??0:0,changes:BlockChange[]=[{position:hit.position,id:water}];
    let other:Vec3|undefined;
    if(block.name.endsWith('_door')||/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony)$/.test(block.name))other=this.next(hit.position,props.half==='upper'?'down':'up');
    if(block.name.endsWith('_bed'))other=this.next(hit.position,props.part==='head'?opposite[props.facing]:props.facing);
    if(other&&this.block(other)?.name===block.name&&this.valid(other))changes.push({position:other,id:0});
    return changes;
  }
  neighbors(position:Vec3):BlockChange[]{
    const changes:BlockChange[]=[];
    for(const p of [position,...Object.keys(directions).map(face=>this.next(position,face))]){
      const block=this.block(p);if(!block||!this.valid(p))continue;const props=properties(block),name=block.name;
      if(name.endsWith('_fence')||name.endsWith('_pane')||name==='iron_bars'||name.endsWith('_wall')){
        for(const face of ['east','west','south','north']){
          const q=this.next(p,face),neighbor=this.block(q),n=neighbor?.name??'';
          const exception=/_leaves$|shulker_box$/.test(n)||['barrier','pumpkin','carved_pumpkin','jack_o_lantern','melon'].includes(n);
          const same=name.endsWith('_fence')?n.endsWith('_fence')&&(name==='nether_brick_fence')===(n==='nether_brick_fence'):name.endsWith('_wall')?n.endsWith('_wall'):n.endsWith('_pane')||n==='iron_bars';
          const gate=n.endsWith('_fence_gate')&&(directions[face][0]!==0?/facing=(north|south)/.test(neighbor!.state):/facing=(east|west)/.test(neighbor!.state));
          const connected=same||gate||!exception&&this.sturdy(q,opposite[face]);
          props[face]=name.endsWith('_wall')?connected?this.block(this.next(p,'up'))?.occludes?'tall':'low':'none':String(connected);
        }
        if(name.endsWith('_wall'))props.up=String(this.block(this.next(p,'up'))?.occludes||!(props.east!=='none'&&props.west!=='none'&&props.north==='none'&&props.south==='none'||props.north!=='none'&&props.south!=='none'&&props.east==='none'&&props.west==='none'));
      }
      if(name.endsWith('_stairs')){
        props.shape='straight';const same=(b?:Block)=>b?.name.endsWith('_stairs')&&properties(b).half===props.half;
        const canTurn=(face:string)=>{const other=this.block(this.next(p,face));return !same(other)||properties(other!).facing!==props.facing;};
        const front=this.block(this.next(p,props.facing)),back=this.block(this.next(p,opposite[props.facing]));
        if(same(front)){const f=properties(front!).facing;if(directions[f][0]!==directions[props.facing][0]&&directions[f][2]!==directions[props.facing][2]&&canTurn(opposite[f]))props.shape=f===left[props.facing]?'outer_left':'outer_right';}
        if(props.shape==='straight'&&same(back)){const f=properties(back!).facing;if(directions[f][0]!==directions[props.facing][0]&&directions[f][2]!==directions[props.facing][2]&&canTurn(f))props.shape=f===left[props.facing]?'inner_left':'inner_right';}
      }
      const id=stateId(this.manifest,block,props);if(id&&id!==this.voxels.get(...p))changes.push({position:p,id});
      // Remove unsupported attachments after their supporting block is destroyed.
      const support=props.face==='ceiling'?'up':props.face==='wall'||name.includes('wall_torch')||name==='ladder'?opposite[props.facing]:'down';
      if(/torch$|_button$|^ladder$|^lever$/.test(name)&&!this.sturdy(this.next(p,support),opposite[support]))changes.push({position:p,id:0});
      if(/rail$|_carpet$|_pressure_plate$|^redstone_wire$|^repeater$|^comparator$/.test(name)&&!this.sturdy(this.next(p,'down'),'up'))changes.push({position:p,id:0});
      const tall=/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony)$/.test(name),plant=tall||/_sapling$|^short_grass$|^fern$|^dandelion$|^poppy$/.test(name);
      if(plant){const below=this.block(this.next(p,'down')),above=this.block(this.next(p,'up'));if(tall&&props.half==='upper'?below?.name!==name:!/^grass_block$|^dirt$|^coarse_dirt$|^podzol$|^farmland$|^rooted_dirt$|^moss_block$/.test(below?.name??'')||tall&&above?.name!==name)changes.push({position:p,id:0});}
      if(name.endsWith('_door')&&(props.half==='upper'?this.block(this.next(p,'down'))?.name!==name:this.block(this.next(p,'up'))?.name!==name||!this.sturdy(this.next(p,'down'),'up')))changes.push({position:p,id:0});
    }
    return changes;
  }
}
