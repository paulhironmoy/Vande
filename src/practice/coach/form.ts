/**
 * Form: a report of demonstrated skill, computed only from the player's own evidence (docs/PRACTICE_COACH.md, "Form").
 * Each innings ball and each mastery attempt leaves one compact FormSample (no gestures, no timestamps); the report
 * scores every skill 0–100 from the samples that are real evidence for it.
 *
 * Form is never an input: nothing in src/physics or src/practice/game imports this module (a test scans for it), so it
 * cannot widen a timing window, weaken a bowler, move a fielder or change an outcome. Running is automatic in
 * Practice, so it is never scored.
 */
import type {
  AssistanceStage,
  BowlerFamily,
  CoachAnalysis,
  CoachRead,
  ContactKind,
  Decision,
  DeliveryRecord,
  DeliveryResult,
  DeliveryVariation,
  FormReport,
  FormSkill,
  FormSkillReport,
} from '@/contracts/practice';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { activeBands, bearingDelta, practiceFlight, resolveDelivery } from '@/physics';
import { withTheLine } from './cricket';
import { ballFacts, type Mover } from './facts';
import { aimClearanceDeg, coachField } from './field';

/**
 * 3 (2026-11-03): the physics' label bands were recalibrated to its physical windows (Real perfect/solid/edge
 * 14/29/55 ms, Play 20/40/86, Learn 31/58/117; the bat's own calibration is frozen apart). A sample carries its own
 * bands (`bands`), and paceGrade and the timing skill grade against them, so a version-2 sample is not comparable with
 * a version-3 one; store/form.ts drops samples of another version on load.
 */
export const FORM_SAMPLE_VERSION = 3 as const;

export type FormContext = { source: 'innings' } | { source: 'mastery'; stage: AssistanceStage };

/** One ball's evidence (JSON; persisted by the UI, oldest first). */
export interface FormSample {
  v: typeof FORM_SAMPLE_VERSION;
  simVersion: typeof PRACTICE_SIM_VERSION;
  source: 'innings' | 'mastery';
  /** Visual assistance the attempt had: 1 full trajectory … 4 none (an innings ball is 4). */
  stage: AssistanceStage;
  family: BowlerFamily;
  variation: DeliveryVariation;
  mover: Mover | null;
  short: boolean;
  read: CoachRead;
  decision: Decision;
  recommended: Decision;
  /** The player chose the footwork (rather than the automatic footwork). */
  manualFootwork: boolean;
  timingErrorMs: number | null;
  /** The active timing bands the ball was played with: perfect, solid, edge (ms). */
  bands: [number, number, number];
  contact: ContactKind;
  /** Attacking strokes off the bat: |exit bearing − intended bearing| (deg). */
  faceErrorDeg: number | null;
  /** Attacking strokes: the intended bearing and its clearance from the protected ring arcs (deg, + = in a gap). */
  aimDeg: number | null;
  aimClearanceDeg: number | null;
  /** Attacking strokes: with the line and the movement, not across them. */
  withLine: boolean | null;
  runs: number;
  out: boolean;
}

export const FORM_SKILLS: readonly FormSkill[] = [
  'line_length',
  'pace_timing',
  'swing_seam',
  'cut',
  'spin_reading',
  'short_ball',
  'footwork',
  'timing',
  'bat_face',
  'off_side_placement',
  'direction',
  'field',
  'running',
];

export const FORM_RULES = {
  /** The score is the mean of a skill's most recent evidence values, at least minSamples of them. */
  scoreWindow: 30,
  minSamples: 3,
  /** Trend: the latest trendWindow values against the trendWindow before them (fewer when there are fewer). */
  trendWindow: 8,
  minTrendSamples: 8,
  /**
   * The lowest assistance stage whose attempts count for a skill (an innings ball counts
   * as stage 4). Recognition never counts with the trajectory or the markers shown (stages 1 and 2), and timing never
   * with the contact cue (stage 3). Running is never scored.
   */
  minStage: {
    line_length: 3,
    pace_timing: 4,
    swing_seam: 3,
    cut: 3,
    spin_reading: 3,
    short_ball: 3,
    footwork: 3,
    timing: 4,
    bat_face: 1,
    off_side_placement: 2,
    direction: 2,
    field: 2,
    running: 5,
  } as Readonly<Record<FormSkill, number>>,
  /** Bat face: full marks within fullDeg of the aim, none from zeroDeg. */
  face: { fullDeg: 5, zeroDeg: 30 },
  /** Field: full marks aiming fullDeg clear of the protected arcs, none from zeroDeg (inside one). */
  aim: { fullDeg: 6, zeroDeg: -2 },
  /** Off-side strokes are aimed at least this far to the off side (deg). */
  offSideFromDeg: 10,
  /** Pace timing grades: inside the perfect band, the solid band, the edge band, beyond. */
  paceGrades: [100, 70, 30, 0],
} as const;

