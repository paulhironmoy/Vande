/**
 * Daily content validation and the headless balance harness.
 * Structural rules live here; the compiled scenario is additionally run through `validateScenario`.
 */
import type { ActionTag, ChapterResult, DailyCrisis, DailySchedule, GameConfig, GameState, OpponentId, Scenario, ScenarioDecision } from './types';
import { OPPONENT_IDS } from './types';
import { validateScenario } from './validate';
import { COMPLICATION_FLAG, DAILY_DEFAULT_DURATION, compileDaily } from './dailyCompiler';
import { createGame, reduce, tick } from './simulation';
import { evidenceActions } from './evidence';
import { computeChapterResult } from './scoring';

export interface DailyValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export const LIMITS = {
  full: { decisionTitle: 48, situation: 160, optionTitle: 48, preview: 80, consequence: 110, claim: 140, coldOpen: 60 },
  simple: { decisionTitle: 40, situation: 200, optionTitle: 40, preview: 90, consequence: 100, claim: 110, question: 140, wordsPerSentence: 12, coldOpenWords: 7 },
  timing: { firstDecision: 6, expiresMin: 15, expiresMax: 30, playMargin: 15, evidenceMargin: 20 },
  counts: { decisionsMin: 4, decisionsMax: 6, evidenceMin: 4, evidenceMax: 6 },
} as const;

const SUPPRESSIVE: ActionTag[] = ['suppressive', 'disproportionate', 'censorship', 'detention'];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function longestSentenceWords(text: string): number {
  return Math.max(0, ...sentences(text).map((s) => s.split(/\s+/).filter(Boolean).length));
}

