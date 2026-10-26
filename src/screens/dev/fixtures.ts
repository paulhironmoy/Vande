/**
 * DEVELOPMENT FIXTURES ONLY. A hand-written, plausible revealed match used by the renderer harness, the screen
 * gallery and unit tests while the gameplay engine is being built. Never imported by shipped screens.
 */
import type {
  BallFate,
  BallOutcome,
  BallPath,
  BatterAnim,
  BowlerAction,
  Contact,
  DeliveryVariant,
  FieldZone,
  Intent,
  Length,
  Line,
  MatchEvent,
  MatchEventLog,
  PlayerRef,
  Runs,
  ShotType,
  TimingGrade,
  WicketKind,
} from '@/contracts';
import { KITS } from '@/ui/avatar/traits';

export const FIXTURE_PLAYERS: [PlayerRef, PlayerRef] = [
  { id: 'p_swingking', alias: 'Swing King', avatar: { seed: 'swing-king-7' }, kit: KITS[0], kind: 'human' },
  { id: 'p_nightowl', alias: 'Night Owl', avatar: { seed: 'night-owl-3' }, kit: KITS[1], kind: 'human' },
];

const FAMILY: Record<DeliveryVariant, 'pace' | 'swing' | 'spin'> = {
  yorker: 'pace',
  good_length: 'pace',
  bouncer: 'pace',
  slower: 'pace',
  inswing: 'swing',
  outswing: 'swing',
  offspin: 'spin',
  legspin: 'spin',
};

const LINE_X: Record<Line, number> = { wide_off: 0.42, off: 0.12, middle: 0, leg: -0.1 };
const LENGTH_BOUNCE: Record<Length, number> = { full: 16.6, good: 14.2, short: 10.4 };
const LENGTH_HEIGHT: Record<Length, number> = { full: 0.42, good: 0.78, short: 1.32 };

export function fixturePath(variant: DeliveryVariant, line: Line, length: Length, intensity: 1 | 2 | 3 = 2): BallPath {
  const fam = FAMILY[variant];
  const speed = fam === 'spin' ? 76 + intensity * 6 : variant === 'slower' ? 108 : fam === 'swing' ? 122 + intensity * 5 : 128 + intensity * 6;
  const yorker = variant === 'yorker';
  const bouncer = variant === 'bouncer';
  return {
    speedKph: speed,
    releaseHeightM: fam === 'spin' ? 1.95 : 2.12,
    bounceAtM: yorker ? 18.9 : bouncer ? 9.6 : LENGTH_BOUNCE[length],
    lineAtBatM: LINE_X[line],
    swingM: variant === 'outswing' ? 0.32 : variant === 'inswing' ? -0.3 : 0,
    turnM: variant === 'offspin' ? -0.2 : variant === 'legspin' ? 0.26 : 0,
    heightAtBatM: yorker ? 0.1 : bouncer ? 1.55 : LENGTH_HEIGHT[length],
    spinRpm: fam === 'spin' ? 1900 : 1000,
    seamUpright: fam !== 'spin',
  };
}

const ACTION: Record<DeliveryVariant, BowlerAction> = {
  yorker: 'pace_short',
  good_length: 'pace_long',
  bouncer: 'pace_long',
  slower: 'pace_short',
  inswing: 'swing_side_on',
  outswing: 'swing_side_on',
  offspin: 'spin_off',
  legspin: 'spin_leg',
};

interface Spec {
  variant: DeliveryVariant;
  line: Line;
  length: Length;
  intent?: Intent;
  shot: ShotType;
  zone: FieldZone | null;
  timing: TimingGrade;
  contact: Contact;
  anim: BatterAnim;
  footwork: BallOutcome['cues']['footwork'];
  fate: BallFate;
  key?: boolean;
  slow?: boolean;
  celebration?: BallOutcome['cues']['celebration'];
  explain: string;
}

