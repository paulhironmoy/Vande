/**
 * The batter's haptics: one readable pattern per outcome, and never two of them within 60 ms of each other (short
 * buzzes closer than that blur into one).
 *
 *   edge      one short tick                                   web [10]           native light
 *   middle    one medium pulse                                 web [24]           native medium
 *   perfect   a firmer pulse, then a short beat 70 ms later    web [32, 70, 14]   native heavy, light at +102 ms
 *   leave, a miss or the pad: nothing
 *
 * The tap plays the predicted outcome's pattern at once. When the sealed answer lands, a different outcome plays its
 * own pattern, at least 60 ms after the end of the first; the same outcome plays nothing more.
 */
import type { Contact, TimingGrade } from '@/contracts';

export type FeelPattern = 'tick' | 'pulse' | 'double';

export interface FeelSpec {
  /** navigator.vibrate pattern (on, off, on … in ms). */
  web: number[];
  /** Capacitor Haptics impacts: [ms from the start, style]. */
  native: Array<[number, 'light' | 'medium' | 'heavy']>;
  /** How long the pattern lasts, ms. */
  ms: number;
}

export const FEEL_PATTERNS: Readonly<Record<FeelPattern, FeelSpec>> = {
  tick: { web: [10], native: [[0, 'light']], ms: 10 },
  pulse: { web: [24], native: [[0, 'medium']], ms: 24 },
  double: { web: [32, 70, 14], native: [[0, 'heavy'], [102, 'light']], ms: 116 },
};

/** The least quiet time between the end of one pattern and the start of the next. */
export const FEEL_GAP_MS = 60;

/** The pattern an outcome is felt as (null: nothing). */
export function feelFor(contact: Contact, timing: TimingGrade): FeelPattern | null {
  if (contact === 'middle') return timing === 'perfect' ? 'double' : 'pulse';
  if (contact === 'thick_edge' || contact === 'thin_edge') return 'tick';
  return null;
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
  const fire = (pattern: FeelPattern) => {
    waiting = null;
    playedUntil = deps.now() + FEEL_PATTERNS[pattern].ms;
    deps.emit(pattern);
  };
  return {
    play(pattern) {
      if (waiting !== null) {
        deps.clearTimer(waiting);
        waiting = null;
      }
      const now = deps.now();
      const at = Math.max(now, playedUntil + FEEL_GAP_MS);
      if (at <= now) fire(pattern);
      else waiting = deps.setTimer(() => fire(pattern), at - now);
    },
    cancel() {
      if (waiting !== null) deps.clearTimer(waiting);
      waiting = null;
    },
  };
}
