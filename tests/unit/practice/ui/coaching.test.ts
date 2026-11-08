/** The words of Practice, from the engines' closed vocabularies: short, direct and honest ("38 ms early"). */
import { describe, expect, it } from 'vitest';
import type { CoachAnalysis, CoachOption, CoachRecommendationKind, DeliveryResult, NormalizedSwing } from '@/contracts';
import { createPracticeT } from '@/i18n/practice';
import { practiceEn } from '@/i18n/practice/en';
import { batEvidenceLines, comparisonLines, isConfirmation, luckyLine, markText, outcomeWord, primaryReasonLine, readLine, reasonWords, recommendationLine, shotElevationRead, shotPowerRead, timingWords, variationKey } from '@/practice/ui/coaching';
import { optionWords } from '@/practice/ui/components/Alternatives';
import { gestureClass } from '@/practice/ui/tester/recorder';
import { fakeEngine, fakeResult, plan } from './fakes';

const t = createPracticeT('en', null);
const engine = fakeEngine();
const flight = engine.flight({ plan: plan(), bowler: { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'x' }, conditions: 'balanced', seed: 's', handedness: 'right' });
const swingResult = (over: Partial<DeliveryResult['coaching']> = {}): DeliveryResult => {
  const r = fakeResult(flight, { kind: 'attack', startT: 0.4, directionDeg: 40, power: 0.6, elevation: 0, footwork: 'auto' });
  return { ...r, coaching: { ...r.coaching, ...over } };
};
const rec = (kind: CoachRecommendationKind, extra: Partial<{ shiftMs: number; region: 'cover'; lofted: boolean }> = {}) => ({ kind, decision: 'attack' as const, footwork: 'forward' as const, shiftMs: extra.shiftMs ?? null, directionDeg: null, region: extra.region ?? null, lofted: extra.lofted ?? null });

describe('the outcome', () => {
  it('only FOUR, SIX and OUT are capitals; runs and dots are words', () => {
    expect(outcomeWord(t, { runs: 4, boundary: 4, dismissal: null })).toEqual({ word: 'Four', caps: true, tone: 'boundary' });
    expect(outcomeWord(t, { runs: 6, boundary: 6, dismissal: null })).toMatchObject({ word: 'Six', caps: true });
    expect(outcomeWord(t, { runs: 0, boundary: null, dismissal: 'caught' })).toMatchObject({ word: 'Out', caps: true, tone: 'out' });
    expect(outcomeWord(t, { runs: 0, boundary: null, dismissal: null })).toMatchObject({ word: 'Dot ball', caps: false });
    expect(outcomeWord(t, { runs: 2, boundary: null, dismissal: null }).word).toBe('2 runs');
    expect(outcomeWord(t, { runs: 1, boundary: null, dismissal: null }).word).toBe('1 run');
  });

  it('marks are shapes and words, never colour alone', () => {
    expect([markText({ runs: 0, dismissal: null }), markText({ runs: 4, dismissal: null }), markText({ runs: 0, dismissal: 'bowled' })]).toEqual(['·', '4', 'W']);
  });
});

