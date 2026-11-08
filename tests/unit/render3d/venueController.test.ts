/**
 * The baked venue's controller (three/venue.ts): nothing waits for it, nothing starts, compiles or swaps during a delivery
 * (rubric PERF2 and PERF4, Definition of Done VEN-03), a failure keeps the procedural stand-in, a lower quality restores it.
 * The pack, the network and the GPU are stand-ins here; the real pack's structure is tested in venuePack.test.ts.
 */
import { Group, Mesh, type Camera, type Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  BAKED_VENUE_BUILT,
  FADE_MS,
  MAX_ATTEMPTS,
  createVenueController,
  packFor,
  type VenueDeps,
  type VenuePack,
} from '@/render3d/three/venue';
import type { BakedVenue } from '@/render3d/three/venueBaked';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeVenue(): BakedVenue & { fades: number[] } {
  const fades: number[] = [];
  return {
    group: new Group(),
    fades,
    setFade: (f) => fades.push(f),
    warm: vi.fn(),
    stats: () => ({ triangles: 1, drawCalls: 2, instances: [1], textureBytes: 3, geometryBytes: 4 }),
    dispose: vi.fn(),
  };
}

function rig(extra: Partial<VenueDeps> = {}) {
  const stadiumGroup = new Group();
  const standIn = [new Mesh(), new Mesh(), new Mesh(), new Mesh()];
  stadiumGroup.userData.venue = { uniforms: { uTime: { value: 0 } }, replaces: standIn };
  const world = { delivery: false, reduced: false, t: 1000 };
  const host = {
    stadiumGroup,
    scene: {} as Scene,
    camera: {} as Camera,
    renderer: {} as WebGLRenderer,
    isDelivery: () => world.delivery,
    reducedMotion: () => world.reduced,
  };
  const loads: Array<{
    pack: VenuePack;
    signal: AbortSignal;
    resolve: (v: BakedVenue) => void;
    reject: (e: unknown) => void;
  }> = [];
  const load = vi.fn(
    (pack: VenuePack, _uniforms: unknown, signal: AbortSignal) =>
      new Promise<BakedVenue>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        loads.push({ pack, signal, resolve, reject });
      }),
  );
  const states: string[] = [];
  const c = createVenueController(host, {
    load,
    now: () => world.t,
    override: null,
    onState: (s) => states.push(s),
    ...extra,
  });
  const tick = (ms = 0) => {
    world.t += ms;
    c.tick();
  };
  /** Frames of 16 ms for `ms` (the controller caps one step at 100 ms so a long frame cannot jump the dissolve). */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 16) tick(16);
  };
  const standInVisible = () => standIn.map((m) => m.visible);
  return { c, load, loads, world, tick, run, standIn, standInVisible, stadiumGroup, states };
}

describe('which pack a quality gets', () => {
  it('gives Premium the full pack, Balanced Standard the light one, Lite and Classic none', () => {
    expect(packFor('high')).toBe('premium');
    expect(packFor('standard')).toBe('balanced');
    expect(packFor('lite')).toBeNull();
    expect(BAKED_VENUE_BUILT).toBe(true); // a web build carries the venue; the Android default build does not (compiled out)
  });
});

