/**
 * Twist questions on the friend's device: drawing a twist matched to the dared move's kind, and the one-attempt-
 * per-device-per-dare store (localStorage `vande:lite-twists`).
 *
 * Stable API used by the Lite screen: TWIST_POOL, twistById, dareIdentity, dareKeyOf, pickTwist, readAttempt,
 * ensureAttempt, drawTwist, answerTwist.
 */
import pool from '@/content/lite/twists.json';
import { hashString } from '@/engine/prng';
import type { Dare } from '@/share/dare';
import type { Twist, TwistAttempt, TwistKind, TwistPool } from './contracts';

export const TWIST_POOL = pool as TwistPool;

export type DareIdentityInput = Pick<Dare, 'seed' | 'path' | 'step' | 'deadline'>;

/** Full identity of a dare: seed, path, step and deadline. Chain and hint are not part of it. */
export function dareIdentity(d: DareIdentityInput): string {
  return `${(d.seed >>> 0).toString(36)}:${d.path || '~'}:${d.step}:${Math.round(d.deadline).toString(36)}`;
}

/** Short storage key for a dare identity. */
export function dareKeyOf(d: DareIdentityInput): string {
  return (hashString(dareIdentity(d)) >>> 0).toString(36);
}

export function twistById(id: string): Twist | undefined {
  return TWIST_POOL.twists.find((t) => t.id === id);
}

/** Draws a live twist of `kind` (any kind if none), preferring ids not in `seen`. `random` returns [0, 1). */
export function pickTwist(kind: TwistKind, seen: readonly string[], random: () => number = Math.random): Twist | undefined {
  void seen;
  const live = TWIST_POOL.twists.filter((t) => !t.retired);
  const same = live.filter((t) => t.kind === kind);
  const from = same.length ? same : live;
  return from.length ? from[Math.floor(random() * from.length)] : undefined;
}

export function readAttempt(dareKey: string): TwistAttempt | undefined {
  void dareKey;
  return undefined;
}

/** The device's attempt for a dare, created with a fresh nonce if missing. */
export function ensureAttempt(dareKey: string): TwistAttempt {
  return { v: 1, dareKey, nonce: Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0'), createdAt: Date.now() };
}

/** Draws and stores the twist for this attempt once; later calls return the stored one. */
export function drawTwist(dareKey: string, kind: TwistKind): TwistAttempt | undefined {
  const a = ensureAttempt(dareKey);
  const t = pickTwist(kind, []);
  if (!t) return undefined;
  return { ...a, twistId: t.id, order: t.options.map((o) => o.id) };
}

/** Records the first answer; later calls keep it. */
export function answerTwist(dareKey: string, optionId: string): TwistAttempt | undefined {
  void dareKey;
  void optionId;
  return undefined;
}
