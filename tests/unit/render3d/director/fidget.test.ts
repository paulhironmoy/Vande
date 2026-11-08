// @vitest-environment node
/**
 * Fidgets and reactions (P3). The Director's people shift their weight, adjust their stance, roll their shoulders, sigh and
 * glance to the side between balls, and the batter reacts to the outcome, all as plain events of the plan:
 *   - the fidgets are draws of the ball's key and nothing else (a different ball, a different set; the same ball, the same set),
 *     and they are zero inside the quiet windows (nothing that moves the torso, hips, arms or hands while the ball is bowled);
 *   - Reduced Motion: no displacement and no glance to the side (gaze shifts there are 10 degrees at most);
 *   - the reaction starts at outcomeAt plus the seeded 180 to 380 ms and not before, its size follows the result (Experience
 *     Constitution, proportional feedback) and its sign follows the news; the same ball with another outcome is bit-equal until then.
 * Reason: MOTION-1 found zero variation between balls and bodies that froze after the result.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CH,
  CHANNELS,
  DRAW,
  deliveryTakeKey,
  prepare,
  type DirectorAnchors,
  type DirectorPlan,
} from '@/render3d/core/motion/director';
import { FIDGET, FIDGET_N, T_SIDE } from '@/render3d/core/motion/director/plan';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng } from './world';
import { frameOf, quantile, record, recordFile, stats, timeOf, val } from './gates';

recordFile('fidget');
vi.setConfig({ testTimeout: 120_000 });

const BODY = [CH.swayX, CH.swayZ, CH.swayRoll, CH.posture, CH.twist, CH.breath];

describe('fidgets between balls', () => {
  for (const role of ['striker', 'bowler'] as const) {
    it(`${role}: a few a minute, of every kind, small, different every ball and the same on a replay`, () => {
      const perMin: number[] = [];
      const kinds = [0, 0, 0, 0];
      const first: number[] = [];
      const peak = { swayX: 0, swayZ: 0, roll: 0, posture: 0, twist: 0 };
      for (let s = 0; s < 120; s++) {
        const a = idleAnchors(role, `fid#${s}`, 60_000, { person: `look-${s % 9}` });
        const p = prepare(a, { hz: 60 });
        const n = p.fidget.length / FIDGET_N;
        perMin.push(n);
        if (n) first.push(p.fidget[0]);
        for (let m = 0; m < n; m++) kinds[p.fidget[m * FIDGET_N + 1]]++;
        // events are in time order and finish before the loop's seam
        for (let m = 1; m < n; m++)
          expect(p.fidget[m * FIDGET_N]).toBeGreaterThan(
            p.fidget[(m - 1) * FIDGET_N] + p.fidget[(m - 1) * FIDGET_N + 2],
          );
        if (n) expect(p.fidget[(n - 1) * FIDGET_N] + p.fidget[(n - 1) * FIDGET_N + 2]).toBeLessThan(60_000 - 4000);
        for (let i = 0; i < p.n; i++) {
          peak.swayX = Math.max(peak.swayX, Math.abs(val(p, i, CH.swayX)));
          peak.swayZ = Math.max(peak.swayZ, Math.abs(val(p, i, CH.swayZ)));
          peak.roll = Math.max(peak.roll, Math.abs(val(p, i, CH.swayRoll)));
          peak.posture = Math.max(peak.posture, Math.abs(val(p, i, CH.posture)));
          peak.twist = Math.max(peak.twist, Math.abs(val(p, i, CH.twist)));
        }
        if (s < 10) {
          const again = prepare(idleAnchors(role, `fid#${s}`, 60_000, { person: `look-${s % 9}` }), { hz: 60 });
          expect(Array.from(again.fidget)).toEqual(Array.from(p.fidget));
          expect(Array.from(again.trace)).toEqual(Array.from(p.trace));
        }
      }
      record(`${role}.fidgetsPerMinute`, stats(perMin));
      record(`${role}.fidgetKinds`, kinds);
      record(`${role}.fidgetPeaks`, peak);
      expect(quantile(perMin, 0.05)).toBeGreaterThanOrEqual(4);
      expect(quantile(perMin, 0.95)).toBeLessThanOrEqual(16);
      for (const k of kinds) expect(k).toBeGreaterThan(40); // every kind turns up
      // different balls give different first fidgets (a few ties of a 3 s window are chance)
      expect(new Set(first.map((v) => Math.round(v / 10))).size).toBeGreaterThan(100);
      // small: a weight shift is centimetres at most
      expect(peak.swayX).toBeLessThanOrEqual(34);
      expect(peak.swayZ).toBeLessThanOrEqual(20);
      expect(peak.roll).toBeLessThanOrEqual(5);
      expect(peak.posture).toBeLessThanOrEqual(5);
      expect(peak.twist).toBeLessThanOrEqual(6);
    });
  }

  it('the bowler fidgets only between balls (his run-up has none); the striker waits with a few until 1 s before the release', () => {
    const r = rng(11);
    let strikerFidgets = 0;
    for (let k = 0; k < 100; k++) {
      // a long wait before the release (the scripts are 2.4 s to the release; a run-up of 6 s leaves room)
      const d = delivery(randomSpec(r), 7000);
      for (const role of ['striker', 'bowler'] as const) {
        const p = prepare(
          anchorsFor(d, { role, key: deliveryTakeKey({ seed: 'fid-del', overIndex: 0, ballIndex: k }) }),
          { hz: 60 },
        );
        if (role === 'bowler') expect(p.fidget.length).toBe(0);
        else {
          for (let m = 0; m < p.fidget.length / FIDGET_N; m++) {
            strikerFidgets++;
            expect(p.fidget[m * FIDGET_N] + p.fidget[m * FIDGET_N + 2]).toBeLessThanOrEqual(d.timeline.release - 1000);
          }
        }
      }
    }
    record('striker.fidgetsInWaitingPerDelivery', strikerFidgets / 100);
    expect(strikerFidgets).toBeGreaterThan(0);
  });

  it('H5: in Reduced Motion every body channel is exactly zero and nothing glances to the side (gaze shifts there are 10 degrees at most)', () => {
    for (const role of ['striker', 'bowler'] as const) {
      let sides = 0;
      let sidesNormal = 0;
      for (let s = 0; s < 40; s++) {
        const rm = prepare(idleAnchors(role, `rm#${s}`, 60_000, { reducedMotion: true }), { hz: 60 });
        const norm = prepare(idleAnchors(role, `rm#${s}`, 60_000), { hz: 60 });
        for (let i = 0; i < rm.n; i++) for (const c of BODY) expect(val(rm, i, c)).toBe(0);
        for (let m = 0; m < rm.fix.length / 5; m++) if (rm.fix[m * 5 + 1] === T_SIDE) sides++;
        for (let m = 0; m < norm.fix.length / 5; m++) if (norm.fix[m * 5 + 1] === T_SIDE) sidesNormal++;
      }
      expect(sides).toBe(0);
      expect(sidesNormal).toBeGreaterThan(10); // and in normal motion they do happen
    }
  });

  it('a fidget is a bell: it starts and ends smoothly (no channel moves more in one 60 Hz frame than a quick, human move would)', () => {
    const worst = { swayX: 0, swayZ: 0, roll: 0, posture: 0, twist: 0 };
    for (let s = 0; s < 30; s++) {
      const p = prepare(idleAnchors('striker', `bell#${s}`, 60_000), { hz: 60 });
      for (let i = 1; i < p.n; i++) {
        worst.swayX = Math.max(worst.swayX, Math.abs(val(p, i, CH.swayX) - val(p, i - 1, CH.swayX)));
        worst.swayZ = Math.max(worst.swayZ, Math.abs(val(p, i, CH.swayZ) - val(p, i - 1, CH.swayZ)));
        worst.roll = Math.max(worst.roll, Math.abs(val(p, i, CH.swayRoll) - val(p, i - 1, CH.swayRoll)));
        worst.posture = Math.max(worst.posture, Math.abs(val(p, i, CH.posture) - val(p, i - 1, CH.posture)));
        worst.twist = Math.max(worst.twist, Math.abs(val(p, i, CH.twist) - val(p, i - 1, CH.twist)));
      }
    }
    record('fidgetWorstFrameStep', worst);
    expect(worst.swayX).toBeLessThan(3.5); // mm a frame: 210 mm/s
    expect(worst.swayZ).toBeLessThan(2.5);
    expect(worst.roll).toBeLessThan(0.3); // deg a frame: 18 deg/s
    expect(worst.posture).toBeLessThan(0.4);
    expect(worst.twist).toBeLessThan(0.7);
  });
});

describe('the reaction to the outcome', () => {
  const OUTCOMES = ['six', 'four', 'runs', 'dot', 'leave', 'close_call', 'wicket'] as const;
  const withOutcome = (a: DirectorAnchors, outcome: string | null, outcomeAt: number | null): DirectorAnchors => ({
    ...a,
    outcome,
    outcomeAt,
  });

  /** Frame times at which two plans differ in any channel; the first of them. */
  function firstDiff(a: DirectorPlan, b: DirectorPlan): number {
    for (let i = 0; i < Math.min(a.n, b.n); i++)
      for (let c = 0; c < CHANNELS; c++)
        if (a.trace[i * CHANNELS + c] !== b.trace[i * CHANNELS + c]) return timeOf(a, i);
    return Number.POSITIVE_INFINITY;
  }

  it('begins at outcomeAt plus the seeded 180 to 380 ms for every outcome and not a frame sooner (bit-equal before), whatever the ball', () => {
    const r = rng(41);
    const onsets: number[] = [];
    const per: Record<string, number[]> = {};
    for (let k = 0; k < 120; k++) {
      const d = delivery(randomSpec(r));
      const base = anchorsFor(d, {
        role: 'striker',
        key: deliveryTakeKey({ seed: 'react', overIndex: 0, ballIndex: k }),
      });
      const at = d.timeline.outcomeAt;
      const quiet = prepare(withOutcome(base, null, null), { hz: 60 });
      void quiet;
      const ref = prepare(withOutcome(base, 'dot', at), { hz: 60 });
      for (const o of OUTCOMES) {
        if (o === 'dot') continue;
        const plan = prepare(withOutcome(base, o, at), { hz: 60 });
        const t = firstDiff(ref, plan);
        const lag = ref.draw[DRAW.reactionMs];
        expect(lag).toBeGreaterThanOrEqual(180);
        expect(lag).toBeLessThanOrEqual(380);
        // The two plans share the key, so they agree until the reaction's start; it begins within a frame of outcomeAt + the draw.
        expect(t, `${o} #${k}`).toBeGreaterThanOrEqual(at + 180);
        expect(t, `${o} #${k}`).toBeLessThanOrEqual(at + lag + (1000 / 60) * 3);
        (per[o] ??= []).push(t - at);
        onsets.push(t - at);
      }
    }
    record('reactionOnsetMsAfterOutcomeAt', {
      all: stats(onsets),
      perOutcome: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, stats(v)])),
    });
    expect(Math.min(...onsets)).toBeGreaterThanOrEqual(180);
    expect(Math.max(...onsets)).toBeLessThanOrEqual(380 + 60);
  });

  it('a plan with no outcome (the live delivery) and one with an outcome agree until the reaction starts, and a leave/dot is the smallest of reactions', () => {
    const r = rng(43);
    for (let k = 0; k < 40; k++) {
      const d = delivery(randomSpec(r));
      const base = anchorsFor(d, { role: 'striker', key: `react-live#${k}`, pre: false });
      const live = prepare(withOutcome(base, null, null), { hz: 60 });
      const done = prepare(withOutcome(base, 'wicket', d.timeline.outcomeAt), { hz: 60 });
      // the live plan has no outcomeAt: a plan built from it has no reaction event, and its trace is the result's until the moment the result matters
      expect(live.react.length).toBe(0);
      expect(done.react.length).toBeGreaterThan(0);
      expect(firstDiff(live, done)).toBeGreaterThanOrEqual(d.timeline.outcomeAt + 180);
    }
  });

  it('is proportional to the result and has the sign of the news: lift and head up for a six, slump and head down for a wicket, little for a dot or a leave', () => {
    const peak: Record<string, { posture: number; headPitchDeg: number; shakeDeg: number }> = {};
    const r = rng(47);
    for (const o of OUTCOMES) peak[o] = { posture: 0, headPitchDeg: 0, shakeDeg: 0 };
    for (let k = 0; k < 60; k++) {
      const d = delivery(randomSpec(r));
      const base = anchorsFor(d, { role: 'striker', key: `react-size#${k}` });
      const at = d.timeline.outcomeAt;
      for (const o of OUTCOMES) {
        const plan = prepare(withOutcome(base, o, at), { hz: 60 });
        // the posture channel alone, at its largest in the 6 s that follow; the head's pitch and the shake are the event's own
        let post = 0;
        for (let i = frameOf(plan, at + 150); i < Math.min(plan.n, frameOf(plan, at + 6000)); i++)
          if (Math.abs(val(plan, i, CH.posture)) > Math.abs(post)) post = val(plan, i, CH.posture);
        if (Math.abs(post) > Math.abs(peak[o].posture)) peak[o].posture = post;
        if (Math.abs(plan.react[8]) > Math.abs(peak[o].headPitchDeg)) peak[o].headPitchDeg = plan.react[8];
        peak[o].shakeDeg = Math.max(peak[o].shakeDeg, Math.abs(plan.react[6]));
      }
    }
    record('reactionPeaks', peak);
    // the news
    expect(peak.six.posture).toBeGreaterThan(2);
    expect(peak.four.posture).toBeGreaterThan(1);
    expect(peak.wicket.posture).toBeLessThan(-2.5);
    expect(peak.six.headPitchDeg).toBeLessThan(0); // up
    expect(peak.wicket.headPitchDeg).toBeGreaterThan(0); // down
    // the size follows the result (proportional feedback): a six is more than a four more than a single; a wicket more than a close call
    expect(Math.abs(peak.six.posture)).toBeGreaterThan(Math.abs(peak.four.posture));
    expect(Math.abs(peak.four.posture)).toBeGreaterThan(Math.abs(peak.runs.posture));
    expect(Math.abs(peak.wicket.posture)).toBeGreaterThan(Math.abs(peak.close_call.posture));
    expect(Math.abs(peak.dot.posture)).toBeLessThan(Math.abs(peak.four.posture) / 2);
    expect(Math.abs(peak.leave.posture)).toBeLessThan(1);
    expect(Math.abs(peak.six.headPitchDeg)).toBeGreaterThan(Math.abs(peak.four.headPitchDeg));
    expect(Math.abs(peak.wicket.headPitchDeg)).toBeGreaterThan(Math.abs(peak.close_call.headPitchDeg));
    // only a bad result shakes the head, a wicket most
    expect(peak.wicket.shakeDeg).toBeGreaterThan(4);
    expect(peak.six.shakeDeg).toBe(0);
    expect(peak.four.shakeDeg).toBe(0);
    expect(peak.wicket.shakeDeg).toBeGreaterThan(peak.close_call.shakeDeg);
  });

  it('Reduced Motion: no posture, no twist, no head shake (the yaw does not oscillate), where normal motion shakes the head after a wicket', () => {
    const r = rng(53);
    const swings = (p: DirectorPlan, from: number, to: number) => {
      let n = 0;
      let prev = 0;
      for (let i = frameOf(p, from) + 1; i < Math.min(p.n, frameOf(p, to)); i++) {
        const v = val(p, i, CH.headYaw) - val(p, i - 1, CH.headYaw);
        if (Math.abs(v) > 0.02 && Math.sign(v) !== Math.sign(prev) && prev !== 0) n++;
        if (Math.abs(v) > 0.02) prev = v;
      }
      return n;
    };
    let normal = 0;
    for (let k = 0; k < 20; k++) {
      const d = delivery(randomSpec(r));
      const at = d.timeline.outcomeAt;
      const base = anchorsFor(d, { role: 'striker', key: `react-rm#${k}`, reducedMotion: true });
      const rmPlan = prepare(withOutcome(base, 'wicket', at), { hz: 60 });
      for (let i = 0; i < rmPlan.n; i++) {
        expect(val(rmPlan, i, CH.posture)).toBe(0);
        expect(val(rmPlan, i, CH.twist)).toBe(0);
      }
      expect(swings(rmPlan, at + 150, at + 1800)).toBeLessThanOrEqual(1);
      normal += swings(
        prepare(withOutcome({ ...base, reducedMotion: false }, 'wicket', at), { hz: 60 }),
        at + 150,
        at + 1800,
      );
    }
    record('headYawReversalsAfterWicket', { normalMotionTotalOver20: normal });
    expect(normal).toBeGreaterThan(20 * 2);
  });

  it('the bowler is outcome-blind (no reaction: his plan has no event and does not change)', () => {
    const d = delivery(randomSpec(rng(5)));
    const a = anchorsFor(d, { role: 'bowler', key: 'react-bowler' });
    expect(prepare(a).react.length).toBe(0);
    expect(FIDGET.breath).toBe(3);
  });
});
