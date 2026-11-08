/**
 * Deliberately unqualified Unity admission for hands-on Android inspection.
 *
 * This is not a release switch. It needs the platform's existing Unity build flag and an exact, separate preview
 * request. The normal renderer gate therefore remains fail closed, and neither Android nor web can enable this path
 * by setting the preview variable alone.
 */
import type { DeviceAssessment } from '@/contracts';

export const UNITY_PRACTICE_ENGINEERING_PREVIEW_LABEL =
  'UNITY ENGINEERING PREVIEW · NOT RELEASE QUALIFIED';
export const UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE = 'data-vande-unity-practice';
export const UNITY_PRACTICE_ENGINEERING_PREVIEW_VALUE = 'engineering-preview-unqualified';
export const UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID = 'vande-unity-engineering-preview';

export type UnityPracticeEngineeringPreviewReason =
  | 'explicit_preview'
  | 'benchmark_unavailable'
  | 'qualification_incomplete';

export interface UnityPracticeEngineeringPreviewBuildFlags {
  unityPracticeEnabled: boolean;
  request: string | undefined;
}

/** Exact two-key build admission. Values such as "true" are intentionally rejected. */
export function unityPracticeEngineeringPreviewEnabled(
  flags: UnityPracticeEngineeringPreviewBuildFlags = {
    unityPracticeEnabled: __UNITY_PRACTICE_ENABLED__,
    request: import.meta.env.VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW,
  },
): boolean {
  return flags.unityPracticeEnabled && flags.request === '1';
}

export interface UnityPracticeEngineeringPreviewAdmission {
  enabled: boolean;
  ownsInput: boolean;
  assessment: DeviceAssessment | null;
}

/**
 * The preview may bridge only the evidence gap it exists to inspect: no benchmark response, or otherwise playable
 * native renderer evidence whose native touch-to-visible latency is still unknown. An explicit Below result or an
 * assessment from another renderer still fails closed, even in preview.
 */
export function canRetainUnityPracticeEngineeringPreview(
  admission: UnityPracticeEngineeringPreviewAdmission,
): boolean {
  if (!admission.enabled || !admission.ownsInput) return false;
  const assessment = admission.assessment;
  if (!assessment) return true;
  return assessment.backend === 'unity' &&
    assessment.tier !== 'below' &&
    (assessment.inputToFrameMs === null || !Number.isFinite(assessment.inputToFrameMs));
}

/**
 * A conspicuous, testable runtime marker. The DOM badge is visible whenever React is in front; the root attribute
 * remains available to Android/WebView inspection while the native Unity view is in front.
 */
export function activateUnityPracticeEngineeringPreviewMarker(
  reason: UnityPracticeEngineeringPreviewReason,
  target: Document | null = typeof document === 'undefined' ? null : document,
): () => void {
  if (!target) return () => undefined;

  const root = target.documentElement;
  const previous = root.getAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE);
  root.setAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE, UNITY_PRACTICE_ENGINEERING_PREVIEW_VALUE);

  const existing = target.getElementById(UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID);
  const marker = existing ?? target.createElement('output');
  const created = existing === null;
  marker.id = UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID;
  marker.textContent = UNITY_PRACTICE_ENGINEERING_PREVIEW_LABEL;
  marker.setAttribute('data-reason', reason);
  marker.setAttribute('aria-label', UNITY_PRACTICE_ENGINEERING_PREVIEW_LABEL);
  marker.setAttribute(
    'style',
    'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 8px;border:1px solid #f2b94b;' +
      'border-radius:4px;background:#17140d;color:#fff4d6;font:700 11px/1.3 system-ui,sans-serif;' +
      'letter-spacing:.04em;pointer-events:none;',
  );
  if (created) target.body.append(marker);

  return () => {
    if (root.getAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE) === UNITY_PRACTICE_ENGINEERING_PREVIEW_VALUE) {
      if (previous === null) root.removeAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE);
      else root.setAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE, previous);
    }
    if (created) marker.remove();
  };
}
