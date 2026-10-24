import type { Dimension, DistrictMood, Pulse, Scores } from '@/engine/types';
import { DIMENSION_LABELS, DIMENSIONS } from '@/engine/types';

/** mm:ss with tabular-friendly zero padding. */
export function formatClock(ticks: number): string {
  const t = Math.max(0, Math.floor(ticks));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** In-world clock: the chapter opens at 09:00 and one tick is one in-world minute. */
export function worldTime(tick: number): string {
  const total = 9 * 60 + Math.max(0, Math.floor(tick));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function phaseLabel(tick: number, duration: number): string {
  const f = duration > 0 ? tick / duration : 0;
  if (f < 0.18) return 'Opening';
  if (f < 0.66) return 'Escalation';
  if (f < 0.94) return 'Resolution';
  return 'Closing';
}

export type Trend = 'rising' | 'falling' | 'steady';

export function trendOf(momentum: number, threshold = 1): Trend {
  if (momentum >= threshold) return 'rising';
  if (momentum <= -threshold) return 'falling';
  return 'steady';
}

export function trendWord(t: Trend): string {
  return t === 'rising' ? 'rising' : t === 'falling' ? 'falling' : 'steady';
}

export function balanceWord(balance: number): string {
  if (balance >= 0.75) return 'Even';
  if (balance >= 0.5) return 'Uneven';
  return 'Strained';
}

export function instabilityWord(instability: number): string {
  if (instability < 0.25) return 'Low';
  if (instability < 0.55) return 'Moderate';
  return 'High';
}

export function crowdWord(crowd: number): string {
  if (crowd < 0.12) return 'Quiet';
  if (crowd < 0.35) return 'Gathering';
  if (crowd < 0.65) return 'Large crowd';
  return 'Very large crowd';
}

export function moodWord(mood: DistrictMood): string {
  switch (mood) {
    case 'calm':
      return 'Calm';
    case 'tense':
      return 'Tense';
    case 'volatile':
      return 'Volatile';
    case 'hopeful':
      return 'Hopeful';
  }
}

export function servicesWord(services: number): string {
  if (services >= 0.8) return 'Running';
  if (services >= 0.45) return 'Disrupted';
  return 'Down';
}

export function trustWord(trust: number): string {
  if (trust >= 0.66) return 'High';
  if (trust >= 0.4) return 'Steady';
  return 'Low';
}

export function scoreWord(value: number): string {
  if (value >= 75) return 'strong';
  if (value >= 55) return 'holding';
  if (value >= 40) return 'strained';
  return 'critical';
}

export function pulseSummary(pulse: Pulse, scores: Scores): string {
  const parts = DIMENSIONS.map((d: Dimension) => `${DIMENSION_LABELS[d]} ${Math.round(scores[d])}, ${trendWord(trendOf(pulse.momentum[d]))}`);
  return `Republic Pulse. Overall ${Math.round(pulse.mean)}, ${trendWord(pulse.direction)}. Balance ${balanceWord(pulse.balance).toLowerCase()}, instability ${instabilityWord(pulse.instability).toLowerCase()}. ${parts.join('. ')}.`;
}

export function urgencyLabel(u: 'low' | 'medium' | 'high'): string {
  return u === 'high' ? 'Urgent' : u === 'medium' ? 'Pressing' : 'Can wait';
}
