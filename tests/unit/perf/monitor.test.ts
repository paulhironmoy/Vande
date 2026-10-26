import { describe, expect, it } from 'vitest';
import { PERF_ASSISTED_TOLERANCE_MS, SessionMonitor, createFrameSampler } from '@/perf';
import { steady } from './fixtures';

function play(m: SessionMonitor, fps: number, seconds = 3) {
  for (const v of steady(fps, seconds)) m.sample(v);
  return m.checkpoint();
}

describe('SessionMonitor (thermal throttling)', () => {
  it('needs three deliveries before judging, then steps Full → Assisted under 50 fps', () => {
    const m = new SessionMonitor({ tier: 'full', profile: 'standard', stage: '3d' });
    expect(play(m, 42)).toBeNull();
    expect(play(m, 42)).toBeNull();
    const d = play(m, 42);
    expect(d).toMatchObject({ tier: 'assisted', profile: 'lite', stage: '3d', reason: 'session_fps_drop', toleranceMs: PERF_ASSISTED_TOLERANCE_MS });
    expect(m.snapshot.tier).toBe('assisted');
  });

  it('one slow delivery among good ones changes nothing (median)', () => {
    const m = new SessionMonitor({ tier: 'full', profile: 'standard', stage: '3d' });
    expect(play(m, 60)).toBeNull();
    expect(play(m, 30)).toBeNull();
    expect(play(m, 60)).toBeNull();
    expect(play(m, 60)).toBeNull();
  });

  it('High steps down to Standard first, under 55 fps', () => {
    const m = new SessionMonitor({ tier: 'full', profile: 'high', stage: '3d' });
    play(m, 52);
    play(m, 52);
    expect(play(m, 52)).toMatchObject({ tier: 'full', profile: 'standard', stage: '3d' });
  });

  it('Assisted → Classic under the 45 fps cutoff; Classic is the floor', () => {
    const m = new SessionMonitor({ tier: 'assisted', profile: 'lite', stage: '3d' });
    play(m, 40);
    play(m, 40);
    expect(play(m, 40)).toMatchObject({ tier: 'below', stage: '2d' });
    play(m, 10);
    play(m, 10);
    expect(play(m, 10)).toBeNull();
  });

  it('never steps up again', () => {
    const m = new SessionMonitor({ tier: 'full', profile: 'standard', stage: '3d' });
    play(m, 40);
    play(m, 40);
    play(m, 40);
    for (let i = 0; i < 5; i++) expect(play(m, 60)).toBeNull();
    expect(m.snapshot.tier).toBe('assisted');
  });

  it('short windows (a quick leave) do not count', () => {
    const m = new SessionMonitor({ tier: 'full', profile: 'standard', stage: '3d' });
    for (let i = 0; i < 6; i++) expect(play(m, 30, 0.5)).toBeNull();
  });

  it('repeated context loss goes straight to Classic between balls', () => {
    const m = new SessionMonitor({ tier: 'full', profile: 'standard', stage: '3d' });
    m.noteContextLoss();
    expect(m.checkpoint()).toBeNull();
    m.noteContextLoss();
    expect(m.checkpoint()).toMatchObject({ tier: 'below', stage: '2d', reason: 'session_context_lost' });
  });
});

describe('createFrameSampler', () => {
  it('reports intervals between frames while started', () => {
    const queue: FrameRequestCallback[] = [];
    const got: number[] = [];
    const s = createFrameSampler((ms) => got.push(ms), { raf: (cb) => (queue.push(cb), queue.length), caf: () => {} });
    s.start();
    for (const t of [100, 116, 133]) queue.shift()?.(t);
    expect(got).toEqual([16, 17]);
    s.stop();
    queue.shift()?.(150);
    expect(got).toEqual([16, 17]);
    expect(s.running).toBe(false);
  });
});
