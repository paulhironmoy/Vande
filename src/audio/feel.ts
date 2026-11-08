/**
 * The haptic patterns, and never two of them within 60 ms of each other (short buzzes closer than that blur into one).
 * Constitution §12: sparingly, and never for navigation, decorative animation or routine score updates.
 *
 *   pattern         when                                   web vibrate          native (Capacitor Haptics)
 *   whisper         release (optional, off by default)     [5]                  vibrate 5 ms
 *   tick            an edge: distinct and light            [10]                 light
 *   soft            the middle, mistimed                   [16]                 light
 *   pulse           the middle                             [24]                 medium
 *   double          the sweet spot: a pulse and a beat     [32, 70, 14]         heavy, light at +102 ms
 *   tap             the pad or body                        [12]                 light
 *   restrained      a close call (beaten, a near miss)     [8]                  light
 *   sharp           a stump impact without a dismissal     [22]                 heavy
 *   decisive        a wicket (bowled starts with the       [40, 80, 24]         heavy, medium at +120 ms
 *                   stumps' sharp hit, so it is one pattern)
 *   confirm         a four                                 [14, 70, 14]         medium, light at +100 ms
 *   confirm_strong  a six                                  [24, 70, 24, 70, 14] heavy, medium +110, light +220
 *   mastery         Coach Mode mastery: restrained success [8, 90, 8]           light, light at +110 ms
 *   leave, a miss: nothing
 *
 * The batter's tap plays the predicted outcome's pattern at once (Sealed Six batting). When the sealed answer lands, a
 * different outcome plays its own pattern, at least 60 ms after the end of the first; the same outcome plays nothing.
 */
import type { Contact, TimingGrade } from '@/contracts';
import type { ContactKind, SwingTiming } from '@/contracts/practice';

export type FeelPattern =
  | 'whisper'
  | 'tick'
  | 'soft'
  | 'pulse'
  | 'double'
  | 'tap'
  | 'restrained'
  | 'sharp'
  | 'decisive'
  | 'confirm'
  | 'confirm_strong'
  | 'mastery';

/** One native step: [ms from the start, impact style] or [ms, 'vibrate', duration ms]. */
export type NativeStep = readonly [number, 'light' | 'medium' | 'heavy'] | readonly [number, 'vibrate', number];

export interface FeelSpec {
  /** navigator.vibrate pattern (on, off, on … in ms). */
  web: number[];
  /** Capacitor Haptics steps. */
  native: NativeStep[];
  /** How long the pattern lasts, ms. */
  ms: number;
}

export const FEEL_PATTERNS: Readonly<Record<FeelPattern, FeelSpec>> = {
  whisper: { web: [5], native: [[0, 'vibrate', 5]], ms: 5 },
  tick: { web: [10], native: [[0, 'light']], ms: 10 },
  soft: { web: [16], native: [[0, 'light']], ms: 16 },
  pulse: { web: [24], native: [[0, 'medium']], ms: 24 },
  double: { web: [32, 70, 14], native: [[0, 'heavy'], [102, 'light']], ms: 116 },
  tap: { web: [12], native: [[0, 'light']], ms: 12 },
  restrained: { web: [8], native: [[0, 'light']], ms: 8 },
  sharp: { web: [22], native: [[0, 'heavy']], ms: 22 },
  decisive: { web: [40, 80, 24], native: [[0, 'heavy'], [120, 'medium']], ms: 144 },
  confirm: { web: [14, 70, 14], native: [[0, 'medium'], [100, 'light']], ms: 98 },
  confirm_strong: { web: [24, 70, 24, 70, 14], native: [[0, 'heavy'], [110, 'medium'], [220, 'light']], ms: 202 },
  mastery: { web: [8, 90, 8], native: [[0, 'light'], [110, 'light']], ms: 106 },
};

/** The least quiet time between the end of one pattern and the start of the next. */
export const FEEL_GAP_MS = 60;

/** Sealed Six: the pattern an outcome is felt as (null: nothing). */
export function feelFor(contact: Contact, timing: TimingGrade): FeelPattern | null {
  if (contact === 'middle') return timing === 'perfect' ? 'double' : 'pulse';
  if (contact === 'thick_edge' || contact === 'thin_edge') return 'tick';
  return null;
}

/** Practice: a contact felt in proportion to its quality (null for a leave or a miss). */
export function practiceContactFeel(kind: ContactKind, timing?: SwingTiming): FeelPattern | null {
  switch (kind) {
    case 'middle':
      return timing === 'perfect' ? 'double' : timing === 'mistimed' ? 'soft' : 'pulse';
    case 'inside_edge':
    case 'outside_edge':
    case 'top_edge':
    case 'leading_edge':
      return 'tick';
    case 'pad':
    case 'body':
      return 'tap';
    default:
      return null;
  }
}

export interface FeelScheduler {
  play(pattern: FeelPattern): void;
  cancel(): void;
}

/**
 * Plays patterns no closer than FEEL_GAP_MS apart: a pattern asked for too soon waits; a newer one replaces any
 * pattern still waiting (the latest outcome is the true one). Pure apart from the injected clock and timer.
 */
export function createFeelScheduler(deps: { now(): number; setTimer(fn: () => void, ms: number): unknown; clearTimer(id: unknown): void; emit(pattern: FeelPattern): void }): FeelScheduler {
  let playedUntil = Number.NEGATIVE_INFINITY;
  let waiting: unknown = null;
  let pending: FeelPattern | null = null;
  const fire = () => {
    waiting = null;
    const pattern = pending;
    pending = null;
    if (!pattern) return;
    playedUntil = deps.now() + FEEL_PATTERNS[pattern].ms;
    deps.emit(pattern);
  };
  return {
    play(pattern) {
      if (waiting !== null) {
        deps.clearTimer(waiting);
        waiting = null;
      }
      pending = pattern;
      const now = deps.now();
      const at = Math.max(now, playedUntil + FEEL_GAP_MS);
      if (at <= now) fire();
      else waiting = deps.setTimer(fire, at - now);
    },
    cancel() {
      if (waiting !== null) deps.clearTimer(waiting);
      waiting = null;
      pending = null;
    },
  };
}
