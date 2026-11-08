export const MIME: Record<string, string>;
export interface HeaderBlock {
  pattern: string;
  set: Array<[string, string]>;
  remove: string[];
}
export function parseHeaders(text: string): HeaderBlock[];
export function headersFor(blocks: HeaderBlock[], pathname: string): Map<string, { name: string; value: string }>;
export interface HeaderServer {
  port: number;
  origin: string;
  close(): Promise<void>;
}
export function startHeaderServer(options: {
  dir: string;
  port?: number;
  headersFile?: string;
  overrides?: string[];
  host?: string;
}): Promise<HeaderServer>;
