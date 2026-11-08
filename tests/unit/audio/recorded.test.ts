/**
 * Recorded takes (src/audio/takes.ts, recorded.ts, recordedManifest.ts): deterministic take selection from the delivery
 * record (the exact-ball retry hears the same takes), the COH6 onset alignment, FBK1 distinct signatures, and the
 * synthesised fallback whenever a take is missing, fails to load, fails its integrity check or is switched off. The
 * shipped manifest is checked against the files in public/audio/cricket/ byte for byte, in the applause takes' MP3
 * format, and its placeholder takes (scripts/audio/placeholders.mjs) against their processed record and honest labels.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alignedStart, deliveryTakeKey, findOnset, fnv1a32, takeIndex, takeUnit } from '@/audio/takes';
import { CONTACT_TAKES, RECORDED_KINDS, RECORDED_PENDING, type RecordedKind } from '@/audio/recordedManifest';
import { FakeBuffer, FakeContext, installFakeAudio, type FakeSource } from './fakeAudio';

describe('take selection (pure)', () => {
  it('FNV-1a 32 matches the reference vectors (for the Unity port)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('the delivery key is the record: the exact-ball retry matches, another ball does not', () => {
    const first = deliveryTakeKey({ seed: 'over-7f3a', overIndex: 0, ballIndex: 3, pressure: 0.2 } as never);
    const retry = deliveryTakeKey({ seed: 'over-7f3a', overIndex: 0, ballIndex: 3, pressure: 0.6 } as never);
    expect(retry).toBe(first);
    expect(deliveryTakeKey({ seed: 'over-7f3a', overIndex: 0, ballIndex: 4 })).not.toBe(first);
    expect(deliveryTakeKey({ seed: 'over-1111', overIndex: 0, ballIndex: 3 })).not.toBe(first);
    expect(deliveryTakeKey({})).toBe('unseeded');
    expect(deliveryTakeKey(null)).toBe('unseeded');
  });

  it('is a pure function of the record, the sound and its use: same in, same out, always in range', () => {
    for (let n = 1; n <= 5; n++) {
      for (let i = 0; i < 50; i++) {
        const k = `seed-${i}#0.${i % 6}`;
        const t = takeIndex(k, 'middle', i % 3, n);
        expect(t).toBe(takeIndex(k, 'middle', i % 3, n));
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(n);
        expect(Number.isInteger(t)).toBe(true);
      }
    }
    expect(takeIndex('anything', 'middle', 0, 1)).toBe(0);
    expect(takeIndex('anything', 'middle', 0, 0)).toBe(0);
    const u = takeUnit('k', 'crowd:applause', 0);
    expect(u).toBe(takeUnit('k', 'crowd:applause', 0));
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });

  it('spreads over every take (no take starves across balls)', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let ball = 0; ball < 600; ball++)
      counts[
        takeIndex(deliveryTakeKey({ seed: `s${ball >> 3}`, overIndex: ball >> 3, ballIndex: ball & 7 }), 'middle', 0, 5)
      ]++;
    for (const c of counts) expect(c).toBeGreaterThan(80);
  });

  it('finds the transient onset (the first sample at a tenth of the peak), whatever leads it', () => {
    const d = new Float32Array(4800);
    for (let i = 0; i < 300; i++) d[i] = 0.004 * Math.sin(i); // codec padding and room noise
    d[336] = 0.05;
    d[337] = -0.9;
    d[338] = 0.7;
    expect(findOnset(d)).toBe(337);
    expect(findOnset(new Float32Array(10))).toBe(0);
  });

  it('aligns the onset on the event time, called ahead or late, at any rate', () => {
    const onset = 0.007;
    const at = (when: number, now: number, rate = 1) => {
      const { start, offset } = alignedStart(when, onset, 0.003, now, rate);
      expect(start).toBeGreaterThanOrEqual(now);
      return start + (onset - offset) / rate;
    };
    expect(at(10, 9.5)).toBeCloseTo(10, 9);
    expect(at(10, 9.999)).toBeCloseTo(10, 9); // the pre-roll would start in the past: it is skipped
    expect(at(10, 9.5, 1.03)).toBeCloseTo(10, 9);
    const crowd = alignedStart(4, 0, 0, 3);
    expect(crowd).toEqual({ start: 4, offset: 0 });
  });
});

// ---- the sink on the Web Audio fake ---------------------------------------------------------------------------------

let clock = 1000;
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

const SR = 48000;
/** Each fake file decodes to a buffer whose transient sits at a known sample, so tests can tell takes apart. */
const ONSET = 336; // 7 ms at 48 kHz
const TAKE_LEN = 12001; // samples: distinct from every other buffer the fake graph makes
function decoded(sampleRate: number, marker: number, onset = ONSET): FakeBuffer {
  const b = new FakeBuffer(1, sampleRate === SR ? TAKE_LEN : Math.round(sampleRate * 0.25), sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < onset; i++) d[i] = 0.002;
  d[onset] = 0.8 + marker / 100;
  for (let i = onset + 1; i < d.length; i++) d[i] = d[onset] * Math.exp(-(i - onset) / 400);
  return b;
}