function outcome(ball: number, s: Spec): BallOutcome {
  const runs: Runs = s.fate.kind === 'runs' ? s.fate.runs : s.fate.kind === 'four' ? 4 : s.fate.kind === 'six' ? 6 : 0;
  const wicket: WicketKind | null = s.fate.kind === 'wicket' ? s.fate.wicket : null;
  const crowd = s.fate.kind === 'six' ? 1 : s.fate.kind === 'wicket' ? 0.95 : s.fate.kind === 'four' ? 0.8 : s.fate.kind === 'runs' ? 0.45 : 0.25;
  return {
    ball,
    delivery: { variant: s.variant, line: s.line, length: s.length, intensity: 2, intent: s.intent ?? 'attack' },
    execution: 0.82,
    executionGrade: 'good',
    shot: s.shot,
    zone: s.zone,
    timing: s.timing,
    contact: s.contact,
    runs,
    wicket,
    fielder: s.fate.kind === 'dot_fielded' || (s.fate.kind === 'wicket' && s.fate.wicket === 'caught') ? s.zone : null,
    factors: { matchup: runs >= 4 ? 0.5 : wicket ? -0.6 : 0, timing: s.timing === 'perfect' ? 0.8 : s.timing === 'good' ? 0.4 : -0.5, execution: 0.3, pitch: 0.1, field: s.fate.kind === 'dot_fielded' ? -0.4 : 0.2, setup: 0, risk: s.shot === 'loft' ? 0.8 : s.shot === 'defend' ? 0.05 : 0.4, explainKey: s.explain },
    cues: {
      bowlerAction: ACTION[s.variant],
      path: fixturePath(s.variant, s.line, s.length),
      batterAnim: s.anim,
      footwork: s.footwork,
      fate: s.fate,
      crowd,
      celebration: s.celebration ?? (s.fate.kind === 'wicket' ? 'wicket' : s.fate.kind === 'six' ? 'six' : s.fate.kind === 'four' ? 'boundary' : 'none'),
      slowMotion: Boolean(s.slow),
      key: Boolean(s.key ?? (runs >= 4 || wicket)),
      cameras: [],
    },
  };
}

const INNINGS_A: Spec[] = [
  { variant: 'good_length', line: 'off', length: 'good', shot: 'drive', zone: 'cover', timing: 'early', contact: 'miss', anim: 'miss', footwork: 'forward', fate: { kind: 'dot_beaten', zone: null }, explain: 'explain.swing_vs_drive' },
  { variant: 'outswing', line: 'off', length: 'full', shot: 'drive', zone: 'cover', timing: 'perfect', contact: 'middle', anim: 'drive', footwork: 'forward', fate: { kind: 'four', zone: 'cover', bounces: true }, explain: 'explain.field_gap' },
  { variant: 'good_length', line: 'middle', length: 'good', shot: 'rotate', zone: 'mid_on', timing: 'good', contact: 'middle', anim: 'push', footwork: 'forward', fate: { kind: 'runs', runs: 1, zone: 'mid_on' }, explain: 'explain.timing_good' },
  { variant: 'bouncer', line: 'middle', length: 'short', shot: 'cut_pull', zone: 'midwicket', timing: 'perfect', contact: 'middle', anim: 'pull', footwork: 'back', fate: { kind: 'six', zone: 'midwicket', distanceM: 84 }, slow: true, explain: 'explain.bouncer_vs_pull' },
  { variant: 'yorker', line: 'middle', length: 'full', shot: 'loft', zone: 'mid_off', timing: 'late', contact: 'miss', anim: 'miss', footwork: 'forward', fate: { kind: 'wicket', wicket: 'bowled', zone: null }, slow: true, explain: 'explain.yorker_vs_loft' },
  { variant: 'good_length', line: 'off', length: 'good', shot: 'defend', zone: null, timing: 'good', contact: 'middle', anim: 'block', footwork: 'forward', fate: { kind: 'dot_block', zone: null }, explain: 'explain.timing_good' },
];

