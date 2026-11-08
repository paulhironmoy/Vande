import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION } from '@/contracts';
import { PERF_CACHE_KEY } from '@/perf';
import {
  DEFAULT_PRACTICE_SETTINGS,
  PRACTICE_KEYS,
  clearCalibration,
  clearDraft,
  clearInnings,
  clearPracticeData,
  emptyDraft,
  isDeliveryRecord,
  isInningsState,
  isResumable,
  loadCalibration,
  loadCalibrations,
  loadDraft,
  loadInnings,
  loadPracticeSettings,
  loadSavedInnings,
  memoryStore,
  saveCalibrations,
  saveDraft,
  saveInnings,
  updatePracticeSettings,
} from '@/practice/store';
import { innings, record } from './fixtures';

describe('practice settings', () => {
  it('defaults: Learn, right-handed, automatic quality, Balanced, landing cue on, guided over not done', () => {
    expect(loadPracticeSettings(memoryStore())).toEqual(DEFAULT_PRACTICE_SETTINGS);
  });

  it('updates merge and persist; invalid stored values fall back one by one', () => {
    const store = memoryStore();
    updatePracticeSettings({ assist: 'real', handedness: 'left' }, store);
    expect(loadPracticeSettings(store)).toMatchObject({ assist: 'real', handedness: 'left', quality: 'auto' });
    store.setItem(
      PRACTICE_KEYS.settings,
      JSON.stringify({
        assist: 'godmode',
        handedness: 'left',
        quality: 'ultra',
        conditions: 'turning',
        hintsShown: -4,
        difficulty: 'legend',
        bowling: 'swing',
        teach: 'no',
        demoSeen: 1,
      }),
    );
    expect(loadPracticeSettings(store)).toMatchObject({
      assist: 'learn',
      handedness: 'left',
      quality: 'auto',
      conditions: 'turning',
      hintsShown: 0,
      difficulty: 'club',
      bowling: 'any',
      teach: true,
      demoSeen: false,
    });
    store.setItem(PRACTICE_KEYS.settings, 'not json');
    expect(loadPracticeSettings(store)).toEqual(DEFAULT_PRACTICE_SETTINGS);
  });
});

describe('calibration, per kind of input (CTL9)', () => {
  it('stores each input’s median offset, rounded; one input never overwrites another', () => {
    const store = memoryStore();
    expect(loadCalibrations(store)).toEqual({});
    expect(saveCalibrations({ touch: { offsetMs: 41.6, attempts: 5 } }, store)).toBe(true);
    expect(saveCalibrations({ keyboard: { offsetMs: 12.2, attempts: 4 } }, store)).toBe(true);
    expect(loadCalibrations(store)).toEqual({
      touch: { offsetMs: 42, attempts: 5 },
      keyboard: { offsetMs: 12, attempts: 4 },
    });
    expect(loadCalibration('touch', store)).toEqual({ offsetMs: 42, attempts: 5 });
    expect(loadCalibration('mouse', store)).toBeNull();
    clearCalibration(store);
    expect(loadCalibrations(store)).toEqual({});
  });

  it('a calibration saved before inputs were told apart becomes the main input’s', () => {
    const store = memoryStore();
    store.setItem(PRACTICE_KEYS.calibration, JSON.stringify({ offsetMs: 55, attempts: 5 }));
    expect(loadCalibrations(store, () => 'touch')).toEqual({ touch: { offsetMs: 55, attempts: 5 } });
    expect(loadCalibrations(store, () => 'mouse')).toEqual({ mouse: { offsetMs: 55, attempts: 5 } });
    // Saving another input keeps it, now in the new shape.
    saveCalibrations({ keyboard: { offsetMs: 10, attempts: 5 } }, store);
    const keys = Object.keys(loadCalibrations(store));
    expect(keys).toHaveLength(2);
    expect(keys).toContain('keyboard');
    expect(keys.some((k) => k === 'touch' || k === 'mouse')).toBe(true);
  });

  it('never stores an empty calibration and rejects corrupt values', () => {
    const store = memoryStore();
    expect(saveCalibrations({ touch: { offsetMs: 0, attempts: 0 } }, store)).toBe(false);
    store.setItem(PRACTICE_KEYS.calibration, JSON.stringify({ offsetMs: 9000, attempts: 5 }));
    expect(loadCalibrations(store)).toEqual({});
    store.setItem(
      PRACTICE_KEYS.calibration,
      JSON.stringify({ v: 2, touch: { offsetMs: 'x', attempts: 5 }, mouse: { offsetMs: 20, attempts: 3 } }),
    );
    expect(loadCalibrations(store)).toEqual({ mouse: { offsetMs: 20, attempts: 3 } });
  });
});

