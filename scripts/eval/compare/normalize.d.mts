export interface MediaObservation {
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  durationMs: number;
  frameRateSource: 'stream.avg_frame_rate' | 'stream.r_frame_rate';
  durationSource: 'format.duration' | 'stream.duration';
}

export interface NormalizePlan {
  inputSha256: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string;
  crf: number;
  filters: string[];
  extension: string;
  ffmpegArgs: string[];
}

export interface NormalizedManifest extends Record<string, unknown> {
  identity: { artifact: unknown; [key: string]: unknown };
  timing: { durationMs: number; [key: string]: unknown };
  capture: {
    resolution: { width: number; height: number };
    frameRate: number;
    codec: string;
    [key: string]: unknown;
  };
  files: Array<Record<string, unknown>>;
  transformations: Array<Record<string, unknown>>;
}

export interface NormalizeManifestOptions extends Record<string, unknown> {
  parentManifestName: string;
  parentManifestSha256: string;
  parentManifestBytes?: number;
  outputRecord: Record<string, unknown>;
  identityArtifactRecord?: Record<string, unknown> | null;
  plan: NormalizePlan;
  evaluator: string;
  observedOutput?: MediaObservation | Record<string, unknown>;
}

export function parseFfprobeObservation(stdout: string): MediaObservation;
export function probeNormalizedMedia(
  file: string,
  dependencies?: {
    available?: (command: string) => boolean;
    run?: (...args: unknown[]) => { stdout: string };
  },
): MediaObservation;
export function normalizePlan(options: Record<string, unknown>, inputRecord: { sha256: string }): NormalizePlan;
export function normalizeManifest(parent: Record<string, unknown>, options: NormalizeManifestOptions): NormalizedManifest;
export function normalize(options: Record<string, unknown>): Promise<Record<string, unknown>>;

