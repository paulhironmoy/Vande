/**
 * Words for Practice, from the engines' own closed vocabularies (never a second opinion on what happened): the dead
 * ball's outcome, primary reason and one recommendation, the comparison between exact-ball attempts, option risks,
 * form skills, the field's plan, and the delivery in plain cricket words. Short and direct: "38 ms early".
 */
import type {
  AttemptChangeKind,
  AttemptComparison,
  BowlerProfile,
  CoachAnalysis,
  CoachRecommendation,
  CoachRecommendationKind,
  CoachRisk,
  CoachingReason,
  DeliveryOutcome,
  DeliveryResult,
  Dismissal,
  FieldIntention,
  FielderRole,
  FormSkill,
  LbwReason,
  PrimaryInsight,
  SwingTiming,
} from '@/contracts';
import type { PracticeT } from '@/i18n/practice';
import { SHOT_LOFT_FROM, SHOT_LOFT_FULL } from '@/physics/constants';
import { leaveKind } from '@/practice/coach/insight';
import { zonePhrases } from '@/practice/coach/tip';
import type { BuildKit, CoachTipLike, CoachingFactsLike, Region, TipWordsLike } from './flow/types';

export { zonePhrases };

/**
 * A line as it starts on screen: its first letter in capitals where the script has them (a Hinglish line that opens
 * with a region, "Cover ke gap mein …"); Devanagari has no capitals and is never changed.
 */
export function lineStart(s: string, intl: string): string {
  const first = s.charAt(0);
  let upper: string;
  try {
    upper = first.toLocaleUpperCase(intl);
  } catch {
    upper = first.toUpperCase();
  }
  return upper + s.slice(1);
}

export function zoneWord(t: PracticeT, region: Region | null | undefined): string | null {
  return region ? t.tk(`practice.zone.${region}`) : null;
}

export function fielderWord(t: PracticeT, role: FielderRole | null | undefined): string | null {
  return role ? t.tk(`practice.fielder.${role}`) : null;
}

/** Variation copy keys: the wrong'un is a googly for a wrist spinner and a carrom ball for a finger spinner. */
export function variationKey(v: string, spinType?: string): string {
  return v === 'wrong_un' ? `wrong_un_${spinType === 'wrist' ? 'wrist' : 'finger'}` : v;
}

export function variationName(t: PracticeT, v: string, spinType?: string): string {
  return t.tk(`practice.var.${variationKey(v, spinType)}`);
}

/** "Right-arm fast bowler", "Left-arm wrist spinner". */
export function bowlerStyle(t: PracticeT, b: Pick<BowlerProfile, 'family' | 'arm' | 'paceBand' | 'spinType'>): string {
  const style = b.family === 'pace' ? (b.paceBand ?? 'fast') : (b.spinType ?? 'finger');
  return t.t('practice.bowler.label', { arm: b.arm, style });
}

/** "About 131–141 km/h": the honest stock range of this bowler (at the Random Over's difficulty, when there is one). */
export function paceRangeText(t: PracticeT, build: BuildKit, b: Pick<BowlerProfile, 'family' | 'paceBand' | 'spinType'>, difficulty?: Parameters<BuildKit['stockRange']>[1]): string {
  const [lo, hi] = build.stockRange(b, difficulty);
  return t.t('practice.bowler.range', { lo: Math.round(lo), hi: Math.round(hi) });
}

/** The outcome as a short word: FOUR, SIX and OUT are the only words shown in capitals (the caller styles them). */
export function outcomeWord(t: PracticeT, o: Pick<DeliveryOutcome, 'runs' | 'boundary' | 'dismissal'>): { word: string; caps: boolean; tone: 'boundary' | 'runs' | 'dot' | 'out' } {
  if (o.dismissal) return { word: t.t('practice.result.out'), caps: true, tone: 'out' };
  if (o.boundary === 6) return { word: t.t('practice.result.six'), caps: true, tone: 'boundary' };
  if (o.boundary === 4) return { word: t.t('practice.result.four'), caps: true, tone: 'boundary' };
  if (o.runs === 0) return { word: t.t('practice.result.dot'), caps: false, tone: 'dot' };
  return { word: t.t('practice.result.runs', { runs: o.runs }), caps: false, tone: 'runs' };
}

export function dismissalWord(t: PracticeT, d: Dismissal): string {
  return t.tk(`practice.result.${d}`);
}

