import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAssessment } from '@/contracts';
import {
  UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE,
  UNITY_PRACTICE_ENGINEERING_PREVIEW_LABEL,
  UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID,
  UNITY_PRACTICE_ENGINEERING_PREVIEW_VALUE,
  activateUnityPracticeEngineeringPreviewMarker,
  canRetainUnityPracticeEngineeringPreview,
  unityPracticeEngineeringPreviewEnabled,
} from '@/practice/unity/engineeringPreview';

const assessment = (overrides: Partial<DeviceAssessment> = {}): DeviceAssessment => ({
  backend: 'unity',
  webgl2: false,
  hardware: true,
  renderer: 'Vulkan',
  shaderCompileMs: 2,
  avgFps: 60,
  p95FrameMs: 17,
  spikes: 0,
  contextLosses: 0,
  inputToFrameMs: null,
  memoryGb: 6,
  tier: 'full',
  profile: 'standard',
  reasons: ['ok'],
  toleranceMs: 0,
  ...overrides,
});

afterEach(() => {
  document.getElementById(UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID)?.remove();
  document.documentElement.removeAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE);
});

describe('Unity Practice engineering-preview admission', () => {
  it('requires both the Android Unity build and the exact preview value', () => {
    expect(unityPracticeEngineeringPreviewEnabled({ unityPracticeEnabled: true, request: '1' })).toBe(true);
    expect(unityPracticeEngineeringPreviewEnabled({ unityPracticeEnabled: false, request: '1' })).toBe(false);
    expect(unityPracticeEngineeringPreviewEnabled({ unityPracticeEnabled: true, request: 'true' })).toBe(false);
    expect(unityPracticeEngineeringPreviewEnabled({ unityPracticeEnabled: true, request: undefined })).toBe(false);
  });

  it('bridges only unavailable or incomplete native evidence, never an explicit rejection', () => {
    const base = { enabled: true, ownsInput: true };
    expect(canRetainUnityPracticeEngineeringPreview({ ...base, assessment: null })).toBe(true);
    expect(canRetainUnityPracticeEngineeringPreview({ ...base, assessment: assessment() })).toBe(true);
    expect(canRetainUnityPracticeEngineeringPreview({ ...base, assessment: assessment({ inputToFrameMs: 42 }) })).toBe(false);
    expect(canRetainUnityPracticeEngineeringPreview({ ...base, assessment: assessment({ tier: 'below' }) })).toBe(false);
    expect(canRetainUnityPracticeEngineeringPreview({ ...base, assessment: assessment({ backend: 'webgl2' }) })).toBe(false);
    expect(canRetainUnityPracticeEngineeringPreview({ enabled: false, ownsInput: true, assessment: null })).toBe(false);
    expect(canRetainUnityPracticeEngineeringPreview({ enabled: true, ownsInput: false, assessment: null })).toBe(false);
  });

  it('marks the runtime as unqualified and removes only its own marker on release', () => {
    const clear = activateUnityPracticeEngineeringPreviewMarker('qualification_incomplete', document);
    expect(document.documentElement.getAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE))
      .toBe(UNITY_PRACTICE_ENGINEERING_PREVIEW_VALUE);
    const marker = document.getElementById(UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID);
    expect(marker?.textContent).toBe(UNITY_PRACTICE_ENGINEERING_PREVIEW_LABEL);
    expect(marker?.getAttribute('data-reason')).toBe('qualification_incomplete');

    clear();
    expect(document.documentElement.hasAttribute(UNITY_PRACTICE_ENGINEERING_PREVIEW_ATTRIBUTE)).toBe(false);
    expect(document.getElementById(UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID)).toBeNull();
  });
});
