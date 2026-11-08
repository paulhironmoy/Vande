/**
 * Practice's added synthesised voices (original; no recordings or samples), in the style of voices.ts, so the bank
 * (src/audio/bank.ts) renders them offline once and the same code is the live fallback. Rendered at intensity 1:
 * playback scales the gain.
 */
import type { PitchCondition } from '@/contracts/practice';
import { noiseBurst, tone, voices, type VoiceTarget } from './voices';

export const fxVoices = {
  /**
   * The ball on the pitch, by surface: a hard, bare pitch cracks; a green one thuds softly; a turning (dry, dusty)
   * one puffs with grit. Balanced is the original bounce.
   */
  bounce(v: VoiceTarget, when: number, condition: PitchCondition, pitch = 1) {
    if (condition === 'hard') {
      tone(v, when, 135 * pitch, { decay: 0.07 / pitch, gain: 0.35 });
      noiseBurst(v, when, { type: 'lowpass', freq: 2200 * pitch, q: 0.7, attack: 0.001, decay: 0.04 / pitch, gain: 0.24 });
      noiseBurst(v, when, { type: 'highpass', freq: 3500 * pitch, q: 0.7, attack: 0.0008, decay: 0.008, gain: 0.1 });
    } else if (condition === 'green') {
      tone(v, when, 105 * pitch, { decay: 0.11 / pitch, gain: 0.3 });
      noiseBurst(v, when, { type: 'lowpass', freq: 900 * pitch, q: 0.7, attack: 0.003, decay: 0.06 / pitch, gain: 0.14 });
    } else if (condition === 'turning') {
      tone(v, when, 115 * pitch, { decay: 0.08 / pitch, gain: 0.3 });
      noiseBurst(v, when, { type: 'lowpass', freq: 1600 * pitch, q: 0.7, attack: 0.002, decay: 0.05 / pitch, gain: 0.16 });
      noiseBurst(v, when + 0.004, { type: 'bandpass', freq: 2800 * pitch, q: 0.8, attack: 0.004, decay: 0.12 / pitch, gain: 0.07 });
    } else voices.bounce(v, when, 0.6, pitch);
  },
  /** The middle of the bat, mistimed: less crack, more thud. */
  mistimed(v: VoiceTarget, when: number, pitch = 1) {
    noiseBurst(v, when, { type: 'bandpass', freq: 1800 * pitch, q: 1, attack: 0.0015, decay: 0.03 / pitch, gain: 0.55 });
    tone(v, when, 520 * pitch, { decay: 0.09 / pitch, gain: 0.28, type: 'triangle' });
    tone(v, when, 150 * pitch, { decay: 0.14 / pitch, gain: 0.34 });
  },
  /** A defensive block: the dead bat's damped thud, short and soft (never the drive's crack and ring). */
  block(v: VoiceTarget, when: number, pitch = 1) {
    noiseBurst(v, when, { type: 'bandpass', freq: 1400 * pitch, q: 1, attack: 0.0015, decay: 0.018 / pitch, gain: 0.32 });
    tone(v, when, 380 * pitch, { decay: 0.05 / pitch, gain: 0.18, type: 'triangle' });
    tone(v, when, 130 * pitch, { decay: 0.08 / pitch, gain: 0.26 });
  },
  /** A top edge: a hollow tock off the shoulder of the blade, with a small rattle. */
  topEdge(v: VoiceTarget, when: number, pitch = 1) {
    noiseBurst(v, when, { type: 'highpass', freq: 2600 * pitch, q: 0.9, attack: 0.001, decay: 0.02 / pitch, gain: 0.35 });
    tone(v, when, 980 * pitch, { decay: 0.05 / pitch, gain: 0.16, type: 'triangle' });
    tone(v, when, 1450 * pitch, { decay: 0.03 / pitch, gain: 0.08 });
    noiseBurst(v, when + 0.012 / pitch, { type: 'bandpass', freq: 3200 * pitch, q: 1.2, attack: 0.001, decay: 0.015 / pitch, gain: 0.15 });
  },
  /** The ball on the body: a dull thump. */
  body(v: VoiceTarget, when: number, pitch = 1) {
    noiseBurst(v, when, { type: 'lowpass', freq: 380 * pitch, q: 0.7, attack: 0.003, decay: 0.09 / pitch, gain: 0.5 });
    tone(v, when, 80 * pitch, { decay: 0.08 / pitch, gain: 0.25 });
  },
  /** The ball into the boundary boards. */
  board(v: VoiceTarget, when: number) {
    noiseBurst(v, when, { type: 'lowpass', freq: 700, q: 0.7, attack: 0.002, decay: 0.12, gain: 0.45 });
    tone(v, when, 95, { decay: 0.16, gain: 0.3 });
    tone(v, when, 230, { decay: 0.08, gain: 0.12, type: 'triangle' });
  },
  /** Interface: a soft tick for a selection. */
  uiSelect(v: VoiceTarget, when: number) {
    tone(v, when, 1320, { decay: 0.035, gain: 0.06 }, v.ui ?? v.out);
  },
  /** Interface: two soft notes for a confirmation. */
  uiConfirm(v: VoiceTarget, when: number) {
    const out = v.ui ?? v.out;
    tone(v, when, 880, { decay: 0.09, gain: 0.07, type: 'triangle' }, out);
    tone(v, when + 0.07, 1320, { decay: 0.14, gain: 0.06, type: 'triangle' }, out);
  },
  /** Coach Mode mastery: a quiet, warm rising triad, distinct from any crowd sound. */
  mastery(v: VoiceTarget, when: number) {
    const out = v.ui ?? v.out;
    tone(v, when, 523.25, { attack: 0.01, decay: 0.5, gain: 0.07, type: 'triangle' }, out);
    tone(v, when + 0.11, 659.25, { attack: 0.01, decay: 0.5, gain: 0.06, type: 'triangle' }, out);
    tone(v, when + 0.22, 783.99, { attack: 0.01, decay: 0.7, gain: 0.06, type: 'triangle' }, out);
    tone(v, when + 0.22, 1567.98, { attack: 0.02, decay: 0.5, gain: 0.015 }, out);
  },
  /** Coach Mode: one stage less assistance, a soft rising pair. */
  stageUp(v: VoiceTarget, when: number) {
    const out = v.ui ?? v.out;
    tone(v, when, 783.99, { attack: 0.006, decay: 0.18, gain: 0.05 }, out);
    tone(v, when + 0.09, 1046.5, { attack: 0.006, decay: 0.24, gain: 0.05 }, out);
  },
};
