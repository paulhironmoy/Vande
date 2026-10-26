// @vitest-environment node
/**
 * Player-facing engine copy (src/i18n/engine/<locale>.json): English has copy for everything the app and engine show,
 * every engine key has text in every locale, placeholders match English and only use params the engine always sends
 * with that key, and every commentary line from real replays renders without a raw placeholder in every language.
 */
import { describe, expect, it } from 'vitest';
import type { Contact, ExecutionGrade, LocaleId, MatchEventLog, TimingGrade, WicketKind } from '@/contracts';
import { COMMENTARY_KEYS, engine, EXPLAIN_KEYS } from '@/engine';
import { pitchHints, unlockHint } from '@/engine/advice';
import { hexSeed, playMatch, type SimPlayer } from '@/engine/sim/harness';
import { rngFromKey } from '@/engine/prng';
import { FIELD_SETTINGS, INTENTS, LENGTHS, LINES, PITCHES, SECTOR_ZONES, SHOTS, VARIANTS, WEATHERS } from '@/engine/v1/tables';
import { formatMessage, parseMessage } from '@/i18n/format';
import { LOCALES, localeInfo } from '@/i18n/locales';
import golden from './fixtures/golden-v1.json';
import adviceSource from '../../../src/engine/advice.ts?raw';
import plannerSource from '../../../src/screens/planner/BowlingPlannerScreen.tsx?raw';
import settingsSource from '../../../src/screens/settings/SettingsRoute.tsx?raw';

const files = import.meta.glob('../../../src/i18n/engine/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
const CATALOGS = Object.fromEntries(Object.entries(files).map(([path, cat]) => [path.replace(/^.*\/|\.json$/g, ''), cat])) as Record<LocaleId, Record<string, string>>;
const en = CATALOGS.en;
const LOCALE_IDS = LOCALES.map((l) => l.id);

type Node = ReturnType<typeof parseMessage>[number];
function args(nodes: Node[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.k === 'arg') out.add(n.name);
    if (n.k === 'plural' || n.k === 'select') {
      out.add(n.name);
      for (const opt of Object.values(n.options)) args(opt, out);
    }
  }
  return out;
}
const argsOf = (pattern: string) => [...args(parseMessage(pattern))].sort();

const TIMINGS: TimingGrade[] = ['perfect', 'good', 'early', 'late', 'very_early', 'very_late', 'no_shot', 'interrupted'];
const CONTACTS: Contact[] = ['middle', 'thick_edge', 'thin_edge', 'pad', 'miss', 'none'];
const EXECUTIONS: ExecutionGrade[] = ['perfect', 'good', 'loose'];
const WICKETS: WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'run_out'];
const FAMILIES = ['pace', 'swing', 'spin'];
const keysOf = (prefix: string, ids: readonly (string | number)[]) => ids.map((id) => `${prefix}.${id}`);
/** Every name the screens show: each id of every table. */
const NAMES = [
  ...keysOf('variant', VARIANTS),
  ...keysOf('family', FAMILIES),
  ...keysOf('line', LINES),
  ...keysOf('length', LENGTHS),
  ...['pace', 'spin'].flatMap((f) => keysOf(`intensity.${f}`, [1, 2, 3])),
  ...keysOf('intent', INTENTS),
  ...keysOf('field', FIELD_SETTINGS),
  ...keysOf('shot', SHOTS),
  ...keysOf('zone', SECTOR_ZONES),
  ...keysOf('pitch', PITCHES),
  ...keysOf('weather', WEATHERS),
  ...keysOf('timing', TIMINGS),
  ...keysOf('contact', CONTACTS),
  ...keysOf('execution', EXECUTIONS),
  ...keysOf('wicket', WICKETS),
];
/** The one-line hints the screens show: delivery cards (planner, Training), the shot picker, pitches, intents and fields. */
const HINTS = [...keysOf('variant_hint', VARIANTS), ...keysOf('shot_hint', SHOTS), ...keysOf('pitch_hint', PITCHES), ...keysOf('intent_hint', INTENTS), ...keysOf('field_hint', FIELD_SETTINGS)];
/** The Auto label the reveal and its scorecard put on balls a stand-in played. */
const AUTO_LABELS = ['auto.tag', 'auto.batted', 'auto.bowled'];
/** Keys a source file names as plain string literals ('guide.title', 'advice.read.attack', ...). */
const quoted = (source: string, prefix: string) => [...new Set([...source.matchAll(/'([a-z_]+(?:\.[a-z0-9_]+)+)'/g)].map((m) => m[1]).filter((k) => k.startsWith(prefix)))];
/** The tactics guide exactly as the Settings sheet shows it: its title, its intro and every key of SettingsRoute's GUIDE table. */
const GUIDE_TOPICS = quoted(settingsSource, 'guide.');
/**
 * Planner advice: the engine's unlock hints, pitch and weather tips and over reads (src/engine/advice.ts; the field read
 * is built per field setting), and the summary the planner builds around them (per family and field).
 */