const take = (id: string, register = `T-${id}`) => ({
  id,
  file: `${id}.mp3`,
  bytes: 100 + id.length,
  sha256: createHash('sha256').update(id).digest('hex'),
  register,
  lufs: null,
  peakDbfs: -1,
  durationMs: 250,
});

const TEST_KINDS: RecordedKind[] = [
  {
    key: 'middle',
    inventory: 1,
    label: 'test',
    honest: 'test',
    align: 'onset',
    prerollMs: 3,
    takes: ['mid-a', 'mid-b', 'mid-c', 'mid-d'].map((i) => take(i)),
  },
  {
    key: 'edge_thin',
    inventory: 3,
    label: 'test',
    honest: 'test',
    align: 'onset',
    prerollMs: 3,
    takes: ['thin-a', 'thin-b', 'thin-c'].map((i) => take(i)),
  },
  {
    key: 'gloves',
    inventory: 8,
    label: 'test',
    honest: 'test',
    align: 'onset',
    prerollMs: 3,
    takes: ['glv-a', 'glv-b', 'glv-c'].map((i) => take(i)),
  },
  {
    key: 'crowd:applause',
    inventory: 12,
    label: 'test',
    honest: 'test',
    align: 'start',
    prerollMs: 0,
    maxRate: 24000,
    takes: ['clap-a', 'clap-b', 'clap-c'].map((i) => take(i)),
  },
];

interface IOOptions {
  fail?: string[];
  badHash?: string[];
  badBytes?: string[];
  noHash?: boolean;
}

function fakeIO(kinds: RecordedKind[], o: IOOptions = {}) {
  const all = kinds.flatMap((k) => k.takes);
  const fetched: string[] = [];
  return {
    fetched,
    io: {
      base: '/audio/cricket/',
      async fetch(url: string) {
        fetched.push(url);
        const t = all.find((x) => url.endsWith(`/${x.file}`))!;
        if (o.fail?.includes(t.id)) throw new Error('404');
        const n = o.badBytes?.includes(t.id) ? t.bytes + 1 : t.bytes;
        const buf = new ArrayBuffer(n);
        new Uint8Array(buf)[0] = all.indexOf(t);
        return buf;
      },
      async sha256(data: ArrayBuffer) {
        if (o.noHash) return null;
        const t = all[new Uint8Array(data)[0]];
        return o.badHash?.includes(t.id) ? '0'.repeat(64) : t.sha256;
      },
      async decode(_ctx: BaseAudioContext, data: ArrayBuffer) {
        const i = new Uint8Array(data)[0];
        const kind = kinds.find((k) => k.takes.includes(all[i]))!;
        return decoded(kind.maxRate ? 24000 : SR, i) as unknown as AudioBuffer;
      },
    },
  };
}

