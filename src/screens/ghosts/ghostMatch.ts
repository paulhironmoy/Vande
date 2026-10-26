/**
 * Practice Ghosts: a full Sealed Six match against a deterministic local opponent, with no server. The ghost's over
 * and its batting come from the engine's ghost policies; the log is built and verified by the same engine code as an
 * official match, so the reveal, the tactics and the scorecard are exactly what a real match shows.
 */
import type { BattingInput, Conditions, GhostProfile, KitSpec, MatchEventLog, OverPlan, PlayerRef, SealedSixEngineApi } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts';
import { localInnings, type LocalInnings } from '../local/localInnings';

const GHOST_KITS: KitSpec[] = [
  { id: 'ghost-anchor', primary: '#2d6a8f', secondary: '#9fe3ff', pattern: 'plain' },
  { id: 'ghost-swinger', primary: '#1f7a4a', secondary: '#d8f5c4', pattern: 'hoops' },
  { id: 'ghost-enforcer', primary: '#8f2d3f', secondary: '#ffc266', pattern: 'sash' },
  { id: 'ghost-trickster', primary: '#5d3fa8', secondary: '#f2c9ff', pattern: 'chevron' },
  { id: 'ghost-maestro', primary: '#1d1858', secondary: '#ffaa33', pattern: 'stripes' },
];

export function ghostRef(g: GhostProfile, alias: string): PlayerRef {
  const i = Math.max(0, ['anchor', 'swinger', 'enforcer', 'trickster', 'maestro'].indexOf(g.id));
  return { id: `ghost_${g.id}`, alias, avatar: { seed: `ghost-${g.id}` }, kit: GHOST_KITS[i % GHOST_KITS.length], kind: 'ghost' };
}

export function randomHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export interface GhostMatch {
  ghost: GhostProfile;
  ref: PlayerRef;
  conditions: Conditions;
  seed: string;
  plan: OverPlan;
  /** Salt of the ghost's commit (fixed when the match is set up). */
  salt: string;
  /** The player's innings against the ghost's over (six balls and the Super Ball). */
  innings: LocalInnings;
}

export function setupGhostMatch(engine: SealedSixEngineApi, ghost: GhostProfile, alias: string, conditions: Conditions, seed = randomHex()): GhostMatch {
  const plan = engine.ghostPlan(ghost.id, seed, conditions);
  return { ghost, ref: ghostRef(ghost, alias), conditions, seed, plan, salt: randomHex(8), innings: localInnings({ plan, conditions, seed, innings: 0, includeSuperBall: true, engine }) };
}

/**
 * The ghost bats against the player's sealed over; then the full, verifiable log is built. `mySalt` is the salt the
 * player's over was sealed with at lock, so the replay's commit is the hash shown on the lock screen.
 */
export async function finishGhostMatch(engine: SealedSixEngineApi, gm: GhostMatch, me: PlayerRef, myPlan: OverPlan, hour: string, mySalt: string): Promise<MatchEventLog> {
  let state = engine.startInnings(1);
  const inputs: Array<BattingInput | null> = [];
  while (!state.done) {
    const ball = state.mainDone ? SUPER_BALL_INDEX : state.nextBall;
    const delivery = engine.revealDelivery(myPlan, ball, gm.conditions);
    const raw = engine.ghostBat(gm.ghost.id, gm.seed, delivery, myPlan.field);
    const checked = engine.validateBattingInput(raw, delivery);
    const input = checked.ok ? checked.input : null;
    state = engine.resolveNextBall(state, { seed: gm.seed, conditions: gm.conditions, plan: myPlan, input }).state;
    inputs.push(input);
  }
  const salts = [mySalt, gm.salt];
  const [h0, h1] = await Promise.all([engine.commitHash(myPlan, salts[0]), engine.commitHash(gm.plan, salts[1])]);
  return engine.buildMatchLog({
    matchId: `ghost-${gm.seed.slice(0, 12)}`,
    kind: 'ghost',
    seed: gm.seed,
    conditions: gm.conditions,
    players: [me, gm.ref],
    commits: [
      { player: 0, hash: h0, sig: '', keyId: 'local', lockedHour: hour, salt: salts[0] },
      { player: 1, hash: h1, sig: '', keyId: 'local', lockedHour: hour, salt: salts[1] },
    ],
    plans: [myPlan, gm.plan],
    inputs: [gm.innings.inputs(), inputs],
    innings: [gm.innings.state(), state],
    meta: { createdHour: hour, revealedHour: hour },
  });
}

/** Hour-resolution ISO stamp (logs never carry exact times). */
export function hourStamp(d = new Date()): string {
  return `${d.toISOString().slice(0, 13)}:00Z`;
}
