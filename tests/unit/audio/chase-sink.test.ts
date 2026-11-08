/**
 * The Practice sink at the end of a chase (owner: COPY), on the same recording fake of Web Audio as
 * practice-sink.test.ts: the six that wins the chase is an ovation with the drums; the same six on the last ball when it
 * cannot win gets the crowd's applause and no drums, and the captions say only what the sound does. An innings without
 * a target keeps its eruption and its drums. Every caption is an existing closed key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeAudio } from './fakeAudio';

let clock = 1000;
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

async function boot() {
  vi.resetModules();
  installFakeAudio();
  const audio = await import('@/audio');
  const settings = await import('@/audio/settings');
  const log = await import('@/audio/timingLog');
  settings.setAudioSettingsStore(null);
  log.enableAudioLog(true);
  audio.syncAudioSettings({ sound: true, haptics: true });
  settings.setAudioSettings({ captions: true });
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vi.fn(() => true) });
  const sink = audio.createPracticeSink();
  window.dispatchEvent(new Event('pointerdown'));
  const entries = () => window.__vandeAudio!.log();
  return { audio, sink, entries, clear: () => window.__vandeAudio!.clear() };
}
type Booted = Awaited<ReturnType<typeof boot>>;

/** The run-up and a middled hit that carries to the rope, with the scoreboard the flow hands the stage for this ball. */
async function struckBall(a: Booted, ctx: Parameters<Booted['sink']['context']>[0]) {
  a.sink.context({ conditions: 'hard', ...ctx });
  a.sink.quiet(true);
  a.sink.moment({ kind: 'approach', intensity: 0.4 });
  a.sink.moment({ kind: 'gather', intensity: 0.5 });
  a.sink.moment({ kind: 'release', intensity: 1 });
  a.sink.cue('release', 0.93, 1);
  a.sink.cue('bounce', 0.6, 1);
  a.sink.moment({ kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' });
  a.sink.feel('sweet', 1, 'middle', 'perfect');
  for (const p of [0.3, 0.5, 0.7, 0.9]) {
    await advance(150);
    a.sink.moment({ kind: 'carry', intensity: p });
  }
}

beforeEach(() => {
  clock = 1000;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function sixAtTheRope(ctx: Parameters<Booted['sink']['context']>[0]) {
  const a = await boot();
  const seen: string[] = [];
  a.audio.onCaption((c) => seen.push(c.key));
  await struckBall(a, ctx);
  const ropeAt = clock + 300;
  a.clear();
  a.sink.moment({ kind: 'six', intensity: 1, runs: 6 }, ropeAt);
  await advance(2000);
  const crowd = a
    .entries()
    .filter((e) => e.type === 'crowd' && e.name !== 'bed' && e.name !== 'level')
    .map((e) => e.name);
  const dhol = a.entries().filter((e) => e.name === 'dhol').length;
  return { a, seen, crowd, dhol, ropeAt };
}

describe('a six at the end of a chase', () => {
  it('that wins it on the last ball: a standing ovation, the drums, and the caption of the ovation', async () => {
    const { a, seen, crowd, dhol, ropeAt } = await sixAtTheRope({ pressure: 0.9, runs: 10, target: 16, ballsLeft: 1 });
    expect(crowd).toEqual(['ovation']);
    expect(dhol).toBe(2);
    expect(seen).toEqual(['sweet_spot', 'crowd_rises', 'six', 'crowd_ovation']);
    expect(a.sink.emotionNow(ropeAt + 600)).toMatchObject({ outcome: 'six', mood: 'ovation' });
    // No look-ahead: until the rope the crowd had no outcome at all.
    expect(a.sink.emotionNow(ropeAt - 1).outcome).toBeNull();
  });

  it('that cannot win it on the last ball: the crowd applauds, the drums stay silent, and the mood turns to dismay', async () => {
    const { a, seen, crowd, dhol, ropeAt } = await sixAtTheRope({ pressure: 0.9, runs: 10, target: 30, ballsLeft: 1 });
    expect(crowd).toEqual(['applause']);
    expect(dhol).toBe(0);
    expect(seen).toEqual(['sweet_spot', 'crowd_rises', 'six', 'crowd_applauds']);
    expect(a.sink.emotionNow(ropeAt + 600).mood).toBe('applause');
    expect(a.sink.emotionNow(ropeAt + 2500).mood).toBe('dismay');
  });

  it('in an innings that is not a chase: the eruption and the drums, as before', async () => {
    const { crowd, dhol, seen } = await sixAtTheRope({ pressure: 0.2, runs: 10 });
    expect(crowd).toEqual(['eruption']);
    expect(dhol).toBe(2);
    expect(seen).toEqual(['sweet_spot', 'crowd_rises', 'six', 'crowd_erupts']);
  });

  it('in a chase with balls to spare that is not yet won: the ordinary six', async () => {
    const { crowd, dhol, seen } = await sixAtTheRope({ pressure: 0.6, runs: 10, target: 40, ballsLeft: 6 });
    expect(crowd).toEqual(['eruption']);
    expect(dhol).toBe(2);
    expect(seen.at(-1)).toBe('crowd_erupts');
  });
});

describe('a wicket in a chase', () => {
  it('is the decisive silence and the dismay, and the drums never play', async () => {
    const a = await boot();
    const seen: string[] = [];
    a.audio.onCaption((c) => seen.push(c.key));
    a.sink.context({ conditions: 'hard', pressure: 0.8, runs: 10, target: 30, ballsLeft: 7 });
    a.sink.quiet(true);
    a.sink.moment({ kind: 'approach', intensity: 0.4 });
    a.sink.moment({ kind: 'gather', intensity: 0.5 });
    a.sink.moment({ kind: 'release', intensity: 1 });
    a.sink.feel('miss', 0.6);
    a.clear();
    const at = clock;
    a.sink.moment({ kind: 'wicket', intensity: 1, dismissal: 'bowled' });
    await advance(1500);
    const shift = a.entries().filter((e) => e.type === 'crowd' && e.name !== 'bed' && e.name !== 'level');
    expect(shift.map((e) => [e.name, e.atPerfMs - at])).toEqual([['dismay', 900]]);
    expect(a.entries().some((e) => e.name === 'dhol')).toBe(false);
    expect(seen).toEqual(['play_and_miss', 'bowled', 'crowd_stunned']);
    expect(a.sink.emotionNow(at + 1200).mood).toBe('dismay');
  });
});
