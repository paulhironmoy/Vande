/**
 * The reveal is earned: the delivery timeline, the scrubber marks, the scorecard, the result and Player of the Match and
 * the live region disclose only what playback has reached (driven by the renderer's frame time); Skip, the result, the
 * end of playback and result_only show everything; seeking backwards never hides what was already seen.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { BattingInput, CommitRecord, Conditions, InningsState, LiveBallHandle, MatchEventLog, OverPlan, ReplayMode } from '@/contracts';
import { autoXiSeed, engine } from '@/engine';
import { buildTrainingLog, trainingCoachRef, trainingPlan, trainingSetup, TRAINING_LESSON } from '@/engine/training';
import { useApp } from '@/app/store';
import { layoutTicks, neutralTrack } from '@/screens/reveal/track';
import type { StageRenderer } from '@/render3d';
import { buildTimeline, timelineTimeOf, type Segment, type Timeline } from '@/render3d/core/timeline';
import { createTranslator } from '@/i18n/translator';
import type { Translator } from '@/i18n';
import { ensureI18n } from '@/i18n/sources';
import { FIXTURE_PLAYERS, fixtureMatchLog } from '@/screens/dev/fixtures';
import { autoBalls, defaultRevealMode, disclosedAt, indexLog } from '@/screens/reveal/disclosure';
import { commentaryText, resultText } from '@/screens/reveal/text';
import { loadI18n, renderUi } from './helpers';

/** A renderer the test drives: frames carry the timeline time, `end()` finishes playback. */
function controllableRenderer() {
  const frames = new Set<(ms: number) => void>();
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const calls: Array<[string, unknown[]]> = [];
  let t = 0;
  let tl: Timeline | null = null;
  const r = {
    kind: '3d' as const,
    calls,
    loaded: false,
    async mount() {},
    async prepareInnings() {},
    bowl(): LiveBallHandle {
      throw new Error('not live');
    },
    async loadReplay(log: MatchEventLog, mode: ReplayMode) {
      calls.push(['loadReplay', [mode]]);
      tl = buildTimeline(log, mode, { reducedMotion: useApp.getState().reducedMotion });
      r.loaded = true;
      return { durationMs: tl.duration };
    },
    play: (speed?: number) => void calls.push(['play', [speed]]),
    pause: () => void calls.push(['pause', []]),
    seek: (ms: number) => {
      t = ms;
      calls.push(['seek', [ms]]);
    },
    renderAt: (ms: number) => {
      t = ms;
    },
    setQuality: () => undefined,
    setReducedMotion: () => undefined,
    stats: () => ({ fps: 60, frameMs: 16.7, drawCalls: 1, quality: 'standard' as const }),
    on(event: string, cb: (p: never) => void) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb as (p: unknown) => void);
      return () => set!.delete(cb as (p: unknown) => void);
    },
    onFrame(cb: (ms: number) => void) {
      frames.add(cb);
      return () => frames.delete(cb);
    },
    setSink: () => undefined,
    timeline: () => tl,
    quality: () => 'standard' as const,
    currentTime: () => t,
    isPlaying: () => false,
    dispose: () => undefined,
    /** Test hooks. */
    frame(ms: number) {
      t = ms;
      frames.forEach((cb) => cb(ms));
    },
    end() {
      listeners.get('end')?.forEach((cb) => cb({ durationMs: tl?.duration ?? 0 }));
    },
  };
  return r;
}

let clock = 10_000;
const fake = { current: controllableRenderer() };

vi.mock('@/render3d', async () => {
  const actual = await vi.importActual<typeof import('@/render3d')>('@/render3d');
  return { ...actual, createMatchRenderer: async () => fake.current as unknown as StageRenderer, webglAvailable: () => true };
});
vi.mock('@/audio', async () => {
  const actual = await vi.importActual<typeof import('@/audio')>('@/audio');
  class Silent {
    cue() {}
    crowd() {}
    dispose() {}
  }
  return { ...actual, MatchAudio: Silent, playSealChime: () => undefined };
});

import { RevealScreen } from '@/screens/reveal/RevealScreen';