/**
 * Timing in words: "On time" when the physics classified the swing as perfect (its own bands, never a number of
 * ours), otherwise "48 ms late" / "12 ms early".
 */
export function timingWords(t: PracticeT, errorMs: number | null, timing?: SwingTiming): string | null {
  if (errorMs === null || !Number.isFinite(errorMs)) return null;
  const ms = Math.round(Math.abs(errorMs));
  if (timing === 'perfect' || ms === 0) return t.t('practice.timing.on_time');
  return t.t(errorMs > 0 ? 'practice.timing.ms_late' : 'practice.timing.ms_early', { ms });
}

/** Why a ball that hit the pad or body first was not out (null when it was out, or never hit the pad first). */
export function lbwNotOut(t: PracticeT, lbw: LbwReason | null | undefined): string | null {
  return lbw && lbw !== 'out' ? t.tk(`practice.lbw.${lbw}`) : null;
}

/** A coaching reason in words, with the gap or fielder the physics named. */
export function reasonWords(t: PracticeT, reason: CoachingReason, r: Pick<DeliveryResult, 'coaching' | 'outcome'>): string {
  return lineStart(reasonPhrase(t, reason, r), t.intl);
}

function reasonPhrase(t: PracticeT, reason: CoachingReason, r: Pick<DeliveryResult, 'coaching' | 'outcome'>): string {
  const z = r.coaching.zone ?? r.outcome.region;
  const f = fielderWord(t, r.coaching.fielderRole);
  switch (reason) {
    case 'found_the_gap':
    case 'cleared_the_rope':
    case 'beat_the_field':
      return z ? t.tk(`practice.coach.${reason}`, zonePhrases(t, z)) : t.tk(`practice.coach.${reason}_any`);
    case 'hit_to_fielder':
    case 'caught_in_the_deep':
    case 'caught_in_the_ring':
      return f ? t.tk(`practice.coach.${reason}`, { fielder: f }) : t.tk(`practice.coach.${reason}_any`);
    default:
      return t.tk(`practice.coach.${reason}`);
  }
}

/** The dead ball's PRIMARY REASON line: the reason, then the measured timing ("Too late on the ball · 42 ms late"). */
export function primaryReasonLine(t: PracticeT, insight: PrimaryInsight, r: Pick<DeliveryResult, 'coaching' | 'outcome' | 'contact' | 'swing'>): string {
  const reason = reasonWords(t, insight.reason, r);
  const timing = r.swing ? timingWords(t, insight.timingMs, r.contact.timing) : null;
  const lbw = lbwNotOut(t, r.coaching.lbw);
  return [reason, lbw, timing].filter(Boolean).join(' · ');
}

/**
 * When a stroke scored but the coach still recommends a change: why it was lucky, from the coach's own evidence (the
 * same stroke, well timed, over the execution spread). Null when there is nothing to say.
 */
export function luckyLine(t: PracticeT, a: Pick<CoachAnalysis, 'attempted'>, rec: Pick<CoachRecommendation, 'kind'>): string | null {
  const at = a.attempted;
  const spread = at.spread;
  if (!spread || at.dismissal || at.runs <= 0 || isConfirmation(rec)) return null;
  if (spread.dismissalRisk > 0.5) return t.t('practice.lucky.mostly_out');
  if (spread.dismissalRisk >= 0.1) return t.t('practice.lucky.out_rate', { n: Math.max(2, Math.round(1 / spread.dismissalRisk)) });
  const risk = (['can_be_caught', 'can_edge', 'into_protected_region', 'can_be_bowled', 'can_be_lbw'] as const).find((r) => spread.risks.includes(r));
  return risk ? t.tk(`practice.lucky.${risk}`) : null;
}

/** A recommendation that confirms what the player did (shown as a confirmation, never as a correction). */
export function isConfirmation(rec: Pick<CoachRecommendation, 'kind'>): boolean {
  return rec.kind === 'well_played' || rec.kind === 'repeat_it';
}

/** The one RECOMMENDATION, in one short line (aimed at a gap the field leaves open, or "the gap" when none is named). */
export function recommendationLine(t: PracticeT, rec: CoachRecommendation): string {
  switch (rec.kind) {
    case 'play_later':
    case 'play_earlier':
      return t.tk(`practice.rec.${rec.kind}`, { ms: rec.shiftMs ?? 0 });
    case 'attack_the_gap':
    case 'aim_for_the_gap':
      return lineStart(t.tk(`practice.rec.${rec.kind}${rec.lofted ? '_lofted' : ''}`, zonePhrases(t, rec.region)), t.intl);
    default:
      return t.tk(`practice.rec.${rec.kind}`);
  }
}

