export interface WedgeLod {
  triangles: number;
  vertices: number;
  pos: number[];
  uv: number[];
  tier: number[];
  col: number[];
  idx: number[];
}
export interface WedgeJson {
  version: number;
  generator?: string;
  blender?: string;
  constants: {
    boundaryR: number;
    wedgeRad: number;
    wedges: number;
    tiers: Record<string, { r0: number; r1: number; y0: number; y1: number; rows: number }>;
    roof: { rInner: number; rOuter: number; y: number; h: number };
    backWall: { r: number; y0: number; y1: number };
    parapet: { r: number; y0: number; y1: number };
  };
  atlas: { w: number; h: number; variants: number; whiteUv: number[]; tiles: Record<string, number[][]> };
  lods: WedgeLod[];
}
export interface PackSpec {
  file: string;
  lods: number[];
  atlasWidth: number;
}
export const REPO_ROOT: string;
export const WEDGE_JSON: string;
export const PACK_DIR: string;
export const POSITION_UNITS: number;
export const PACKS: PackSpec[];
export function buildGlb(wedge: WedgeJson, lods: number[], atlasWebp: Uint8Array, atlasSize: number[]): Buffer;
export function atlasWebp(wedge: WedgeJson, width: number): Promise<{ webp: Buffer; size: number[] }>;
export function buildPack(wedge: WedgeJson, pack: PackSpec): Promise<Buffer>;
