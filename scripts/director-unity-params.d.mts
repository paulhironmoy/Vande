export const WEB_PARAMS: string;
export const UNITY_PARAMS_COPY: string;
export const UNITY_GENERATED: string;
export function fnv1a32Bytes(bytes: ArrayLike<number>): number;
export function generateDirectorParams(jsonText: string): string;
export function expectedFiles(root?: string): { params: string; generated: string };
export function staleFiles(root?: string): string[];
