import {
  OPPONENT_IDS,
  type ActionTag,
  type Difficulty,
  type GameConfig,
  type OpponentId,
  type OpponentMeta,
  type OpponentPlay,
  type OpponentRuntime,
  type RngState,
  type Scenario,
  type TimerPace,
} from './types';
import { rngFloat, rngInt } from './prng';
import { clamp, drawInt, type Draft } from './state';

export const OPPONENTS: Record<OpponentId, OpponentMeta> = {
  exploiter: {
    id: 'exploiter',
    name: 'Grievance Exploiter',
    behavior: 'Turns delays and unresolved public anger into escalation.',
    pressure: 'Punishes slow responses. While you wait, crowds grow, harden and stop listening.',
    baseDifficulty: 'Low',
    signal: 'pulse',
    exploits: ['wait'],
  },
  provocateur: {
    id: 'provocateur',
    name: 'Provocateur',
    behavior: 'Tries to manufacture confrontations between crowds and police.',
    pressure: 'Stages incidents that bait force. Restraint plus verified facts take the bait away.',
    baseDifficulty: 'Medium',
    signal: 'spike',
    exploits: ['force', 'wait'],
  },
  disinfo: {
    id: 'disinfo',
    name: 'Disinformation Cell',
    behavior: 'Produces false claims and manipulated evidence at speed.',
    pressure: 'Floods your evidence tray. Acting on unverified material costs freedom and trust.',
    baseDifficulty: 'Medium',
    signal: 'swarm',
    exploits: ['accusation', 'communication'],
  },
  sabotage: {
    id: 'sabotage',
    name: 'Sabotage Network',
    behavior: 'Exploits confusion to damage property, records and services.',
    pressure: 'Destroys perishable evidence and disrupts services unless you preserve and protect.',
    baseDifficulty: 'High',
    signal: 'fracture',
    exploits: ['wait', 'service'],
  },
  overreaction: {
    id: 'overreaction',
    name: 'Overreaction Trap',
    behavior: 'Tempts the state into disproportionate action.',
    pressure: 'Offers shortcuts: sweeping detentions, shutdowns, blanket bans. Each one wrecks legitimacy.',
    baseDifficulty: 'High',
    signal: 'bait',
    exploits: ['force', 'detention', 'suppressive'],
  },
};

export const DIFFICULTY_META: Record<Difficulty, { label: string; description: string }> = {
  measured: { label: 'Measured', description: 'Fewer opponent moves and gentler pressure. Good for learning the city.' },
  standard: { label: 'Standard', description: 'The intended challenge. Opponents fire most of their moves.' },
  severe: { label: 'Severe', description: 'Every move fires, harder and earlier. For experienced players.' },
};

export const DEFAULT_OPPONENTS: OpponentId[] = ['exploiter', 'disinfo'];

export const PACE_MS: Record<TimerPace, number> = { standard: 1000, relaxed: 1500, extended: 2000 };

const FIRE_FRACTION: Record<Difficulty, number> = { measured: 0.5, standard: 0.75, severe: 1 };
const INTENSITY: Record<Difficulty, number> = { measured: 0.8, standard: 1, severe: 1.25 };
const RANK: Record<Difficulty, number> = { measured: 0, standard: 1, severe: 2 };
const MEMORY_SIZE = 4;
const ADAPT_PULL = 10;

export function difficultyAllows(play: OpponentPlay, difficulty: Difficulty): boolean {
  return !play.minDifficulty || RANK[difficulty] >= RANK[play.minDifficulty];
}

/** Canonical order so selection order never changes the schedule. */
export function canonicalOpponents(ids: OpponentId[]): OpponentId[] {
  return OPPONENT_IDS.filter((id) => ids.includes(id));
}

export function scheduleOpponents(
  scenario: Scenario,
  config: GameConfig,
  rng: RngState,
): { runtimes: Record<string, OpponentRuntime>; rng: RngState } {
  const runtimes: Record<string, OpponentRuntime> = {};
  let r = rng;
  const fraction = FIRE_FRACTION[config.difficulty];
  for (const id of canonicalOpponents(config.opponents)) {
    const schedule: Record<string, number> = {};
    const plays = scenario.opponentPlays.filter((p) => p.opponent === id && difficultyAllows(p, config.difficulty));
    for (const play of plays) {
      let fires = true;
      if (fraction < 1) {
        const f = rngFloat(r);
        r = f.next;
        fires = f.value < Math.min(1, fraction * (play.weight ?? 1));
      }
      if (!fires) continue;
      const at = rngInt(r, play.earliest, play.latest);
      r = at.next;
      schedule[play.id] = at.value;
    }
    runtimes[id] = { id, schedule, fired: [], memory: [], intensity: INTENSITY[config.difficulty] };
  }
  return { runtimes, rng: r };
}

/**
 * Feeds the player's latest action tags to every opponent. Plays that respond to a remembered
 * tendency are pulled earlier (up to 10 ticks) or, if dormant, become guaranteed.
 */
export function adaptOpponents(d: Draft, scenario: Scenario, tags: ActionTag[]): void {
  if (tags.length === 0) return;
  for (const rt of Object.values(d.opponents)) {
    rt.memory = [...rt.memory, ...tags].slice(-MEMORY_SIZE);
    for (const play of scenario.opponentPlays) {
      if (play.opponent !== rt.id || !play.respondsTo?.length) continue;
      if (!difficultyAllows(play, d.config.difficulty)) continue;
      if (rt.fired.includes(play.id)) continue;
      const marker = `_adapted:${play.id}`;
      if (d.flags[marker]) continue;
      if (!play.respondsTo.some((t) => rt.memory.includes(t))) continue;
      const soonest = Math.max(play.earliest, d.tick + 2);
      const current = rt.schedule[play.id];
      if (current === undefined) {
        if (soonest > play.latest) continue;
        const offset = drawInt(d, 0, 6);
        rt.schedule[play.id] = clamp(soonest + offset, soonest, play.latest);
      } else if (current > soonest) {
        rt.schedule[play.id] = Math.max(soonest, current - ADAPT_PULL);
      }
      d.flags[marker] = true;
    }
  }
}
