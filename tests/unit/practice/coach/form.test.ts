import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION, type AssistanceStage, type DeliveryRecord, type NormalizedSwing } from '@/contracts/practice';
import { FORM_RULES, FORM_SAMPLE_VERSION, FORM_SKILLS, analyzeBall, evidenceOf, formFromAttempts, formSample, isFormSample, type FormContext, type FormSample } from '@/practice/coach';
import { OFFSPIN, play, recordFor, referenceRecord, swingFor } from './fixtures';

function sample(record: DeliveryRecord, swing: NormalizedSwing | null, context: FormContext = { source: 'innings' }): FormSample {
  const { record: r, result } = play(record, swing);
  return formSample({ record: r, result, analysis: analyzeBall(r, result) }, context);
}

const OUT = referenceRecord('ref-1');
const IN = referenceRecord('ref-2');
const LEFT_WELL = sample(OUT, null);
const LEFT_AND_BOWLED = sample(IN, null);
const DRIVE = sample(OUT, swingFor(OUT, { directionDeg: 42, power: 0.45 }));
const repeat = (s: FormSample, n: number) => Array.from({ length: n }, () => s);

describe('form samples', () => {
  it('are compact JSON evidence (no gestures, no timestamps) that survives storage', () => {
    for (const s of [LEFT_WELL, LEFT_AND_BOWLED, DRIVE]) {
      const back = JSON.parse(JSON.stringify(s));
      expect(back).toEqual(s);
      expect(isFormSample(back)).toBe(true);
      expect(Object.keys(s)).not.toContain('startT');
    }
    expect(LEFT_WELL).toMatchObject({ v: FORM_SAMPLE_VERSION, simVersion: PRACTICE_SIM_VERSION, source: 'innings', stage: 4, family: 'pace', decision: 'leave', out: false });
    expect(DRIVE.aimDeg).toBe(42);
    expect(DRIVE.withLine).toBe(true);
    expect(DRIVE.aimClearanceDeg!).toBeGreaterThan(0);
  });

  it('a mastery attempt carries its assistance stage', () => {
    expect(sample(OUT, null, { source: 'mastery', stage: 2 })).toMatchObject({ source: 'mastery', stage: 2 });
  });

  it('corrupt or old samples are rejected and ignored', () => {
    expect(isFormSample({ ...LEFT_WELL, v: 0 })).toBe(false);
    expect(isFormSample({ ...LEFT_WELL, simVersion: PRACTICE_SIM_VERSION - 1 })).toBe(false);
    expect(isFormSample({ ...LEFT_WELL, simVersion: PRACTICE_SIM_VERSION + 1 })).toBe(false);
    expect(isFormSample({ ...LEFT_WELL, read: { ...LEFT_WELL.read, line: 'maybe' } })).toBe(false);
    expect(isFormSample({ ...LEFT_WELL, bands: [1, 2] })).toBe(false);
    expect(isFormSample('nonsense')).toBe(false);
    const report = formFromAttempts([...repeat(LEFT_WELL, 5), { ...LEFT_WELL, v: 99 }, null, 42]);
    expect(report.line_length.samples).toBe(5);
  });
});

