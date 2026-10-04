export type Vec3 = [number, number, number];
export type FaceName = 'east' | 'west' | 'up' | 'down' | 'south' | 'north';
export const FACES: FaceName[] = ['east', 'west', 'up', 'down', 'south', 'north'];
export interface Tile { start: number; frames: number; ticks?: number; size?: [number,number]; key?:string }
export interface Element {
  from: Vec3;
  to: Vec3;
  faces: Partial<Record<FaceName, { tile: number; uv: [number, number, number, number]; tint?: boolean; cull?: FaceName; rotation?: number }>>;
  rotation?: { origin: Vec3; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  transform?: Vec3;
  uvlock?: boolean;
}
export interface Block {
  name: string;
  theme: string;
  solid: boolean;
  cube: boolean;
  occludes: boolean;
  transparent: boolean;
  fluid: boolean;
  fluidLevel?: number;
  fluidTiles?: number[];
  sturdyFaces?: number;
  emissive: number;
  tiles: number[];
  uvRotations: number[];
  tinted: boolean[];
  tint: number[];
  elements: Element[];
  rotation: Vec3;
  collision: { from: Vec3; to: Vec3 }[];
  light: number;
  opacity: number;
  state: string;
  particle?:number;
}
export interface Manifest {
  atlas: { size: number; cell: number; pixels: number; tiles: Tile[] };
  blocks: Block[];
  lookup: Record<string, number>;
  audio: Record<string, string | null>;
  effects: Record<string,string[]>;
  worlds: Record<string, WorldManifest>;
  missingTextures: string[];
  building?:Record<string,Record<string,number>>;
}
export interface WorldManifest {
  name: string; source: string; checksum: string;
  theme?:string;
  bounds: { min: Vec3; max: Vec3 };
  chunks: { file: string; voxels: string; origin: Vec3; quads: number }[];
  spawn: Vec3;
  yaw: number;
  blocks: number; quads: number; triangles: number;
  unsupported: string[];
  paintings?: number;
  environment?: {sky_color?:string;fog_color?:string;water_fog_color?:string;water_fog_distance?:number;sun:string;moon:string;clouds:string};
}
export interface MeshData {
  position: number[]; normal: number[]; uv: number[]; tile: number[];
  color: number[]; glow: number[]; light: number[]; index: number[];
}