const INNINGS_B: Spec[] = [
  { variant: 'offspin', line: 'middle', length: 'good', shot: 'sweep', zone: 'square_leg', timing: 'good', contact: 'middle', anim: 'sweep', footwork: 'forward', fate: { kind: 'runs', runs: 2, zone: 'square_leg' }, explain: 'explain.spin_vs_sweep' },
  { variant: 'legspin', line: 'off', length: 'full', shot: 'loft', zone: 'mid_on', timing: 'early', contact: 'thick_edge', anim: 'loft', footwork: 'charge', fate: { kind: 'wicket', wicket: 'caught', zone: 'mid_on' }, slow: true, explain: 'explain.field_stopped' },
  { variant: 'inswing', line: 'leg', length: 'full', shot: 'drive', zone: 'mid_on', timing: 'late', contact: 'pad', anim: 'miss', footwork: 'forward', fate: { kind: 'wicket', wicket: 'lbw', zone: null }, explain: 'explain.swing_vs_drive' },
  { variant: 'good_length', line: 'off', length: 'full', shot: 'drive', zone: 'mid_off', timing: 'perfect', contact: 'middle', anim: 'drive', footwork: 'forward', fate: { kind: 'four', zone: 'mid_off', bounces: true }, explain: 'explain.loose_ball' },
  { variant: 'slower', line: 'off', length: 'short', shot: 'cut_pull', zone: 'point', timing: 'good', contact: 'middle', anim: 'cut', footwork: 'across', fate: { kind: 'dot_fielded', zone: 'point' }, explain: 'explain.slower_vs_early' },
  { variant: 'bouncer', line: 'off', length: 'short', shot: 'leave', zone: null, timing: 'no_shot', contact: 'none', anim: 'leave', footwork: 'back', fate: { kind: 'dot_beaten', zone: null }, explain: 'explain.leave_safe' },
];

/** Builds the fixture log. Player 0 bats first against player 1's over. */
export function fixtureMatchLog(): MatchEventLog {
  const events: MatchEvent[] = [];
  const innings = [INNINGS_A, INNINGS_B].map((specs, inn) => {
    const batter = inn as 0 | 1;
    events.push({ t: 'innings_start', innings: batter, batter, field: inn === 0 ? 'balanced' : 'attacking' });
    let runs = 0;
    let wickets = 0;
    const balls: BallOutcome[] = [];
    specs.forEach((s, i) => {
      if (wickets >= 2) return;
      const o = outcome(i, s);
      runs += o.runs;
      if (o.wicket) wickets++;
      balls.push(o);
      events.push({ t: 'ball', innings: batter, ball: i, outcome: o, score: { runs, wickets, ballsLeft: 5 - i } });
    });
    events.push({ t: 'innings_end', innings: batter, runs, wickets });
    return { batter, bowler: (1 - batter) as 0 | 1, balls, runs, wickets, ballsFaced: balls.length };
  });
  const winner = innings[0].runs === innings[1].runs ? null : innings[0].runs > innings[1].runs ? 0 : 1;
  const turning = events.findIndex((e) => e.t === 'ball' && e.outcome.wicket === 'bowled');
  events.push({ t: 'result', result: { winner, tie: winner === null, decidedBy: 'runs', marginRuns: Math.abs(innings[0].runs - innings[1].runs), playerOfMatch: winner ?? 0, turningPointEvent: turning } });
  const plan = (field: 'balanced' | 'attacking') => ({
    v: 1 as const,
    field,
    balls: Array.from({ length: 6 }, () => ({ variant: 'good_length' as const, line: 'off' as const, length: 'good' as const, intensity: 2 as const, intent: 'attack' as const, gesture: { pointer: 'touch' as const, samples: [] } })) as unknown as MatchEventLog['plans'][0]['balls'],
    superBall: { variant: 'yorker' as const, line: 'middle' as const, length: 'full' as const, intensity: 3 as const, intent: 'attack' as const, gesture: { pointer: 'touch' as const, samples: [] } },
  });
  return {
    schema: 1,
    engine: 1,
    matchId: 'fixture-match-001',
    kind: 'duel',
    seed: '0123456789abcdef0123456789abcdef',
    conditions: { pitch: 'hard', weather: 'clear' },
    players: FIXTURE_PLAYERS,
    commits: [
      { player: 0, hash: 'a'.repeat(64), sig: 'b'.repeat(64), keyId: 'k1', lockedHour: '2026-10-24T19:00Z' },
      { player: 1, hash: 'c'.repeat(64), sig: 'd'.repeat(64), keyId: 'k1', lockedHour: '2026-10-24T20:00Z' },
    ],
    // Innings 0 is bowled by player 1 (balanced field); innings 1 by player 0 (attacking field).
    plans: [plan('attacking'), plan('balanced')],
    inputs: [[], []],
    innings: innings as MatchEventLog['innings'],
    superBall: { used: false, outcomes: null },
    result: { winner, tie: winner === null, decidedBy: 'runs', marginRuns: Math.abs(innings[0].runs - innings[1].runs), playerOfMatch: winner ?? 0, turningPointEvent: turning },
    events,
    meta: { createdHour: '2026-10-24T18:00Z', revealedHour: '2026-10-24T21:00Z' },
  };
}

