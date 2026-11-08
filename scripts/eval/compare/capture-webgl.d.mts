export interface WebGlAvailability {
  available: boolean;
  status: 'AVAILABLE_FOR_RUNTIME_CAPTURE' | 'NOT_AVAILABLE';
  reason: string | null;
  buildId: string | null;
  unityVersion: string | null;
  unitySourceSha256: string | null;
  artifactCount: number;
  hostArtifactCount: number;
  hostedUnityArtifactCount: number;
  exporterReceiptSha256?: string;
}

export interface WebGlCaptureResult {
  ok: boolean;
  status: string;
  reason?: string;
  output: string;
  manifest: string;
  availability?: WebGlAvailability;
  errors?: string[];
}

export function assessWebGlAvailability(options: {
  exportRoot: string;
  hostRoot: string | null;
  projectRoot: string;
  sourceId: string;
}): WebGlAvailability;

export function captureWebGl(options: Record<string, unknown>): Promise<WebGlCaptureResult>;
