// @vitest-environment node
/**
 * COACH2 ★ for the cover drive (release/player-experience/ceiling-rubric.md COACH2; docs/prompts/
 * VANDE-PRACTICE-WEDGE-PROMPT.md §4 step 5 and §7.1): tips that provably work.
 *
 * On every reference ball, each applicable cover-drive mistake is played through the real input layer and the game's
 * exact-ball path:
 *
 *   input   the keyboard's cover drive, played on the shipped GestureTracker: W (front foot), then Numpad 9 (the
 *           45° cover arrow; Numpad 8, straight, for the late-movement mistake below), pressed at a chosen time
 *           after release; the tracker's gesture is normalised by normalizeGesture with the release time, exactly as
 *           the live screen does
 *   ball    repeatDelivery (src/practice/game/replay.ts) on the reference ball's record, with the record's assistance and
 *           tier tolerance
 *
 * The mistakes are fixed before any outcome is seen, from the coach's own description of the ball (facts.ts,
 * cricket.ts):
 *
 *   too early       the drive pressed so its timing error is −(solid + edge) / 2 of the active bands: mistimed
 *   too late        the same, late
 *   wrong ball      the drive on time, when the coach's orthodoxy says a front-foot drive is not cricket for the
 *                   measured length and line (too short, too full, or across the line or movement)
 *   late movement   when the length and line are a drive's but the ball moved ≥ 5 cm: the front-foot drive on time
 *                   down the line the ball started on, the face closed to the movement (W + Numpad 8, straight, for
 *                   a ball moving away; W + Numpad 9 for one moving in). The 45° drive on time is no longer this
 *                   mistake: the repaired bat (physics REPORT item 1) meets the full outswinger with it, so it scores
 *                   or is judged as a stroke, not beaten by the movement (COACH2-RERUN.md, "Late movement")
 *
 * Then the coach's recommendation for the failed attempt (options[0], what the demonstration plays) is played through
 * the same path at every point of the execution spread the coach itself uses (simulate.ts spreadOf: every 5 ms across
 * ±2σ of the human error model, never clipped to a label band, aim ±10° at every timing within ±σ; dense since the
 * evaluators' finding D-1, 2026-11-03). It succeeds at a point when it is not dismissed and meets the
 * ball off the middle of the bat (or leaves a ball that misses the stumps). Every point must succeed. A timing tip
 * ("start 68 ms earlier") is also applied literally: the player's own stroke moved by exactly that many milliseconds
 * must succeed at its ideal point.
 *
 * Every case is recorded; with COACH2_TABLE=<path> the table is written there as Markdown (the evidence in
 * release/product-sequence/stage-1-practice/wedge/coaching/). No case is skipped: a case the physics cannot pass fails
 * here with its evidence.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import type {
  AssistLevel,
  CoachAnalysis,
  DeliveryRecord,
  DeliveryResult,
  GestureInput,
  NormalizedSwing,
} from '@/contracts/practice';
import { GestureTracker, type TrackerScheduler } from '@/input/tracker';
import { normalizeGesture } from '@/input/normalize';
import { activeBands, batTravelMs, bearingDelta, idealTimeFor, practiceFlight } from '@/physics';
import { shotFamily } from '@/physics/shot';
import { REFERENCE_BALLS, repeatDelivery } from '@/practice/game';
import {
  analyzeBall,
  coachTip,
  metStandard,
  praiseEarned,
  primaryInsight,
  spokenAction,
  tipActionWords,
  tipFactWords,
  tipSentence,
  type CoachTip,
  type TipTranslator,
} from '@/practice/coach';
import { ballFacts } from '@/practice/coach/facts';
import { isOrthodox } from '@/practice/coach/cricket';
import { idealTimes, swingOf, type Candidate } from '@/practice/coach/candidates';
import { spreadOf } from '@/practice/coach/simulate';
import { formatMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import { referenceRecord } from './fixtures';

const RELEASE_MS = 10_000;
/** The keyboard's cover drive: Numpad 9 is the up-and-right arrow, 45° on screen (a right-hander's cover). */
const COVER_KEY = 'Numpad9';
/** The keyboard's straight drive: Numpad 8, straight up the screen (0°). */
const STRAIGHT_KEY = 'Numpad8';
type DriveKey = typeof COVER_KEY | typeof STRAIGHT_KEY;
const DRIVE: Record<DriveKey, { family: 'cover_drive' | 'straight_drive'; words: string }> = {
  Numpad9: { family: 'cover_drive', words: 'cover drive (W + Numpad 9)' },
  Numpad8: { family: 'straight_drive', words: 'straight drive (W + Numpad 8)' },
};
const FRONT_FOOT_KEY = 'KeyW';
const SURFACE = { width: 844, height: 390 * 0.46 };