/** Structural, reading-level, timing and tradeoff checks for one authored day, then compilation + scenario validation. */
export function validateDailyCrisis(input: unknown): DailyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (p: string, m: string) => errors.push(`${p}: ${m}`);
  const warn = (p: string, m: string) => warnings.push(`${p}: ${m}`);
  if (!isObj(input)) return { ok: false, errors: ['day: not an object'], warnings };
  const day = input as unknown as DailyCrisis;
  const tag = `day ${String((input as Obj).id ?? '?')}`;

  for (const k of ['id', 'title', 'subtitle', 'dilemmaKey', 'focus', 'institution', 'mood'] as const) {
    if (!isStr((input as Obj)[k])) err(`${tag}.${k}`, 'missing');
  }
  if (typeof day.version !== 'number' || day.version < 1) err(`${tag}.version`, 'must be a positive integer');
  if (!/^d\d{3}$/.test(String(day.id))) err(`${tag}.id`, "must look like 'd001'");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(day.dilemmaKey))) err(`${tag}.dilemmaKey`, 'must be kebab-case');
  if (!Array.isArray(day.themeTags) || day.themeTags.length === 0) err(`${tag}.themeTags`, 'needs at least one tag');
  if (!Array.isArray(day.opponents) || day.opponents.length < 1 || day.opponents.length > 3) err(`${tag}.opponents`, 'needs 1–3 opponents');
  else for (const o of day.opponents) if (!(OPPONENT_IDS as readonly string[]).includes(o)) err(`${tag}.opponents`, `unknown opponent '${o}'`);
  const duration = day.duration ?? DAILY_DEFAULT_DURATION;
  if (duration < 80 || duration > 140) err(`${tag}.duration`, 'daily duration must be 80–140 ticks');

  // Cold open
  if (!Array.isArray(day.coldOpen) || day.coldOpen.length !== 3) err(`${tag}.coldOpen`, 'needs exactly 3 lines');
  else day.coldOpen.forEach((l, i) => {
    if (!isStr(l)) err(`${tag}.coldOpen[${i}]`, 'empty');
    else if (l.length > LIMITS.full.coldOpen) err(`${tag}.coldOpen[${i}]`, `longer than ${LIMITS.full.coldOpen} chars`);
  });

  // Briefing
  if (!isObj(day.briefing)) err(`${tag}.briefing`, 'missing');
  else {
    for (const k of ['grievance', 'responsibility', 'objective'] as const) if (!isStr(day.briefing[k])) err(`${tag}.briefing.${k}`, 'missing');
    if (!Array.isArray(day.briefing.knownFacts) || day.briefing.knownFacts.length < 2) err(`${tag}.briefing.knownFacts`, 'needs 2+ facts');
    if (!Array.isArray(day.briefing.unverifiedClaims) || day.briefing.unverifiedClaims.length < 1) err(`${tag}.briefing.unverifiedClaims`, 'needs 1+ claims');
  }

  // Evidence
  const evidence = Array.isArray(day.evidence) ? day.evidence : [];
  if (evidence.length < LIMITS.counts.evidenceMin || evidence.length > LIMITS.counts.evidenceMax) err(`${tag}.evidence`, `needs ${LIMITS.counts.evidenceMin}–${LIMITS.counts.evidenceMax} items`);
  const evidenceIds = new Set<string>();
  let perishable = 0;
  evidence.forEach((e, i) => {
    const p = `${tag}.evidence[${i}]`;
    if (evidenceIds.has(e.id)) err(p, `duplicate id '${e.id}'`);
    evidenceIds.add(e.id);
    if (isStr(e.claim) && e.claim.length > LIMITS.full.claim) err(p, `claim longer than ${LIMITS.full.claim} chars`);
    if (e.injectedBy && !day.opponents?.includes(e.injectedBy)) err(p, `injected by '${e.injectedBy}', who is not one of this day's opponents`);
    if (e.availableAt !== undefined && e.availableAt > duration - LIMITS.timing.evidenceMargin) err(p, `availableAt must be ≤ ${duration - LIMITS.timing.evidenceMargin}`);
    if (e.perishable) perishable += 1;
    if (!isObj(e.simple)) err(`${p}.simple`, 'missing simple copy');
    else {
      if (!isStr(e.simple.claim)) err(`${p}.simple.claim`, 'missing');
      else {
        if (e.simple.claim.length > LIMITS.simple.claim) err(`${p}.simple.claim`, `longer than ${LIMITS.simple.claim} chars`);
        if (longestSentenceWords(e.simple.claim) > LIMITS.simple.wordsPerSentence + 2) err(`${p}.simple.claim`, 'a sentence is too long for the Simple style');
      }
    }
  });
  if (perishable === 0) warn(`${tag}.evidence`, 'no perishable item: the Sabotage Network has nothing to destroy');

  // Decisions
  const decisions = Array.isArray(day.decisions) ? day.decisions : [];
  if (decisions.length < LIMITS.counts.decisionsMin || decisions.length > LIMITS.counts.decisionsMax) err(`${tag}.decisions`, `needs ${LIMITS.counts.decisionsMin}–${LIMITS.counts.decisionsMax} decisions`);
  const decisionIds = new Set<string>();
  const timed = decisions.filter((d) => typeof d.triggerAt === 'number').sort((a, b) => (a.triggerAt ?? 0) - (b.triggerAt ?? 0));
  if (timed.length === 0) err(`${tag}.decisions`, 'no decision has a triggerAt');
  else if ((timed[0].triggerAt ?? 99) > LIMITS.timing.firstDecision) err(`${tag}.decisions`, `first decision must appear by tick ${LIMITS.timing.firstDecision}`);
  let suppressiveWithCosts = 0;
  let evidenceDependent = 0;
  decisions.forEach((d, i) => {
    const p = `${tag}.decisions[${i}]`;
    if (decisionIds.has(d.id)) err(p, `duplicate id '${d.id}'`);
    decisionIds.add(d.id);
    checkDecisionCopy(d, p, err);
    if (typeof d.triggerAt === 'number' && d.triggerAt > duration - LIMITS.timing.playMargin) err(p, `triggerAt too late (max ${duration - LIMITS.timing.playMargin})`);
    if (d.expiresAfter < LIMITS.timing.expiresMin || d.expiresAfter > LIMITS.timing.expiresMax) err(p, `expiresAfter must be ${LIMITS.timing.expiresMin}–${LIMITS.timing.expiresMax}`);
    const def = d.options?.find((o) => o.id === d.defaultOption);
    if (!def) err(p, `defaultOption '${d.defaultOption}' not found`);
    else {
      if (!def.tags.includes('wait')) err(`${p}.defaultOption`, 'the default must be a wait option');
      const costs = (def.effects.safety ?? 0) + (def.effects.economy ?? 0) + (def.effects.grievance ?? 0);
      if (costs >= 0) err(`${p}.defaultOption`, 'waiting must cost safety, economy or grievance');
    }
    for (const o of d.options ?? []) {
      const q = `${p}.options.${o.id}`;
      const effectKeys = Object.entries(o.effects ?? {}).filter(([, v]) => typeof v === 'number' && v !== 0);
      if (effectKeys.length === 0) err(q, 'option has no consequences (effects empty)');
      if (o.tags.some((t) => SUPPRESSIVE.includes(t))) {
        const f = (o.effects.freedom ?? 0) + (o.disproportionateEffects?.freedom ?? 0);
        const t = (o.effects.trust ?? 0) + (o.disproportionateEffects?.trust ?? 0);
        if (f < 0 && t < 0) suppressiveWithCosts += 1;
        else if (!o.proportionateIf) err(q, 'suppressive options must cost freedom and trust');
      }
      if (o.requiresEvidence?.length) evidenceDependent += 1;
      if (o.tags.includes('accusation') && !o.falseAccusationEffects) err(q, 'accusation options need falseAccusationEffects');
      for (const id of o.requiresEvidence ?? []) if (!evidenceIds.has(id)) err(q, `requiresEvidence '${id}' not found`);
      for (const spec of o.delayed ?? []) {
        const start = (d.triggerAt ?? 40) + d.expiresAfter;
        if (start + spec.afterTicks > duration + 10) warn(q, `delayed effect may fall after the chapter ends (${start + spec.afterTicks} > ${duration})`);
      }
    }
    if (d.rightsMomentId && !day.rightsMoments?.some((r) => r.id === d.rightsMomentId)) err(p, `rightsMomentId '${d.rightsMomentId}' not found`);
  });
  if (suppressiveWithCosts === 0) err(`${tag}.decisions`, 'no suppressive option with freedom and trust costs');
  if (evidenceDependent === 0) err(`${tag}.decisions`, 'no evidence-dependent option (requiresEvidence)');
  // Structural repetition inside a day: identical option title sets across decisions.
  const titleSets = decisions.map((d) => (d.options ?? []).map((o) => o.title).sort().join('|'));
  if (new Set(titleSets).size !== titleSets.length) err(`${tag}.decisions`, 'two decisions offer identical option sets');

  // Rights
  const rights = Array.isArray(day.rightsMoments) ? day.rightsMoments : [];
  if (rights.length < 1) err(`${tag}.rightsMoments`, 'needs at least one rights moment');
  rights.forEach((r, i) => {
    const p = `${tag}.rightsMoments[${i}]`;
    if (!isObj(r.simple)) err(`${p}.simple`, 'missing simple copy');
    else if (isStr(r.simple.question) && r.simple.question.length > LIMITS.simple.question) err(`${p}.simple.question`, `longer than ${LIMITS.simple.question} chars`);
    if (!decisions.some((d) => d.rightsMomentId === r.id)) warn(p, `rights moment '${r.id}' is not attached to any decision`);
  });

  // Complication
  const c = day.complication;
  if (!isObj(c)) err(`${tag}.complication`, 'missing');
  else {
    if (!day.opponents?.includes(c.opponent)) err(`${tag}.complication.opponent`, 'must be one of the day opponents');
    if (!(day.events ?? []).some((e) => e.id === c.eventId)) err(`${tag}.complication.eventId`, `event '${c.eventId}' not found in day.events`);
    if (c.earliest < 10 || c.latest > duration - LIMITS.timing.playMargin || c.earliest > c.latest) err(`${tag}.complication`, `window must be inside 10–${duration - LIMITS.timing.playMargin}`);
    if (c.baitDecisionId) {
      const bait = decisions.find((d) => d.id === c.baitDecisionId);
      if (!bait) err(`${tag}.complication.baitDecisionId`, `decision '${c.baitDecisionId}' not found`);
      else if (bait.triggerAt !== undefined) err(`${tag}.complication.baitDecisionId`, 'the bait decision must not have a triggerAt (it opens on the complication)');
    }
  }

  // Events (authored) need simple copy
  (day.events ?? []).forEach((e, i) => {
    if (!isStr(e.simple)) err(`${tag}.events[${i}].simple`, 'missing simple copy');
  });

  // Resolution rules need simple copy
  if (isObj(day.resolution)) {
    for (const key of ['resolved', 'unresolved', 'rightsProtected', 'rightsHarmed', 'improvements'] as const) {
      const rules = (day.resolution as Obj)[key];
      if (!Array.isArray(rules) || rules.length === 0) err(`${tag}.resolution.${key}`, 'needs at least one rule');
      else rules.forEach((r: unknown, i: number) => {
        if (!isObj(r) || !isStr(r.simple)) err(`${tag}.resolution.${key}[${i}].simple`, 'missing simple copy');
      });
    }
  } else err(`${tag}.resolution`, 'missing');

  // Scenario-level simple layer
  if (!isObj(day.simple)) err(`${tag}.simple`, 'missing (title, subtitle, briefing, closing, coldOpen)');
  else {
    for (const k of ['title', 'subtitle'] as const) if (!isStr(day.simple[k])) err(`${tag}.simple.${k}`, 'missing');
    if (!isObj(day.simple.briefing)) err(`${tag}.simple.briefing`, 'missing');
    if (!isObj(day.simple.closing)) err(`${tag}.simple.closing`, 'missing');
    const co = day.simple.coldOpen;
    if (!Array.isArray(co) || co.length !== 3) err(`${tag}.simple.coldOpen`, 'needs exactly 3 lines');
    else co.forEach((l, i) => {
      if (l.split(/\s+/).filter(Boolean).length > LIMITS.simple.coldOpenWords) err(`${tag}.simple.coldOpen[${i}]`, `more than ${LIMITS.simple.coldOpenWords} words`);
    });
  }

  // Compile and run the scenario validator when the structure is sound.
  if (errors.length === 0) {
    let scenario: Scenario | undefined;
    try {
      scenario = compileDaily(day);
    } catch (e) {
      err(`${tag}.compile`, e instanceof Error ? e.message : String(e));
    }
    if (scenario) {
      const v = validateScenario(scenario);
      for (const e of v.errors) err(`${tag}.compiled`, e);
      const twice = compileDaily(day);
      if (JSON.stringify(twice) !== JSON.stringify(scenario)) err(`${tag}.compile`, 'compilation is not deterministic');
      const bait = scenario.decisions.find((d) => d.id === day.complication?.baitDecisionId);
      if (bait && bait.triggerFlag !== COMPLICATION_FLAG && bait.triggerAt === undefined) err(`${tag}.compiled`, 'bait decision did not receive the complication trigger');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function checkDecisionCopy(d: ScenarioDecision, p: string, err: (p: string, m: string) => void): void {
  if (isStr(d.title) && d.title.length > LIMITS.full.decisionTitle) err(`${p}.title`, `longer than ${LIMITS.full.decisionTitle} chars`);
  if (isStr(d.situation) && d.situation.length > LIMITS.full.situation) err(`${p}.situation`, `longer than ${LIMITS.full.situation} chars`);
  for (const o of d.options ?? []) {
    const q = `${p}.options.${o.id}`;
    if (o.title.length > LIMITS.full.optionTitle) err(`${q}.title`, `longer than ${LIMITS.full.optionTitle} chars`);
    if (o.preview.length > LIMITS.full.preview) err(`${q}.preview`, `longer than ${LIMITS.full.preview} chars`);
    if (o.consequence.length > LIMITS.full.consequence) err(`${q}.consequence`, `longer than ${LIMITS.full.consequence} chars`);
  }
  const s = d.simple;
  if (!isObj(s)) return err(`${p}.simple`, 'missing simple copy');
  if (s.title.length > LIMITS.simple.decisionTitle) err(`${p}.simple.title`, `longer than ${LIMITS.simple.decisionTitle} chars`);
  if (s.situation.length > LIMITS.simple.situation) err(`${p}.simple.situation`, `longer than ${LIMITS.simple.situation} chars`);
  if (longestSentenceWords(s.situation) > LIMITS.simple.wordsPerSentence + 2) err(`${p}.simple.situation`, 'a sentence is too long for the Simple style');
  for (const o of d.options ?? []) {
    const so = s.options?.[o.id];
    if (!so) {
      err(`${p}.simple.options.${o.id}`, 'missing simple copy');
      continue;
    }
    if (so.title.length > LIMITS.simple.optionTitle) err(`${p}.simple.options.${o.id}.title`, `longer than ${LIMITS.simple.optionTitle} chars`);
    if (so.preview.length > LIMITS.simple.preview) err(`${p}.simple.options.${o.id}.preview`, `longer than ${LIMITS.simple.preview} chars`);
    if (so.consequence && so.consequence.length > LIMITS.simple.consequence) err(`${p}.simple.options.${o.id}.consequence`, `longer than ${LIMITS.simple.consequence} chars`);
  }
}

/** Schedule rules: enough days, every id present, no dilemma repeats inside any `window` consecutive entries (cyclic), pins resolvable. */
export function validateDailySchedule(schedule: DailySchedule, days: Record<string, DailyCrisis>, opts: { window?: number; minDays?: number } = {}): DailyValidation {
  const window = opts.window ?? 30;
  const minDays = opts.minDays ?? 30;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isStr(schedule.contentVersion)) errors.push('schedule.contentVersion: missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.epoch)) errors.push('schedule.epoch: must be YYYY-MM-DD');
  const order = schedule.order ?? [];
  if (order.length < minDays) errors.push(`schedule.order: needs at least ${minDays} days (has ${order.length})`);
  const seen = new Set<string>();
  order.forEach((id, i) => {
    if (seen.has(id)) errors.push(`schedule.order[${i}]: duplicate day '${id}'`);
    seen.add(id);
    if (!days[id]) errors.push(`schedule.order[${i}]: unknown day '${id}'`);
  });
  for (const [date, id] of Object.entries(schedule.pinned ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`schedule.pinned.${date}: not a daily id`);
    if (!days[id]) errors.push(`schedule.pinned.${date}: unknown day '${id}'`);
  }
  const n = order.length;
  if (n > 0) {
    const keys = order.map((id) => days[id]?.dilemmaKey ?? `?${id}`);
    const w = Math.min(window, n);
    for (let start = 0; start < n; start++) {
      const slice = new Map<string, string>();
      for (let k = 0; k < w; k++) {
        const idx = (start + k) % n;
        const key = keys[idx];
        const prev = slice.get(key);
        if (prev && prev !== order[idx]) {
          errors.push(`schedule.order: dilemma '${key}' repeats within ${w} days (${prev} and ${order[idx]})`);
          start = n; // one report is enough
          break;
        }
        slice.set(key, order[idx]);
      }
    }
    // Structural repetition across days: identical sorted decision titles.
    const shapes = new Map<string, string>();
    for (const id of order) {
      const day = days[id];
      if (!day) continue;
      const shape = day.decisions.map((d) => d.title).sort().join('|');
      const prev = shapes.get(shape);
      if (prev) errors.push(`schedule.order: days ${prev} and ${id} have the same decision titles`);
      shapes.set(shape, id);
    }
  }
  if (Object.keys(schedule.pinned ?? {}).length === 0) warnings.push('schedule.pinned: empty (pin dates once they have been published)');
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Headless harness
// ---------------------------------------------------------------------------

export type HeadlessStrategy = 'principled' | 'suppressive' | 'idle' | 'reckless';

const GOOD: ActionTag[] = ['dialogue', 'transparent', 'investigative', 'protect-assembly', 'protect-press', 'proportionate', 'service', 'relief', 'legal-process', 'communication'];
const BAD: ActionTag[] = ['disproportionate', 'suppressive', 'censorship', 'detention', 'force'];

function scoreTags(tags: ActionTag[], good: ActionTag[], bad: ActionTag[]): number {
  let s = 0;
  for (const t of tags) {
    if (good.includes(t)) s += 2;
    if (bad.includes(t)) s -= 3;
    if (t === 'wait') s -= 1;
  }
  return s;
}

/** Plays a scenario to the end with a scripted strategy. Deterministic for a given config. */
export function playHeadless(scenario: Scenario, config: GameConfig, strategy: HeadlessStrategy): { state: GameState; result: ChapterResult } {
  let s: GameState = createGame(config, scenario);
  s = reduce(s, { type: 'start', tick: 0 }, scenario);
  while (s.status === 'running') {
    if (strategy !== 'idle') {
      if (strategy === 'principled' || strategy === 'suppressive') {
        for (const es of Object.values(s.evidence)) {
          if (!es.visible || es.destroyed) continue;
          const acts = evidenceActions(s, scenario, es.id).filter((a) => a.enabled);
          for (const a of acts) {
            if (a.verb === 'preserve' && !es.preserved) s = reduce(s, { type: 'evidence', tick: s.tick, evidenceId: es.id, verb: 'preserve' }, scenario);
            if (strategy === 'principled' && a.verb === 'inspect' && !es.inspected) s = reduce(s, { type: 'evidence', tick: s.tick, evidenceId: es.id, verb: 'inspect' }, scenario);
            if (strategy === 'principled' && a.verb === 'compare' && !s.evidence[es.id].compared) {
              s = reduce(s, { type: 'evidence', tick: s.tick, evidenceId: es.id, verb: 'compare', compareWith: a.compareWith }, scenario);
            }
          }
        }
      }
      for (const id of [...s.pendingDecisionIds]) {
        const d = scenario.decisions.find((x) => x.id === id);
        if (!d) continue;
        let best = d.options[0];
        let bestScore = -Infinity;
        const weakest = (Object.keys(s.scores) as (keyof typeof s.scores)[]).reduce((w, k) => (s.scores[k] < s.scores[w] ? k : w));
        for (const o of d.options) {
          let sc: number;
          if (strategy === 'principled') {
            sc = scoreTags(o.tags, GOOD, BAD);
            // A sensible player breaks ties toward the measure that is currently weakest.
            if ((o.effects[weakest] ?? 0) > 0) sc += 0.5;
            const relied = o.requiresEvidence ?? [];
            if (o.tags.includes('accusation') && !relied.every((e) => ['verified', 'corroborated'].includes(s.evidence[e]?.state ?? ''))) sc -= 10;
            if (o.tags.includes('accusation') && relied.some((e) => s.evidence[e]?.state === 'manipulated')) sc -= 20;
          } else if (strategy === 'suppressive') {
            sc = scoreTags(o.tags, BAD, GOOD);
          } else {
            sc = o.tags.includes('accusation') || o.tags.includes('force') || o.tags.includes('detention') ? 5 : 0;
          }
          if (sc > bestScore) {
            bestScore = sc;
            best = o;
          }
        }
        s = reduce(s, { type: 'decide', tick: s.tick, decisionId: id, optionId: best.id }, scenario);
      }
      for (const rid of [...s.pendingRightsIds]) {
        const m = scenario.rightsMoments.find((x) => x.id === rid);
        if (!m) continue;
        const opt = strategy === 'principled' ? m.options.find((o) => o.correct) : m.options.find((o) => !o.correct);
        if (opt) s = reduce(s, { type: 'rights', tick: s.tick, momentId: rid, optionId: opt.id }, scenario);
      }
    }
    s = tick(s, scenario, 1);
  }
  return { state: s, result: computeChapterResult(s, scenario, '2026-10-24T00:00:00.000Z') };
}

export interface DailyBalanceReport {
  dayId: string;
  principled: number;
  suppressive: number;
  idle: number;
  reckless: number;
  ok: boolean;
  problems: string[];
}

/** Outcome-band sanity: a principled player must clearly beat suppression and inaction on every day. */
export function dailyBalance(day: DailyCrisis, opts: { seed?: number; opponents?: OpponentId[] } = {}): DailyBalanceReport {
  const scenario = compileDaily(day);
  const config: GameConfig = {
    scenarioId: scenario.id,
    seed: opts.seed ?? 20261026,
    difficulty: 'standard',
    opponents: opts.opponents ?? day.opponents,
    mode: 'daily',
  };
  const run = (st: HeadlessStrategy) => playHeadless(scenario, config, st).result.score;
  const principled = run('principled');
  const suppressive = run('suppressive');
  const idle = run('idle');
  const reckless = run('reckless');
  const problems: string[] = [];
  if (principled < 60) problems.push(`principled scores only ${principled} (< 60)`);
  if (principled - suppressive < 12) problems.push(`suppression (${suppressive}) is too close to principled (${principled})`);
  if (principled - idle < 12) problems.push(`inaction (${idle}) is too close to principled (${principled})`);
  return { dayId: day.id, principled, suppressive, idle, reckless, ok: problems.length === 0, problems };
}