let tr: Translator;
beforeAll(async () => {
  await loadI18n();
  const { english } = await ensureI18n('en');
  tr = createTranslator('en', english, english);
});
beforeEach(() => {
  clock = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  fake.current = controllableRenderer();
  useApp.setState({ reducedMotion: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- real engine logs ------------------------------------------------------------------------------------------------

const CONDITIONS: Conditions = { pitch: 'green', weather: 'clear' };
const hexOf = (key: string) => Array.from(key, (c) => c.charCodeAt(0).toString(16)).join('').padEnd(32, '0').slice(0, 32);

async function duelLog(key: string, autoFrom = 99): Promise<MatchEventLog> {
  const seed = hexOf(key);
  const plans: [OverPlan, OverPlan] = [engine.ghostPlan('enforcer', `${key}-0`, CONDITIONS), engine.ghostPlan('trickster', `${key}-1`, CONDITIONS)];
  const states: [InningsState, InningsState] = [engine.startInnings(0), engine.startInnings(1)];
  const inputs: [Array<BattingInput | null>, Array<BattingInput | null>] = [[], []];
  for (const i of [0, 1] as const) {
    const plan = plans[i === 0 ? 1 : 0];
    let st = engine.startInnings(i);
    while (!st.done) {
      const d = engine.revealDelivery(plan, st.nextBall, CONDITIONS);
      // Player 2 misses the batting deadline from ball `autoFrom`: the platform's Auto XI bats the rest.
      const raw = i === 1 && d.ball >= autoFrom ? engine.autoBat(autoXiSeed(seed, 1, d.ball), d, plan.field) : engine.ghostBat(i === 0 ? 'maestro' : 'swinger', `${key}-bat${i}`, d, plan.field);
      const c = engine.validateBattingInput(raw, d);
      const input = c.ok ? c.input : null;
      inputs[i].push(input);
      st = engine.resolveNextBall(st, { seed, conditions: CONDITIONS, plan, input }).state;
    }
    states[i] = st;
  }
  const salts = ['salt-0', 'salt-1'];
  const commits = (await Promise.all(
    [0, 1].map(async (p) => ({ player: p as 0 | 1, hash: await engine.commitHash(plans[p], salts[p]), sig: '', keyId: 'test', lockedHour: '2026-10-25T09:00Z', salt: salts[p] })),
  )) as [CommitRecord, CommitRecord];
  return engine.buildMatchLog({
    matchId: `duel-${key}`,
    kind: 'duel',
    seed,
    conditions: CONDITIONS,
    players: FIXTURE_PLAYERS,
    commits,
    plans,
    inputs,
    innings: states,
    meta: { createdHour: '2026-10-25T09:00Z', revealedHour: '2026-10-25T21:00Z' },
  });
}

async function findDuel(pred: (log: MatchEventLog) => boolean): Promise<MatchEventLog> {
  for (let k = 0; k < 400; k++) {
    const log = await duelLog(`k${k}`);
    if (pred(log)) return log;
  }
  throw new Error('no log matches');
}

const isKey = (o: MatchEventLog['innings'][0]['balls'][0]) => o.cues.key || o.wicket !== null || o.runs >= 4;
/** Innings 1: six balls, a wicket and a boundary (not on the first ball), and a non-key ball first. */
const rich = (log: MatchEventLog) => {
  const b = log.innings[0].balls;
  return b.length === 6 && !isKey(b[0]) && b.slice(1).some((o) => o.wicket) && b.slice(1).some((o) => o.runs >= 4);
};

function dailyLog(): MatchEventLog {
  const { conditions, overs } = engine.dailyChallenge('2026-10-25', 'test-salt');
  let state: InningsState = engine.startInnings(0);
  const inputs: Array<BattingInput | null> = [];
  while (!state.mainDone) {
    const d = engine.revealDelivery(overs[0], state.nextBall, conditions);
    const input = engine.autoBat(`daily-${d.ball}`, d, overs[0].field);
    inputs.push(input);
    state = engine.resolveNextBall(state, { seed: 'daily-seed', conditions, plan: overs[0], input }).state;
  }
  return engine.buildDailyLog({
    attemptId: 'att1',
    day: '2026-10-25',
    attempt: 1,
    seed: 'daily-seed',
    serverSalt: 'test-salt',
    player: FIXTURE_PLAYERS[0],
    setter: { ...FIXTURE_PLAYERS[1], kind: 'daily' },
    inputs,
    innings: state,
    meta: { createdHour: '2026-10-25T10:00Z', revealedHour: '2026-10-25T10:00Z' },
  });
}

async function trainingLog(): Promise<MatchEventLog> {
  const setup = trainingSetup('abcdef0123456789abcdef0123456789');
  const d = engine.revealDelivery(setup.coachOver, 0, setup.conditions);
  const own = engine.validateBattingInput(engine.ghostBat('maestro', 'me', d, setup.coachOver.field), d);
  const plan = trainingPlan(TRAINING_LESSON.choices.yorker, null, setup.seed);
  return buildTrainingLog({ setup, player: FIXTURE_PLAYERS[0], coach: trainingCoachRef('Coach', FIXTURE_PLAYERS[1].kit), plan, inputs: [own.ok ? own.input : null] });
}

// ---- driving the screen ----------------------------------------------------------------------------------------------

async function open(log: MatchEventLog, props: Partial<Parameters<typeof RevealScreen>[0]> = {}) {
  const view = renderUi(<RevealScreen log={log} autoplay={false} {...props} />);
  // Building a full timeline can take well over the default 1 s under a loaded full run: wait for the renderer itself.
  await waitFor(() => expect(fake.current.loaded).toBe(true), { timeout: 15_000 });
  await act(async () => {});
  return view;
}
/** A rendered frame at timeline time `ms` (past MatchStage's ~12 Hz throttle). */
async function frame(ms: number) {
  clock += 100;
  await act(async () => {
    fake.current.frame(ms);
  });
}
/** Drags the scrubber to a replay time (its value is a position on the neutral track, 0–1000). */
function scrub(ms: number, tl?: Timeline, log?: MatchEventLog) {
  const value = tl && log ? Math.round(neutralTrack(tl, { innings: log.kind === 'daily' ? 1 : 2, superBall: log.kind !== 'daily' }).pos(ms) * 1000) : ms;
  fireEvent.change(screen.getByTestId('reveal-scrub'), { target: { value: String(value) } });
}

const timelineOf = (log: MatchEventLog, mode: ReplayMode) => buildTimeline(log, mode, { reducedMotion: useApp.getState().reducedMotion });
const segOf = (tl: Timeline, eventIndex: number) => tl.segments.find((x) => x.kind === 'ball' && x.eventIndex === eventIndex) as Segment;
const decided = (seg: Segment) => timelineTimeOf(seg, seg.script.times.decisive) + 5;
const undecided = (seg: Segment) => seg.t0 + 1;

const rowKinds = (n: 1 | 2) => Array.from(within(screen.getByTestId('reveal-timeline')).getByRole('list', { name: `Innings ${n}` }).querySelectorAll('[data-kind]')).map((x) => x.getAttribute('data-kind'));
const tickKinds = () => Array.from(screen.getByTestId('reveal-ticks').children).map((x) => x.getAttribute('data-kind'));
const live = () => screen.getByTestId('reveal-live').textContent ?? '';
const panel = () => screen.getByRole('tabpanel');
const scoreText = (runs: number, wickets: number) => `${runs}/${wickets}`;
const markKind = (o: { runs: number; wicket: unknown }) => (o.wicket ? 'wicket' : o.runs === 6 ? 'six' : o.runs === 4 ? 'four' : o.runs === 0 ? 'dot' : 'runs');

describe('the reveal discloses only what playback has reached', () => {
  it('at the start: neutral placeholders, no marks, no totals, no result and a silent live region', async () => {
    const log = await findDuel(rich);
    await open(log, { initialMode: 'full' });
    expect(rowKinds(1)).toEqual(Array(6).fill('upcoming'));
    expect(rowKinds(2)).toEqual(Array(6).fill('upcoming'));
    expect(tickKinds()).toEqual([]);
    expect(within(panel()).queryAllByRole('button')).toHaveLength(0);
    expect(within(panel()).getAllByRole('img', { name: 'Sealed' })).toHaveLength(2);
    expect(within(panel()).queryByText(scoreText(log.innings[0].runs, log.innings[0].wickets))).toBeNull();
    expect(screen.queryByText(/Player of the Match/)).toBeNull();
    expect(screen.queryByTestId('reveal-summary')).toBeNull();
    expect(live()).toBe('');
  });

  it('frame by frame: only the balls up to the frame time, in the timeline, marks, scorecard and live region', async () => {
    const log = await findDuel(rich);
    const tl = timelineOf(log, 'full');
    const ix = indexLog(log);
    await open(log, { initialMode: 'full' });
    const balls = log.innings[0].balls;
    const k = balls.findIndex((o, i) => i > 0 && o.wicket !== null);
    const seg = segOf(tl, ix.balls[0][k]);

    // Ball k is on screen but not decided: it is "now", earlier balls are shown, later ones are not.
    await frame(undecided(seg));
    expect(rowKinds(1)).toEqual([...balls.slice(0, k).map(markKind), 'current', ...Array(5 - k).fill('upcoming')]);
    expect(rowKinds(2)).toEqual(Array(6).fill('upcoming'));
    expect(tickKinds()).toHaveLength(k);
    expect(tickKinds()).not.toContain('wicket');
    expect(within(panel()).getAllByRole('button')).toHaveLength(k);
    const before = log.events[ix.balls[0][k - 1]];
    if (before.t !== 'ball') throw new Error('not a ball');
    expect(within(panel()).getByText(scoreText(before.score.runs, before.score.wickets))).toBeTruthy();
    expect(live()).toBe(commentaryText(log.events[ix.balls[0][k - 1] + 1] as never, log, tr));

    // Its decisive moment: the wicket is disclosed everywhere, and nothing after it.
    await frame(decided(seg));
    expect(rowKinds(1)).toEqual([...balls.slice(0, k + 1).map(markKind), ...Array(5 - k).fill('upcoming')]);
    expect(tickKinds()).toHaveLength(k + 1);
    expect(tickKinds().filter((x) => x === 'wicket')).toHaveLength(balls.slice(0, k + 1).filter((o) => o.wicket).length);
    expect(within(panel()).getAllByRole('button')).toHaveLength(k + 1);
    const after = log.events[ix.balls[0][k]];
    if (after.t !== 'ball') throw new Error('not a ball');
    expect(within(panel()).getByText(scoreText(after.score.runs, after.score.wickets))).toBeTruthy();
    expect(live()).toBe(commentaryText(log.events[ix.balls[0][k] + 1] as never, log, tr));
    expect(within(panel()).getAllByRole('img', { name: 'Sealed' })).toHaveLength(1);
    expect(screen.queryByText(/Player of the Match/)).toBeNull();
  });

  it('seeking backwards keeps what was seen; the live region follows the replay, never ahead', async () => {
    const log = await findDuel(rich);
    const tl = timelineOf(log, 'full');
    const ix = indexLog(log);
    await open(log, { initialMode: 'full' });
    const last = segOf(tl, ix.balls[0][5]);
    await frame(decided(last));
    const seen = rowKinds(1);
    expect(seen).not.toContain('upcoming');
    scrub(0);
    expect(rowKinds(1)).toEqual(seen);
    expect(tickKinds()).toHaveLength(6);
    expect(within(panel()).getAllByRole('button')).toHaveLength(6);
    expect(within(panel()).getByText(scoreText(log.innings[0].runs, log.innings[0].wickets))).toBeTruthy();
    expect(live()).toBe('');
    // Back at ball 2, the line is ball 1's (ball 2 is not decided again yet).
    scrub(undecided(segOf(tl, ix.balls[0][1])), tl, log);
    expect(live()).toBe(commentaryText(log.events[ix.balls[0][0] + 1] as never, log, tr));
    expect(rowKinds(1)).toEqual(seen);
  });

  it('Skip discloses everything: every ball, final totals, the result and the Player of the Match', async () => {
    const log = await findDuel(rich);
    await open(log);
    fireEvent.click(screen.getByTestId('reveal-skip'));
    expect(rowKinds(1)).toEqual(log.innings[0].balls.map(markKind));
    expect(rowKinds(2)).toEqual(log.innings[1].balls.map(markKind));
    expect(within(panel()).getByText(scoreText(log.innings[0].runs, log.innings[0].wickets))).toBeTruthy();
    expect(within(panel()).getByText(scoreText(log.innings[1].runs, log.innings[1].wickets))).toBeTruthy();
    const summary = screen.getByTestId('reveal-summary');
    expect(summary.textContent).toContain(resultText(log.result, log, tr));
    expect(summary.textContent).toContain(`Player of the Match: ${log.players[log.result.playerOfMatch].alias}`);
    const tl = timelineOf(log, defaultRevealMode(log));
    expect(tickKinds()).toHaveLength(tl.segments.filter((x) => x.kind === 'ball').length);
  });

  it('the end of playback discloses everything', async () => {
    const log = await findDuel(rich);
    await open(log, { initialMode: 'full' });
    await act(async () => fake.current.end());
    expect(rowKinds(1)).toEqual(log.innings[0].balls.map(markKind));
    expect(screen.getByTestId('reveal-summary')).toBeTruthy();
  });

  it('result_only discloses everything at once', async () => {
    const log = await findDuel(rich);
    await open(log, { initialMode: 'result_only' });
    expect(rowKinds(2)).toEqual(log.innings[1].balls.map(markKind));
    expect(screen.getByTestId('reveal-summary').textContent).toContain(resultText(log.result, log, tr));
    expect(live()).toContain(commentaryText(log.events[indexLog(log).result + 1] as never, log, tr));
  });

  it('the result card discloses everything, after the held breath', async () => {
    const log = await findDuel(rich);
    await open(log, { initialMode: 'full' });
    const tl = timelineOf(log, 'full');
    const result = tl.segments.find((x) => x.kind === 'result')!;
    // The held breath first: every ball is in, the result is not, and no result card yet.
    expect(result.beat).toBeGreaterThan(1000);
    // Lines that carry the result ("The chase falls 5 runs short.", "… wins by 7 runs!") wait for the card: not on the
    // innings-end card, not during the held breath, and never in the live region before it.
    const resultLines = log.events
      .filter((e) => e.t === 'commentary' && /\.(chase_won|chase_short|result_\w+|player_of_match|turning_point)$/.test(e.key))
      .map((e) => commentaryText(e as never, log, tr))
      .filter(Boolean);
    expect(resultLines.length).toBeGreaterThan(0);
    const end = tl.segments.filter((x) => x.kind === 'innings_end').at(-1);
    if (end) {
      await frame(end.t0 + 50);
      for (const line of resultLines) expect(live()).not.toContain(line);
    }
    await frame(result.t0 + 10);
    expect(rowKinds(2)).toEqual(log.innings[1].balls.map(markKind));
    expect(screen.queryByTestId('reveal-summary')).toBeNull();
    expect(screen.queryByTestId('reveal-result-card')).toBeNull();
    expect(screen.getByTestId('reveal-breath')).toBeTruthy();
    expect(screen.queryByTestId('reveal-total')).toBeNull();
    for (const line of resultLines) expect(live()).not.toContain(line);
    // Then the result lands.
    await frame(result.t0 + result.beat! + 10);
    expect(screen.getByTestId('reveal-summary')).toBeTruthy();
    expect(screen.getByTestId('reveal-result-card').textContent).toContain(resultText(log.result, log, tr));
    expect(screen.queryByTestId('reveal-breath')).toBeNull();
    // Now the result may be said.
    expect(resultLines.some((line) => live().includes(line)) || live().includes(resultText(log.result, log, tr))).toBe(true);
  });

  it('the held breath: the crowd hushes, the sound builds and the camera pushes in (a still frame with reduced motion)', async () => {
    const { defaultPlan, shotPose } = await import('@/render3d/core/camera');
    const log = await findDuel(rich);
    const seg = timelineOf(log, 'full').segments.find((x) => x.kind === 'result')!;
    const beat = seg.beat!;
    expect(seg.script.events.find((e) => e.kind === 'tension')?.t).toBe(0);
    expect(seg.script.events.find((e) => e.kind === 'result')?.t).toBe(beat);
    // Every celebration starts after the beat.
    expect(seg.script.events.filter((e) => e.kind === 'fireworks').every((e) => e.t > beat)).toBe(true);
    const plan = defaultPlan(seg.script, false);
    expect(plan[0]).toEqual({ shot: 'result_push', atMs: 0, durationMs: beat });
    const ctx = { aspect: 0.5, reducedMotion: false };
    const a = shotPose('result_push', seg.script, 0, 0, ctx);
    const b = shotPose('result_push', seg.script, beat, 0, ctx);
    expect(b.pos.z).toBeGreaterThan(a.pos.z);
    expect(b.fov).toBeLessThan(a.fov);
    const still = { aspect: 0.5, reducedMotion: true };
    expect(shotPose('result_push', seg.script, 0, 0, still)).toEqual(shotPose('result_push', seg.script, beat, 0, still));
  });

  it('Key Moments (the default for duels) shows the skipped balls once a later ball plays, and the score bug never a ball to come', async () => {
    const log = await findDuel(rich);
    expect(defaultRevealMode(log)).toBe('key_moments');
    await open(log);
    expect(screen.getByRole('radio', { name: 'Key moments' }).getAttribute('aria-checked')).toBe('true');
    const tl = timelineOf(log, 'key_moments');
    const first = tl.segments.find((x) => x.kind === 'ball') as Segment;
    expect(first.innings).toBe(0);
    const k = log.innings[0].balls.findIndex((o) => o.ball === first.ball);
    await frame(undecided(first));
    // The non-key balls before it have been played; it is "now"; nothing later is shown.
    expect(rowKinds(1).slice(0, k)).toEqual(log.innings[0].balls.slice(0, k).map(markKind));
    expect(rowKinds(1)[k]).toBe('current');
    expect(rowKinds(1).slice(k + 1)).toEqual(Array(5 - k).fill('upcoming'));
    const stage = screen.getByRole('region', { name: 'Match view' });
    const bug = Array.from(stage.querySelectorAll('[role="img"][data-kind]')).map((x) => x.getAttribute('data-kind'));
    expect(bug).toHaveLength(6);
    expect(bug[k]).toBe('current');
    expect(bug.slice(k + 1)).toEqual(Array(5 - k).fill('upcoming'));
    // No scrubber marks for key moments still to come.
    expect(tickKinds()).toEqual([]);

    // Switching to Full replay restarts playback without hiding anything.
    await frame(decided(first));
    const seen = rowKinds(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Full replay' }));
    await waitFor(() => expect(fake.current.calls.filter(([c]) => c === 'loadReplay').length).toBeGreaterThan(0));
    expect(rowKinds(1)).toEqual(seen);
  });

  it('an innings that ends early keeps six neutral slots until the ball that ends it has played', async () => {
    const log = await findDuel((l) => l.innings[0].balls.length < 6 && l.innings[0].balls.length > 2);
    const n = log.innings[0].balls.length;
    const tl = timelineOf(log, 'full');
    const ix = indexLog(log);
    await open(log, { initialMode: 'full' });
    // Before the second wicket is decided, nothing says the innings is about to end.
    await frame(undecided(segOf(tl, ix.balls[0][n - 1])));
    expect(rowKinds(1)).toEqual([...log.innings[0].balls.slice(0, n - 1).map(markKind), 'current', ...Array(6 - n).fill('upcoming')]);
    // The wicket ends it: only the balls faced remain.
    await frame(decided(segOf(tl, ix.balls[0][n - 1])));
    expect(rowKinds(1)).toEqual(log.innings[0].balls.map(markKind));
    expect(rowKinds(2)).toEqual(Array(6).fill('upcoming'));
  });

  it('the Super Ball appears only once its card has played, one ball at a time', async () => {
    const log = await findDuel((l) => l.superBall.used);
    const tl = timelineOf(log, 'full');
    const ix = indexLog(log);
    await open(log, { initialMode: 'full' });
    const superHeading = () => within(panel()).queryByText('Super Ball');
    await frame(decided(segOf(tl, ix.balls[1][log.innings[1].balls.length - 1])));
    expect(superHeading()).toBeNull();
    const card = tl.segments.find((x) => x.kind === 'super_start') as Segment;
    await frame(card.t0 + 10);
    expect(superHeading()).toBeTruthy();
    const rowsNow = () => within(panel()).getAllByRole('button').length;
    const mainBalls = log.innings[0].balls.length + log.innings[1].balls.length;
    expect(rowsNow()).toBe(mainBalls);
    await frame(decided(segOf(tl, ix.supers[0])));
    expect(rowsNow()).toBe(mainBalls + 1);
    expect(screen.queryByTestId('reveal-summary')).toBeNull();
    fireEvent.click(screen.getByTestId('reveal-skip'));
    expect(rowsNow()).toBe(mainBalls + 2);
    expect(screen.getByTestId('reveal-summary').textContent).toContain(resultText(log.result, log, tr));
  });

  it('tapping a ball still to come does nothing; a played ball seeks and explains', async () => {
    const log = await findDuel(rich);
    const tl = timelineOf(log, 'full');
    const ix = indexLog(log);
    await open(log, { initialMode: 'full' });
    await frame(decided(segOf(tl, ix.balls[0][1])));
    const row = within(screen.getByTestId('reveal-timeline')).getByRole('list', { name: 'Innings 1' });
    const seeks = () => fake.current.calls.filter(([c]) => c === 'seek').length;
    const n = seeks();
    fireEvent.click(within(row).getAllByRole('button')[4]);
    fireEvent.click(within(within(screen.getByTestId('reveal-timeline')).getByRole('list', { name: 'Innings 2' })).getAllByRole('button')[0]);
    expect(seeks()).toBe(n);
    fireEvent.click(within(row).getAllByRole('button')[1]);
    expect(seeks()).toBe(n + 1);
    fireEvent.click(screen.getByRole('tab', { name: 'Why it happened' }));
    expect(panel().textContent).toContain(tr.t(`variant.${log.innings[0].balls[1].delivery.variant}` as never));
  });

  it('reduced motion follows the same rule', async () => {
    useApp.setState({ reducedMotion: true });
    const log = await findDuel(rich);
    const tl = timelineOf(log, 'full');
    const ix = indexLog(log);
    await open(log, { initialMode: 'full' });
    await frame(undecided(segOf(tl, ix.balls[0][2])));
    expect(rowKinds(1)).toEqual([...log.innings[0].balls.slice(0, 2).map(markKind), 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(tickKinds()).toHaveLength(2);
    expect(disclosedAt(log, tl, undecided(segOf(tl, ix.balls[0][2])))).toBe(ix.balls[0][2] - 1);
  });
});

describe('Daily Six and Training reveals', () => {
  it('Daily Six: one innings, every ball by default, the score line and no Player of the Match', async () => {
    const log = dailyLog();
    expect(defaultRevealMode(log)).toBe('full');
    await open(log);
    expect(screen.getByRole('radio', { name: 'Full replay' }).getAttribute('aria-checked')).toBe('true');
    expect(within(screen.getByTestId('reveal-timeline')).getAllByRole('list')).toHaveLength(1);
    expect(rowKinds(1)).toEqual(Array(6).fill('upcoming'));
    expect(within(panel()).getAllByText(/^Innings \d$/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('reveal-skip'));
    const summary = screen.getByTestId('reveal-summary');
    expect(summary.textContent).toBe(resultText(log.result, log, tr));
    expect(summary.textContent).not.toMatch(/tie/i);
    expect(screen.queryByText(/Player of the Match/)).toBeNull();
    expect(screen.queryByText(log.players[1].alias)).toBeNull();
  });

  it('Training labels the balls Auto XI batted and the lesson bowled ("Auto"), never the player\'s own', async () => {
    const log = await trainingLog();
    const auto = autoBalls(log);
    expect(auto.main[0]).toEqual([null, 'batted', 'batted', 'batted', 'batted', 'batted']);
    expect(auto.main[1]).toEqual([null, 'bowled', 'bowled', 'bowled', 'bowled', 'bowled']);
    expect(auto.super).toEqual(['batted', 'bowled']);
    await open(log);
    const items = (n: 1 | 2) => Array.from(within(screen.getByTestId('reveal-timeline')).getByRole('list', { name: `Innings ${n}` }).querySelectorAll('li'));
    // What is on screen (the screen-reader note is checked separately).
    const captions = (n: 1 | 2) =>
      items(n).map((li) => {
        const c = li.cloneNode(true) as HTMLElement;
        c.querySelectorAll('.sr-only').forEach((x) => x.remove());
        return c.textContent;
      });
    // Labels are not results: they show on the placeholders too, the same for every slot that may be played.
    expect(captions(1)).toEqual(['1', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto']);
    expect(captions(2)).toEqual(['1', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto']);
    // Screen readers hear it too: "Batted automatically" / "Bowled automatically" on each Auto slot.
    expect(items(1).map((li) => li.querySelector('.sr-only')?.textContent ?? null)).toEqual([null, ...Array(5).fill('Batted automatically')]);
    expect(items(2)[1].querySelector('.sr-only')?.textContent).toBe('Bowled automatically');
    fireEvent.click(screen.getByTestId('reveal-skip'));
    const rows = within(panel()).getAllByRole('button');
    expect(rows[0].textContent).not.toContain('Auto');
    expect(rows[1].textContent).toContain('Batted automatically');
    const coachFirst = log.innings[0].balls.length;
    expect(rows[coachFirst].textContent).not.toContain('Auto');
    expect(rows[coachFirst + 1].textContent).toContain('Bowled automatically');
  });

  it('a duel without stand-ins has no Auto labels; an Auto Over labels the over it bowled', async () => {
    const log = await findDuel(rich);
    expect(autoBalls(log).any).toBe(false);
    const autoOver = { ...log, commits: [log.commits[0], { ...log.commits[1], auto: true }] as MatchEventLog['commits'] };
    const auto = autoBalls(autoOver);
    expect(auto.main[0]).toEqual(Array(6).fill('bowled'));
    expect(auto.main[1]).toEqual(Array(6).fill(null));
    // Auto XI at a batting deadline is recognised from the log alone.
    const late = await duelLog('late', 3);
    const lateAuto = autoBalls(late);
    expect(lateAuto.main[0]).toEqual(Array(6).fill(null));
    expect(lateAuto.main[1].slice(0, 3)).toEqual([null, null, null]);
    for (const b of late.inputs[1].map((i) => i.ball).filter((b) => b >= 3 && b < 6)) expect(lateAuto.main[1][b]).toBe('batted');
    expect(lateAuto.super[1]).toBe('batted');
  });
});

describe('rematch action', () => {
  it('says what the caller says and becomes the primary call to action when offered', async () => {
    const log = fixtureMatchLog();
    const onRematch = vi.fn();
    await open(log, { onRematch, onShare: () => undefined });
    let button = screen.getByTestId('reveal-rematch');
    expect(button.textContent).toBe('Rematch');
    expect(button.getAttribute('data-state')).toBe('idle');
    cleanup();
    fake.current = controllableRenderer();
    await open(log, { onRematch, onShare: () => undefined, rematchState: 'sent', rematchLabel: 'Rematch sent · send again' });
    button = screen.getByTestId('reveal-rematch');
    expect(button.textContent).toBe('Rematch sent · send again');
    expect(button.getAttribute('data-state')).toBe('sent');
    cleanup();
    fake.current = controllableRenderer();
    await open(log, { onRematch, onShare: () => undefined, rematchState: 'offered', rematchLabel: 'Asha wants a rematch · Accept' });
    button = screen.getByTestId('reveal-rematch');
    expect(button.getAttribute('data-state')).toBe('offered');
    expect(button.className).toMatch(/primary/);
    // Offered: the rematch comes first in the footer.
    expect(button.parentElement?.firstElementChild).toBe(button);
    fireEvent.click(button);
    expect(onRematch).toHaveBeenCalledTimes(1);
  });
});

describe('nothing in the scrubber gives the result away', () => {
  const trackOf = (log: MatchEventLog, mode: ReplayMode) => neutralTrack(timelineOf(log, mode), { innings: 2, superBall: true });

  it('an innings-2 ball sits at the same place whether or not the match needs a Super Ball', async () => {
    const tie = await findDuel((l) => l.events.some((e) => e.t === 'ball' && e.innings === 'super'));
    const plain = await findDuel((l) => !l.events.some((e) => e.t === 'ball' && e.innings === 'super') && l.innings[1].balls.length === 6 && l.innings[0].balls.length === 6);
    const at = (log: MatchEventLog, k: number) => {
      const tl = timelineOf(log, 'full');
      const seg = segOf(tl, indexLog(log).balls[1][k]);
      return trackOf(log, 'full').pos(seg.t0);
    };
    for (const k of [0, 3, 5]) expect(at(tie, k)).toBeCloseTo(at(plain, k), 6);
    // The lengths differ, the track does not: the Super Ball zone is always there.
    expect(timelineOf(tie, 'full').duration).not.toBe(timelineOf(plain, 'full').duration);
    expect(trackOf(tie, 'full').zones).toEqual(trackOf(plain, 'full').zones);
  });

  it('positions only move forward, and a position maps back to a time inside the same moment', async () => {
    const log = await findDuel(rich);
    const tl = timelineOf(log, 'full');
    const track = trackOf(log, 'full');
    let last = -1;
    for (let ms = 0; ms < tl.duration; ms += 250) {
      const p = track.pos(ms);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(track.pos(tl.duration)).toBe(1);
    const seg = segOf(tl, indexLog(log).balls[0][2]);
    const back = track.time(track.pos(seg.t0 + seg.dur / 2));
    expect(Math.abs(back - (seg.t0 + seg.dur / 2))).toBeLessThan(seg.dur / 50 + 1);
  });

  it('shows the time played, and the total only once the result is known', async () => {
    const log = await findDuel(rich);
    await open(log);
    expect(screen.getByTestId('reveal-elapsed').textContent).toBe('0:00');
    expect(screen.queryByTestId('reveal-total')).toBeNull();
    expect(screen.getByTestId('reveal-scrub').getAttribute('aria-valuetext')).toBe('0:00 played');
    fireEvent.click(screen.getByTestId('reveal-skip'));
    expect(screen.getByTestId('reveal-total')).toBeTruthy();
    expect(screen.getByTestId('reveal-scrub').getAttribute('aria-valuetext')).toMatch(/ of /);
  });
});

describe('scrubber marks on a narrow phone (N2)', () => {
  it('close labels give way to the more telling one; nothing is dropped', () => {
    // Four balls a few px apart on a 220 px track: 4, 4, W, 4 used to print as "4 4W4 4".
    const ticks = [
      { pos: 0.4, kind: 'four' as const },
      { pos: 0.43, kind: 'four' as const },
      { pos: 0.46, kind: 'wicket' as const },
      { pos: 0.49, kind: 'four' as const },
      { pos: 0.7, kind: 'six' as const },
      { pos: 0.72, kind: 'ball' as const },
    ];
    const out = layoutTicks(ticks, 220);
    expect(out).toHaveLength(ticks.length);
    expect(out.filter((x) => x.label).map((x) => x.kind)).toEqual(['wicket', 'six']);
    // Every pair of labels left on the track is at least a label apart.
    const labelled = out.filter((x) => x.label).map((x) => x.pos * 220);
    for (let i = 1; i < labelled.length; i++) expect(labelled[i] - labelled[i - 1]).toBeGreaterThanOrEqual(17);
    // On a wide track all of them keep their labels.
    expect(layoutTicks(ticks, 1200).filter((x) => x.label)).toHaveLength(5);
  });
});

describe("Training's reveal is short", () => {
  it('keeps the player\'s own two balls, then the result: about half a minute', async () => {
    const log = await trainingLog();
    const { cutReplay } = await import('@/render3d/core/timeline');
    const { cutTrainingReplay, trainingCutBalls } = await import('@/screens/training/cut');
    const before = buildTimeline(log, 'key_moments');
    cutTrainingReplay(log);
    try {
      const cut = buildTimeline(log, 'key_moments');
      const balls = cut.segments.filter((x) => x.kind === 'ball');
      // The player's two balls are always in it, and nothing outside the chosen few.
      expect(balls.some((x) => x.innings === 0 && x.ball === 0)).toBe(true);
      expect(balls.some((x) => x.innings === 1 && x.ball === 0)).toBe(true);
      expect(balls).toHaveLength(2);
      for (const x of balls) expect(trainingCutBalls(log).has(x.eventIndex)).toBe(true);
      expect(cut.duration).toBeLessThan(32_000);
      expect(cut.duration).toBeLessThan(before.duration);
    } finally {
      cutReplay(log, null);
    }
  });
});
