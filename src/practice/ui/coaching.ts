/**
 * Words for one delivery, from the physics' own result (never a second opinion on what happened): the three-line
 * card shown after each ball ("PERFECT · Found the cover gap · FOUR"), the screen-reader announcement, and the
 * longer "why" used by the warm-up explanation, the dismissal screen and the diagnostic replay.
 */
import type { BowlerFamily, ContactKind, DeliveryResult, Dismissal, FielderRole, LbwReason, SwingTiming } from '@/contracts';
import type { BallMark } from '@/ui';
import type { PracticeKey, PracticeT } from '@/i18n/practice';
import type { CoachingFactsLike, Region } from './flow/types';

export type Headline = 'perfect' | 'solid' | 'early' | 'late' | 'left' | 'beaten' | 'pad';

/** The card's first line: how the swing met the ball. */
export function headlineOf(r: Pick<DeliveryResult, 'swing' | 'contact'>): Headline {
  const c = r.contact;
  if (!r.swing || c.kind === 'leave') return 'left';
  if (c.kind === 'pad' || c.kind === 'body') return c.timing === 'perfect' || c.timing === 'solid' ? 'pad' : lateness(c.timingErrorMs);
  if (c.timing === 'perfect' && c.kind === 'middle') return 'perfect';
  if (c.timing === 'perfect' || c.timing === 'solid') return c.kind === 'middle' ? 'solid' : lateness(c.timingErrorMs, 'solid');
  if (c.timing === 'mistimed' || c.timing === 'missed') return lateness(c.timingErrorMs);
  return 'beaten';
}

function lateness(errorMs: number | null, onTime: Headline = 'beaten'): Headline {
  if (errorMs === null) return onTime;
  if (errorMs > 0) return 'late';
  if (errorMs < 0) return 'early';
  return onTime;
}

