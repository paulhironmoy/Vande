/**
 * The newer things Practice keeps: a saved innings from another version is dropped calmly (never resumed, never a
 * crash), records saved before balls had a condition load as a new white ball, exact-ball mastery, form evidence and
 * the tester mode's answers, all bounded, validated on read and cleared with Practice data.
 */
import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION } from '@/contracts';
import { FORM_SAMPLE_VERSION } from '@/practice/coach';
import {
  MASTERY_MAX_BALLS,
  PRACTICE_KEYS,
  addFormSample,
  allMastery,
  clearPracticeData,
  clearTesterData,
  droppedInnings,
  loadFormSamples,
  loadMastery,
  loadSavedInnings,
  memoryStore,
  recordTesterAnswer,
  recordTesterEvent,
  saveInnings,
  saveMastery,
  setTesterEnabled,
  setTesterSessionField,
  startTesterSession,
  testerAnswerCount,
  testerEnabled,
  testerExport,
  testerSessions,
} from '@/practice/store';
import { innings } from './fixtures';

const session = {
  id: 's1',
  consent: true as const,
  cohort: 'rookie' as const,
  handReported: null,
  startedAt: '2026-10-26T10:00:00.000Z',
  appVersion: '1.0.0',
  build: 'abc1234',
  simVersion: PRACTICE_SIM_VERSION,
  locale: 'en',
  device: { graphics: 'balanced', screen: '915x412', input: 'touch' },
  hand: 'right',
  assist: 'learn',
  calibration: { touch: null, mouse: null, keyboard: null },
  ttfcdMs: null,
};

describe('an innings Practice can no longer replay', () => {
  it('another simulation version is "updated"; damaged data is "unreadable"; a good one is kept', () => {
    const store = memoryStore();
    expect(droppedInnings(store)).toBeNull();
    store.setItem(
      PRACTICE_KEYS.innings,
      JSON.stringify({ v: 1, state: { ...innings(), version: PRACTICE_SIM_VERSION - 1 } }),
    );
    expect(droppedInnings(store)).toBe('updated');
    expect(loadSavedInnings(store)).toBeNull();
    store.setItem(PRACTICE_KEYS.innings, JSON.stringify({ v: 1, state: { ...innings(), runs: -3 } }));
    expect(droppedInnings(store)).toBe('unreadable');
    saveInnings(innings(), store);
    expect(droppedInnings(store)).toBeNull();
    expect(loadSavedInnings(store)?.state.runs).toBe(9);
  });

  it('an over saved before balls had a condition loads with the physics’ default ball; a bad ball is refused', () => {
    const store = memoryStore();
    const s = innings();
    const current = s.current!;
    // As saved before balls had a condition: no `ball` on the plan or on its records.
    const legacy = JSON.parse(JSON.stringify({ ...s, current })) as {
      current: { plan: Record<string, unknown>; deliveries: Array<Record<string, unknown>> };
    };
    delete legacy.current.plan.ball;
    for (const d of legacy.current.deliveries) delete d.ball;
    store.setItem(PRACTICE_KEYS.innings, JSON.stringify({ v: 1, state: legacy }));
    const loaded = loadSavedInnings(store)!.state;
    expect(loaded.current?.plan.ball).toEqual({ colour: 'white', age: 'new' });
    expect(loaded.current?.deliveries.every((d) => d.ball.colour === 'white')).toBe(true);
    saveInnings(
      { ...s, current: { ...current, plan: { ...current.plan, ball: { colour: 'pink', age: 'new' } as never } } },
      store,
    );
    expect(loadSavedInnings(store)).toBeNull();
    expect(droppedInnings(store)).toBe('unreadable');
  });
});

describe('exact-ball mastery', () => {
  it('is kept per ball, most recent last, bounded, and corrupt entries are ignored', () => {
    const store = memoryStore();
    saveMastery(
      {
        key: 'a',
        stage: 2,
        attempts: [
          {
            stage: 1,
            decision: 'defend',
            footwork: 'forward',
            timingErrorMs: 12,
            contact: 'middle',
            runs: 0,
            out: false,
            success: true,
          },
        ],
        mastered: false,
      },
      store,
    );
    expect(loadMastery('a', store)?.stage).toBe(2);
    expect(loadMastery('b', store)).toBeNull();
    for (let i = 0; i < MASTERY_MAX_BALLS + 5; i++)
      saveMastery({ key: `k${i}`, stage: 1, attempts: [], mastered: false }, store);
    expect(allMastery(store)).toHaveLength(MASTERY_MAX_BALLS);
    expect(loadMastery('a', store)).toBeNull();
    store.setItem(
      PRACTICE_KEYS.mastery,
      JSON.stringify({
        v: 2,
        simVersion: PRACTICE_SIM_VERSION,
        items: [
          { key: 'x', stage: 9, attempts: [], mastered: false },
          { key: 'y', stage: 1, attempts: [], mastered: true },
        ],
      }),
    );
    expect(allMastery(store).map((m) => m.key)).toEqual(['y']);
  });

  it('drops mastery saved by prior or future simulation versions', () => {
    const store = memoryStore();
    const state = { key: 'simulated-ball', stage: 1, attempts: [], mastered: false };
    for (const simVersion of [PRACTICE_SIM_VERSION - 1, PRACTICE_SIM_VERSION + 1]) {
      store.setItem(PRACTICE_KEYS.mastery, JSON.stringify({ v: 2, simVersion, items: [state] }));
      expect(loadMastery(state.key, store)).toBeNull();
      expect(allMastery(store)).toEqual([]);
    }
    store.setItem(PRACTICE_KEYS.mastery, JSON.stringify({ v: 1, items: [state] }));
    expect(allMastery(store)).toEqual([]);
  });
});

