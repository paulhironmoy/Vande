export interface UnityArtifactRecord {
  url: string;
  sha256: string;
}

export interface UnityWebGlManifest {
  buildId: string;
  unitySourceSha256: string;
  unityVersion: string;
  productVersion: string;
  loader: UnityArtifactRecord;
  data: UnityArtifactRecord;
  framework: UnityArtifactRecord;
  code: UnityArtifactRecord;
  streamingAssetsUrl: string;
}

export function validateUnityPayloadStructure(root: string, manifest: UnityWebGlManifest): Record<string, unknown>;
export function verifyTrustedUnityExport(
  root: string,
  manifest: UnityWebGlManifest,
  options?: {
    expectedBuildId?: string;
    expectedSourceSha256?: string;
  },
): Record<string, unknown>;

export const UNITY_EXPORT_TRUST_POLICY: Readonly<{
  receiptName: string;
  signatureName: string;
  trustFile: string;
  trustFileSha256: string;
  exporterFile: string;
}>;
