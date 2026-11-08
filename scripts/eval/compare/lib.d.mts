export interface ManifestValidationOptions {
  root?: string | null;
  verifyFiles?: boolean;
  verifyMedia?: boolean;
  mediaProbeDependencies?: MediaProbeDependencies;
}

export interface AnnotationValidationOptions {
  durationMs?: number | null;
  captureId?: string | null;
}

export interface MediaProbeIdentity {
  executable?: string;
  tool: 'ffprobe';
  version: string;
  executableSha256: string;
}

export interface MediaProbeObservation {
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  audioStreamCount: number;
  decodedAudioStreamCount: number;
  audioCoverage: Array<{
    index: number;
    decodedFrameCount: number;
    startUs: number | null;
    durationUs: number | null;
    endUs: number | null;
  }>;
  decodedFrameCount: number;
  durationUs: number;
  durationMs: number;
  frameRateSource: 'stream.avg_frame_rate' | 'stream.r_frame_rate';
  durationSource: 'ffmpeg.decoded_video_progress';
}

export interface MediaProbeRecord {
  path?: string;
  sha256: string;
  bytes: number;
  probe: {
    tool: 'ffprobe';
    version: string;
    executableSha256: string;
    arguments: string[];
  };
  decoder: {
    tool: 'ffmpeg';
    version: string;
    executableSha256: string;
    arguments: string[];
  };
  observation: MediaProbeObservation;
}

/** The bounded command runner (lib.mjs runBounded): what spawnSync returned for a command that was allowed to finish. */
export type BoundedRun = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number; encoding?: string; allowFailure?: boolean; env?: Record<string, string | undefined>; maxBuffer?: number },
) => { stdout: string; stderr?: string; status?: number | null };

export interface MediaProbeDependencies {
  run?: BoundedRun;
  identity?: MediaProbeIdentity | null;
  decoderIdentity?: (Omit<MediaProbeIdentity, 'tool'> & { tool: 'ffmpeg' }) | null;
}

export function canonicalJson(value: unknown, pretty?: boolean): string;
export function sha256Bytes(value: string | ArrayBufferView): string;
export function sha256File(file: string): string;
export function validateManifest(value: unknown, options?: ManifestValidationOptions): string[];
export function assertValidManifest<T>(value: T, options?: ManifestValidationOptions): T;
export function parseDecodedVideoProgress(stdout: string): { frameCount: number; durationUs: number };
export function parseMediaProbeObservation(stdout: string, decodedVideo: { frameCount: number; durationUs: number }): MediaProbeObservation;
export function probeMediaEvidence(file: string, dependencies?: MediaProbeDependencies): MediaProbeRecord;
export function verifyManifestMedia(manifest: unknown, root: string, dependencies?: MediaProbeDependencies): MediaProbeRecord[];
/** A validated capture manifest. Only the fields TypeScript callers read are named; the schema is validateManifest's. */
export interface CaptureManifest {
  captureId: string;
  files: Array<{ role: string; path: string; bytes: number; sha256: string; mimeType: string; raw: boolean; durationMs: number | null }>;
  [field: string]: unknown;
}

export function loadManifestEvidence(file: string, options?: ManifestValidationOptions): { manifest: CaptureManifest; mediaProbes: MediaProbeRecord[] };
export function loadManifest(file: string, options?: ManifestValidationOptions): CaptureManifest;
export function validateAnnotations(value: unknown, options?: AnnotationValidationOptions): string[];
export function assertValidAnnotations<T>(value: T, options?: AnnotationValidationOptions): T;
export function assertValidAnnotationsForManifest<T>(value: T, manifest: unknown, options?: { mediaProbes?: MediaProbeRecord[] | null }): T;
export function validateMetrics(value: unknown): string[];
export function assertValidMetrics<T>(value: T): T;