const EDGES: ReadonlySet<ContactKind> = new Set<ContactKind>([
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
]);
const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * The evidence one ball leaves, from its record and analysis. Like analyzeBall, it re-simulates the record's swing
 * (about 1 ms) rather than trusting a passed result, so the sample always agrees with the record and the analysis.
 */
export function formSample(
  input: { record: DeliveryRecord; result?: DeliveryResult | null; analysis: CoachAnalysis },
  context: FormContext,
): FormSample {
  const { record, analysis } = input;
  const flight = practiceFlight(record);
  const result = resolveDelivery({
    flight,
    swing: record.swing,
    field: record.field,
    bowler: record.bowler,
    conditions: record.conditions,
    handedness: record.handedness,
    assist: record.assist,
    tierToleranceMs: record.tierToleranceMs,
  });
  const facts = ballFacts(flight, record.bowler.family);
  const swing = record.swing;
  const a = analysis.attempted;
  const attack = swing !== null && swing.kind === 'attack';
  const c = result.contact;
  const offBat =
    attack && (c.kind === 'middle' || EDGES.has(c.kind)) && c.exitBearingDeg !== null && c.intendedBearingDeg !== null;
  const b = activeBands(record.assist, record.tierToleranceMs);
  return {
    v: FORM_SAMPLE_VERSION,
    simVersion: PRACTICE_SIM_VERSION,
    source: context.source,
    stage: context.source === 'innings' ? 4 : context.stage,
    family: record.bowler.family,
    variation: record.plan.variation,
    mover: facts.mover,
    short: facts.short,
    read: { ...analysis.read },
    decision: a.decision,
    recommended: analysis.options[0].decision,
    manualFootwork: swing !== null && swing.footwork !== 'auto',
    timingErrorMs: a.timingErrorMs,
    bands: [b.perfectMs, b.solidMs, b.edgeMs],
    contact: a.contact,
    faceErrorDeg: offBat ? r1(Math.abs(bearingDelta(c.exitBearingDeg!, c.intendedBearingDeg!))) : null,
    aimDeg: attack ? swing.directionDeg : null,
    aimClearanceDeg: attack ? aimClearanceDeg(coachField(record), swing.directionDeg) : null,
    withLine: attack ? withTheLine({ decision: 'attack', directionDeg: swing.directionDeg }, facts) : null,
    runs: a.runs,
    out: a.dismissal !== null,
  };
}

const verdict = (v: CoachRead[keyof CoachRead]): number | null => (v === 'right' ? 100 : v === 'wrong' ? 0 : null);
const lin = (x: number, zero: number, full: number) => 100 * Math.min(1, Math.max(0, (x - zero) / (full - zero)));

function paceGrade(s: FormSample): number | null {
  if (s.timingErrorMs === null) return null;
  const e = Math.abs(s.timingErrorMs);
  const g = FORM_RULES.paceGrades;
  return e <= s.bands[0] ? g[0] : e <= s.bands[1] ? g[1] : e <= s.bands[2] ? g[2] : g[3];
}

