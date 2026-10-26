/**
 * Presentation cues (engine v1): bowler action, executed ball path, batter animation and footwork, the ball's fate,
 * crowd, celebration, slow motion, Key Moments membership and a camera plan on a fixed per-ball timeline. The renderer
 * plays these as-is; they are part of the replay and are verified with it.
 */
import type {
  BallCues,
  BallFate,
  BallPath,
  BatterAnim,
  BowlerAction,
  CameraCue,
  Conditions,
  DeliveryPlan,
  FieldZone,
  ShotType,
} from '@/contracts';
import { deliveryTiming } from './delivery';
import type { Atom } from './model';
import { FAMILY, OFF_SIDE_ZONES } from './tables';

type Core = Omit<DeliveryPlan, 'gesture'>;

/** Run-up length (ms) before release, by bowler action. */
export const RUN_UP_MS: Record<BowlerAction, number> = {
  pace_long: 2200,
  pace_short: 1800,
  swing_side_on: 2000,
  spin_off: 1300,
  spin_leg: 1350,
};
/** Aftermath (ms after contact) by fate, before any celebration. */
const AFTERMATH_MS = { dot_block: 1000, dot_beaten: 1200, dot_fielded: 1900, runs1: 2300, runs2: 2900, runs3: 3500, four: 2600, six: 3000, wicket: 2600 } as const;
/** Extra time for a celebration. */
const CELEBRATION_MS = { none: 0, boundary: 1600, six: 2000, wicket: 2200, milestone: 2400 } as const;

export function bowlerActionFor(d: Core): BowlerAction {
  switch (d.variant) {
    case 'inswing':
    case 'outswing':
      return 'swing_side_on';
    case 'offspin':
      return 'spin_off';
    case 'legspin':
      return 'spin_leg';
    case 'slower':
      return 'pace_short';
    default:
      return d.intensity === 1 ? 'pace_short' : 'pace_long';
  }
}

export function footworkFor(d: Core, shot: ShotType): BallCues['footwork'] {
  const short = d.variant === 'bouncer' || (d.variant !== 'yorker' && d.length === 'short');
  if (shot === 'leave') return 'still';
  if (shot === 'sweep') return 'across';
  if (FAMILY[d.variant] === 'spin' && (shot === 'drive' || shot === 'loft') && (d.intensity === 1 || d.length === 'full')) return 'charge';
  if (shot === 'cut_pull' || short) return 'back';
  return 'forward';
}

export function batterAnimFor(shot: ShotType, zone: FieldZone | null, atom: Atom, leaving: boolean): BatterAnim {
  if (leaving) return 'leave';
  if (atom.contact === 'miss' || atom.contact === 'pad') return 'miss';
  if (atom.contact === 'thick_edge' || atom.contact === 'thin_edge') return 'edge';
  switch (shot) {
    case 'defend':
      return 'block';
    case 'rotate':
      return 'push';
    case 'drive':
      return 'drive';
    case 'cut_pull':
      return zone && OFF_SIDE_ZONES.includes(zone) ? 'cut' : 'pull';
    case 'sweep':
      return 'sweep';
    case 'loft':
      return 'loft';
    default:
      return 'leave';
  }
}

export function fateFor(atom: Atom, sixDistance: number): BallFate {
  switch (atom.kind) {
    case 'wicket':
      return { kind: 'wicket', wicket: atom.wicket ?? 'bowled', zone: atom.fielder };
    case 'six':
      return { kind: 'six', zone: atom.zone ?? 'mid_on', distanceM: sixDistance };
    case 'four':
      return { kind: 'four', zone: atom.zone ?? 'cover', bounces: atom.aerial };
    case 'runs':
      return { kind: 'runs', runs: atom.runs as 1 | 2 | 3, zone: atom.zone ?? 'cover' };
    default:
      return { kind: atom.kind as 'dot_block' | 'dot_beaten' | 'dot_fielded', zone: atom.zone };
  }
}

function aftermathMs(fate: BallFate): number {
  switch (fate.kind) {
    case 'runs':
      return fate.runs === 1 ? AFTERMATH_MS.runs1 : fate.runs === 2 ? AFTERMATH_MS.runs2 : AFTERMATH_MS.runs3;
    default:
      return AFTERMATH_MS[fate.kind];
  }
}

/** Timeline of one ball (ms from the start of the ball). */
export interface BallTimeline {
  releaseAtMs: number;
  bounceAtMs: number;
  contactAtMs: number;
  endMs: number;
}

export function timelineFor(action: BowlerAction, path: BallPath, flightMs: number, fate: BallFate, celebration: BallCues['celebration']): BallTimeline {
  const releaseAtMs = RUN_UP_MS[action];
  const travel = path.bounceAtM - 1.2;
  const bounceAtMs = releaseAtMs + Math.round((flightMs * (travel > 0 ? travel : 0)) / 17.7);
  const contactAtMs = releaseAtMs + flightMs;
  const endMs = contactAtMs + aftermathMs(fate) + CELEBRATION_MS[celebration];
  return { releaseAtMs, bounceAtMs: bounceAtMs < contactAtMs ? bounceAtMs : contactAtMs - 1, contactAtMs, endMs };
}