describe('the primary reason and the one recommendation', () => {
  it('names the gap or the fielder the physics named', () => {
    expect(reasonWords(t, 'found_the_gap', swingResult({ zone: 'cover' }))).toBe('Found the cover gap');
    expect(reasonWords(t, 'hit_to_fielder', swingResult({ fielderRole: 'mid_off' }))).toBe('Hit straight to mid-off');
    expect(reasonWords(t, 'hit_to_fielder', swingResult({ fielderRole: null }))).toBe('Hit straight to a fielder');
  });

  it('timing is short and measured: "38 ms early"; On time is the physics’ own perfect band', () => {
    expect(timingWords(t, -38, 'mistimed')).toBe('38 ms early');
    expect(timingWords(t, 48, 'solid')).toBe('48 ms late');
    expect(timingWords(t, 19, 'perfect')).toBe('On time');
    expect(timingWords(t, null)).toBeNull();
    const r = { ...swingResult(), contact: { ...swingResult().contact, timing: 'mistimed' as const } };
    expect(primaryReasonLine(t, { reason: 'too_late', timingMs: 42, recommendation: rec('play_earlier', { shiftMs: 40 }) }, r)).toBe('Too late on the ball · 42 ms late');
  });

  it('every recommendation kind reads as one short line', () => {
    const kinds: CoachRecommendationKind[] = ['repeat_it', 'leave_outside_off', 'leave_down_leg', 'leave_over_the_top', 'play_at_the_stumps', 'defend_forward', 'defend_back', 'attack_the_gap', 'get_forward', 'get_back', 'play_later', 'play_earlier', 'play_straighter', 'aim_for_the_gap', 'keep_it_down'];
    for (const k of kinds) {
      const line = recommendationLine(t, rec(k, { shiftMs: 30, region: 'cover' }));
      expect(line.length, k).toBeGreaterThan(5);
      expect(line.length, k).toBeLessThan(60);
      expect(`practice.rec.${k}` in practiceEn, k).toBe(true);
    }
    expect(recommendationLine(t, rec('play_later', { shiftMs: 38 }))).toBe('Start 38 ms later.');
    expect(recommendationLine(t, rec('attack_the_gap', { region: 'cover', lofted: true }))).toBe('Hit over the top towards cover.');
  });

  it('a comparison says what changed in plain words', () => {
    expect(comparisonLines(t, { changes: ['timing_closer', 'clean_contact_now', 'more_runs'], verdict: 'better', timingMs: 38, runsDelta: 2 })).toEqual(['38 ms closer to ideal timing', 'Clean contact this time']);
    expect(comparisonLines(t, { changes: ['same_again'], verdict: 'same', timingMs: null, runsDelta: 0 })).toEqual(['Much the same as last time']);
  });

  it('the wrong’un is a googly for a wrist spinner and a carrom ball for a finger spinner', () => {
    expect(variationKey('wrong_un', 'wrist')).toBe('wrong_un_wrist');
    expect(variationKey('wrong_un', 'finger')).toBe('wrong_un_finger');
    expect(variationKey('cutter')).toBe('cutter');
  });
});

describe('a stroke that scored but the coach would change (RK-F06)', () => {
  const attempted = (over: Partial<CoachAnalysis['attempted']>) => ({ attempted: { runs: 4, dismissal: null, spread: { dismissalRisk: 0, expectedRuns: 1.2, risks: [] }, ...over } }) as unknown as Pick<CoachAnalysis, 'attempted'>;
  it('says why it was lucky from the coach’s evidence, and nothing when there is none', () => {
    const change = rec('leave_over_the_top');
    expect(luckyLine(t, attempted({ spread: { dismissalRisk: 0.2, expectedRuns: 1, risks: ['can_be_caught'] } }), change)).toBe('It scored this time, but this stroke is out about 1 time in 5.');
    expect(luckyLine(t, attempted({ spread: { dismissalRisk: 0.7, expectedRuns: 1, risks: [] } }), change)).toBe('It scored this time, but this stroke is out more often than not.');
    expect(luckyLine(t, attempted({ spread: { dismissalRisk: 0.02, expectedRuns: 1, risks: ['into_protected_region'] } }), change)).toBe('It scored this time, but it went where a fielder is set to stop it.');
    expect(luckyLine(t, attempted({ spread: { dismissalRisk: 0, expectedRuns: 3, risks: [] } }), change)).toBeNull();
    // A leave, a wicket, a dot ball, or a confirmation: nothing to explain.
    expect(luckyLine(t, attempted({ spread: null }), change)).toBeNull();
    expect(luckyLine(t, attempted({ dismissal: 'caught', runs: 0 }), change)).toBeNull();
    expect(luckyLine(t, attempted({ runs: 0 }), change)).toBeNull();
    expect(luckyLine(t, attempted({ spread: { dismissalRisk: 0.3, expectedRuns: 1, risks: [] } }), rec('well_played'))).toBeNull();
  });

  it('well played and the same again are confirmations; the rest are corrections', () => {
    expect(isConfirmation(rec('well_played'))).toBe(true);
    expect(isConfirmation(rec('repeat_it'))).toBe(true);
    expect(isConfirmation(rec('play_later', { shiftMs: 30 }))).toBe(false);
    expect(recommendationLine(t, rec('well_played'))).toBe('Well played: that works as well as the coach’s choice.');
  });
});