describe('innings persistence', () => {
  it('round-trips an innings, including the in-flight flag (resolved as a leave on resume, never re-bowled)', () => {
    const store = memoryStore();
    const s = innings({ inFlight: { overIndex: 1, ballIndex: 2 } });
    expect(saveInnings(s, store)).toBe(true);
    expect(loadInnings(store)).toEqual(s);
    clearInnings(store);
    expect(loadInnings(store)).toBeNull();
  });

  it('remembers that the last ball was settled as the app went away, until the next save', () => {
    const store = memoryStore();
    saveInnings(innings(), store, 'resumed_leave');
    expect(loadSavedInnings(store)?.notice).toBe('resumed_leave');
    saveInnings(innings(), store);
    expect(loadSavedInnings(store)?.notice).toBeNull();
  });

  it('rejects tampered or corrupt innings', () => {
    const store = memoryStore();
    const bad = [
      innings({ status: 'winning' as never }),
      innings({ runs: -5 }),
      innings({ runs: 1.5 }),
      innings({ balls: 999 }),
      innings({ version: 99 as never }),
      innings({
        current: { ...innings().current!, deliveries: Array.from({ length: 7 }, (_, i) => record(1, i % 6)) },
      }),
      innings({ current: { ...innings().current!, deliveries: [{ ...record(1, 0), runs: 5 as never }] } }),
      innings({ overs: Array.from({ length: 11 }, () => innings().overs[0]) }),
      innings({ dismissal: { record: { ...record(1, 2), dismissal: 'retired' as never } } }),
    ];
    for (const s of bad) {
      store.setItem(PRACTICE_KEYS.innings, JSON.stringify({ v: 1, state: s }));
      expect(loadInnings(store)).toBeNull();
    }
    store.setItem(PRACTICE_KEYS.innings, '{"v":1,"state":');
    expect(loadInnings(store)).toBeNull();
  });

  it('an innings from another simulation version is discarded (it would not replay exactly)', () => {
    expect(isInningsState(innings())).toBe(true);
    expect(isInningsState({ ...innings(), version: PRACTICE_SIM_VERSION + 1 })).toBe(false);
    expect(isDeliveryRecord({ ...record(0, 0), version: PRACTICE_SIM_VERSION + 1 })).toBe(false);
  });

  it('resumable while batting, between overs or choosing; not once out or complete', () => {
    expect(isResumable(innings())).toBe(true);
    expect(isResumable(innings({ status: 'over_complete', current: null }))).toBe(true);
    expect(isResumable(innings({ status: 'out' }))).toBe(false);
    expect(isResumable(innings({ status: 'complete' }))).toBe(false);
    expect(isResumable(null)).toBe(false);
  });

  it('storage that throws or is missing never breaks play', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveInnings(innings(), throwing)).toBe(false);
    expect(loadInnings(throwing)).toBeNull();
    expect(saveInnings(innings(), null)).toBe(false);
    expect(() => clearInnings(throwing)).not.toThrow();
  });
});

describe('Build an Over draft', () => {
  it('round-trips and rejects broken drafts', () => {
    const store = memoryStore();
    const d = emptyDraft('spin');
    d.balls[2] = { lineM: 0.2, lengthM: 4.5, variation: 'flighted' };
    d.order = 'shuffle';
    saveDraft(d, store);
    expect(loadDraft(store)).toEqual(d);
    store.setItem(PRACTICE_KEYS.draft, JSON.stringify({ ...d, balls: [null] }));
    expect(loadDraft(store)).toBeNull();
    clearDraft(store);
    expect(loadDraft(store)).toBeNull();
  });
});

describe('clearPracticeData', () => {
  it('removes every Practice key and the cached device check', () => {
    const store = memoryStore();
    for (const k of [...Object.values(PRACTICE_KEYS), PERF_CACHE_KEY]) store.setItem(k, '1');
    store.setItem('vc:player', 'keep');
    clearPracticeData(store);
    expect([...store.map.keys()]).toEqual(['vc:player']);
  });
});