async function boot(kinds: RecordedKind[] | null, o: IOOptions = {}) {
  vi.resetModules();
  installFakeAudio();
  const audio = await import('@/audio');
  const settings = await import('@/audio/settings');
  const log = await import('@/audio/timingLog');
  const engine = await import('@/audio/engine');
  const recorded = await import('@/audio/recorded');
  settings.setAudioSettingsStore(null);
  log.enableAudioLog(true);
  audio.syncAudioSettings({ sound: true, haptics: true });
  const sink = audio.createPracticeSink();
  window.dispatchEvent(new Event('pointerdown'));
  const g = engine.currentGraph()!;
  const ctx = g.ctx as unknown as FakeContext;
  const fio = fakeIO(kinds ?? [], o);
  if (kinds) {
    recorded.resetRecorded(kinds);
    await recorded.loadRecorded(g, fio.io as never);
  }
  const entries = () => window.__vandeAudio!.log();
  const sounds = () => entries().filter((e) => e.type === 'sound');
  return {
    audio,
    engine,
    recorded,
    sink,
    g,
    ctx,
    entries,
    sounds,
    fetched: fio.fetched,
    clear: () => window.__vandeAudio!.clear(),
  };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** One delivery up to its contact, with the record's identity in the context as the flow passes it to stage.bowl(). */
function deliver(a: Booted, rec: { seed: string; overIndex: number; ballIndex: number }) {
  a.sink.context({ pressure: 0, runs: 10, conditions: 'hard', ...rec });
  a.sink.quiet(true);
  a.sink.moment({ kind: 'approach', intensity: 0.4 });
  a.sink.moment({ kind: 'release', intensity: 1 });
}

/** What played: `rec:<take>`, or `synth` (the sprite, or live synthesis before the sprite is ready). */
const detailOf = (a: Booted, name: string) =>
  a
    .sounds()
    .filter((e) => e.name === name)
    .map((e) => (e.detail?.startsWith('synth') ? 'synth' : e.detail));

beforeEach(() => {
  clock = 1000;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recorded contact takes on the sink', () => {
  it('COH6: called ahead, the take’s own transient is heard at the physics contact time (within 1 ms), with its haptic', async () => {
    const a = await boot(TEST_KINDS);
    deliver(a, { seed: 'over-a', overIndex: 0, ballIndex: 2 });
    a.clear();
    const contactAt = clock + 60;
    const before = a.ctx.sources().length;
    a.sink.moment({ kind: 'contact', intensity: 0.85, contact: 'middle', timing: 'solid' }, contactAt);
    a.sink.feel('middle', 0.85, 'middle', 'solid', contactAt);
    const crack = a.sounds().find((e) => e.name === 'middle')!;
    expect(crack.detail).toMatch(/^rec:mid-[a-d]$/);
    expect(Math.abs(crack.audioPerfMs! - contactAt)).toBeLessThan(1);
    // The buffer starts early by its pre-roll, so the transient sample (7 ms in) is the one heard at the contact.
    const src = a.ctx
      .sources()
      .slice(before)
      .find((s: FakeSource) => s.buffer?.length === TAKE_LEN)!;
    const { when, offset } = src.starts[0];
    expect(when + (ONSET / SR - offset!)).toBeCloseTo(crack.ctxTime!, 9);
    expect(offset!).toBeCloseTo(ONSET / SR - 0.003, 9);
    await advance(60);
    expect(
      a
        .entries()
        .filter((e) => e.type === 'haptic')
        .map((e) => e.name),
    ).toEqual(['pulse']);
  });

  it('called at the moment itself, the transient is late by only the output latency the device reports', async () => {
    const a = await boot(TEST_KINDS);
    deliver(a, { seed: 'over-a', overIndex: 0, ballIndex: 2 });
    a.clear();
    a.sink.feel('middle', 0.85, 'middle', 'solid');
    const crack = a.sounds().find((e) => e.name === 'middle')!;
    expect(crack.detail).toMatch(/^rec:/);
    expect(crack.audioPerfMs! - clock).toBeLessThanOrEqual(a.ctx.outputLatency * 1000 + 3);
  });

  it('the exact-ball retry hears the same takes; other balls vary; the take never depends on load order or session', async () => {
    const run = async (rec: { seed: string; overIndex: number; ballIndex: number }, a?: Booted) => {
      a ??= await boot(TEST_KINDS);
      deliver(a, rec);
      a.clear();
      a.sink.feel('middle', 0.85, 'middle', 'solid');
      a.sink.cue('gloves', 0.6, 1);
      a.sink.cue('gloves', 0.6, 1);
      await advance(200);
      return [...detailOf(a, 'middle'), ...detailOf(a, 'gloves')];
    };
    const rec = { seed: 'over-7f3a', overIndex: 0, ballIndex: 3 };
    const a = await boot(TEST_KINDS);
    const first = await run(rec, a);
    expect(first.every((d) => d?.startsWith('rec:'))).toBe(true);
    // The retry in the same session, after other balls, and in a fresh session: identical.
    await run({ seed: 'over-7f3a', overIndex: 0, ballIndex: 4 }, a);
    expect(await run(rec, a)).toEqual(first);
    // Across balls every take gets used.
    const seen = new Set<string>();
    for (let ball = 0; ball < 24; ball++)
      for (const d of await run({ seed: 'over-b', overIndex: ball >> 2, ballIndex: ball & 3 }, a)) seen.add(d!);
    expect([...seen].filter((d) => d.startsWith('rec:mid-')).length).toBe(4);
    expect([...seen].filter((d) => d.startsWith('rec:glv-')).length).toBe(3);
    // A fresh session (new modules, new context, loaded again): still identical. Last, as it rebinds the timing log.
    expect(await run(rec)).toEqual(first);
  });

  it('muting never shifts a later choice: uses are counted while silent', async () => {
    const rec = { seed: 'over-m', overIndex: 1, ballIndex: 0 };
    const reference = await boot(TEST_KINDS);
    deliver(reference, rec);
    reference.clear();
    reference.sink.cue('gloves', 0.6, 1);
    reference.sink.cue('gloves', 0.6, 1);
    const want = detailOf(reference, 'gloves')[1];

    const a = await boot(TEST_KINDS);
    deliver(a, rec);
    a.clear();
    a.audio.syncAudioSettings({ sound: false, haptics: true });
    a.sink.cue('gloves', 0.6, 1);
    a.audio.syncAudioSettings({ sound: true, haptics: true });
    a.sink.cue('gloves', 0.6, 1);
    expect(detailOf(a, 'gloves')).toEqual([want]);
  });

  it('FBK1: each contact kind keeps its own sound, takes and haptic; a miss stays a swish with no vibration', async () => {
    const a = await boot(TEST_KINDS);
    deliver(a, { seed: 'over-f', overIndex: 0, ballIndex: 0 });
    const play = async (...f: Parameters<Booted['sink']['feel']>) => {
      a.clear();
      a.sink.feel(...f);
      await advance(200);
      const s = a.sounds()[0];
      return [
        s.name,
        s.detail?.startsWith('synth') ? 'synth' : s.detail?.replace(/-[a-d]$/, ''),
        a
          .entries()
          .filter((e) => e.type === 'haptic')
          .map((e) => e.name)
          .join(),
      ];
    };
    expect(await play('middle', 0.85, 'middle', 'solid')).toEqual(['middle', 'rec:mid', 'pulse']);
    expect(await play('edge', 0.55, 'outside_edge')).toEqual(['edge_thin', 'rec:thin', 'tick']);
    // No takes registered for these: their synthesised voices play.
    expect(await play('middle', 0.62, 'middle', 'mistimed')).toEqual(['mistimed', 'synth', 'soft']);
    expect(await play('edge', 0.7, 'inside_edge')).toEqual(['edge_thick', 'synth', 'tick']);
    expect(await play('miss', 0.6)).toEqual(['swish', 'synth', '']);
  });
});

describe('the synthesised fallback', () => {
  it('a take that fails to load, fails its byte count or its SHA-256 is never played: its synthesised voice plays instead', async () => {
    const a = await boot(TEST_KINDS, { fail: ['mid-a'], badBytes: ['mid-b'], badHash: ['mid-c'] });
    expect(a.recorded.recordedStatus().find((s) => s.key === 'middle')).toEqual({ key: 'middle', takes: 4, loaded: 1 });
    const details = new Set<string>();
    for (let ball = 0; ball < 40; ball++) {
      deliver(a, { seed: 'over-x', overIndex: ball >> 3, ballIndex: ball & 7 });
      a.clear();
      a.sink.feel('middle', 0.85, 'middle', 'solid');
      details.add(detailOf(a, 'middle')[0]!);
    }
    expect([...details].sort()).toEqual(['rec:mid-d', 'synth']);
  });

  it('without a way to hash (an insecure context), the byte count still guards and the take plays', async () => {
    const a = await boot(TEST_KINDS, { noHash: true });
    expect(a.recorded.recordedStatus().every((s) => s.loaded === s.takes)).toBe(true);
  });

  it('before every take of a kind has settled, and with recordings switched off, the synthesised voice plays', async () => {
    const a = await boot(null);
    a.recorded.resetRecorded(TEST_KINDS);
    deliver(a, { seed: 'over-p', overIndex: 0, ballIndex: 0 });
    a.clear();
    a.sink.feel('middle', 0.85, 'middle', 'solid');
    expect(detailOf(a, 'middle')).toEqual(['synth']);

    const b = await boot(TEST_KINDS);
    b.audio.setRecordedSounds(false);
    deliver(b, { seed: 'over-p', overIndex: 0, ballIndex: 0 });
    b.clear();
    b.sink.feel('middle', 0.85, 'middle', 'solid');
    expect(detailOf(b, 'middle')).toEqual(['synth']);
    b.audio.setRecordedSounds(true);
    b.sink.feel('middle', 0.85, 'middle', 'solid');
    expect(detailOf(b, 'middle')[1]).toMatch(/^rec:/);
  });

  it('nothing loads during a delivery: loading waits for Delivery Quiet Mode to end', async () => {
    const a = await boot(null);
    a.recorded.resetRecorded(TEST_KINDS);
    a.sink.quiet(true);
    const { io } = fakeIO(TEST_KINDS);
    const fetchSpy = vi.spyOn(io, 'fetch');
    const done = a.recorded.loadRecorded(a.g, io as never);
    await advance(50);
    expect(fetchSpy).not.toHaveBeenCalled();
    a.sink.quiet(false);
    await done;
    expect(fetchSpy).toHaveBeenCalledTimes(TEST_KINDS.reduce((n, k) => n + k.takes.length, 0));
  });

  it('a delivery with no record identity still chooses deterministically', async () => {
    const pick = async () => {
      const a = await boot(TEST_KINDS);
      a.sink.context({ pressure: 0, conditions: 'hard' });
      a.sink.moment({ kind: 'approach', intensity: 0.4 });
      a.clear();
      a.sink.feel('middle', 0.85, 'middle', 'solid');
      return detailOf(a, 'middle')[0];
    };
    const first = await pick();
    expect(first).toMatch(/^rec:/);
    expect(await pick()).toBe(first);
  });
});

describe('loading in Practice’s setup (play never fetches)', () => {
  it('every take is requested at once, before any delivery; decoding then fetches nothing more and reports its memory', async () => {
    const a = await boot(null);
    a.recorded.resetRecorded(TEST_KINDS);
    const { io } = fakeIO(TEST_KINDS);
    const fetchSpy = vi.spyOn(io, 'fetch');
    const total = TEST_KINDS.reduce((n, k) => n + k.takes.length, 0);
    const files = await a.recorded.prefetchRecorded(io as never);
    expect(fetchSpy).toHaveBeenCalledTimes(total);
    expect(files.size).toBe(total);
    expect(a.recorded.recordedTiming().requestedMs).not.toBeNull();
    // A delivery, then the decode: it reads the requested bytes and never fetches again.
    a.sink.quiet(true);
    const done = a.recorded.loadRecorded(a.g, io as never);
    await advance(50);
    expect(a.recorded.recordedMemory().takes).toBe(0);
    a.sink.quiet(false);
    await done;
    expect(fetchSpy).toHaveBeenCalledTimes(total);
    expect(files.size, 'the compressed bytes are dropped once decoded').toBe(0);
    // The fake decodes contact takes to TAKE_LEN samples at 48 kHz, and crowd takes to 0.25 s at their 24 kHz.
    const decoded = TEST_KINDS.reduce((n, k) => n + k.takes.length * (k.maxRate ? 24000 * 0.25 : TAKE_LEN) * 4, 0);
    expect(a.recorded.recordedMemory()).toEqual({ decodedBytes: decoded, takes: total });
    expect(a.recorded.recordedTiming().readyMs).not.toBeNull();
  });

  it('only Practice requests takes: its warm-up does, Sealed Six’s MatchAudio never does', async () => {
    vi.resetModules();
    installFakeAudio();
    const prepareRecorded = vi.fn();
    vi.doMock('@/audio/recorded', async (orig) => ({
      ...(await orig<typeof import('@/audio/recorded')>()),
      prepareRecorded,
    }));
    const match = await import('@/audio/match');
    new match.MatchAudio();
    expect(prepareRecorded).not.toHaveBeenCalled();
    match.installMatchAudioUnlock();
    expect(prepareRecorded).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/audio/recorded');
  });
});

describe('recorded crowd layers', () => {
  it('a crowd take decoded above its kind’s rate is held at that rate (memory), once, off the main thread', async () => {
    const a = await boot(null);
    const kinds: RecordedKind[] = [{ ...TEST_KINDS[3] }];
    a.recorded.resetRecorded(kinds);
    const { io } = fakeIO(kinds);
    io.decode = async () => decoded(SR, 1) as unknown as AudioBuffer;
    await a.recorded.loadRecorded(a.g, io as never);
    const t = a.recorded.pickTake('crowd:applause', 'k', 0)!;
    expect(t.buffer.sampleRate).toBe(24000);
    expect(t.buffer.length).toBe(Math.ceil((TAKE_LEN / SR) * 24000));
  });

  it('a confirmed single gets a recorded applause take, chosen from the record, at its own pitch', async () => {
    const a = await boot(TEST_KINDS);
    const runs = async (rec: { seed: string; overIndex: number; ballIndex: number }) => {
      deliver(a, rec);
      a.sink.moment({ kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }, clock + 10);
      await advance(1200);
      a.clear();
      const before = a.ctx.sources().length;
      a.sink.moment({ kind: 'runs', intensity: 0.55, runs: 1 });
      await advance(400);
      const crowd = a.entries().find((e) => e.type === 'crowd' && e.name === 'applause')!;
      const src = a.ctx
        .sources()
        .slice(before)
        .find((s) => s.buffer?.sampleRate === 24000);
      expect(src?.playbackRate.value).toBe(1);
      a.sink.moment({ kind: 'reflection', intensity: 0 });
      await advance(5000);
      return crowd.detail;
    };
    const rec = { seed: 'over-r', overIndex: 0, ballIndex: 1 };
    const first = await runs(rec);
    expect(first).toMatch(/^rec:clap-[a-c]$/);
    expect(await runs({ seed: 'over-r', overIndex: 0, ballIndex: 2 })).toMatch(/^rec:clap-/);
    expect(await runs(rec)).toBe(first);
  });
});

describe('the shipped manifest', () => {
  const dir = resolve(process.cwd(), 'public/audio/cricket');

  it('covers wedge §7.2’s fourteen kinds, in priority order, and says honestly what plays', () => {
    const items = new Set([...RECORDED_KINDS.map((k) => k.inventory), ...RECORDED_PENDING.map((k) => k.inventory)]);
    expect([...items].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const order = RECORDED_KINDS.map((k) => k.inventory);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    for (const k of RECORDED_KINDS) {
      if (k.takes.length) {
        expect(k.honest).not.toMatch(/synthesised voice plays/);
        expect(k.takes.length).toBeGreaterThanOrEqual(3);
        expect(k.takes.length).toBeLessThanOrEqual(5);
      } else expect(k.honest).toMatch(/synthesised voice plays \(not a recording\)/);
    }
    expect(RECORDED_KINDS.find((k) => k.key === 'crowd:applause')!.honest).toMatch(/not from a cricket ground/);
  });

  it('FBK1: no two sounds share a take, and every runtime sound is listed once', () => {
    const keys = RECORDED_KINDS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    const files = RECORDED_KINDS.flatMap((k) => k.takes.map((t) => t.file));
    expect(new Set(files).size).toBe(files.length);
  });

  it('every take is the registered file, byte for byte, and nothing unregistered ships', () => {
    const takes = RECORDED_KINDS.flatMap((k) => k.takes);
    for (const t of takes) {
      const bytes = readFileSync(resolve(dir, t.file));
      expect(bytes.length).toBe(t.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(t.sha256);
      expect(t.register).toMatch(/^TC-\d{2}-(\d{2}|P\d{2})$/);
    }
    expect(readdirSync(dir).sort()).toEqual(takes.map((t) => t.file).sort());
  });

  it('every take is in the shipped applause takes’ format: MPEG-1 Layer III, the same rate, mono, VBR, no ID3, one encoder', () => {
    const header = (file: string) => {
      const b = readFileSync(resolve(dir, file));
      expect(b.subarray(0, 3).toString('latin1')).not.toBe('ID3');
      expect(b[0]).toBe(0xff);
      expect(b[1] & 0xfe).toBe(0xfa); // MPEG-1, Layer III
      const rate = [44100, 48000, 32000][(b[2] >> 2) & 3];
      const mono = b[3] >> 6 === 3;
      const tag = b.subarray(21, 25).toString('latin1'); // after a mono frame's 17-byte side information
      const encoder = b.subarray(21 + 8 + 4 + 4 + 100 + 4, 21 + 8 + 4 + 4 + 100 + 4 + 9).toString('latin1');
      return { rate, mono, tag, encoder };
    };
    const ref = header('applause-1.mp3');
    expect(ref).toEqual({ rate: 48000, mono: true, tag: 'Xing', encoder: ref.encoder });
    for (const t of RECORDED_KINDS.flatMap((k) => k.takes)) expect(header(t.file), t.file).toEqual(ref);
  });

  it('placeholders say so: flagged, labelled “not a recording”, ph- files, P register rows; recordings never say placeholder', () => {
    for (const k of RECORDED_KINDS) {
      if (k.placeholder) {
        expect(k.takes.length).toBeGreaterThanOrEqual(3);
        expect(k.honest).toMatch(/^Placeholder: original synthesised .*not a recording; replace with a recording\./);
        expect(k.honest).not.toMatch(/\b(licensed|recorded by|CC0|CC BY)\b/i);
        for (const t of k.takes) {
          expect(t.file).toMatch(new RegExp(`^ph-${k.key}-\\d+\\.mp3$`));
          expect(t.id).toBe(t.file.replace(/\.mp3$/, ''));
          expect(t.register).toMatch(new RegExp(`^TC-${String(k.inventory).padStart(2, '0')}-P\\d{2}$`));
        }
      } else {
        expect(k.honest).not.toMatch(/placeholder/i);
        for (const t of k.takes) {
          expect(t.file).not.toMatch(/^ph-/);
          expect(t.register).toMatch(/^TC-\d{2}-\d{2}$/);
        }
      }
    }
    // Only contact sounds have placeholders, and CONTACT_TAKES follows RECORDED_KINDS' order (the Unity test reads it).
    const contacts = RECORDED_KINDS.filter((k) => k.align === 'onset').map((k) => k.key);
    expect(Object.keys(CONTACT_TAKES)).toEqual(contacts.filter((k) => CONTACT_TAKES[k as keyof typeof CONTACT_TAKES]));
    expect(RECORDED_KINDS.filter((k) => k.placeholder).every((k) => k.align === 'onset')).toBe(true);
  });

  it('placeholder takes match their processed record: levelled to the live voice, onset at the 3 ms pre-roll, peak ≤ 0.95', () => {
    // The record is a committed copy of the file that `node scripts/audio/placeholders.mjs --write` leaves in the ignored
    // release/ folder (release/product-sequence/stage-1-practice/wedge/sound/placeholders/processed.json). After the
    // placeholders are regenerated, copy it over this fixture; a stale copy fails the size and hash checks below.
    const record = JSON.parse(
      readFileSync(resolve(process.cwd(), 'tests/fixtures/audio/placeholders-processed.json'), 'utf8'),
    ) as {
      rules: { preroll_ms: number; peak_cap: number };
      takes: Array<{
        key: string;
        file: string;
        bytes: number;
        sha256: string;
        register: string;
        hitLufs: number;
        targetLufs: number;
        limitedByPeak: boolean;
        peakDbfs: number;
        onsetMs: number;
        durationMs: number;
      }>;
    };
    expect(record.rules).toMatchObject({ preroll_ms: 3, peak_cap: 0.95 });
    const placeholders = RECORDED_KINDS.filter((k) => k.placeholder).flatMap((k) =>
      k.takes.map((t) => ({ key: k.key, t })),
    );
    expect(placeholders.length).toBeGreaterThan(0);
    for (const { key, t } of placeholders) {
      const r = record.takes.find((x) => x.file === t.file)!;
      expect(r, t.file).toBeDefined();
      expect([r.key, r.bytes, r.sha256, r.register, r.peakDbfs, r.durationMs]).toEqual([
        key,
        t.bytes,
        t.sha256,
        t.register,
        t.peakDbfs,
        t.durationMs,
      ]);
      expect(10 ** (t.peakDbfs / 20)).toBeLessThanOrEqual(0.95);
      expect(Math.abs(r.onsetMs - 3)).toBeLessThanOrEqual(0.5);
      if (!r.limitedByPeak) expect(Math.abs(r.hitLufs - r.targetLufs)).toBeLessThanOrEqual(0.5);
      else expect(r.hitLufs).toBeLessThan(r.targetLufs);
    }
  });

  it('crowd takes sit at the synthesised reaction’s loudness (−21 LUFS ± 0.5) and under its peak (0.95)', () => {
    for (const t of RECORDED_KINDS.find((k) => k.key === 'crowd:applause')!.takes) {
      expect(Math.abs(t.lufs! + 21)).toBeLessThanOrEqual(0.5);
      expect(10 ** (t.peakDbfs / 20)).toBeLessThanOrEqual(0.95);
      expect(t.durationMs).toBe(2500);
    }
  });
});
