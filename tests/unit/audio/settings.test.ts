/**
 * Sound settings (src/audio/settings.ts) and captions (src/audio/captions.ts): validated storage under
 * 'vc:practice:audio', a stable snapshot for useSyncExternalStore, change notifications, reset, and captions that
 * exist only while the setting is on, with closed keys for every essential cue.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO_SETTINGS,
  getAudioSettings,
  loadAudioSettings,
  normaliseAudioSettings,
  resetAudioSettings,
  setAudioSettings,
  setAudioSettingsStore,
  subscribeAudioSettings,
  type AudioKeyStore,
} from '@/audio/settings';
import {
  CAPTION_KEYS,
  captionsEnabled,
  contactCaption,
  dismissalCaption,
  emitCaption,
  onCaption,
  setCaptionClock,
  type Caption,
} from '@/audio/captions';
import { deliveryContext, matchPressure, milestoneInReach } from '@/audio/emotion';

function memory(): AudioKeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let store = memory();
beforeEach(() => {
  store = memory();
  setAudioSettingsStore(store);
});
afterEach(() => setAudioSettingsStore(undefined));

describe('sound settings', () => {
  it('defaults: every bus at full, Practice vibration on, the release tick and captions off', () => {
    expect(getAudioSettings()).toEqual({
      v: 1,
      effects: 1,
      crowd: 1,
      music: 1,
      haptics: true,
      releaseHaptic: false,
      captions: false,
    });
    expect(DEFAULT_AUDIO_SETTINGS).toEqual(getAudioSettings());
    expect(AUDIO_SETTINGS_KEY).toBe('vc:practice:audio');
  });

  it('validates every read: corrupt JSON, wrong types and out-of-range levels never get through', () => {
    store.map.set(AUDIO_SETTINGS_KEY, '{not json');
    expect(loadAudioSettings(store)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(
      normaliseAudioSettings({ effects: 7, crowd: -1, music: '0.5', haptics: 'yes', captions: true, extra: 1 }),
    ).toEqual({ ...DEFAULT_AUDIO_SETTINGS, effects: 1, crowd: 0, captions: true });
    expect(normaliseAudioSettings({ effects: 0.333333, crowd: Number.NaN })).toMatchObject({ effects: 0.33, crowd: 1 });
    expect(normaliseAudioSettings([1, 2])).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('saves, applies and notifies at once; the snapshot changes identity only on a change', () => {
    const a = getAudioSettings();
    expect(getAudioSettings()).toBe(a);
    let calls = 0;
    const off = subscribeAudioSettings(() => calls++);
    const b = setAudioSettings({ crowd: 0.5, captions: true });
    expect(b).not.toBe(a);
    expect(Object.isFrozen(b)).toBe(true);
    expect(getAudioSettings()).toBe(b);
    expect(JSON.parse(store.map.get(AUDIO_SETTINGS_KEY)!)).toMatchObject({ v: 1, crowd: 0.5, captions: true });
    expect(calls).toBe(1);
    // Nothing changed: the same snapshot, no notification.
    expect(setAudioSettings({ crowd: 0.5 })).toBe(b);
    expect(calls).toBe(1);
    off();
    setAudioSettings({ music: 0 });
    expect(calls).toBe(1);
    // A fresh load reads what was saved.
    setAudioSettingsStore(store);
    expect(getAudioSettings()).toMatchObject({ crowd: 0.5, music: 0, captions: true });
  });

  it('reset clears the stored value and returns to the defaults', () => {
    setAudioSettings({ effects: 0, haptics: false });
    expect(resetAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(store.map.has(AUDIO_SETTINGS_KEY)).toBe(false);
  });

  it('works with no storage at all (the settings still apply for the session)', () => {
    setAudioSettingsStore(null);
    expect(setAudioSettings({ crowd: 0 }).crowd).toBe(0);
  });
});

describe('captions', () => {
  it('emit only while the Captions setting is on', () => {
    const seen: Caption[] = [];
    const off = onCaption((c) => seen.push(c));
    setCaptionClock(() => 1234);
    setAudioSettings({ captions: false });
    emitCaption('bowled');
    expect(seen).toEqual([]);
    setAudioSettings({ captions: true });
    expect(captionsEnabled()).toBe(true);
    emitCaption('bowled');
    emitCaption('crowd_erupts');
    expect(seen.map((c) => [c.key, c.kind, c.atMs])).toEqual([
      ['bowled', 'wicket', 1234],
      ['crowd_erupts', 'crowd', 1234],
    ]);
    expect(seen[1].id).toBeGreaterThan(seen[0].id);
    expect(seen.every((c) => c.holdMs >= 1500)).toBe(true);
    off();
    setAudioSettings({ captions: false });
  });

  it('closed keys cover every contact, dismissal, boundary, milestone, crowd beat and coach moment', () => {
    expect(contactCaption('middle', 'perfect')).toBe('sweet_spot');
    expect(contactCaption('middle', 'solid')).toBe('middle');
    expect(contactCaption('middle', 'mistimed')).toBe('mistimed');
    expect(contactCaption('top_edge')).toBe('top_edge');
    expect(contactCaption('miss')).toBe('play_and_miss');
    expect(contactCaption('leave')).toBeNull();
    expect(dismissalCaption('caught_behind')).toBe('caught_behind');
    expect(dismissalCaption('lbw')).toBe('lbw');
    for (const k of [
      'inside_edge',
      'outside_edge',
      'leading_edge',
      'pad',
      'body',
      'bowled',
      'caught',
      'not_out',
      'four',
      'six',
      'milestone_fifty',
      'milestone_hundred',
      'crowd_rises',
      'crowd_gasps',
      'crowd_groans',
      'crowd_applauds',
      'crowd_cheers',
      'crowd_stunned',
      'crowd_relieved',
      'crowd_ovation',
      'mastered',
      'stage_up',
    ] as const) {
      expect(CAPTION_KEYS).toContain(k);
    }
    expect(new Set(CAPTION_KEYS).size).toBe(CAPTION_KEYS.length);
  });
});

describe('the match situation', () => {
  it('pressure: final over, last ball, a close chase, the last wicket in a chase, a milestone in reach', () => {
    const calm = { runs: 20, wicketsInHand: 1, ballsLeft: null };
    expect(matchPressure(calm)).toBe(0);
    expect(matchPressure({ ...calm, ballsLeft: 6 })).toBeCloseTo(0.25, 6);
    expect(matchPressure({ ...calm, ballsLeft: 1 })).toBeCloseTo(0.35, 6);
    expect(matchPressure({ ...calm, runs: 46 })).toBeCloseTo(0.12, 6);
    // A chase in the balance near the end is tense; a lost cause or a won one is not.
    const close = matchPressure({ runs: 40, wicketsInHand: 3, ballsLeft: 6, target: 48 });
    const hopeless = matchPressure({ runs: 10, wicketsInHand: 3, ballsLeft: 6, target: 60 });
    const won = matchPressure({ runs: 60, wicketsInHand: 3, ballsLeft: 6, target: 60 });
    expect(close).toBeGreaterThan(0.75);
    expect(close).toBeGreaterThan(hopeless);
    expect(won).toBeCloseTo(0.25, 6);
    expect(matchPressure({ runs: 40, wicketsInHand: 1, ballsLeft: 6, target: 48 })).toBeGreaterThan(close);
    expect(matchPressure({ runs: 0, wicketsInHand: 1, ballsLeft: 1, target: 6, batterRuns: 47 })).toBe(1);
  });

  it('milestones in reach and the context the stage receives', () => {
    expect([43, 44, 49, 50, 94, 99, 100, 144].map(milestoneInReach)).toEqual([
      null,
      'fifty',
      'fifty',
      null,
      'hundred',
      'hundred',
      null,
      'fifty',
    ]);
    expect(deliveryContext({ runs: 47, wicketsInHand: 1, ballsLeft: 30 })).toEqual({
      pressure: 0.12,
      milestone: 'fifty',
      wicketEndsInnings: true,
      runs: 47,
    });
    expect(deliveryContext({ runs: 47, wicketsInHand: 2, ballsLeft: null, batterRuns: 12 })).toMatchObject({
      milestone: null,
      wicketEndsInnings: false,
      runs: 12,
    });
  });
});