const EDGES: ReadonlySet<ContactKind> = new Set(['inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);

export function zoneWord(t: PracticeT, region: Region | null | undefined): string | null {
  return region ? t.tk(`practice.zone.${region}`) : null;
}

export function areaWord(t: PracticeT, region: Region): string {
  return t.tk(`practice.area.${region}`);
}

export function fielderWord(t: PracticeT, role: FielderRole | null | undefined): string | null {
  return role ? t.tk(`practice.fielder.${role}`) : null;
}

/** The card's second line: the physics' coaching reason in words (edges name the edge when the result says out). */
export function reasonLine(t: PracticeT, r: Pick<DeliveryResult, 'coaching' | 'contact' | 'outcome'>): string {
  const { reason, zone, fielderRole } = r.coaching;
  const z = zoneWord(t, zone ?? r.outcome.region);
  const f = fielderWord(t, fielderRole);
  switch (reason) {
    case 'found_the_gap':
    case 'cleared_the_rope':
    case 'beat_the_field':
      return z ? t.tk(`practice.coach.${reason}`, { zone: z }) : t.tk(`practice.coach.${reason}_any`);
    case 'hit_to_fielder':
    case 'caught_in_the_deep':
    case 'caught_in_the_ring':
      return f ? t.tk(`practice.coach.${reason}`, { fielder: f }) : t.tk(`practice.coach.${reason}_any`);
    case 'edged_behind':
    case 'edged_to_slip':
      return EDGES.has(r.contact.kind) ? t.tk(`practice.contact.${r.contact.kind}`) : t.tk(`practice.coach.${reason}`);
    default:
      return t.tk(`practice.coach.${reason}`);
  }
}

/** The card's third line: the result. */
export function resultLine(t: PracticeT, o: DeliveryResult['outcome']): string {
  if (o.dismissal) return t.tk(`practice.result.${o.dismissal}`);
  if (o.boundary === 6) return t.t('practice.result.six');
  if (o.boundary === 4) return t.t('practice.result.four');
  if (o.runs === 0) return t.t('practice.result.dot');
  return t.t('practice.result.runs', { runs: o.runs });
}

export function headlineText(t: PracticeT, h: Headline): string {
  return t.tk(`practice.coach.head.${h}`);
}

export interface CoachingLines {
  headline: Headline;
  head: string;
  reason: string;
  result: string;
  /** Tone for the card: a boundary, runs, a dot, or a wicket (always shown with words and a shape too). */
  tone: 'boundary' | 'runs' | 'dot' | 'out';
}

export function coachingLines(t: PracticeT, r: DeliveryResult): CoachingLines {
  const headline = headlineOf(r);
  const o = r.outcome;
  return {
    headline,
    head: headlineText(t, headline),
    reason: reasonLine(t, r),
    result: resultLine(t, o),
    tone: o.dismissal ? 'out' : o.boundary ? 'boundary' : o.runs > 0 ? 'runs' : 'dot',
  };
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

/**
 * The fuller explanation from the game's measured evidence (src/practice/game coachingFacts): the delivery, its
 * movement when it mattered, the swing's timing, the contact, aim against direction and (for a wicket) how it was
 * out, plus one tip. Nothing is said that the physics did not report.
 */
export function whySentences(t: PracticeT, f: CoachingFactsLike, swung: boolean, lbw: LbwReason | null = null, family: BowlerFamily = 'pace'): { lines: string[]; tip: string } {
  const lines: string[] = [];
  const d = f.delivery;
  lines.push(
    t.t('practice.why.delivery', {
      kph: Math.round(d.speedKph),
      variation: t.tk(`practice.var.${d.variation}`),
      length: t.tk(`practice.length.${d.lengthBand}`),
      line: t.tk(`practice.lineband.${d.lineBand}`),
    }),
  );
  const moved = (m: number | null): m is number => m !== null && Math.abs(m) >= 0.1;
  const showMove = f.reason === 'beaten_by_swing' || f.reason === 'beaten_by_seam' || f.reason === 'beaten_by_turn' || moved(f.movement.airM) || moved(f.movement.pitchM);
  // In the air a pace ball swings and a spinner's drifts; off the pitch one seams and the other turns.
  const spin = family === 'spin';
  const air = f.movement.airM;
  const pitch = f.movement.pitchM;
  if (showMove && moved(air)) lines.push(t.tk(`practice.why.${spin ? 'drift' : 'air'}_${air > 0 ? 'away' : 'in'}`, { cm: Math.round(Math.abs(air) * 100) }));
  if (showMove && moved(pitch)) lines.push(t.tk(`practice.why.${spin ? 'turn' : 'seam'}_${pitch > 0 ? 'away' : 'in'}`, { cm: Math.round(Math.abs(pitch) * 100) }));
  if (!swung) lines.push(t.t('practice.why.no_swing'));
  else if (f.timingErrorMs !== null) {
    const ms = Math.round(Math.abs(f.timingErrorMs));
    const onTime = f.timingBand === 'perfect' || f.timingBand === 'solid';
    lines.push(onTime ? t.t('practice.why.timing_on', { ms }) : t.t(f.timingErrorMs > 0 ? 'practice.why.timing_late' : 'practice.why.timing_early', { ms }));
  }
  if (swung || f.contact === 'pad' || f.contact === 'body') lines.push(t.tk(`practice.why.contact.${f.contact}`));
  const notOut = lbwNotOut(t, lbw);
  if (notOut) lines.push(notOut);
  const aim = f.intendedRegion;
  const went = f.exitRegion ?? f.endRegion;
  if (swung && aim && went && f.exitBearingDeg !== null) {
    lines.push(aim === went ? t.t('practice.why.as_aimed', { went: zoneWord(t, went) ?? '' }) : t.t('practice.why.aimed_went', { aim: zoneWord(t, aim) ?? '', went: zoneWord(t, went) ?? '' }));
  }
  if (f.dismissal) lines.push(t.tk(`practice.why.wicket.${f.dismissal}`));
  // The card's early/late, or (when the physics left it open) the sign of a mistimed or missed swing's error.
  const off = f.timingBand !== 'perfect' && f.timingBand !== 'solid' && f.timingErrorMs !== null;
  const late = f.timing === 'late' || (f.timing === null && off && (f.timingErrorMs ?? 0) > 0);
  const early = f.timing === 'early' || (f.timing === null && off && (f.timingErrorMs ?? 0) < 0);
  const tip: PracticeKey = !swung ? 'practice.why.tip.leave' : late ? 'practice.why.tip.late' : early ? 'practice.why.tip.early' : aim && went && aim !== went ? 'practice.why.tip.aim' : 'practice.why.tip.good';
  return { lines, tip: t.t(tip) };
}

/** The badge for one ball (the design system's shapes: dot, runs, four, six, wicket). */
export function markOf(o: { runs: number; dismissal: Dismissal | null }): BallMark {
  if (o.dismissal) return { kind: 'wicket', wicket: o.dismissal === 'caught_behind' ? 'caught' : o.dismissal };
  if (o.runs === 6) return { kind: 'six' };
  if (o.runs === 4) return { kind: 'four' };
  if (o.runs === 0) return { kind: 'dot' };
  return { kind: 'runs', runs: Math.min(3, o.runs) as 1 | 2 | 3 };
}

/** "2.3" style overs from legal balls. */
export function oversText(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}