describe('the venue controller', () => {
  it('waits for an idle frame: no download at mount and none inside a delivery', () => {
    const r = rig();
    r.c.setProfile('high');
    expect(r.c.inspect()).toMatchObject({ pack: 'premium', state: 'idle', attempts: 0 });
    expect(r.load).not.toHaveBeenCalled();
    r.world.delivery = true;
    r.tick();
    r.tick(100);
    expect(r.load).not.toHaveBeenCalled();
    r.world.delivery = false;
    r.tick();
    expect(r.load).toHaveBeenCalledTimes(1);
    expect(r.loads[0].pack).toBe('premium');
    expect(r.c.inspect().state).toBe('loading');
  });

  it('keeps the stand-in for Lite and Classic and loads nothing', () => {
    const r = rig();
    r.c.setProfile('lite');
    r.tick();
    expect(r.load).not.toHaveBeenCalled();
    expect(r.c.inspect().state).toBe('off');
    expect(r.standInVisible()).toEqual([true, true, true, true]);
  });

  it('does not download anything when the browser is asked to save data', () => {
    const had = Object.getOwnPropertyDescriptor(navigator, 'connection');
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    try {
      const r = rig();
      r.c.setProfile('high');
      r.tick();
      expect(r.load).not.toHaveBeenCalled();
      expect(r.c.inspect().state).toBe('off');
      expect(r.standInVisible()).toEqual([true, true, true, true]);
    } finally {
      if (had) Object.defineProperty(navigator, 'connection', had);
      else delete (navigator as { connection?: unknown }).connection;
    }
  });

  it('is switched off by the test override (one build compared with itself)', () => {
    const r = rig({ override: 'off' });
    r.c.setProfile('high');
    r.tick();
    expect(r.load).not.toHaveBeenCalled();
    expect(r.c.inspect().state).toBe('off');
  });

  it('aborts a download in flight when a delivery starts, tries again afterwards and gives up after MAX_ATTEMPTS', async () => {
    const r = rig();
    r.c.setProfile('standard');
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      r.tick();
      expect(r.load).toHaveBeenCalledTimes(attempt);
      expect(r.loads[attempt - 1].pack).toBe('balanced');
      r.world.delivery = true;
      r.c.setDelivery(true);
      expect(r.loads[attempt - 1].signal.aborted).toBe(true);
      await flush();
      r.tick(); // still in the delivery: nothing starts
      expect(r.load).toHaveBeenCalledTimes(attempt);
      r.world.delivery = false;
      r.c.setDelivery(false);
      if (attempt < MAX_ATTEMPTS) expect(r.c.inspect().state).toBe('idle');
    }
    expect(r.c.inspect()).toMatchObject({ state: 'failed', attempts: MAX_ATTEMPTS });
    expect(r.standInVisible()).toEqual([true, true, true, true]);
    r.tick();
    expect(r.load).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('warms and swaps only between deliveries, freezes the dissolve inside one, and hides the stand-in at the end', async () => {
    const r = rig();
    const venue = fakeVenue();
    r.c.setProfile('high');
    r.tick();
    r.world.delivery = true; // the download finishes while a delivery is live
    r.loads[0].resolve(venue);
    await flush();
    r.tick();
    expect(venue.warm).not.toHaveBeenCalled(); // no shader compile inside a delivery
    expect(r.c.inspect().state).toBe('loaded');
    r.world.delivery = false;
    r.tick();
    expect(venue.warm).toHaveBeenCalledTimes(1);
    expect(r.c.inspect().state).toBe('ready');
    r.tick();
    expect(r.c.inspect().state).toBe('fading');
    expect(r.stadiumGroup.children).toContain(venue.group);
    expect(r.standInVisible()).toEqual([true, true, true, true]); // the stand-in is still the picture during the dissolve
    r.run(FADE_MS / 2);
    expect(venue.fades.at(-1)).toBeCloseTo(0.5, 1);
    const halfway = venue.fades.at(-1);
    r.world.delivery = true;
    r.run(800); // frozen inside a delivery
    expect(venue.fades.at(-1)).toBe(halfway);
    r.world.delivery = false;
    r.tick(0); // the first idle frame after it: no jump from the time that passed
    expect(venue.fades.at(-1)).toBe(halfway);
    r.run(FADE_MS / 2 + 48);
    expect(r.c.inspect().state).toBe('shown');
    expect(r.standInVisible()).toEqual([false, false, false, false]);
    expect(r.c.inspect().stats).toMatchObject({ drawCalls: 2 });
  });

  it('shows at once under Reduced Motion', async () => {
    const r = rig();
    r.world.reduced = true;
    r.c.setProfile('high');
    r.tick();
    r.loads[0].resolve(fakeVenue());
    await flush();
    r.tick();
    r.tick();
    r.tick();
    r.tick(16);
    expect(r.c.inspect().state).toBe('shown');
  });

  it('keeps the stand-in when the download, the pack or the warm-up fails', async () => {
    const failed = rig();
    failed.c.setProfile('high');
    failed.tick();
    failed.loads[0].reject(new Error('HTTP 404'));
    await flush();
    expect(failed.c.inspect()).toMatchObject({ state: 'failed', reason: 'HTTP 404' });
    expect(failed.standInVisible()).toEqual([true, true, true, true]);
    failed.tick();
    expect(failed.load).toHaveBeenCalledTimes(1);

    const warm = rig();
    const venue = fakeVenue();
    (venue.warm as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('shader link failed');
    });
    warm.c.setProfile('high');
    warm.tick();
    warm.loads[0].resolve(venue);
    await flush();
    warm.tick();
    expect(warm.c.inspect()).toMatchObject({ state: 'failed', reason: 'shader link failed' });
    expect(venue.dispose).toHaveBeenCalled();
    expect(warm.standInVisible()).toEqual([true, true, true, true]);
  });

  it('fails safely when there is no stand-in to replace', () => {
    const r = rig();
    r.stadiumGroup.userData.venue = undefined;
    r.c.setProfile('high');
    r.tick();
    expect(r.c.inspect()).toMatchObject({ state: 'failed' });
    expect(r.load).not.toHaveBeenCalled();
  });

  it('restores the stand-in and drops the baked venue when the quality steps down or the stage goes', async () => {
    const r = rig();
    const venue = fakeVenue();
    r.c.setProfile('high');
    r.tick();
    r.loads[0].resolve(venue);
    await flush();
    r.tick();
    r.tick();
    r.run(FADE_MS + 32);
    expect(r.c.inspect().state).toBe('shown');
    r.c.setProfile('lite');
    expect(r.c.inspect().state).toBe('off');
    expect(venue.dispose).toHaveBeenCalledTimes(1);
    expect(r.standInVisible()).toEqual([true, true, true, true]);
    r.c.setProfile('standard');
    expect(r.c.inspect()).toMatchObject({ pack: 'balanced', state: 'idle' });
    r.c.dispose();
    expect(r.c.inspect().state).toBe('off');
  });

  it('drops a download that finishes after the quality changed', async () => {
    let finish: (v: BakedVenue) => void = () => undefined;
    const r = rig({
      load: () =>
        new Promise<BakedVenue>((resolve) => {
          finish = resolve;
        }),
    });
    const late = fakeVenue();
    r.c.setProfile('high');
    r.tick();
    r.c.setProfile('lite');
    finish(late);
    await flush();
    expect(late.dispose).toHaveBeenCalledTimes(1);
    expect(r.c.inspect().state).toBe('off');
  });
});