/** One part of the card's tip sentence: the measured fact (the PRIMARY REASON), the one action, or joining words. */
export interface TipPart {
  role: 'fact' | 'action' | 'text';
  text: string;
}

/**
 * The dead ball's one sentence ("31 ms late, with the bat face 26° off your line: start 31 ms earlier."), split into its
 * fact, its action and the locale's own joining words (from the same practice.tip.sentence pattern), so the card can mark
 * the reason and the action while showing exactly the one sentence. If the split ever differed from the sentence, the
 * whole sentence is shown as one part: the words on screen are always exactly the tip.
 */
export function tipParts(t: PracticeT, words: TipWordsLike): TipPart[] {
  const F = '\u0001';
  const A = '\u0002';
  const frame = t.tk('practice.tip.sentence', { fact: F, action: A });
  const parts: TipPart[] = [];
  let text = '';
  for (const ch of frame) {
    if (ch !== F && ch !== A) {
      text += ch;
      continue;
    }
    if (text) parts.push({ role: 'text', text });
    text = '';
    parts.push(ch === F ? { role: 'fact', text: words.fact } : { role: 'action', text: words.action });
  }
  if (text) parts.push({ role: 'text', text });
  const whole = parts.map((p) => p.text).join('');
  const once = (role: TipPart['role']) => parts.filter((p) => p.role === role).length === 1;
  return whole === words.sentence && once('fact') && once('action') ? parts : [{ role: 'text', text: words.sentence }];
}

/**
 * The same tip as two lines, for a native card that shows the reason and the action on their own lines (Unity's
 * dead-ball card): "31 ms late, with the bat face 26° off your line." and "Start 31 ms earlier.".
 */
export function tipLines(t: PracticeT, words: TipWordsLike): { reason: string; recommendation: string } {
  return {
    reason: t.t('practice.tip.reason_line', { fact: lineStart(words.fact, t.intl) }),
    recommendation: t.t('practice.tip.action_line', { action: lineStart(words.action, t.intl) }),
  };
}

/** What changed between two attempts at the exact ball, most important first (at most two lines). */
/**
 * Coach Mode's card as the coach's measured comparison allows it (O-4). The card never confirms an attempt ("play it the
 * same way again", "well played", the tick, the green) when the comparison of that attempt with the one before it says
 * 'worse' ("Not yet."): the comparison is the coach's measurement of this attempt, so the card follows it. It then says
 * the tip's own measured fact with the recommended response itself, exactly as the coach says it whenever praise is
 * withheld (src/practice/coach/tip.ts insteadOf and spokenAction: its aim for a stroke, its block, or why to leave).
 * Any other verdict, or a tip that is not a confirmation, is shown as the coach formed it.
 */
export function cardTip(tip: CoachTipLike, analysis: CoachAnalysis, comparison: AttemptComparison | null): { tip: CoachTipLike; withheld: boolean } {
  if (!isConfirmation(tip.action) || comparison?.verdict !== 'worse') return { tip, withheld: false };
  // A fact that already withholds praise carries the coach's own `instead`, and spokenAction says it.
  if ('instead' in tip.fact) return { tip, withheld: true };
  return { tip: { ...tip, action: { ...tip.action, kind: insteadKind(analysis, tip.action) } }, withheld: true };
}

/** The recommended response itself as an action (the coach's rule in tip.ts insteadOf, which it does not export). */
function insteadKind(analysis: CoachAnalysis, rec: CoachRecommendation): CoachRecommendationKind {
  if (rec.decision === 'attack') return 'aim_for_the_gap';
  if (rec.decision === 'defend') return rec.footwork === 'back' || rec.footwork === 'across' ? 'defend_back' : 'defend_forward';
  return leaveKind(analysis);
}

export function comparisonLines(t: PracticeT, c: AttemptComparison): string[] {
  return c.changes.slice(0, 2).map((k: AttemptChangeKind) => t.tk(`practice.compare.${k}`, { ms: Math.abs(c.timingMs ?? 0), runs: Math.abs(c.runsDelta) }));
}

export function riskWord(t: PracticeT, r: CoachRisk): string {
  return t.tk(`practice.risk.${r}`);
}