type Mistake = 'too_early' | 'too_late' | 'wrong_ball' | 'late_movement';
const CONFIGS: Array<{ assist: AssistLevel; tier: number }> = [
  { assist: 'play', tier: 0 },
  { assist: 'real', tier: 0 },
  { assist: 'learn', tier: 0 },
  { assist: 'play', tier: 15 },
  { assist: 'real', tier: 15 },
];

/** A clock that moves only when told (the tracker's timers run on it). */
function simClock(start: number): TrackerScheduler & { advance(to: number): void } {
  let now = start;
  let next = 1;
  const timers: Array<{ at: number; id: number; fn: () => void }> = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + Math.max(0, ms), id, fn });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(to: number) {
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > to) break;
        timers.shift();
        now = Math.max(now, t.at);
        t.fn();
      }
      now = Math.max(now, to);
    },
  };
}

/** The keyboard drive (W, then the arrow) pressed `errorMs` from the ideal for the front foot, through the shipped tracker and normaliser. */
function keyboardDrive(record: DeliveryRecord, errorMs: number, arrow: DriveKey = COVER_KEY): NormalizedSwing {
  const flight = practiceFlight(record);
  // The key time that puts the swing's start at the ideal contact less the keyboard stroke's bat travel.
  const probe = (atMs: number) => {
    const clock = simClock(atMs - 500);
    let gesture: GestureInput | null = null;
    const tracker = new GestureTracker({ swingStart: () => {}, gesture: (g) => (gesture = gesture ?? g) }, clock);
    tracker.setSurface(SURFACE.width, SURFACE.height);
    tracker.setHandedness('right');
    tracker.setEnabled(true);
    clock.advance(atMs - 200);
    expect(tracker.key(FRONT_FOOT_KEY, atMs - 200)).toBe('footwork');
    clock.advance(atMs);
    expect(tracker.key(arrow, atMs)).toBe('swing');
    clock.advance(atMs + 400);
    tracker.dispose();
    expect(gesture, 'the tracker emitted the key stroke').not.toBeNull();
    return normalizeGesture(gesture!, { releasePerfMs: RELEASE_MS, calibrationMs: 0, handedness: 'right' })!;
  };
  // The keyboard's power is fixed (KEYBOARD.power): one probe reads the stroke, the second places it in time.
  const at0 = probe(RELEASE_MS);
  const target = idealTimeFor(flight, at0.footwork) - batTravelMs(at0.kind, at0.power) / 1000 + errorMs / 1000;
  const swing = probe(RELEASE_MS + target * 1000);
  expect(swing.kind).toBe('attack');
  expect(swing.footwork).toBe('forward');
  expect(swing.elevation).toBe(0);
  return swing;
}

/** A point of the spread succeeds: not dismissed, and off the middle (or a clean leave of a ball that misses). */
function succeeds(r: DeliveryResult, leave: boolean): boolean {
  if (r.outcome.dismissal) return false;
  return leave ? r.contact.kind === 'leave' : r.contact.kind === 'middle';
}

interface SpreadRun {
  ok: number;
  n: number;
  failures: string[];
}

