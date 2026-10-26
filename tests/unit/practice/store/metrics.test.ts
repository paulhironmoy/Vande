import { describe, expect, it } from 'vitest';
import {
  PRACTICE_KEYS,
  TIMING_BINS,
  addDelivery,
  addTier,
  addTtfd,
  bearingGap,
  bump,
  durationBucket,
  emptyMetrics,
  fpsBucket,
  intentMatch,
  latencyBucket,
  loadMetrics,
  memoryStore,
  outcomeProp,
  overNumberProp,
  saveMetrics,
  timingBin,
  timingProp,
  ttfdBucket,
} from '@/practice/store';
import { result } from './fixtures';

describe('buckets', () => {
  it('time to first delivery', () => {
    expect([1000, 4999, 5000, 9999, 10000, 19999, 20000].map(ttfdBucket)).toEqual(['<5s', '<5s', '5-10s', '5-10s', '10-20s', '10-20s', '>20s']);
  });

  it('input-to-bat latency', () => {
    expect([12, 49.9, 50, 69, 70, 99, 100, 400].map(latencyBucket)).toEqual(['<50ms', '<50ms', '50-70ms', '50-70ms', '70-100ms', '70-100ms', '>100ms', '>100ms']);
  });

  it('durations, frame rates and over numbers', () => {
    expect(durationBucket(10_000)).toBe('<30s');
    expect(durationBucket(400_000)).toBe('>5m');
    expect(fpsBucket(60)).toBe('60+');
    expect(fpsBucket(50)).toBe('45-59');
    expect(fpsBucket(12)).toBe('<20');
    expect(overNumberProp(0)).toBe('1');
    expect(overNumberProp(7)).toBe('7');
    expect(overNumberProp(12)).toBe('10');
  });

  it('timing: on time for perfect or solid, early or late by the sign, none without a swing', () => {
    expect(timingProp(result({ timing: 'perfect' }))).toBe('on_time');
    expect(timingProp(result({ timing: 'solid', errorMs: -60 }))).toBe('on_time');
    expect(timingProp(result({ timing: 'mistimed', errorMs: -90 }))).toBe('early');
    expect(timingProp(result({ timing: 'missed', errorMs: 140 }))).toBe('late');
    expect(timingProp(result({ swing: null, timing: 'none', errorMs: null }))).toBe('none');
  });

  it('intent versus actual direction (attacking contact only)', () => {
    expect(bearingGap(350, 10)).toBe(20);
    expect(bearingGap(-170, 170)).toBe(20);
    expect(intentMatch(result({ intended: 30, exit: 40 }))).toBe('on_target');
    expect(intentMatch(result({ intended: 30, exit: 60 }))).toBe('near');
    expect(intentMatch(result({ intended: 30, exit: -60 }))).toBe('off_target');
    expect(intentMatch(result({ swing: 'defend' }))).toBe('none');
    expect(intentMatch(result({ exit: null, kind: 'miss' }))).toBe('none');
  });

  it('outcomes', () => {
    expect(outcomeProp({ runs: 0, boundary: null, dismissal: null })).toBe('dot');
    expect(outcomeProp({ runs: 2, boundary: null, dismissal: null })).toBe('runs');
    expect(outcomeProp({ runs: 4, boundary: 4, dismissal: null })).toBe('four');
    expect(outcomeProp({ runs: 6, boundary: 6, dismissal: null })).toBe('six');
    expect(outcomeProp({ runs: 0, boundary: null, dismissal: 'caught' })).toBe('out');
  });

  it('timing histogram bins', () => {
    expect(timingBin(-500)).toBe(0);
    expect(timingBin(-200)).toBe(1);
    expect(timingBin(0)).toBe(9);
    expect(timingBin(199)).toBe(16);
    expect(timingBin(200)).toBe(TIMING_BINS - 1);
  });
});

describe('local aggregates', () => {
  it('counts deliveries without keeping any gesture, time or identifier', () => {
    let m = emptyMetrics();
    m = addDelivery(m, result({ timing: 'perfect', errorMs: 8 }), { scoring: true, latencyMs: 41 });
    m = addDelivery(m, result({ timing: 'mistimed', errorMs: 120, kind: 'outside_edge', dismissal: 'caught_behind', runs: 0, boundary: null }), { scoring: true, latencyMs: 75 });
    m = addDelivery(m, result({ swing: null, timing: 'none', errorMs: null, kind: 'leave', runs: 0, boundary: null }), { scoring: false });
    m = addTtfd(bump(bump(m, 'nextOver'), 'replays', 2), 6200);
    m = addTier(m, 'assisted');
    expect(m.deliveries).toBe(2);
    expect(m.wickets).toBe(1);
    expect(m.outcomes).toMatchObject({ four: 1, out: 1 });
    expect(m.timing).toEqual({ early: 0, on_time: 1, late: 1, none: 1 });
    expect(m.contact).toMatchObject({ middle: 1, outside_edge: 1, leave: 1 });
    expect(m.latency).toMatchObject({ '<50ms': 1, '70-100ms': 1 });
    expect(m.timingHistogram.reduce((a, b) => a + b, 0)).toBe(2);
    expect(m).toMatchObject({ nextOver: 1, replays: 2, ttfd: { '5-10s': 1 }, tiers: { assisted: 1 } });
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/samples|startT|directionDeg|renderer|seed|id"/);
  });

  it('persists, and repairs corrupt fields instead of failing', () => {
    const store = memoryStore();
    const m = bump(emptyMetrics(), 'sessions');
    saveMetrics(m, store);
    expect(loadMetrics(store)).toEqual(m);
    store.setItem(PRACTICE_KEYS.metrics, JSON.stringify({ ...m, deliveries: 'lots', timing: { on_time: -3, late: 2 }, timingHistogram: [1, 2] }));
    const r = loadMetrics(store);
    expect(r.deliveries).toBe(0);
    expect(r.timing).toEqual({ early: 0, on_time: 0, late: 2, none: 0 });
    expect(r.timingHistogram).toHaveLength(TIMING_BINS);
    expect(r.sessions).toBe(1);
  });
});