/** A single outcome for focused harness shots: e.g. fixtureBall('six'). */
export function fixtureBall(kind: 'six' | 'four' | 'bowled' | 'caught' | 'lbw' | 'block' | 'beaten' | 'runs' | 'fielded' | 'runout' | 'stumped'): BallOutcome {
  const all = [...INNINGS_A, ...INNINGS_B];
  const find = (pred: (s: Spec) => boolean) => all.find(pred)!;
  switch (kind) {
    case 'six':
      return outcome(0, find((s) => s.fate.kind === 'six'));
    case 'four':
      return outcome(0, find((s) => s.fate.kind === 'four'));
    case 'bowled':
      return outcome(0, find((s) => s.fate.kind === 'wicket' && s.fate.wicket === 'bowled'));
    case 'caught':
      return outcome(0, find((s) => s.fate.kind === 'wicket' && s.fate.wicket === 'caught'));
    case 'lbw':
      return outcome(0, find((s) => s.fate.kind === 'wicket' && s.fate.wicket === 'lbw'));
    case 'block':
      return outcome(0, find((s) => s.fate.kind === 'dot_block'));
    case 'beaten':
      return outcome(0, find((s) => s.fate.kind === 'dot_beaten'));
    case 'runs':
      return outcome(0, find((s) => s.fate.kind === 'runs' && s.fate.runs === 2));
    case 'fielded':
      return outcome(0, find((s) => s.fate.kind === 'dot_fielded'));
    case 'runout':
      return outcome(0, { variant: 'good_length', line: 'off', length: 'good', shot: 'rotate', zone: 'cover', timing: 'good', contact: 'middle', anim: 'push', footwork: 'forward', fate: { kind: 'wicket', wicket: 'run_out', zone: 'cover' }, slow: true, explain: 'explain.field_stopped' });
    case 'stumped':
      return outcome(0, { variant: 'legspin', line: 'off', length: 'full', shot: 'loft', zone: 'mid_off', timing: 'early', contact: 'miss', anim: 'miss', footwork: 'charge', fate: { kind: 'wicket', wicket: 'stumped', zone: null }, slow: true, explain: 'explain.yorker_vs_loft' });
  }
}

/** A revealed delivery for live-batting previews. */
export function fixtureDelivery(ball = 0, variant: DeliveryVariant = 'good_length', line: Line = 'off', length: Length = 'good') {
  const path = fixturePath(variant, line, length);
  const releaseToContactMs = Math.round(((18.9 - 0.15) / (path.speedKph / 3.6)) * 1000 * 1.06);
  return {
    ball,
    variant,
    family: FAMILY[variant],
    line,
    length,
    intensity: 2 as const,
    timing: { releaseToContactMs, perfectMs: 28, goodMs: 70, edgeMs: 150 },
    path,
  };
}