/** A swing played at every point of the coach's execution spread (offsets from the swing as given). */
function overSpread(
  record: DeliveryRecord,
  swing: NormalizedSwing | null,
  decision: 'leave' | 'defend' | 'attack',
): SpreadRun {
  if (!swing) {
    const r = repeatDelivery(record, null);
    const good = succeeds(r, true);
    return {
      ok: good ? 1 : 0,
      n: 1,
      failures: good ? [] : [`leave: ${r.contact.kind}${r.outcome.dismissal ? ` out ${r.outcome.dismissal}` : ''}`],
    };
  }
  const c: Candidate = {
    id: 'rec',
    index: 0,
    decision: decision === 'defend' ? 'defend' : 'attack',
    kind: swing.kind,
    footwork: swing.footwork,
    directionDeg: swing.directionDeg,
    elevation: swing.elevation,
    power: swing.power,
  };
  const ideal = idealTimes(practiceFlight(record));
  const centre = swingOf(c, ideal)!;
  const ownMs = Math.round((swing.startT - centre.startT) * 1e5) / 100;
  const out: SpreadRun = { ok: 0, n: 0, failures: [] };
  for (const p of spreadOf(c)) {
    const s = swingOf(c, ideal, p.dtMs + ownMs, p.aimDeg)!;
    const r = repeatDelivery(record, s);
    out.n++;
    if (succeeds(r, false)) out.ok++;
    else
      out.failures.push(
        `${p.dtMs > 0 ? '+' : ''}${p.dtMs} ms/${p.aimDeg > 0 ? '+' : ''}${p.aimDeg}°: ${r.contact.kind}${r.outcome.dismissal ? ` out ${r.outcome.dismissal}` : ''}`,
      );
  }
  return out;
}

/** A strict translator over one catalog: every key must exist in it (no English fallback hides a missing line). */
function translator(catalog: Record<string, string>, intl: string): TipTranslator & { used: Set<string> } {
  const used = new Set<string>();
  return {
    used,
    tk(key, params) {
      const p = catalog[key];
      if (p === undefined) throw new Error(`missing copy ${key}`);
      used.add(key);
      return formatMessage(p, params, intl);
    },
  };
}
const EN = () => translator(practiceEn as Record<string, string>, 'en-IN');
const HI = () => translator(practiceHi, 'hi-IN');
const HI_LATN = () => translator(practiceHiLatn, 'en-IN');

/** One sentence: a fact, a colon, one action, one full stop (decimals such as 7.9 allowed). */
function oneSentence(s: string, stop: '.' | '।'): boolean {
  if (!s.endsWith(stop)) return false;
  const body = s.slice(0, -1).replace(/\d\.\d/g, '');
  return !/[.!?।]/.test(body) && body.split(': ').length === 2 && !body.includes('{');
}

interface Row {
  config: string;
  ball: string;
  mistake: Mistake;
  input: string;
  physics: string;
  punished: boolean;
  tip: string;
  sentence: string;
  recommended: string;
  spread: string;
  literal: string;
  pass: boolean;
}
const ROWS: Row[] = [];

const fmtSwing = (an: CoachAnalysis) => {
  const r = an.options[0];
  if (!r.swing) return `leave (${r.footwork})`;
  return r.decision === 'defend'
    ? `block, ${r.footwork} foot`
    : `${r.footwork} foot ${r.swing.directionDeg}°, power ${r.swing.power}, elevation ${r.swing.elevation}`;
};

/** The mistakes that apply to a ball, from the coach's own description of it (decided before any outcome). */
function mistakesFor(record: DeliveryRecord): Array<{ mistake: Mistake; errorMs: number; arrow: DriveKey }> {
  const f = ballFacts(practiceFlight(record), record.bowler.family);
  const b = activeBands(record.assist, record.tierToleranceMs);
  const mid = Math.round((b.solidMs + b.edgeMs) / 2);
  const out: Array<{ mistake: Mistake; errorMs: number; arrow: DriveKey }> = [
    { mistake: 'too_early', errorMs: -mid, arrow: COVER_KEY },
    { mistake: 'too_late', errorMs: mid, arrow: COVER_KEY },
  ];
  const driveIsCricket = isOrthodox(
    { decision: 'attack', footwork: 'forward', played: 'forward', directionDeg: 45, elevation: 0 },
    f,
  );
  if (!driveIsCricket) out.push({ mistake: 'wrong_ball', errorMs: 0, arrow: COVER_KEY });
  // Beaten by late movement: the drive down the line the ball started on (straight for one moving away), on time.
  else if (f.mover !== null)
    out.push({ mistake: 'late_movement', errorMs: 0, arrow: f.playedMoveM > 0 ? STRAIGHT_KEY : COVER_KEY });
  return out;
}

