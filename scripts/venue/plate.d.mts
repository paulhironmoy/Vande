export const SIZES: Array<{ width: number; ceiling: number }>;
export const ZONES: Record<string, { rect: number[]; limit: number; feather: number }>;
export const REFERENCE: number[][];
export function energy(rgb: Uint8Array, w: number, h: number, rect: number[]): number;
export function referenceEnergy(rgb: Uint8Array, w: number, h: number): number;
export function makePlate(inputPath: string, outDir: string, name: string): Promise<{ plates: Array<Record<string, unknown>> }>;
