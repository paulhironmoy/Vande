/** Pure parsing used by the Android harness; importing this module never connects to or changes a device. */

const DEGREES = new Set([0, 90, 180, 270]);
const QUARTER_TURNS = [0, 90, 180, 270];

function rotationToken(token) {
  const named = token.toUpperCase().startsWith('ROTATION_');
  const value = Number(token.replace(/^ROTATION_/i, ''));
  if (!Number.isInteger(value)) return null;
  if (named) return DEGREES.has(value) ? value : null;
  if (value >= 0 && value <= 3) return QUARTER_TURNS[value];
  return DEGREES.has(value) ? value : null;
}

/** Supports the named and numeric forms emitted across Android's window and input dumps. */
export function parseRotation(text) {
  for (const pattern of [
    /\bmCurrentRotation\s*=\s*(ROTATION_\d+|\d+)\b/i,
    /\bmRotation\s*=\s*(ROTATION_\d+|\d+)\b/i,
    /\bSurfaceOrientation\s*:\s*(ROTATION_\d+|\d+)\b/i,
  ]) {
    const match = pattern.exec(text);
    if (match) {
      const rotation = rotationToken(match[1]);
      if (rotation !== null) return rotation;
    }
  }
  return null;
}

function sizeMatch(text, label) {
  const match = new RegExp(`${label}\\s*:\\s*(\\d+)\\s*x\\s*(\\d+)`, 'i').exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** `adb shell wm size` reports both lines after an override; Android uses the override as the effective display size. */
export function parseWmSize(text) {
  const override = sizeMatch(text, 'Override size');
  if (override) return { ...override, source: 'override' };
  const physical = sizeMatch(text, 'Physical size');
  if (physical) return { ...physical, source: 'physical' };
  const raw = /\b(\d+)\s*x\s*(\d+)\b/i.exec(text);
  if (!raw) return null;
  const width = Number(raw[1]);
  const height = Number(raw[2]);
  return width > 0 && height > 0 ? { width, height, source: 'raw' } : null;
}
