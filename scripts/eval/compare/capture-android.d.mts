export interface AndroidIdentityOptions {
  sourceId: string;
  serial: string;
  renderer: string;
  trusted?: unknown;
}

export interface ArtifactHashObservation {
  path: string;
  sha256: string | null;
}

export interface LocalArtifactObservation {
  remotePath: string;
  sha256: string;
}

export interface AndroidOsIdentity {
  release?: string | null;
  api?: string | null;
  buildFingerprint?: string | null;
  securityPatch?: string | null;
  buildId?: string | null;
}

export function canonicalAndroidOs(device: AndroidOsIdentity | null | undefined): string | null;
export function canonicalAdbCapturePerturbations(): string[];
export function extractBuildIdsFromText(text: string): string[];
export function validateAndroidIdentityEvidence(value: unknown, options: AndroidIdentityOptions): string[];
export function validateArtifactHashWindow(
  before: ArtifactHashObservation[],
  after: ArtifactHashObservation[],
  localInventory: LocalArtifactObservation[],
): string[];
export function captureAndroid(options: Record<string, unknown>): Promise<Record<string, unknown>>;
export function captureControlledCompetitor(options: Record<string, unknown>): Promise<Record<string, unknown>>;