function cameraPlan(tl: BallTimeline, fate: BallFate, celebration: BallCues['celebration'], middle: boolean, variety: number): CameraCue[] {
  const cams: CameraCue[] = [];
  const add = (shot: CameraCue['shot'], atMs: number, durationMs: number) => {
    if (durationMs > 0) cams.push({ shot, atMs, durationMs });
  };
  const deliveryStart = tl.releaseAtMs - 250;
  add('bowler_follow', 0, deliveryStart);
  const afterContact = tl.contactAtMs + 200;
  add('broadcast_end', deliveryStart, afterContact - deliveryStart);
  const after = tl.endMs - CELEBRATION_MS[celebration];
  let cursor = afterContact;
  switch (fate.kind) {
    case 'wicket': {
      if (fate.wicket === 'bowled' || fate.wicket === 'lbw' || fate.wicket === 'stumped') {
        add('stump_cam', cursor, 900);
        cursor += 900;
        add('side_on', cursor, after - cursor);
      } else if (fate.wicket === 'run_out') {
        add('fielder_follow', cursor, 1100);
        cursor += 1100;
        add('stump_cam', cursor, after - cursor);
      } else {
        add(fate.zone ? 'fielder_follow' : 'side_on', cursor, after - cursor);
      }
      break;
    }
    case 'six':
      if (middle) {
        add('batter_close', cursor, 450);
        cursor += 450;
      }
      add('aerial', cursor, 1600);
      cursor += 1600;
      add('crowd', cursor, after - cursor);
      break;
    case 'four':
      if (middle) {
        add('batter_close', cursor, 400);
        cursor += 400;
      }
      add(fate.bounces ? 'aerial' : variety < 0.5 ? 'side_on' : 'fielder_follow', cursor, 1400);
      cursor += 1400;
      add('crowd', cursor, after - cursor);
      break;
    case 'runs':
    case 'dot_fielded':
      add('fielder_follow', cursor, after - cursor);
      break;
    default:
      add(variety < 0.5 ? 'batter_close' : 'side_on', cursor, after - cursor);
  }
  if (celebration !== 'none') add('celebration', after, tl.endMs - after);
  return cams;
}

export interface CueInput {
  d: Core;
  conditions: Conditions;
  path: BallPath;
  shot: ShotType;
  zone: FieldZone | null;
  atom: Atom;
  leaving: boolean;
  sixDistance: number;
  variety: number;
  superBall: boolean;
  lastBall: boolean;
}

export function buildCues(c: CueInput): BallCues {
  const fate = fateFor(c.atom, c.sixDistance);
  const celebration: BallCues['celebration'] = fate.kind === 'six' ? 'six' : fate.kind === 'four' ? 'boundary' : fate.kind === 'wicket' ? 'wicket' : 'none';
  const crowdBase =
    fate.kind === 'six'
      ? 0.95
      : fate.kind === 'wicket'
        ? 0.9
        : fate.kind === 'four'
          ? 0.8
          : fate.kind === 'runs'
            ? 0.2 + 0.1 * fate.runs
            : fate.kind === 'dot_fielded'
              ? 0.2
              : 0.15;
  const crowd = Math.round(Math.min(1, crowdBase + (c.superBall ? 0.1 : 0) + (c.lastBall ? 0.05 : 0)) * 100) / 100;
  const slowMotion = fate.kind === 'wicket' || fate.kind === 'six' || (fate.kind === 'four' && (c.lastBall || c.superBall));
  const key = fate.kind === 'wicket' || fate.kind === 'six' || fate.kind === 'four' || c.superBall || (c.lastBall && c.atom.runs >= 2);
  const action = bowlerActionFor(c.d);
  const flight = deliveryTiming(c.d, c.conditions).releaseToContactMs;
  const tl = timelineFor(action, c.path, flight, fate, celebration);
  return {
    bowlerAction: action,
    path: c.path,
    batterAnim: batterAnimFor(c.shot, c.zone, c.atom, c.leaving),
    footwork: c.leaving ? 'still' : footworkFor(c.d, c.shot),
    fate,
    crowd,
    celebration,
    slowMotion,
    key,
    cameras: cameraPlan(tl, fate, celebration, c.atom.contact === 'middle', c.variety),
  };
}

/** Timeline of a resolved ball for renderers and highlight cutting. */
export function ballTimeline(outcome: { delivery: Core; cues: BallCues }, conditions: Conditions): BallTimeline {
  const flight = deliveryTiming(outcome.delivery, conditions).releaseToContactMs;
  return timelineFor(outcome.cues.bowlerAction, outcome.cues.path, flight, outcome.cues.fate, outcome.cues.celebration);
}