const ADVICE = [
  ...VARIANTS.flatMap((v) => unlockHint(v)?.key ?? []),
  ...PITCHES.flatMap((pitch) => WEATHERS.flatMap((weather) => pitchHints({ pitch, weather }).map((h) => h.key))),
  ...quoted(adviceSource, 'advice.'),
  ...keysOf('advice.read', FIELD_SETTINGS.map((f) => `field_${f}`)),
  ...quoted(plannerSource, 'advice.'),
  ...keysOf('advice.summary', [...FAMILIES, ...FIELD_SETTINGS.map((f) => `field_${f}`)]),
];

/** Params the engine always sends with each commentary key (ball lines: plus zone, fielder, distance only where listed). */
const BALL = ['runs', 'shot', 'variant', 'speed', 'batter', 'bowler'];
const PARAMS: Record<string, string[]> = {
  'commentary.innings_start': ['batter', 'field', 'pitch', 'weather'],
  'commentary.chase_target': ['batter', 'field', 'target', 'balls'],
  'commentary.chase_needs': ['runs', 'balls'],
  'commentary.chase_won': ['batter', 'ballsLeft'],
  'commentary.chase_short': ['by'],
  'commentary.scores_level': ['runs'],
  'commentary.dot_block': BALL,
  'commentary.dot_beaten': BALL,
  'commentary.dot_fielded': BALL,
  'commentary.leave': BALL,
  'commentary.unanswered': BALL,
  'commentary.runs': BALL,
  'commentary.four': [...BALL, 'zone'],
  'commentary.four_edge': BALL,
  'commentary.six': [...BALL, 'zone', 'distance'],
  'commentary.loose_punished': [...BALL, 'zone'],
  'commentary.wicket_bowled': [...BALL, 'wicket'],
  'commentary.wicket_lbw': [...BALL, 'wicket'],
  'commentary.wicket_stumped': [...BALL, 'wicket'],
  'commentary.wicket_run_out': [...BALL, 'wicket'],
  'commentary.wicket_caught': [...BALL, 'wicket', 'fielder'],
  'commentary.wicket_caught_behind': [...BALL, 'wicket'],
  'commentary.wicket_caught_deep': [...BALL, 'wicket', 'fielder'],
  'commentary.wicket_setup': [...BALL, 'wicket'],
  'commentary.super_ball_intro': ['runs'],
  'commentary.super_ball_result': ['p0', 'p1'],
  'commentary.result_runs': ['winner', 'margin'],
  'commentary.result_super_ball': ['winner', 'margin'],
  'commentary.result_wickets_lost': ['winner', 'margin'],
  'commentary.result_boundaries': ['winner', 'margin'],
  'commentary.result_tie': ['margin'],
  'commentary.turning_point': ['event'],
  'commentary.player_of_match': ['player'],
  'commentary.daily_score': ['score', 'runs', 'wickets'],
};

/** Real replays: the golden fixture (duel, Super Ball tie, all-out with dead balls, unanswered balls), simulated matches and a daily attempt. */
function replays(): MatchEventLog[] {
  const logs = (golden as unknown as { logs: MatchEventLog[] }).logs.slice();
  const rng = rngFromKey('i18n-engine-replays');
  const bats = ['random', 'heuristic', 'oracle', 'fixed:defend', 'fixed:loft', 'fixed:sweep', 'auto'] as const;
  const player = (): SimPlayer => ({ bat: { strategy: rng.pick(bats), skill: rng.pick(['unskilled', 'average', 'skilled'] as const) }, bowl: { strategy: rng.pick(['random', 'starter_mix'] as const), skill: 'average' } });
  for (let i = 0; i < 160; i++) logs.push(playMatch([player(), player()], { pitch: rng.pick(PITCHES), weather: rng.pick(WEATHERS) }, hexSeed(rng), { buildLog: true }).log!);
  const { conditions, overs } = engine.dailyChallenge('2026-10-25', 'i18n-salt');
  let state = engine.startInnings(0);
  const inputs = [];
  while (!state.done) {
    const d = engine.revealDelivery(overs[0], state.mainDone ? 6 : state.nextBall, conditions);
    const input = engine.autoBat(`daily-${d.ball}`, d, overs[0].field);
    inputs.push(input);
    state = engine.resolveNextBall(state, { seed: 'daily-seed', conditions, plan: overs[0], input }).state;
  }
  const people = logs[0].players;
  logs.push(engine.buildDailyLog({ attemptId: 'a', day: '2026-10-25', attempt: 1, seed: 'daily-seed', serverSalt: 'i18n-salt', player: people[0], setter: { ...people[1], kind: 'daily' }, inputs, innings: state, meta: { createdHour: 'h', revealedHour: 'h' } }));
  return logs;
}

