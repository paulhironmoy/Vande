/**
 * The release meter rules. Local copy of the engine's METER (keeps the engine out of the design system); engine-using
 * screens register the engine's own rules and grader (src/screens/engineRules.ts). Tests assert they match.
 */
import type { ExecutionGrade, InputTrace } from '@/contracts';

export interface MeterRules {
  fillMs: number;
  sweetMs: number;
  falloffMs: number;
  perfectQuality: number;
  goodQuality: number;
  minHoldMs: number;
  maxHoldMs: number;
}

export const LOCAL_METER: MeterRules = { fillMs: 1000, sweetMs: 800, falloffMs: 160, perfectQuality: 0.85, goodQuality: 0.5, minHoldMs: 40, maxHoldMs: 1500 };

type Grader = (trace: InputTrace) => { ok: true; quality: number; grade: ExecutionGrade } | { ok: false; errors: string[] };
let registered: { rules?: MeterRules; grade?: Grader } = {};

export function registerMeterRules(r: { rules?: MeterRules; grade?: Grader }) {
  registered = r;
}

export function meterRules(): MeterRules {
  return registered.rules ?? LOCAL_METER;
}

/** Local preview of the grade a release would earn (the server re-derives it from the trace). */
export function previewGrade(trace: InputTrace): { quality: number; grade: ExecutionGrade } | null {
  if (registered.grade) {
    try {
      const r = registered.grade(trace);
      return r.ok ? { quality: r.quality, grade: r.grade } : null;
    } catch {
      /* fall through to the local formula */
    }
  }
  const rules = meterRules();
  const s = trace.samples;
  if (s.length < 2) return null;
  const release = s[s.length - 1][0];
  const q = Math.max(0, Math.min(1, 1 - Math.abs(release - rules.sweetMs) / rules.falloffMs));
  return { quality: q, grade: q >= rules.perfectQuality ? 'perfect' : q >= rules.goodQuality ? 'good' : 'loose' };
}
