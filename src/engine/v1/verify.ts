/**
 * Replay verification (engine v1): recompute the commit hashes, re-validate the plans and every stored input, re-run
 * the innings from the log's own seed and inputs, rebuild the whole log and compare it field by field. Duels and cup
 * matches have two sealed plans; a Daily Six log (kind 'daily') has the setter's over only.
 */
import type { BattingInput, Fail, InningsState, MatchEventLog, OverPlan } from '@/contracts';
import { EVENT_SCHEMA_VERSION, SUPER_BALL_INDEX } from '@/contracts/cricket';
import { canonicalJson, commitHash } from '../canonical';
import { validateBattingInput } from './batting';
import { assembleDailyLog } from './daily';
import { revealDelivery } from './delivery';
import { resolveNextBall, startInnings } from './innings';
import { buildMatchLog } from './match';
import { validatePlan } from './plan';
import { RULES_VERSION, VARIANTS } from './tables';

const fail = (errors: string[]): Fail => ({ ok: false, errors });
const OK = { ok: true } as const;

async function checkCommit(log: MatchEventLog, p: 0 | 1, errors: string[]): Promise<void> {
  const c = log.commits[p];
  if (!c || c.player !== p) errors.push(`commit${p}.player`);
  if (!c || typeof c.salt !== 'string') {
    errors.push(`commit${p}.salt_missing`);
    return;
  }
  if ((await commitHash(log.plans[p], c.salt)) !== c.hash) errors.push(`commit${p}.hash_mismatch`);
  const v = validatePlan(log.plans[p], VARIANTS);
  if (!v.ok) errors.push(...v.errors.map((e) => `plan${p}.${e}`));
}

/** Re-plays innings `i` against `plan` from the log's stored inputs; returns the state and the inputs by ball. */
function replay(log: MatchEventLog, i: 0 | 1, plan: OverPlan, errors: string[]): { state: InningsState; byBall: Array<BattingInput | null> } {
  const map = new Map<number, BattingInput>();
  for (const input of log.inputs[i]) {
    if (!input || typeof input.ball !== 'number') {
      errors.push(`inputs${i}.malformed`);
      continue;
    }
    if (map.has(input.ball)) errors.push(`inputs${i}.duplicate_ball_${input.ball}`);
    map.set(input.ball, input);
  }
  let state = startInnings(i);
  const used = new Set<number>();
  const byBall: Array<BattingInput | null> = [];
  while (!state.done) {
    const ball = state.mainDone ? SUPER_BALL_INDEX : state.nextBall;
    const input = map.get(ball) ?? null;
    if (input) {
      const check = validateBattingInput(input, revealDelivery(plan, ball, log.conditions));
      if (!check.ok) errors.push(...check.errors.map((e) => `inputs${i}.ball${ball}.${e}`));
      used.add(ball);
    }
    byBall[ball] = input;
    state = resolveNextBall(state, { seed: log.seed, conditions: log.conditions, plan, input }).state;
  }
  for (const b of map.keys()) if (!used.has(b)) errors.push(`inputs${i}.unplayed_ball_${b}`);
  return { state, byBall };
}

function compare(rebuilt: MatchEventLog, log: MatchEventLog, errors: string[]): void {
  const keys = new Set<string>([...Object.keys(rebuilt), ...Object.keys(log)]);
  for (const k of [...keys].sort()) {
    const a = canonicalJson((rebuilt as unknown as Record<string, unknown>)[k] ?? null);
    const b = canonicalJson((log as unknown as Record<string, unknown>)[k] ?? null);
    if (a !== b) errors.push(`log.mismatch.${k}`);
  }
}

async function verifyDaily(log: MatchEventLog): Promise<{ ok: true } | Fail> {
  const errors: string[] = [];
  await checkCommit(log, 1, errors);
  if (canonicalJson(log.plans[0]) !== canonicalJson(log.plans[1])) errors.push('plan0.not_the_daily_over');
  if (log.inputs[1].length) errors.push('inputs1.not_empty');
  if (errors.length) return fail(errors);
  const { state, byBall } = replay(log, 0, log.plans[1], errors);
  if (errors.length) return fail(errors);
  const rebuilt = assembleDailyLog({
    matchId: log.matchId,
    seed: log.seed,
    conditions: log.conditions,
    player: log.players[0],
    setter: log.players[1],
    plan: log.plans[1],
    commit: log.commits[1],
    inputs: byBall,
    innings: state,
    meta: log.meta,
  });
  // The whole-log comparison already covers these; explicit codes make a wrong daily score easy to diagnose.
  if (log.result?.marginRuns !== 0) errors.push('result.daily_margin_not_zero');
  if (log.result?.dailyScore !== rebuilt.result.dailyScore) errors.push('result.daily_score');
  compare(rebuilt, log, errors);
  return errors.length ? fail(errors) : OK;
}

export async function verifyMatchLog(log: MatchEventLog): Promise<{ ok: true } | Fail> {
  try {
    if (!log || typeof log !== 'object') return fail(['log.missing']);
    if (log.schema !== EVENT_SCHEMA_VERSION) return fail(['log.schema']);
    if (log.engine !== RULES_VERSION) return fail(['log.engine_version']);
    if (!Array.isArray(log.plans) || log.plans.length !== 2 || !Array.isArray(log.commits) || log.commits.length !== 2) return fail(['log.shape']);
    if (!Array.isArray(log.inputs) || log.inputs.length !== 2) return fail(['log.shape']);
    if (log.kind === 'daily') return await verifyDaily(log);
    const errors: string[] = [];
    for (const p of [0, 1] as const) await checkCommit(log, p, errors);
    if (errors.length) return fail(errors);

    const states: [InningsState, InningsState] = [startInnings(0), startInnings(1)];
    const byBall: [Array<BattingInput | null>, Array<BattingInput | null>] = [[], []];
    for (const i of [0, 1] as const) {
      const r = replay(log, i, log.plans[i === 0 ? 1 : 0], errors);
      states[i] = r.state;
      byBall[i] = r.byBall;
    }
    if (errors.length) return fail(errors);

    const rebuilt = buildMatchLog({
      matchId: log.matchId,
      kind: log.kind,
      seed: log.seed,
      conditions: log.conditions,
      players: log.players,
      commits: log.commits,
      plans: log.plans,
      inputs: byBall,
      innings: states,
      meta: log.meta,
    });
    compare(rebuilt, log, errors);
    return errors.length ? fail(errors) : OK;
  } catch (e) {
    return fail([`log.malformed:${e instanceof Error ? e.message : String(e)}`]);
  }
}