/** The same id → name resolution the reveal screen does (src/screens/reveal/text.ts), using this catalog's names. */
function resolve(params: Record<string, string | number>, log: MatchEventLog, cat: Record<string, string>): Record<string, string | number> {
  const name = (key: string) => cat[key] ?? en[key];
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if ((k === 'batter' || k === 'bowler' || k === 'winner' || k === 'player') && (v === 0 || v === 1)) out[k] = log.players[v].alias;
    else if (k === 'shot') out[k] = name(`shot.${v}`);
    else if (k === 'variant') out[k] = name(`variant.${v}`);
    else if (k === 'zone' || k === 'fielder') out[k] = name(`zone.${v}`);
    else if (k === 'wicket') out[k] = name(`wicket.${v}`);
    else if (k === 'field') out[k] = name(`field.${v}`);
    else if (k === 'pitch') out[k] = name(`pitch.${v}`);
    else if (k === 'weather') out[k] = name(`weather.${v}`);
    else if (k === 'speed' || k === 'distance') out[k] = Math.round(Number(v));
    else out[k] = v;
  }
  return out;
}

describe('engine copy catalogs', () => {
  it('exist for every app locale', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALE_IDS].sort());
  });

  it('English covers everything the app and engine show: names, shown hints, ghosts, Auto labels, advice, explanations, commentary and the Settings guide', () => {
    // The keys read from source must still be found there (a moved table or summary would otherwise empty the check).
    expect(settingsSource, 'SettingsRoute keeps its GUIDE table').toMatch(/const GUIDE\b/);
    expect(GUIDE_TOPICS.length).toBeGreaterThan(2);
    expect(quoted(adviceSource, 'advice.read.').length).toBeGreaterThan(0);
    expect(quoted(plannerSource, 'advice.summary.').length).toBeGreaterThan(0);
    const required = [...EXPLAIN_KEYS, ...COMMENTARY_KEYS, ...engine.GHOSTS.flatMap((g) => [g.nameKey, g.styleKey]), ...NAMES, ...HINTS, ...AUTO_LABELS, ...ADVICE, ...GUIDE_TOPICS];
    expect(required.filter((k) => !en[k])).toEqual([]);
    for (const [k, v] of Object.entries(en)) {
      expect(typeof v, k).toBe('string');
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it.each(LOCALE_IDS)('%s has exactly the English keys, every one non-empty', (locale) => {
    const cat = CATALOGS[locale];
    expect(Object.keys(en).filter((k) => !(k in cat))).toEqual([]);
    expect(Object.keys(cat).filter((k) => !(k in en))).toEqual([]);
    for (const [k, v] of Object.entries(cat)) expect(typeof v === 'string' && v.trim().length > 0, `${locale} ${k}`).toBe(true);
  });

  it.each(LOCALE_IDS)('%s parses as ICU-lite with the same placeholders as English', (locale) => {
    const cat = CATALOGS[locale];
    const mismatches: string[] = [];
    for (const [k, v] of Object.entries(cat)) {
      expect(() => parseMessage(v), `${locale} ${k}`).not.toThrow();
      if (en[k] !== undefined && argsOf(v).join() !== argsOf(en[k]).join()) mismatches.push(`${k}: ${argsOf(v).join()} vs ${argsOf(en[k]).join()}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('explanations take no params; commentary uses only params the engine always sends', () => {
    for (const k of EXPLAIN_KEYS) expect(argsOf(en[k]), k).toEqual([]);
    expect(COMMENTARY_KEYS.filter((k) => !PARAMS[k])).toEqual([]);
    for (const k of COMMENTARY_KEYS) for (const a of argsOf(en[k])) expect(PARAMS[k], `${k} uses {${a}}`).toContain(a);
  });

  const logs = replays();

  it('the engine really sends those params with every commentary event, and every explanation key is known', () => {
    const seen = new Set<string>();
    for (const log of logs)
      for (const e of log.events) {
        if (e.t === 'ball') expect(EXPLAIN_KEYS).toContain(e.outcome.factors.explainKey);
        if (e.t !== 'commentary') continue;
        seen.add(e.key);
        for (const p of PARAMS[e.key] ?? ['(unknown key)']) expect(e.params, `${e.key} lacks ${p}`).toHaveProperty(p);
      }
    expect(seen.size).toBeGreaterThan(25);
  });

  it.each(LOCALE_IDS)('%s renders every commentary line of real replays without a raw placeholder', (locale) => {
    const cat = CATALOGS[locale];
    const intl = localeInfo(locale).intl;
    const bad: string[] = [];
    for (const log of logs)
      for (const e of log.events) {
        if (e.t !== 'commentary') continue;
        const text = formatMessage(cat[e.key], resolve(e.params as Record<string, string | number>, log, cat), intl);
        if (!text.trim() || /[{}]/.test(text)) bad.push(`${e.key}: ${text}`);
      }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('renders numbers and plurals per locale', () => {
    const p = { runs: 1, balls: 1 };
    expect(formatMessage(en['commentary.chase_needs'], p, 'en-IN')).toBe('The equation: 1 run from 1 ball.');
    expect(formatMessage(en['commentary.chase_needs'], { runs: 7, balls: 3 }, 'en-IN')).toBe('The equation: 7 runs from 3 balls.');
    expect(formatMessage(en['commentary.chase_won'], { batter: 'Asha', ballsLeft: 0 }, 'en-IN')).toBe('Asha gets there off the very last ball!');
    expect(formatMessage(en['commentary.loose_punished'], { bowler: 'Ravi', zone: 'Cover', runs: 4 }, 'en-IN')).toContain('FOUR');
  });
});