describe('the form report', () => {
  it('scores a skill only from its evidence, with a minimum number of samples', () => {
    const empty = formFromAttempts([]);
    for (const k of FORM_SKILLS) expect(empty[k]).toEqual({ score: null, samples: 0, trend: null });
    const two = formFromAttempts(repeat(LEFT_WELL, 2));
    expect(two.line_length).toMatchObject({ score: null, samples: 2 });
    const good = formFromAttempts(repeat(LEFT_WELL, 5));
    expect(good.line_length).toMatchObject({ score: 100, samples: 5 });
    const poor = formFromAttempts(repeat(LEFT_AND_BOWLED, 5));
    expect(poor.line_length).toMatchObject({ score: 0, samples: 5 });
    expect(poor.swing_seam.score).toBe(0);
  });

  it('running is automatic in Practice and is never scored', () => {
    const r = formFromAttempts([...repeat(DRIVE, 10), ...repeat(LEFT_WELL, 10)]);
    expect(r.running).toEqual({ score: null, samples: 0, trend: null });
  });

  it('attacking strokes give execution evidence: timing, bat face, direction, the field, off-side placement', () => {
    const r = formFromAttempts(repeat(DRIVE, 4));
    expect(r.timing.score!).toBeGreaterThan(80);
    expect(r.direction.score).toBe(100);
    expect(r.field.samples).toBe(4);
    if (DRIVE.contact === 'middle') {
      expect(r.bat_face.score!).toBeGreaterThan(50);
      expect(r.off_side_placement.samples).toBe(4);
    }
    expect(r.pace_timing.samples).toBe(4);
    expect(r.spin_reading.samples).toBe(0);
  });

  it('spin is read only against spin, pace timing only against pace', () => {
    const spinner = recordFor({ variation: 'stock', lengthM: 4, lineM: 0.1, speedKph: 84 }, { bowler: OFFSPIN, conditions: 'turning' });
    const s = sample(spinner, swingFor(spinner, { kind: 'defend' }));
    const r = formFromAttempts(repeat(s, 4));
    expect(r.pace_timing.samples).toBe(0);
    expect(r.spin_reading.samples).toBeGreaterThan(0);
  });

  it('assisted attempts never count as recognition: the trajectory or the markers showed the answer', () => {
    const helped = sample(OUT, null, { source: 'mastery', stage: 1 });
    const markers = sample(OUT, null, { source: 'mastery', stage: 2 });
    const cue = sample(OUT, null, { source: 'mastery', stage: 3 });
    expect(formFromAttempts(repeat(helped, 5)).line_length.samples).toBe(0);
    expect(formFromAttempts(repeat(markers, 5)).line_length.samples).toBe(0);
    expect(formFromAttempts(repeat(cue, 5)).line_length.samples).toBe(5);
    const helpedDrive = sample(OUT, swingFor(OUT, { directionDeg: 42, power: 0.45 }), { source: 'mastery', stage: 1 });
    const r = formFromAttempts(repeat(helpedDrive, 4));
    expect(r.timing.samples).toBe(0);
    expect(r.direction.samples).toBe(0);
    expect(r.bat_face.samples).toBe(helpedDrive.contact === 'middle' ? 4 : 0);
    for (const [skill] of evidenceOf(helpedDrive)) expect(FORM_RULES.minStage[skill]).toBeLessThanOrEqual(1);
  });

  it('the trend compares the latest evidence with what came before', () => {
    const better = formFromAttempts([...repeat(LEFT_AND_BOWLED, 8), ...repeat(LEFT_WELL, 8)]);
    expect(better.line_length.trend).toBe(100);
    const worse = formFromAttempts([...repeat(LEFT_WELL, 8), ...repeat(LEFT_AND_BOWLED, 8)]);
    expect(worse.line_length.trend).toBe(-100);
    expect(formFromAttempts(repeat(LEFT_WELL, 7)).line_length.trend).toBeNull();
  });

  it('is the mean of the most recent window', () => {
    const r = formFromAttempts([...repeat(LEFT_AND_BOWLED, 40), ...repeat(LEFT_WELL, FORM_RULES.scoreWindow)]);
    expect(r.line_length.score).toBe(100);
    expect(r.line_length.samples).toBe(40 + FORM_RULES.scoreWindow);
  });
});

describe('form never feeds back into the game', () => {
  // Vite reads the sources as raw text (as tests/unit/platform/bundleSecrets.test.ts does).
  const texts = (files: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const game = texts(import.meta.glob(['/src/physics/**/*.{ts,tsx}', '/src/practice/game/**/*.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }));
  const form = texts(import.meta.glob('/src/practice/coach/form.ts', { query: '?raw', import: 'default', eager: true }));

  const importsCoach = (src: string) => /from\s+['"](@\/practice\/coach|[./]+coach)(\/[^'"]*)?['"]|import\(\s*['"][^'"]*practice\/coach/.test(src);

  it('the scan recognises every way of importing the coach', () => {
    expect(importsCoach("import { formFromAttempts } from '@/practice/coach';")).toBe(true);
    expect(importsCoach("import type { FormSample } from '@/practice/coach/form';")).toBe(true);
    expect(importsCoach("export { x } from '../coach';")).toBe(true);
    expect(importsCoach("const m = await import('@/practice/coach');")).toBe(true);
    expect(importsCoach("import { coachingFacts } from './coaching';")).toBe(false);
  });

  it('nothing in src/physics or src/practice/game imports the coach (form, mastery or analysis)', () => {
    expect(Object.keys(game).length).toBeGreaterThan(20);
    const offenders = Object.entries(game)
      .filter(([, src]) => importsCoach(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the form module imports only types and pure helpers: nothing it could change', () => {
    const src = Object.values(form)[0];
    const imports = [...src.matchAll(/^import[^;]+from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((m) => m === '@/contracts/practice' || m === '@/physics' || m.startsWith('./'))).toBe(true);
    expect(src).not.toMatch(/TIMING_BANDS|autoField|PITCHES|ATHLETICS/);
  });
});

describe('form: stage gating is exactly FORM_RULES.minStage', () => {
  it('every skill but running can be evidenced at some stage', () => {
    for (const k of FORM_SKILLS) {
      const min = FORM_RULES.minStage[k];
      if (k === 'running') expect(min).toBeGreaterThan(4);
      else expect(min).toBeLessThanOrEqual(4 as AssistanceStage);
    }
  });
});
