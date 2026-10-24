import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import scenarioSchema from '../../../src/content/schema/scenario.schema.json';
import dailySchema from '../../../src/content/daily/daily.schema.json';
import { DAYS, SCHEDULE } from '@/content/daily';
import { ACKNOWLEDGED_FLAG, CITY, COMPLICATION_FLAG, DAILY_DEFAULT_DURATION, ROADS, compileDaily, dailyScenarioId } from '@/engine/dailyCompiler';
import { LIMITS, validateDailyCrisis, validateDailySchedule } from '@/engine/dailyValidate';
import { validateScenario } from '@/engine/validate';
import { OPPONENT_IDS, type DailyCrisis, type DailySchedule } from '@/engine/types';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(scenarioSchema);
ajv.addSchema(dailySchema);
const dayValid = ajv.getSchema('https://vande.app/schema/daily.schema.json')!;
const scheduleValid = ajv.getSchema('https://vande.app/schema/daily.schema.json#/definitions/schedule')!;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const districtIds = new Set(CITY.map((d) => d.id));
const SUPPRESSIVE = ['suppressive', 'detention', 'censorship', 'disproportionate'];

describe.each(SCHEDULE.order.map((id) => [id, DAYS[id]] as const))('daily day %s', (id, day) => {
  it('matches the JSON schema', () => {
    const ok = dayValid(clone(day));
    expect(dayValid.errors ?? [], JSON.stringify(dayValid.errors, null, 1)).toEqual([]);
    expect(ok).toBe(true);
  });

  it('passes the content validator', () => {
    const v = validateDailyCrisis(day);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('compiles into a valid, deterministic scenario on the shared city', () => {
    const a = compileDaily(day);
    const b = compileDaily(day);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.id).toBe(dailyScenarioId(id));
    expect(a.id).toBe(`daily:${id}`);
    expect(validateScenario(a).errors).toEqual([]);
    expect(a.chapter).toBe(1);
    expect(a.districts.map((d) => d.id)).toEqual(CITY.map((d) => d.id));
    expect(a.roads.length).toBe(ROADS.length);
    expect(a.briefing.lines).toEqual(day.coldOpen);
  });

  it('keeps the quick-play shape', () => {
    const s = compileDaily(day);
    expect(s.duration).toBe(day.duration ?? DAILY_DEFAULT_DURATION);
    expect(s.duration).toBeGreaterThanOrEqual(80);
    expect(s.duration).toBeLessThanOrEqual(140);
    expect(day.decisions.length).toBeGreaterThanOrEqual(LIMITS.counts.decisionsMin);
    expect(day.decisions.length).toBeLessThanOrEqual(LIMITS.counts.decisionsMax);
    expect(day.evidence.length).toBeGreaterThanOrEqual(LIMITS.counts.evidenceMin);
    expect(day.evidence.length).toBeLessThanOrEqual(LIMITS.counts.evidenceMax);
    const timed = s.decisions.filter((d) => typeof d.triggerAt === 'number');
    expect(timed.length).toBeGreaterThanOrEqual(LIMITS.counts.decisionsMin - 1);
    expect(Math.min(...timed.map((d) => d.triggerAt as number))).toBeLessThanOrEqual(LIMITS.timing.firstDecision);
    for (const d of timed) {
      expect(d.expiresAfter, d.id).toBeGreaterThanOrEqual(LIMITS.timing.expiresMin);
      expect(d.expiresAfter, d.id).toBeLessThanOrEqual(LIMITS.timing.expiresMax);
      expect((d.triggerAt as number) + d.expiresAfter, d.id).toBeLessThanOrEqual(s.duration);
    }
    expect(day.rightsMoments.length).toBeGreaterThanOrEqual(1);
  });

  it('gives every opponent at least one play and wires the complication', () => {
    const s = compileDaily(day);
    for (const o of OPPONENT_IDS) expect(s.opponentPlays.some((p) => p.opponent === o), o).toBe(true);
    const comp = s.events.find((e) => e.id === day.complication.eventId)!;
    expect(comp).toBeDefined();
    expect(comp.at).toBe(-1);
    expect(comp.setsFlags).toContain(COMPLICATION_FLAG);
    const play = s.opponentPlays.find((p) => p.kind === 'event' && p.target === day.complication.eventId)!;
    expect(play).toBeDefined();
    expect(play.opponent).toBe(day.complication.opponent);
    expect(play.earliest).toBe(day.complication.earliest);
    expect(play.latest).toBe(day.complication.latest);
    if (day.complication.baitDecisionId) {
      const bait = s.decisions.find((d) => d.id === day.complication.baitDecisionId)!;
      expect(bait.triggerFlag).toBe(COMPLICATION_FLAG);
      expect(bait.triggerAt).toBeUndefined();
    }
    for (const ev of day.evidence) {
      if (ev.injectedBy) expect(s.opponentPlays.some((p) => p.kind === 'inject-evidence' && p.target === ev.id && p.opponent === ev.injectedBy), ev.id).toBe(true);
      if (ev.perishable) expect(s.opponentPlays.some((p) => p.kind === 'destroy-evidence' && p.target === ev.id), ev.id).toBe(true);
    }
  });

  it('generates the standard opening and settling events', () => {
    const s = compileDaily(day);
    const ids = s.events.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['g-open-gather', 'g-open-institution', 'g-pressure-builds', 'g-calm-returns', 'g-settling']));
    expect(s.events.find((e) => e.id === 'g-pressure-builds')?.condition).toEqual({ notFlag: ACKNOWLEDGED_FLAG });
    expect(s.events.find((e) => e.id === 'g-calm-returns')?.condition).toEqual({ flag: ACKNOWLEDGED_FLAG });
    for (const authored of day.events ?? []) expect(ids).toContain(authored.id);
  });

  it('carries the Simple layer to every reading surface', () => {
    const s = compileDaily(day);
    expect(s.simple?.title).toBeTruthy();
    expect(s.simple?.briefing?.lines).toEqual(day.simple?.coldOpen);
    expect(s.simple?.closing?.good).toBeTruthy();
    for (const d of s.decisions) {
      expect(d.simple?.title, d.id).toBeTruthy();
      expect(d.simple?.situation, d.id).toBeTruthy();
      for (const o of d.options) expect(d.simple?.options?.[o.id]?.title, o.id).toBeTruthy();
    }
    for (const e of s.evidence) expect(e.simple?.claim, e.id).toBeTruthy();
    for (const r of s.rightsMoments) expect(r.simple?.question, r.id).toBeTruthy();
    const rules = [...s.resolution.resolved, ...s.resolution.unresolved, ...s.resolution.rightsProtected, ...s.resolution.rightsHarmed, ...s.resolution.improvements];
    for (const rule of rules) expect(rule.simple, rule.text).toBeTruthy();
  });

  it('places every reference inside the shared city', () => {
    const s = compileDaily(day);
    for (const d of s.decisions) if (d.district) expect(districtIds.has(d.district), d.id).toBe(true);
    for (const e of s.evidence) if (e.district) expect(districtIds.has(e.district), e.id).toBe(true);
    expect(districtIds.has(day.focus)).toBe(true);
    expect(CITY.find((d) => d.id === day.institution)?.institution, 'institution district must host an institution').toBeTruthy();
  });

  it('offers a real trade-off: a costly wait, a suppressive shortcut and an evidence-gated option', () => {
    const options = day.decisions.flatMap((d) => d.options);
    expect(options.some((o) => o.tags.some((t) => SUPPRESSIVE.includes(t)))).toBe(true);
    expect(options.some((o) => (o.requiresEvidence ?? []).length > 0)).toBe(true);
    for (const d of day.decisions) {
      const def = d.options.find((o) => o.id === d.defaultOption)!;
      expect(def.tags, `${d.id} default`).toContain('wait');
    }
  });
});