export function skillName(t: PracticeT, k: FormSkill): string {
  return t.tk(`practice.form.${k}`);
}

export function intentionLine(t: PracticeT, i: FieldIntention): string {
  return t.tk(`practice.intent.${i}`);
}

/** "Cutter · 127 km/h · Good length, off stump". */
export function deliveryLine(t: PracticeT, build: BuildKit, r: DeliveryResult, bowler: Pick<BowlerProfile, 'family' | 'spinType'>): string {
  const p = r.flight.plan;
  const length = t.tk(`practice.length.${build.lengthBand(p.lengthM, bowler.family)}`);
  const line = t.tk(`practice.lineband.${build.lineBand(p.lineM)}`);
  return t.t('practice.delivery.line', { variation: variationName(t, p.variation, bowler.spinType), kph: Math.round(r.flight.release.speedKph), length, line });
}

export type ShotElevationRead = 'grounded' | 'uppish' | 'lofted';
export type ShotPowerRead = 'soft' | 'firm' | 'hard';

/**
 * The same elevation boundaries the virtual shot uses: below SHOT_LOFT_FROM stays down, the transition is visibly
 * uppish, and SHOT_LOFT_FULL is the fully lofted intent used by Coach. This prevents a fully lofted 0.45 stroke from
 * being described as grounded.
 */
export function shotElevationRead(elevation: number): ShotElevationRead {
  if (elevation < SHOT_LOFT_FROM) return 'grounded';
  if (elevation < SHOT_LOFT_FULL) return 'uppish';
  return 'lofted';
}

/** Plain-language effort bands. The top band is "hard", not the false claim that every value from 0.75 is maximum. */
export function shotPowerRead(power: number): ShotPowerRead {
  return power < 0.4 ? 'soft' : power < 0.75 ? 'firm' : 'hard';
}

type IntentRead = Pick<NonNullable<DeliveryResult['swing']>, 'kind' | 'directionDeg' | 'power' | 'elevation'>;

/** What the game read from an exact recorded intent, in the same words used on the dead-ball result. */
export function intentReadLine(t: PracticeT, intent: IntentRead | null, regionOf: (bearingDeg: number) => Region): string {
  if (!intent) return t.t('practice.read_as.leave');
  if (intent.kind === 'defend') return t.t('practice.read_as.block');
  const elevation = shotElevationRead(intent.elevation);
  const power = shotPowerRead(intent.power);
  return t.tk(`practice.read_as.${elevation}`, { ...zonePhrases(t, regionOf(intent.directionDeg)), power: t.tk(`practice.read_as.power.${power}`) });
}

/**
 * What the game read from the player's input, in plain words ("Grounded shot to cover, firm"), so the cause of every
 * outcome is visible: the recorded swing's kind, elevation, power and direction, exactly as the physics used them.
 */
export function readLine(t: PracticeT, swing: DeliveryResult['swing'], regionOf: (bearingDeg: number) => Region): string {
  return intentReadLine(t, swing, regionOf);
}

/** Measured bat evidence for the secondary “Why?” disclosure; every line stays within what the result proves. */
export function batEvidenceLines(t: PracticeT, facts: Pick<CoachingFactsLike, 'bat'>): string[] {
  const bat = facts.bat;
  const lines: string[] = [];
  if (bat.faceToIntentDeg !== null)
    lines.push(t.t('practice.why.bat_face', { deg: Math.round(Math.abs(bat.faceToIntentDeg)) }));
  if (bat.speedKph !== null)
    lines.push(t.t('practice.why.bat_speed', { kph: Math.round(bat.speedKph) }));
  if (bat.withinSweetSpotAlongBand === true)
    lines.push(t.t('practice.why.bat_along_band'));
  else if (bat.sweetSpotAlongOffsetM !== null)
    lines.push(t.t('practice.why.bat_along_offset', {
      cm: Math.round(Math.abs(bat.sweetSpotAlongOffsetM) * 100),
      end: t.t(bat.sweetSpotAlongOffsetM < 0 ? 'practice.why.bat_toe' : 'practice.why.bat_shoulder'),
    }));
  return lines;
}

/** A ball's short mark in text (·, 1, 2, 4, 6, W): shape and word, never colour alone. */
export function markText(o: { runs: number; dismissal: Dismissal | null }): string {
  return o.dismissal ? 'W' : o.runs === 0 ? '·' : String(o.runs);
}

/** "2.3" style overs from legal balls. */
export function oversText(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}