const TIP_MISTAKE: Record<Mistake, ReadonlyArray<CoachTip['fact']['kind']>> = {
  too_early: ['early'],
  too_late: ['late', 'late_where'],
  wrong_ball: ['too_short_to_drive', 'at_the_toes', 'too_short_forward', 'full_back', 'across_movement', 'across_line'],
  late_movement: ['moved'],
};
/** Which mistake each tip fact shows, as seen on the reference over (for the four-sentences check). */
const SEEN = new Map<
  string,
  { fact: CoachTip['fact']; tip: CoachTip; en: string; hi: string; hiLatn: string; where: string }
>();

for (const { assist, tier } of CONFIGS) {
  describe(`COACH2 cover drive (${assist}, tier tolerance ${tier} ms): the recommendation works across the spread`, () => {
    for (const rb of REFERENCE_BALLS) {
      it(`${rb.id} ${rb.variation}`, () => {
        const base: DeliveryRecord = { ...referenceRecord(rb.id, assist), tierToleranceMs: tier };
        const bands = activeBands(assist, tier);
        const failures: string[] = [];
        for (const { mistake, errorMs, arrow } of mistakesFor(base)) {
          // 1. The mistake, through the input layer and the exact-ball path.
          const swing = keyboardDrive(base, errorMs, arrow);
          const result = repeatDelivery(base, swing);
          expect(
            shotFamily(swing.kind, swing.directionDeg, result.footwork),
            `${rb.id} ${mistake}: a ${DRIVE[arrow].family}`,
          ).toBe(DRIVE[arrow].family);
          expect(
            Math.abs((result.contact.timingErrorMs ?? NaN) - errorMs),
            `${rb.id} ${mistake}: timing as pressed`,
          ).toBeLessThan(0.2);
          if (mistake === 'too_early' || mistake === 'too_late')
            expect(['mistimed', 'missed']).toContain(result.contact.timing);
          const record: DeliveryRecord = {
            ...base,
            swing,
            runs: result.outcome.runs,
            dismissal: result.outcome.dismissal,
          };
          const an = analyzeBall(record, result);
          const insight = primaryInsight(an);
          const tip = coachTip(record, an);
          const rec = an.options[0];
          const punished =
            result.outcome.dismissal !== null || result.contact.kind !== 'middle' || result.outcome.runs === 0;

          // 2. The tip: one sentence from the recommendation kind and the measured facts, in every launch locale.
          expect(tip.action).toEqual(insight.recommendation);
          const en = tipSentence(EN(), tip);
          const hi = tipSentence(HI(), tip);
          const hiLatn = tipSentence(HI_LATN(), tip);
          expect(oneSentence(en, '.'), en).toBe(true);
          expect(oneSentence(hi, '।'), hi).toBe(true);
          expect(oneSentence(hiLatn, '.'), hiLatn).toBe(true);
          // The sentence ends with the action as said (tip.ts spokenAction). It is the card's recommendation, except a
          // confirmation (repeat_it, well_played) whose praise is not earned: the stroke carried a risk the recommended
          // response does not, so the recommended response itself is said and no praise or "again" appears (owner
          // decision 2026-11-03; anti-fake rule 7; FLOW REPORT item 20).
          expect(en.endsWith(`${tipActionWords(EN(), spokenAction(tip))}.`), en).toBe(true);
          if (!praiseEarned(an, tip.action, tip)) {
            for (const [t, said] of [
              [EN(), en],
              [HI(), hi],
              [HI_LATN(), hiLatn],
            ] as const) {
              for (const praise of [
                tipActionWords(t, { ...tip.action, kind: 'repeat_it' }),
                tipActionWords(t, { ...tip.action, kind: 'well_played' }),
              ])
                expect(
                  said.toLocaleLowerCase().includes(praise.toLocaleLowerCase()),
                  `${said} praises (${praise})`,
                ).toBe(false);
            }
          }
          // The numbers are the recorded ones.
          const fact = tip.fact;
          if (fact.kind === 'early' || fact.kind === 'late' || fact.kind === 'late_where')
            expect(fact.ms).toBe(Math.round(Math.abs(result.contact.timingErrorMs!)));
          if (fact.kind === 'late')
            expect(fact.faceDeg).toBe(
              Math.round(Math.abs(bearingDelta(result.contact.faceBearingDeg!, result.contact.intendedBearingDeg!))),
            );
          if (fact.kind === 'moved' || fact.kind === 'across_movement')
            expect(fact.cm).toBe(Math.round(Math.abs(ballFacts(practiceFlight(base), 'pace').playedMoveM) * 100));
          if (
            fact.kind === 'too_short_to_drive' ||
            fact.kind === 'at_the_toes' ||
            fact.kind === 'too_short_forward' ||
            fact.kind === 'full_back'
          )
            expect(fact.lengthM).toBe(Math.round(an.ball.lengthM! * 10) / 10);
          // A mistake is never confirmed as the right stroke.
          if (mistake === 'too_early' || mistake === 'too_late')
            expect(['repeat_it', 'well_played']).not.toContain(insight.recommendation.kind);
          for (const k of TIP_MISTAKE[mistake])
            if (fact.kind === k && !SEEN.has(mistake))
              SEEN.set(mistake, { fact, tip, en, hi, hiLatn, where: `${assist}/${tier} ${rb.id}` });

          // 3. The recommendation, through the same path, at every point of the coach's execution spread.
          const spread = overSpread(base, rec.swing, rec.decision);
          const centre = repeatDelivery(base, rec.swing);
          expect(centre.outcome).toEqual(rec.outcome);
          const done = analyzeBall(
            { ...base, swing: rec.swing, runs: centre.outcome.runs, dismissal: centre.outcome.dismissal },
            centre,
          );
          const centreOk = metStandard(done) && primaryInsight(done).recommendation.kind === 'repeat_it';

          // 4. A timing tip applied literally to the player's own stroke.
          let literal = 'n/a (not a timing tip)';
          let literalOk = true;
          const k = insight.recommendation.kind;
          if (k === 'play_later' || k === 'play_earlier') {
            const ms = (k === 'play_later' ? 1 : -1) * insight.recommendation.shiftMs!;
            const moved = { ...swing, startT: Math.round((swing.startT + ms / 1000) * 1e4) / 1e4 };
            const r = repeatDelivery(base, moved);
            literalOk = succeeds(r, false);
            const own = overSpread(base, moved, 'attack');
            literal = `${k === 'play_later' ? '+' : ''}${ms} ms → ${r.contact.kind}${r.outcome.dismissal ? ` out ${r.outcome.dismissal}` : ''}, ${r.outcome.runs} run(s); own stroke over the spread ${own.ok}/${own.n}`;
          }

          const pass = centreOk && spread.ok === spread.n && literalOk;
          if (!pass)
            failures.push(
              `${mistake}: recommended ${fmtSwing(an)} ${spread.ok}/${spread.n} [${spread.failures.join('; ')}]${centreOk ? '' : ' (ideal point not clean)'}${literalOk ? '' : ` literal tip: ${literal}`}`,
            );
          ROWS.push({
            config: `${assist}/${tier}`,
            ball: `${rb.id} ${rb.variation}`,
            mistake,
            input: `${DRIVE[arrow].words}, ${errorMs > 0 ? '+' : ''}${errorMs} ms; measured ${result.contact.timingErrorMs!.toFixed(1)} ms (${result.contact.timing}; bands ${bands.solidMs}/${bands.edgeMs})`,
            physics: `${result.contact.kind}, ${result.outcome.runs} run(s)${result.outcome.dismissal ? `, out ${result.outcome.dismissal}` : ''}; reason ${result.coaching.reason}`,
            punished,
            tip: `${tip.action.kind}${tip.action.shiftMs ? ` ${tip.action.shiftMs} ms` : ''} (${tip.mistake ?? 'confirmation'}: ${fact.kind})${tip.mistake === null && an.attempted.spread ? `; the drive over the spread: risk ${an.attempted.spread.dismissalRisk}, E ${an.attempted.spread.expectedRuns}, risks [${an.attempted.spread.risks.join(', ')}]` : ''}`,
            sentence: en,
            recommended: `${fmtSwing(an)} (risk ${rec.dismissalRisk}, E ${rec.expectedRuns})`,
            spread: `${spread.ok}/${spread.n}${spread.failures.length ? ` [${spread.failures.join('; ')}]` : ''}`,
            literal,
            pass,
          });
        }
        expect(failures, `${assist}/${tier} ${rb.id}`).toEqual([]);
      }, 240_000);
    }
  });
}

