import { OPPONENT_IDS, SCENARIO_IDS, type DailySpec, type OpponentId, type ScenarioId } from './types';
import { createRng, hashString, rngInt } from './prng';

const SCENARIO_TITLES: Record<ScenarioId, string> = {
  'examination-crisis': 'Examination Crisis',
  'electoral-dispute': 'Electoral Dispute',
  'information-storm': 'Information Storm',
};

/** Local calendar day as YYYY-MM-DD. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function getDailySpecForKey(key: string): DailySpec {
  const seed = hashString(`vande-daily-${key}`);
  const scenarioId = SCENARIO_IDS[((dayIndex(key) % SCENARIO_IDS.length) + SCENARIO_IDS.length) % SCENARIO_IDS.length];
  let rng = createRng(seed);
  const countDraw = rngInt(rng, 2, 3);
  rng = countDraw.next;
  const pool: OpponentId[] = [...OPPONENT_IDS];
  const opponents: OpponentId[] = [];
  while (opponents.length < countDraw.value && pool.length) {
    const pick = rngInt(rng, 0, pool.length - 1);
    rng = pick.next;
    opponents.push(pool.splice(pick.value, 1)[0]);
  }
  const low = rngInt(rng, 45, 60);
  rng = low.next;
  const typical = rngInt(rng, 60, 75);
  rng = typical.next;
  const high = rngInt(rng, 78, 92);
  return {
    date: key,
    scenarioId,
    seed,
    difficulty: 'standard',
    opponents: OPPONENT_IDS.filter((id) => opponents.includes(id)),
    title: `Daily Crisis — ${SCENARIO_TITLES[scenarioId]}`,
    simulatedBand: { low: low.value, typical: typical.value, high: high.value },
  };
}

/** One deterministic scenario per local calendar day. */
export function getDailySpec(date: Date): DailySpec {
  return getDailySpecForKey(dateKey(date));
}
