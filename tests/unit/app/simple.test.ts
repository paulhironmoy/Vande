import { describe, expect, it } from 'vitest';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES, SIMPLE_STATES, cityMood, pick, starsFor, weakestDimension } from '@/app/simple';
import { CONFIDENCE_STATES, DIMENSIONS, OUTCOME_LABELS, type RepublicOutcome, type Scores } from '@/engine/types';

const scores = (v: Partial<Scores>): Scores => ({ freedom: 60, grievance: 60, safety: 60, evidence: 60, trust: 60, economy: 60, ...v });

describe('simple vocabulary', () => {
  it('covers every dimension, confidence state and outcome with short plain words', () => {
    for (const d of DIMENSIONS) {
      expect(SIMPLE_DIMENSIONS[d].label.length).toBeLessThanOrEqual(16);
      expect(SIMPLE_DIMENSIONS[d].help.split(' ').length).toBeLessThanOrEqual(12);
    }
    for (const s of CONFIDENCE_STATES) expect(SIMPLE_STATES[s].label.length).toBeLessThanOrEqual(16);
    for (const o of Object.keys(OUTCOME_LABELS) as RepublicOutcome[]) {
      expect(SIMPLE_OUTCOMES[o].label.length).toBeLessThanOrEqual(22);
      expect([1, 2, 3]).toContain(SIMPLE_OUTCOMES[o].stars);
    }
  });

  it('reads the city mood from balance, not just the mean', () => {
    expect(cityMood(scores({})).tone).toBe('good');
    expect(cityMood(scores({ freedom: 80, grievance: 75, safety: 78, evidence: 82, trust: 76, economy: 74 })).tone).toBe('great');
    expect(cityMood(scores({ freedom: 90, safety: 20 })).tone).not.toBe('great');
    expect(cityMood(scores({ freedom: 30, grievance: 30, safety: 30, evidence: 30, trust: 30, economy: 30 })).tone).toBe('trouble');
    expect(weakestDimension(scores({ trust: 12 }))).toBe('trust');
  });

  it('awards stars on a gentle curve and picks simple copy only when present', () => {
    expect(starsFor(80)).toBe(3);
    expect(starsFor(60)).toBe(2);
    expect(starsFor(40)).toBe(1);
    expect(starsFor(10)).toBe(0);
    expect(pick(true, 'full', 'simple')).toBe('simple');
    expect(pick(true, 'full', undefined)).toBe('full');
    expect(pick(false, 'full', 'simple')).toBe('full');
  });
});