describe('the exact stroke read', () => {
  const attack = (elevation: number, power = 0.6): NormalizedSwing => ({
    kind: 'attack',
    startT: 0.4,
    directionDeg: 40,
    power,
    elevation,
    footwork: 'forward',
  });
  const option = (elevation: number): CoachOption => ({
    kind: 'recommended',
    decision: 'attack',
    footwork: 'forward',
    swing: attack(elevation),
    region: 'cover',
    expectedRuns: 1.2,
    dismissalRisk: 0.05,
    risks: [],
    contactT: null,
    contactPoint: null,
  } as unknown as CoachOption);

  it('uses the physics elevation boundaries for grounded, raised and fully lofted intent', () => {
    expect([
      shotElevationRead(0),
      shotElevationRead(0.079),
      shotElevationRead(0.08),
      shotElevationRead(0.3),
      shotElevationRead(0.449),
      shotElevationRead(0.45),
      shotElevationRead(0.5),
    ]).toEqual(['grounded', 'grounded', 'uppish', 'uppish', 'uppish', 'lofted', 'lofted']);
    expect(readLine(t, attack(0.08), engine.regionOf)).toBe('raised shot to cover, firm');
    expect(readLine(t, attack(0.3), engine.regionOf)).toBe('raised shot to cover, firm');
    expect(readLine(t, attack(0.45), engine.regionOf)).toBe('lofted shot to cover, firm');
    expect(readLine(t, attack(0.5), engine.regionOf)).toBe('lofted shot to cover, firm');
    expect(optionWords(t, option(0.08))).toBe('Raise it on the front foot towards cover');
    expect(optionWords(t, option(0.3))).toBe('Raise it on the front foot towards cover');
    expect(optionWords(t, option(0.45))).toBe('Loft on the front foot towards cover');
    expect(optionWords(t, option(0.5))).toBe('Loft on the front foot towards cover');
    expect(gestureClass('touch', attack(0.08))).toBe('flick_ground');
    expect(gestureClass('touch', attack(0.3))).toBe('flick_ground');
    expect(gestureClass('touch', attack(0.45))).toBe('flick_lofted');
    expect(gestureClass('touch', attack(0.5))).toBe('flick_lofted');
  });

  it('calls strong sub-maximum inputs hard rather than falsely claiming full power', () => {
    expect([shotPowerRead(0.39), shotPowerRead(0.4), shotPowerRead(0.749), shotPowerRead(0.75), shotPowerRead(1)]).toEqual([
      'soft',
      'firm',
      'firm',
      'hard',
      'hard',
    ]);
    const line = readLine(t, attack(0, 0.75), engine.regionOf);
    expect(line).toBe('grounded shot to cover, hard');
    expect(line).not.toContain('full power');
  });

  it('words only the measured bat evidence and states the along-blade limit precisely', () => {
    expect(batEvidenceLines(t, {
      bat: {
        faceBearingDeg: 31,
        faceToIntentDeg: -9.6,
        speedKph: 82.4,
        bladeU: 0.44,
        sweetSpotAlongOffsetM: -0.037,
        withinSweetSpotAlongBand: false,
      },
    })).toEqual([
      'Bat face was 10° from your intended line.',
      'Bat speed at contact: 82 km/h.',
      'Contact was 4 cm towards the toe along the blade.',
    ]);
    expect(batEvidenceLines(t, {
      bat: {
        faceBearingDeg: null,
        faceToIntentDeg: null,
        speedKph: null,
        bladeU: 0.5,
        sweetSpotAlongOffsetM: 0,
        withinSweetSpotAlongBand: true,
      },
    })).toEqual(['Contact was inside the sweet-spot band along the blade.']);
  });
});