describe('form evidence', () => {
  it('keeps versioned samples only, the newest few hundred', () => {
    const store = memoryStore();
    expect(addFormSample({ nope: true }, store)).toBe(false);
    for (let i = 0; i < 310; i++) addFormSample({ v: FORM_SAMPLE_VERSION, simVersion: PRACTICE_SIM_VERSION, i }, store);
    const samples = loadFormSamples(store);
    expect(samples).toHaveLength(300);
    expect(samples[0].i).toBe(10);
  });

  it('rejects form evidence from prior or future simulation versions', () => {
    const store = memoryStore();
    const current = { v: FORM_SAMPLE_VERSION, simVersion: PRACTICE_SIM_VERSION, id: 'current' };
    expect(addFormSample(current, store)).toBe(true);
    expect(addFormSample({ ...current, simVersion: PRACTICE_SIM_VERSION - 1 }, store)).toBe(false);
    expect(addFormSample({ ...current, simVersion: PRACTICE_SIM_VERSION + 1 }, store)).toBe(false);
    expect(loadFormSamples(store)).toEqual([current]);

    for (const simVersion of [PRACTICE_SIM_VERSION - 1, PRACTICE_SIM_VERSION + 1]) {
      store.setItem(PRACTICE_KEYS.form, JSON.stringify({ v: 2, simVersion, samples: [current] }));
      expect(loadFormSamples(store)).toEqual([]);
    }
    store.setItem(PRACTICE_KEYS.form, JSON.stringify({ v: 1, samples: [current] }));
    expect(loadFormSamples(store)).toEqual([]);
  });
});

describe('tester mode', () => {
  it('records nothing before consent or a session, refuses answers outside the closed set, exports what was given', () => {
    const store = memoryStore();
    expect(testerEnabled(store)).toBe(false);
    expect(recordTesterAnswer('s1', { q: 'line', a: 'stumps' }, store)).toBe(false);
    setTesterEnabled(true, store);
    // No consent, no session.
    expect(startTesterSession({ ...session, consent: false as never }, store)).toBe(false);
    expect(testerSessions(store)).toHaveLength(0);
    expect(startTesterSession(session, store)).toBe(true);
    expect(
      recordTesterAnswer('s1', { q: 'line', a: 'stumps', truth: 'outside_off', ctx: { over: 1, ball: 2 } }, store),
    ).toBe(true);
    expect(recordTesterAnswer('s1', { q: 'line', a: 'over_there' }, store)).toBe(false);
    expect(recordTesterAnswer('s1', { q: 'fidelity_tactical', a: '11' }, store)).toBe(false);
    expect(recordTesterAnswer('s1', { q: 'rate_control', a: '9' }, store)).toBe(true);
    expect(recordTesterAnswer('nobody', { q: 'line', a: 'stumps' }, store)).toBe(false);
    expect(recordTesterEvent('s1', { t: 1200, type: 'marker', code: 'help', reason: 'controls' }, store)).toBe(true);
    expect(setTesterSessionField('s1', { ttfcdMs: 8400 }, store)).toBe(true);
    expect(testerAnswerCount(store)).toBe(3);
    const out = JSON.parse(testerExport(store, new Date('2026-10-26T11:00:00Z')));
    expect(out).toMatchObject({ format: 'vande-practice-tester', version: 2, exportedAt: '2026-10-26T11:00:00.000Z' });
    expect(out.sessions[0]).toMatchObject({
      consent: true,
      cohort: 'rookie',
      handReported: null,
      ttfcdMs: 8400,
      build: 'abc1234',
    });
    expect(out.sessions[0].answers).toEqual([
      { q: 'line', a: 'stumps', truth: 'outside_off', ctx: { over: 1, ball: 2 } },
      { q: 'rate_control', a: '9' },
    ]);
    expect(out.sessions[0].events).toEqual([{ t: 1200, type: 'marker', code: 'help', reason: 'controls' }]);
    clearTesterData(store);
    expect(testerAnswerCount(store)).toBe(0);
    expect(testerEnabled(store)).toBe(true);
  });

  it('a version 1 record or a session without consent is not exported', () => {
    const store = memoryStore();
    store.setItem(
      PRACTICE_KEYS.tester,
      JSON.stringify({ v: 1, enabled: true, sessions: [{ id: 'old', startedAt: 'x', answers: [] }] }),
    );
    expect(testerEnabled(store)).toBe(true);
    expect(testerSessions(store)).toHaveLength(0);
    store.setItem(
      PRACTICE_KEYS.tester,
      JSON.stringify({ v: 2, enabled: true, sessions: [{ ...session, consent: false, events: [], answers: [] }] }),
    );
    expect(testerSessions(store)).toHaveLength(0);
  });

  it('"Clear Practice data" clears mastery, form, tester answers and the sound settings too', () => {
    const store = memoryStore();
    saveMastery({ key: 'a', stage: 1, attempts: [], mastered: false }, store);
    addFormSample({ v: FORM_SAMPLE_VERSION, simVersion: PRACTICE_SIM_VERSION }, store);
    setTesterEnabled(true, store);
    store.setItem(PRACTICE_KEYS.audio, '{"v":1}');
    clearPracticeData(store);
    for (const key of [PRACTICE_KEYS.mastery, PRACTICE_KEYS.form, PRACTICE_KEYS.tester, PRACTICE_KEYS.audio])
      expect(store.getItem(key)).toBeNull();
  });
});