describe('schedule', () => {
  it('matches the schema and the schedule validator', () => {
    expect(scheduleValid(clone(SCHEDULE)), JSON.stringify(scheduleValid.errors)).toBe(true);
    const v = validateDailySchedule(SCHEDULE, DAYS);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('rejects a dilemma repeated inside a 30-day window', () => {
    const dup = clone(DAYS[SCHEDULE.order[0]]);
    dup.id = 'd900';
    const days = { ...DAYS, d900: dup };
    const schedule: DailySchedule = { ...SCHEDULE, order: [...SCHEDULE.order.slice(0, 10), 'd900', ...SCHEDULE.order.slice(10)] };
    const v = validateDailySchedule(schedule, days);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toMatch(/dilemma/i);
  });

  it('rejects unknown and duplicate ids', () => {
    const v = validateDailySchedule({ ...SCHEDULE, order: [...SCHEDULE.order, 'd999', SCHEDULE.order[0]] }, DAYS);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a pool smaller than the freshness window', () => {
    const v = validateDailySchedule({ ...SCHEDULE, order: SCHEDULE.order.slice(0, 12) }, DAYS);
    expect(v.ok).toBe(false);
  });
});

describe('content validator guards', () => {
  const base = DAYS[SCHEDULE.order[0]];
  const expectError = (mutate: (d: DailyCrisis) => void, pattern: RegExp) => {
    const d = clone(base);
    mutate(d);
    const v = validateDailyCrisis(d);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toMatch(pattern);
  };

  it('requires a waiting default option', () =>
    expectError((d) => {
      const dec = d.decisions[0];
      dec.defaultOption = dec.options.find((o) => !o.tags.includes('wait'))!.id;
    }, /default/i));
  it('caps cold-open lines at 60 characters', () => expectError((d) => void (d.coldOpen[0] = 'x'.repeat(61)), /coldOpen/));
  it('needs four to six decisions', () => expectError((d) => void (d.decisions = d.decisions.slice(0, 3)), /decisions/));
  it('only lets a day opponent inject evidence', () =>
    expectError((d) => {
      const ev = d.evidence.find((e) => e.injectedBy)!;
      ev.injectedBy = OPPONENT_IDS.find((o) => !d.opponents.includes(o))!;
    }, /injected by/i));
  it('requires at least one suppressive option', () =>
    expectError((d) => {
      for (const dec of d.decisions) for (const o of dec.options) o.tags = o.tags.filter((t) => !SUPPRESSIVE.includes(t));
    }, /suppressive/i));
  it('requires the complication event to exist', () => expectError((d) => void (d.complication.eventId = 'e-missing'), /complication/));
  it('rejects non-objects', () => {
    expect(validateDailyCrisis(null).ok).toBe(false);
    expect(validateDailyCrisis('x').ok).toBe(false);
    expect(validateDailyCrisis({}).ok).toBe(false);
  });
});
