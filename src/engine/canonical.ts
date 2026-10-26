/**
 * Canonical plan JSON and commit hashes. FROZEN PRIMITIVE shared by every engine version.
 *
 * Canonical form: only the known plan fields (unknown keys are dropped), object keys sorted by UTF-16 code units, no
 * whitespace, numbers in ECMAScript shortest round-trip form (exactly what JSON.stringify prints). The commit hash is
 * `SHA-256(canonicalPlan(plan) + salt)` as lowercase hex, computed with WebCrypto (`globalThis.crypto.subtle`, present
 * in browsers, Workers and Node 20+) and with the bundled synchronous SHA-256 where WebCrypto is unavailable.
 */
import type { DeliveryPlan, InputTrace, OverPlan } from '@/contracts';
import { sha256Hex, utf8 } from './sha256';

/** Deterministic JSON: sorted keys, no whitespace. Throws on non-finite numbers. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value}`);
  }
}

function pickTrace(t: InputTrace): InputTrace {
  if (!t || typeof t !== 'object') return t;
  const samples = Array.isArray(t.samples) ? t.samples.map((s) => (Array.isArray(s) ? ([s[0], s[1], s[2]] as [number, number, number]) : s)) : t.samples;
  return { pointer: t.pointer, samples };
}

function pickDelivery(d: DeliveryPlan): DeliveryPlan {
  if (!d || typeof d !== 'object') return d;
  return { variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: d.intent, gesture: pickTrace(d.gesture) };
}

/** Copy of a plan with only the known fields (the form that is hashed, stored and replayed). */
export function normalizePlan(plan: OverPlan): OverPlan {
  const balls = Array.isArray(plan.balls) ? (plan.balls.map(pickDelivery) as OverPlan['balls']) : plan.balls;
  return { v: plan.v, field: plan.field, balls, superBall: pickDelivery(plan.superBall) };
}

export function canonicalPlan(plan: OverPlan): string {
  return canonicalJson(normalizePlan(plan));
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** SHA-256 hex of a UTF-8 string: WebCrypto when available, otherwise the bundled implementation (same result). */
export async function sha256HexAsync(message: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    const bytes = utf8(message);
    const digest = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return toHex(digest);
  }
  return sha256Hex(message);
}

export function commitHash(plan: OverPlan, salt: string): Promise<string> {
  return sha256HexAsync(canonicalPlan(plan) + salt);
}