/** The evidence values (0–100) one sample gives each skill it is evidence for. */
export function evidenceOf(s: FormSample): Array<[FormSkill, number]> {
  const out: Array<[FormSkill, number]> = [];
  const put = (k: FormSkill, v: number | null, minStage: number = FORM_RULES.minStage[k]) => {
    if (v !== null && s.stage >= minStage) out.push([k, v]);
  };
  const attack = s.decision === 'attack';
  put('line_length', verdict(s.read.line));
  put('line_length', verdict(s.read.length));
  if (s.family === 'pace') put('pace_timing', paceGrade(s));
  if (s.family === 'pace' && (s.mover === 'swing' || s.mover === 'seam')) put('swing_seam', verdict(s.read.movement));
  if (s.variation === 'cutter' || s.mover === 'cut') {
    put('cut', verdict(s.read.movement));
    put('cut', verdict(s.read.pace), 4);
  }
  if (s.family === 'spin') {
    put('spin_reading', verdict(s.read.movement));
    put('spin_reading', verdict(s.read.pace), 4);
  }
  if (s.short) put('short_ball', verdict(s.read.bounce));
  if (s.manualFootwork) put('footwork', verdict(s.read.length));
  if (s.timingErrorMs !== null) put('timing', 100 * Math.max(0, 1 - Math.abs(s.timingErrorMs) / s.bands[2]));
  if (attack && s.contact === 'middle' && s.faceErrorDeg !== null)
    put('bat_face', lin(s.faceErrorDeg, FORM_RULES.face.zeroDeg, FORM_RULES.face.fullDeg));
  if (attack && EDGES.has(s.contact)) put('bat_face', 0);
  if (attack && s.contact === 'middle' && s.aimDeg !== null && s.aimDeg >= FORM_RULES.offSideFromDeg)
    put('off_side_placement', !s.out && s.runs > 0 ? 100 : 0);
  if (attack && s.withLine !== null) put('direction', s.withLine ? 100 : 0);
  if (attack && s.aimClearanceDeg !== null)
    put('field', lin(s.aimClearanceDeg, FORM_RULES.aim.zeroDeg, FORM_RULES.aim.fullDeg));
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function reportOf(skill: FormSkill, values: readonly number[]): FormSkillReport {
  if (skill === 'running') return { score: null, samples: 0, trend: null };
  const n = values.length;
  const score = n >= FORM_RULES.minSamples ? Math.round(mean(values.slice(-FORM_RULES.scoreWindow))) : null;
  let trend: number | null = null;
  if (n >= FORM_RULES.minTrendSamples) {
    const w = Math.min(FORM_RULES.trendWindow, Math.floor(n / 2));
    trend = Math.round(mean(values.slice(-w)) - mean(values.slice(-2 * w, -w)));
  }
  return { score, samples: n, trend };
}

/** The form report from the player's samples (oldest first). Samples that fail isFormSample are ignored. */
export function formFromAttempts(samples: readonly unknown[]): FormReport {
  const values = Object.fromEntries(FORM_SKILLS.map((k) => [k, [] as number[]])) as Record<FormSkill, number[]>;
  for (const s of samples) {
    if (!isFormSample(s)) continue;
    for (const [k, v] of evidenceOf(s)) values[k].push(v);
  }
  return Object.fromEntries(FORM_SKILLS.map((k) => [k, reportOf(k, values[k])])) as FormReport;
}

const VERDICTS = new Set(['right', 'wrong', 'unclear']);
const DECISIONS = new Set(['leave', 'defend', 'attack']);
const MOVERS = new Set(['swing', 'seam', 'cut', 'turn', 'drift']);
const CONTACTS = new Set([
  'middle',
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
  'pad',
  'body',
  'miss',
  'leave',
]);
const VARIATIONS = new Set([
  'stock',
  'outswing',
  'inswing',
  'seam',
  'cutter',
  'slower',
  'bouncer',
  'yorker',
  'flighted',
  'quicker',
  'topspinner',
  'arm_ball',
  'wrong_un',
]);
const numOrNull = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));

/** Structural check for a FormSample read back from storage (old versions and corrupt data are rejected). */
export function isFormSample(v: unknown): v is FormSample {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const read = s.read as Record<string, unknown> | null;
  const bands = s.bands as unknown[];
  return (
    s.v === FORM_SAMPLE_VERSION &&
    s.simVersion === PRACTICE_SIM_VERSION &&
    (s.source === 'innings' || s.source === 'mastery') &&
    [1, 2, 3, 4].includes(s.stage as number) &&
    (s.family === 'pace' || s.family === 'spin') &&
    VARIATIONS.has(s.variation as string) &&
    (s.mover === null || MOVERS.has(s.mover as string)) &&
    typeof s.short === 'boolean' &&
    !!read &&
    typeof read === 'object' &&
    ['length', 'line', 'pace', 'movement', 'bounce'].every((k) => VERDICTS.has(read[k] as string)) &&
    DECISIONS.has(s.decision as string) &&
    DECISIONS.has(s.recommended as string) &&
    typeof s.manualFootwork === 'boolean' &&
    numOrNull(s.timingErrorMs) &&
    Array.isArray(bands) &&
    bands.length === 3 &&
    bands.every((x) => typeof x === 'number' && x > 0) &&
    CONTACTS.has(s.contact as string) &&
    numOrNull(s.faceErrorDeg) &&
    numOrNull(s.aimDeg) &&
    numOrNull(s.aimClearanceDeg) &&
    (s.withLine === null || typeof s.withLine === 'boolean') &&
    Number.isInteger(s.runs) &&
    typeof s.out === 'boolean'
  );
}
