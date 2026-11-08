/**
 * The Practice sink (src/audio/practice.ts) on a recording fake of Web Audio: the release gates the examiners measure
 * (COH6 contact timing and nothing on a miss, FBK1 distinct contact signatures, COH9 no reaction before the event,
 * A11Y5 captions), Delivery Quiet Mode, the §13 ducks, the bus levels, the background, and the emotion machine running
 * with the sound off. Everything is read from the hooks build's timing log (window.__vandeAudio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeContext, installFakeAudio, type FakeGain } from './fakeAudio';

let clock = 1000;
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

async function boot(opts: { sound?: boolean; captions?: boolean } = {}) {
  vi.resetModules();
  installFakeAudio();
  const audio = await import('@/audio');
  const settings = await import('@/audio/settings');
  const log = await import('@/audio/timingLog');
  const engine = await import('@/audio/engine');
  settings.setAudioSettingsStore(null);
  log.enableAudioLog(true);
  audio.syncAudioSettings({ sound: opts.sound ?? true, haptics: true });
  if (opts.captions) settings.setAudioSettings({ captions: true });
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  const sink = audio.createPracticeSink();
  window.dispatchEvent(new Event('pointerdown'));
  // This module instance's own context (an earlier test's listeners may build one in theirs).
  const ctx = engine.currentGraph()!.ctx as unknown as FakeContext;
  const entries = () => window.__vandeAudio!.log();
  const sounds = () =>
    entries()
      .filter((e) => e.type === 'sound')
      .map((e) => e.name);
  const haptics = () =>
    entries()
      .filter((e) => e.type === 'haptic')
      .map((e) => e.name);
  return {
    audio,
    settings,
    engine,
    sink,
    ctx,
    entries,
    sounds,
    haptics,
    vibrate,
    clear: () => window.__vandeAudio!.clear(),
  };
}

/** The stage's moments up to contact: the run-up 2 s, the stride 450 ms before release. */
function prelude(sink: Awaited<ReturnType<typeof boot>>['sink']) {
  sink.context({ pressure: 0, runs: 10, conditions: 'hard' });
  sink.quiet(true);
  sink.moment({ kind: 'approach', intensity: 0.4 });
  sink.moment({ kind: 'gather', intensity: 0.5 });
  sink.moment({ kind: 'release', intensity: 1 });
  sink.cue('release', 0.93, 1);
  sink.cue('bounce', 0.6, 1);
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

describe('contact (COH6, FBK1)', () => {
  it('lands on the physics contact: called ahead with its time, the sound is heard then and the haptic fires then', async () => {
    const a = await boot();
    prelude(a.sink);
    a.clear();
    const contactAt = clock + 50;
    a.sink.moment({ kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }, contactAt);
    a.sink.feel('sweet', 1, 'middle', 'perfect', contactAt);
    const crack = a.entries().find((e) => e.type === 'sound' && e.name === 'sweet')!;
    expect(Math.abs(crack.audioPerfMs! - contactAt)).toBeLessThan(1);
    expect(a.haptics()).toEqual([]);
    await advance(50);
    const buzz = a.entries().find((e) => e.type === 'haptic')!;
    expect(buzz.name).toBe('double');
    expect(Math.abs(buzz.atPerfMs - contactAt)).toBeLessThanOrEqual(1);
    expect(a.vibrate).toHaveBeenCalledWith([32, 70, 14]);
  });

  it('called at the moment itself, the sound is late by only the output latency the device reports', async () => {
    const a = await boot();
    prelude(a.sink);
    a.clear();
    a.sink.feel('middle', 0.82, 'middle', 'solid');
    const crack = a.entries().find((e) => e.name === 'middle')!;
    expect(crack.audioPerfMs! - clock).toBeLessThanOrEqual(a.ctx.outputLatency * 1000 + 3);
    expect(a.haptics()).toEqual(['pulse']);
  });

  it('middle, mistimed, sweet spot, a block, edges and a miss each sound and feel different; a miss has no contact sound and no vibration', async () => {
    const a = await boot();
    prelude(a.sink);
    const play = async (
      f: Parameters<typeof a.sink.feel>,
      contact?: 'middle' | 'top_edge' | 'inside_edge' | 'outside_edge',
    ) => {
      a.clear();
      if (contact) a.sink.moment({ kind: 'contact', intensity: 0.5, contact, timing: f[3] });
      a.sink.feel(...f);
      await advance(200);
      return [a.sounds(), a.haptics()];
    };
    expect(await play(['middle', 0.82, 'middle', 'solid'])).toEqual([['middle'], ['pulse']]);
    expect(await play(['middle', 0.62, 'middle', 'mistimed'])).toEqual([['mistimed'], ['soft']]);
    expect(await play(['sweet', 1, 'middle', 'perfect'])).toEqual([['sweet'], ['double']]);
    expect(await play(['edge', 0.7, 'inside_edge'])).toEqual([['edge_thick'], ['tick']]);
    expect(await play(['edge', 0.55, 'outside_edge'])).toEqual([['edge_thin'], ['tick']]);
    // Without the detail in feel(), the contact moment just before supplies it.
    expect(await play(['edge', 0.55], 'top_edge')).toEqual([['top_edge'], ['tick']]);
    expect(await play(['miss', 0.6])).toEqual([['swish'], []]);
    // A defended middle is a block: a damped thud and a light tap, never the sweet spot's crack and double.
    expect(await play(['block' as never, 1, 'middle', 'perfect'])).toEqual([['block'], ['tap']]);
  });
});

describe('the delivery around the contact', () => {
  it('release and pitch by surface, each ducking every lower bus; the bat contact too (§13)', async () => {
    const a = await boot();
    prelude(a.sink);
    expect(a.sounds()).toEqual(['release_fast', 'bounce_hard']);
    const g = a.engine.currentGraph()!;
    for (const bus of ['crowd', 'bed', 'music', 'interface'] as const) {
      const ev = (g.duck[bus] as unknown as FakeGain).gain.events.filter((e) => e.type === 'target');
      expect(ev.some((e) => e.value === a.engine.DUCK.depth[bus])).toBe(true);
      expect(ev.at(-1)!.value).toBe(1);
    }
    const before = (g.duck.crowd as unknown as FakeGain).gain.events.length;
    a.sink.feel('middle', 0.82, 'middle', 'solid');
    const after = (g.duck.crowd as unknown as FakeGain).gain.events.slice(before);
    expect(after.map((e) => e.type)).toEqual(['cancel', 'target', 'target']);
    // In just before the crack (at most 4 ms ahead), back after the contact's hold.
    const span = after[2].time - after[1].time;
    expect(span).toBeGreaterThanOrEqual(a.engine.DUCK.hold.contact);
    expect(span).toBeLessThanOrEqual(a.engine.DUCK.hold.contact + 0.0041);
  });

  it('Delivery Quiet Mode: no interface sound from the approach to dead ball; mastery waits for it to end', async () => {
    const a = await boot({ captions: true });
    const seen: string[] = [];
    a.audio.onCaption((c) => seen.push(c.key));
    prelude(a.sink);
    a.clear();
    a.audio.playUiCue('confirm');
    a.audio.playMasteryFeel('mastered');
    expect(a.sounds()).toEqual([]);
    a.sink.quiet(false);
    await advance(249);
    expect(a.sounds()).toEqual([]);
    await advance(1);
    expect(a.sounds()).toEqual(['mastery']);
    expect(a.haptics()).toEqual(['mastery']);
    expect(seen).toContain('mastered');
    a.audio.playUiCue('select');
    expect(a.sounds().at(-1)).toBe('ui_select');
    // An interface cue never vibrates.
    expect(a.haptics()).toEqual(['mastery']);
  });

  it('a six: nothing before the rope; then the crowd, the dhol, a strong confirmation and the captions', async () => {
    const a = await boot({ captions: true });
    const seen: Array<[string, number]> = [];
    a.audio.onCaption((c) => seen.push([c.key, c.atMs]));
    prelude(a.sink);
    expect(seen).toEqual([]);
    a.sink.moment({ kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' });
    a.sink.feel('sweet', 1, 'middle', 'perfect');
    for (const p of [0.3, 0.5, 0.7, 0.9]) {
      await advance(150);
      a.sink.moment({ kind: 'carry', intensity: p });
    }
    const ropeAt = clock + 300;
    a.clear();
    a.sink.moment({ kind: 'six', intensity: 1, runs: 6 }, ropeAt);
    const crowd = a.entries().filter((e) => e.type === 'crowd' && e.name !== 'bed');
    expect(crowd.map((e) => e.name)).toEqual(['eruption']);
    expect(crowd[0].atPerfMs).toBe(ropeAt);
    expect(
      a
        .entries()
        .filter((e) => e.name === 'dhol')
        .every((e) => e.atPerfMs >= ropeAt),
    ).toBe(true);
    expect(a.sink.emotionNow(ropeAt - 1).outcome).toBeNull();
    expect(a.haptics()).toEqual([]);
    await advance(300);
    expect(a.haptics()).toEqual(['confirm_strong']);
    expect(seen.map(([k]) => k)).toEqual(['sweet_spot', 'crowd_rises', 'six', 'crowd_erupts']);
    expect(seen.find(([k]) => k === 'six')![1]).toBe(ropeAt);
    expect(a.sink.emotionNow()).toMatchObject({ outcome: 'six', mood: 'eruption' });
  });

  it('a wicket (EMO1): the impact, a decisive haptic, decisive silence within 150 ms, then the crowd shift', async () => {
    const a = await boot({ captions: true });
    const seen: string[] = [];
    a.audio.onCaption((c) => seen.push(c.key));
    prelude(a.sink);
    a.sink.feel('miss', 0.6);
    a.clear();
    const at = clock;
    a.sink.cue('stumps', 1, 1);
    a.sink.cue('bails', 1, 1);
    a.sink.moment({ kind: 'wicket', intensity: 1, dismissal: 'bowled' });
    expect(a.sounds()).toEqual(['stumps', 'bails']);
    // The silence: the bed heads for 0.03 at once, and every crowd one-shot still sounding is faded out.
    const bed = a.entries().find((e) => e.name === 'bed')!;
    expect(bed.level).toBeLessThanOrEqual(0.03);
    const crowdDuck = (a.engine.currentGraph()!.duck.crowd as unknown as FakeGain).gain.events;
    const silence = crowdDuck.slice(-3);
    expect(silence.map((e) => [e.type, e.value])).toEqual([
      ['cancel', 0],
      ['target', 0],
      ['target', 1],
    ]);
    // A contact cue arriving with the wicket never reopens the crowd during the silence.
    a.sink.cue('stumps', 1, 1);
    expect(crowdDuck.slice(-3)).toEqual(silence);
    // The shift: the murmur of dismay, 900 ms later.
    const shift = a.entries().filter((e) => e.type === 'crowd' && e.name !== 'bed' && e.name !== 'level');
    expect(shift.map((e) => [e.name, e.atPerfMs - at])).toEqual([['dismay', 900]]);
    const before = a.sink.emotionNow(at).arousal;
    expect(a.sink.emotionNow(at + 150).arousal).toBeLessThan(before);
    await advance(100);
    expect(a.haptics()).toEqual(['decisive']);
    expect(seen).toEqual(['play_and_miss', 'bowled', 'crowd_stunned']);
  });
});

describe('settings, the background and the sound switch', () => {
  it('bus levels follow the settings at once; Practice vibration and the release tick follow theirs', async () => {
    const a = await boot();
    const g = a.engine.currentGraph()!;
    a.settings.setAudioSettings({ crowd: 0, effects: 0.5 });
    const last = (n: unknown) => (n as FakeGain).gain.events.at(-1)!.value;
    expect(last(g.level.crowd)).toBe(0);
    expect(last(g.bedLevel)).toBe(0);
    expect(last(g.level.effects)).toBeCloseTo(a.engine.busGain(0.5), 6);
    a.settings.setAudioSettings({ releaseHaptic: true });
    prelude(a.sink);
    await advance(10);
    expect(a.haptics()).toEqual(['whisper']);
    a.settings.setAudioSettings({ haptics: false });
    a.clear();
    a.sink.feel('sweet', 1, 'middle', 'perfect');
    await advance(200);
    expect(a.haptics()).toEqual([]);
    expect(a.sounds()).toEqual(['sweet']);
  });

  it('with the sound off the emotion machine still runs (the 3D crowd follows it); nothing plays', async () => {
    const a = await boot({ sound: false });
    prelude(a.sink);
    const hush = a.sink.emotionNow().arousal;
    a.sink.moment({ kind: 'four', intensity: 1, runs: 4 });
    await advance(400);
    expect(a.sink.emotionNow().arousal).toBeGreaterThan(hush + 0.4);
    expect(a.sounds()).toEqual([]);
  });

  it('the background stops every voice and suspends; coming back resumes and re-syncs the crowd bed', async () => {
    const a = await boot();
    prelude(a.sink);
    a.sink.moment({ kind: 'six', intensity: 1, runs: 6 });
    const live = a.ctx.sources().filter((s) => s.starts.length && s.kind === 'buffer' && !s.loop);
    expect(live.length).toBeGreaterThan(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(a.ctx.log.at(-1)).toBe('suspend');
    expect(live.every((s) => s.stops.length > 0)).toBe(true);
    const bedEvents = a.entries().filter((e) => e.name === 'bed').length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(a.ctx.log.at(-1)).toBe('resume');
    expect(a.entries().filter((e) => e.name === 'bed').length).toBe(bedEvents + 1);
  });

  it('captions (A11Y5) come from the stored setting with the sound off and before any unlock, moments or not', async () => {
    vi.resetModules();
    installFakeAudio();
    localStorage.setItem('vc:practice:audio', JSON.stringify({ v: 1, captions: true }));
    const audio = await import('@/audio');
    audio.syncAudioSettings({ sound: false, haptics: false });
    const seen: string[] = [];
    audio.onCaption((c) => seen.push(c.key));
    // No gesture, no graph, nothing read the settings yet: a sink as the stage creates it, before it sends moments.
    const sink = audio.createPracticeSink();
    sink.feel('middle', 0.82, 'middle', 'solid');
    sink.feel('miss', 0.6);
    sink.feel('six', 1);
    sink.feel('bowled', 1);
    sink.feel('catch', 1);
    expect(seen).toEqual(['middle', 'play_and_miss', 'six', 'bowled', 'caught']);
    expect(FakeContext.made).toHaveLength(0);
    localStorage.removeItem('vc:practice:audio');
  });

  it('before the stage sends moments, cue() keeps the Sealed Six mapping (nothing changes until it is wired)', async () => {
    const a = await boot();
    a.sink.cue('boundary', 1, 1);
    expect(a.sounds()).toEqual([]);
    expect(a.ctx.sources().some((s) => s.kind === 'buffer' && s.loop)).toBe(true);
  });
});
