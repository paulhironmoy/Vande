import type { WedgeJson } from './pack.mjs';
export function mulberry32(seed: number): () => number;
export function paintAtlas(
  wedge: WedgeJson,
  opt?: { width?: number; seed?: number },
): { width: number; height: number; rgba: Uint8Array };
