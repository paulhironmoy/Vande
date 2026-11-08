export type RotationDegrees = 0 | 90 | 180 | 270;
export interface AndroidDisplaySize {
  width: number;
  height: number;
  source: 'override' | 'physical' | 'raw';
}
export function parseRotation(text: string): RotationDegrees | null;
export function parseWmSize(text: string): AndroidDisplaySize | null;