describe('the four cover-drive mistakes each produce one plain sentence (RK4, COACH1)', () => {
  it('every tip is rendered from the recommendation kind and recorded facts, never written per ball', () => {
    // The tip module and its copy name no reference ball, no variation and no seed: the words come from closed kinds.
    const src = readFileSync('src/practice/coach/tip.ts', 'utf8');
    for (const word of ['ref-', 'REFERENCE', 'reference.ts', 'seed', 'lookSeed', 'vande-reference'])
      expect(src.includes(word), word).toBe(false);
    for (const [k, v] of Object.entries(practiceEn as Record<string, string>)) {
      if (!k.startsWith('practice.tip.')) continue;
      expect(/ref-\d|reference/i.test(v), k).toBe(false);
      expect(k in practiceHi && k in practiceHiLatn, k).toBe(true);
    }
  });

  it('on the reference over, each of the four mistakes produced its own measured sentence in en, hi and hi-Latn', () => {
    // Filled by the COACH2 cases above (same file, run in order): the first case whose tip fact shows each mistake.
    expect([...SEEN.keys()].sort()).toEqual(['late_movement', 'too_early', 'too_late', 'wrong_ball']);
    for (const s of SEEN.values()) {
      expect(oneSentence(s.en, '.'), s.en).toBe(true);
      expect(oneSentence(s.hi, '।'), s.hi).toBe(true);
      expect(oneSentence(s.hiLatn, '.'), s.hiLatn).toBe(true);
      expect(s.en).toBe(tipSentence(EN(), s.tip));
      expect(s.en.startsWith(tipFactWords(EN(), s.fact))).toBe(true);
    }
  });
});

afterAll(() => {
  const path = process.env.COACH2_TABLE;
  if (!path || ROWS.length === 0) return;
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    '| # | Level/tier | Ball | Mistake | Input (through GestureTracker + normalizeGesture) | Physics of the mistake | Punished | Tip (kind: fact) | Sentence (en) | Recommended response | Spread (ok/points) | Timing tip applied literally | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...ROWS.map(
      (r, i) =>
        `| ${i + 1} | ${r.config} | ${r.ball} | ${r.mistake} | ${esc(r.input)} | ${esc(r.physics)} | ${r.punished ? 'yes' : 'no'} | ${esc(r.tip)} | ${esc(r.sentence)} | ${esc(r.recommended)} | ${esc(r.spread)} | ${esc(r.literal)} | ${r.pass ? 'PASS' : 'FAIL'} |`,
    ),
  ];
  const seen = [...SEEN.entries()].map(
    ([m, s]) => `- ${m} (${s.where}): en "${s.en}" · hi "${s.hi}" · hi-Latn "${s.hiLatn}"`,
  );
  writeFileSync(path, `${lines.join('\n')}\n\nSentences seen per mistake on the reference over:\n${seen.join('\n')}\n`);
});
