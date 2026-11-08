export interface WebCaptureResult {
  ok: boolean;
  status: string;
  output: string;
  manifest: string;
  errors: string[];
}

export interface WebArtifactInventory {
  root: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface UnityHostArtifactBindingFile {
  exportPath: string;
  hostPath: string;
  bytes: number;
  sha256: string;
}

export interface UnityHostArtifactBinding {
  schemaVersion: 1;
  hostPrefix: 'unity/';
  hostArtifactRoot: string;
  unityExportRoot: string;
  fileCount: number;
  files: UnityHostArtifactBindingFile[];
}

export interface RuntimeUnitySurfaceEvidence {
  present: boolean;
  connected: boolean;
  renderer: string | null;
  visible: boolean;
  pointerEnabled: boolean;
  hitTest: boolean;
  inputReady: boolean;
  bridgeOperationActive: boolean;
  viewportCoverage: number;
  opacity: string | null;
  pointerEvents: string | null;
  elementToken: string | null;
}

export type RuntimeInputOwner = 'unity-webgl-canvas' | 'react-gesture-surface' | 'conflict' | null;

export interface RuntimePresentationState {
  atPerfMs?: number;
  path?: string;
  screen: string | null;
  phase: string | null;
  renderer: string | null;
  admission: string | null;
  armed: boolean;
  reactInputArmed: boolean;
  inputOwner: RuntimeInputOwner;
  unitySurface: RuntimeUnitySurfaceEvidence;
  score?: string | null;
  result: boolean;
  outcome?: string | null;
  swing?: 'attack' | 'defend' | 'leave' | null;
}

export interface RuntimeIdentityWatchEvidence {
  startedAtPerfMs: number;
  finishedAtPerfMs: number;
  baseline: { renderer: string | null; admission: string | null };
  final: { renderer: string | null; admission: string | null };
  transitions: Array<{
    atPerfMs: number;
    attribute: 'data-vande-practice-renderer' | 'data-vande-unity-practice';
    oldValue: string | null;
    currentValue: string | null;
  }>;
  canvas: {
    id: 'vande-unity-practice-canvas';
    elementToken: string;
    baseline: { connected: boolean; unique: boolean; renderer: string | null };
    final: { connected: boolean; sameElement: boolean; unique: boolean; renderer: string | null };
    rendererTransitions: Array<{
      atPerfMs: number;
      oldValue: string | null;
      currentValue: string | null;
    }>;
    childListTransitions: Array<{
      atPerfMs: number;
      removedLatched: boolean;
      addedLatched: boolean;
      addedReplacement: boolean;
      currentMatchesLatched: boolean;
      latchedConnected: boolean;
    }>;
  };
}

export interface RuntimeIdentityWatchStart {
  ownershipValidated: boolean;
  armedState: RuntimePresentationState;
  watchStart: {
    startedAtPerfMs: number;
    baseline: { renderer: string | null; admission: string | null };
    canvas: {
      id: 'vande-unity-practice-canvas';
      elementToken: string;
      baseline: { connected: boolean; unique: boolean; renderer: string | null };
    };
  } | null;
  error: string | null;
}

export interface RuntimePresentationContinuity {
  schemaVersion: 1;
  renderer: string;
  admission: string | null;
  armedInputOwner: RuntimeInputOwner;
  armedUnitySurface: RuntimeUnitySurfaceEvidence | null;
  resultRenderer: string;
  resultAdmission: string | null;
  resultUnitySurface: RuntimeUnitySurfaceEvidence | null;
  identityWatch: RuntimeIdentityWatchEvidence;
  proof: string;
}

export interface RuntimeArtifactResponse {
  request(): { redirectedFrom(): unknown; redirectedTo(): unknown };
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Uint8Array>;
}

export const WEB_CAPTURE_BINDING_POLICY: Readonly<{
  serviceWorkers: 'block';
  redirects: 'reject';
  partialResponses: 'reject';
  unboundRequests: 'reject';
  webSockets: 'reject';
  queries: 'reject';
  auxiliaryPages: 'reject';
  dedicatedWorkers: 'reject';
  downloads: 'reject';
}>;
export const UNITY_WEBGL_HOST_PREFIX: 'unity/';
export const UNITY_WEBGL_ADMISSION_VALUE: 'engineering-preview-unqualified';
export function artifactInventory(
  root: string,
  options?: Readonly<{ requireIndex?: boolean }>,
): WebArtifactInventory;
export function artifactPathsForBinding(inventory: WebArtifactInventory): string[];
export function verifyUnityHostArtifactBinding(
  hostInventory: WebArtifactInventory,
  unityExportRoot: string,
  verifiedUnityFiles: ReadonlyMap<string, string>,
): UnityHostArtifactBinding;
export function assertRuntimePresentationContinuity(
  expectedRenderer: string,
  armedState: RuntimePresentationState,
  resultState: RuntimePresentationState,
  identityWatch: RuntimeIdentityWatchEvidence,
): RuntimePresentationContinuity;
export function assertAtomicRuntimeWatchStart(
  expectedRenderer: string,
  atomicStart: RuntimeIdentityWatchStart,
): { armed: RuntimePresentationState; watchStart: NonNullable<RuntimeIdentityWatchStart['watchStart']> };
export function assertCapturedKeyboardAction(
  action: string,
  resultState: RuntimePresentationState,
): { action: string; expectedSwing: 'attack' | 'defend'; observedSwing: 'attack' | 'defend' };
export function canonicalArtifactBase(base: string): string;
export function runtimeArtifactIdentity(requestUrl: string, base: string, inventory: WebArtifactInventory): { path: string; requestUrl: string; query: '' };
export function runtimeArtifactPath(requestUrl: string, base: string, inventory: WebArtifactInventory): string;
export function verifyRuntimeArtifactResponse(response: RuntimeArtifactResponse, base: string, inventory: WebArtifactInventory): Promise<{ path: string; requestUrl: string; query: ''; sha256: string; bytes: number; status: number }>;
export function captureWeb(options: Record<string, unknown>): Promise<WebCaptureResult>;
