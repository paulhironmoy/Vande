/**
 * CTR-06: haptics stay for touch only. Through the real chain (the control chosen -> the Practice sink on a recording fake
 * of Web Audio -> navigator.vibrate), a mouse or camera player's contact, six, wicket and mastery confirmation make no
 * vibration call at all, and a touch player's make at least one. The camera case matters twice: a phone propped up for
 * the camera must not shake its own view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeAudio } from '../../../audio/fakeAudio';

let clock = 1000;
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};
const realMatchMedia = window.matchMedia;

async function boot(opts: { touch?: boolean; haptics?: boolean } = {}) {
  vi.resetModules();
  installFakeAudio();
  localStorage.clear();
  if (opts.touch)
    window.matchMedia = ((q: string) => ({
      matches: q === '(pointer: coarse)' || q === '(any-pointer: coarse)',
    })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
  const audio = await import('@/audio');
  const settings = await import('@/audio/settings');
  const log = await import('@/audio/timingLog');
  const camera = await import('@/practice/ui/controls/cameraPort');
  const controls = await import('@/practice/ui/controls/state');
  settings.setAudioSettingsStore(null);
  log.enableAudioLog(true);
  audio.syncAudioSettings({ sound: true, haptics: opts.haptics ?? true });
  camera.setCameraForTests({ info: { offered: true, packMb: 9.2 }, port: { Setup: () => null, stop: vi.fn() } });
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  const sink = audio.createPracticeSink();
  window.dispatchEvent(new Event('pointerdown'));
  return { audio, controls, sink, vibrate };
}
type Rig = Awaited<ReturnType<typeof boot>>;

/** A whole ball's feel: the run-up, a contact, a six over the rope, a wicket, and a mastered exact ball. */
async function playEverything(a: Rig) {
  const { sink } = a;
  sink.context({ pressure: 0, runs: 10, conditions: 'hard' });
  sink.quiet(true);
  sink.moment({ kind: 'approach', intensity: 0.4 });
  sink.moment({ kind: 'release', intensity: 1 });
  sink.cue('release', 0.93, 1);
  sink.cue('bounce', 0.6, 1);
  const contactAt = clock + 50;
  sink.moment({ kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }, contactAt);
  sink.feel('sweet', 1, 'middle', 'perfect', contactAt);
  await advance(100);
  sink.moment({ kind: 'six', intensity: 1, runs: 6 }, clock + 300);
  await advance(400);
  sink.feel('miss', 0.6);
  sink.cue('stumps', 1, 1);
  sink.moment({ kind: 'wicket', intensity: 1, dismissal: 'bowled' });
  await advance(400);
  a.audio.playMasteryFeel('mastered');
  await advance(400);
}

beforeEach(() => {
  clock = 1000;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('haptics are for the finger only', () => {
  it('a mouse player: no vibration call for contact, a six, a wicket or the mastery confirmation', async () => {
    const a = await boot();
    a.controls.setControl('mouse');
    await playEverything(a);
    expect(a.vibrate).not.toHaveBeenCalled();
  });

  it('a camera player: none either', async () => {
    const a = await boot();
    a.controls.setControl('camera');
    expect(a.controls.currentControl()).toBe('camera');
    await playEverything(a);
    expect(a.vibrate).not.toHaveBeenCalled();
  });

  it('a touch player: the contact, the six, the wicket and the mastery confirmation all vibrate', async () => {
    const a = await boot({ touch: true });
    a.controls.setControl('touch');
    expect(a.controls.currentControl()).toBe('touch');
    await playEverything(a);
    expect(a.vibrate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('switching between balls changes it at once, in both directions', async () => {
    const a = await boot({ touch: true });
    a.controls.setControl('touch');
    a.sink.feel('sweet', 1, 'middle', 'perfect');
    await advance(100);
    const withTouch = a.vibrate.mock.calls.length;
    expect(withTouch).toBeGreaterThanOrEqual(1);
    a.controls.setControl('camera');
    await advance(200);
    a.sink.feel('sweet', 1, 'middle', 'perfect');
    await advance(100);
    expect(a.vibrate.mock.calls.length).toBe(withTouch);
    a.controls.setControl('touch');
    await advance(200);
    a.sink.feel('sweet', 1, 'middle', 'perfect');
    await advance(100);
    expect(a.vibrate.mock.calls.length).toBeGreaterThan(withTouch);
  });

  it('the Vibration switch in Settings still wins for touch', async () => {
    const a = await boot({ touch: true, haptics: false });
    a.controls.setControl('touch');
    await playEverything(a);
    expect(a.vibrate).not.toHaveBeenCalled();
  });

  it('the sound is the same for every control: only the vibration depends on it', async () => {
    const a = await boot({ touch: true });
    const sounds = () =>
      window
        .__vandeAudio!.log()
        .filter((e) => e.type === 'sound')
        .map((e) => e.name);
    a.sink.context({ pressure: 0, runs: 10, conditions: 'hard' });
    a.sink.quiet(true);
    a.sink.cue('release', 0.93, 1);
    const heard: string[][] = [];
    for (const control of ['touch', 'camera'] as const) {
      a.controls.setControl(control);
      window.__vandeAudio!.clear();
      a.sink.moment({ kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }, clock + 20);
      a.sink.feel('sweet', 1, 'middle', 'perfect', clock + 20);
      await advance(300);
      heard.push(sounds());
    }
    expect(heard[0].length).toBeGreaterThan(0);
    expect(heard[1]).toEqual(heard[0]);
  });
});
