import { describe, expect, it, vi } from 'vitest';
import { STUMPS_FRONT_Z, buildFlight, defaultFlightMs } from '@/render3d/core/trajectory';
import { BALL_R, CONTACT_Z, PITCH_HALF, ZONES, zoneForBearing, ZONE_BEARING, fieldSpots, BOUNDARY_R } from '@/render3d/core/ground';
import { buildTimeline, completeTimeline, locate, replayTimeline, sceneTimeOf, timelineTimeOf, resultTime, scoreAt } from '@/render3d/core/timeline';
import { STUMPS_HALF_W } from '@/physics/constants';
import { buildBallScript, buildLiveScript, sampleBall, retimeCameras, type BallScript } from '@/render3d/core/choreo';
import { defaultPlan, cueAt, planFor } from '@/render3d/core/camera';
import { evaluateActor } from '@/render3d/core/actors';
import { ALL_CLIPS, CLIPS, createPose, getClip, sampleClip } from '@/render3d/core/clips';
import { fixtureBall, fixtureDelivery, fixtureMatchLog, fixturePath, FIXTURE_PLAYERS } from '@/screens/dev/fixtures';
import { liveCast } from '@/render3d/core/session';
import type { Look } from '@/render3d/core/actors';

const cast = liveCast(FIXTURE_PLAYERS[0], FIXTURE_PLAYERS[1]);
const scriptFor = (kind: Parameters<typeof fixtureBall>[0], extra: Partial<Parameters<typeof buildBallScript>[0]> = {}): BallScript =>
  buildBallScript({ outcome: fixtureBall(kind), field: 'balanced', cast, seed: 42, ...extra });

describe('trajectory (the physics flight of a match delivery)', () => {
  it('meets the contact plane at exactly releaseToContactMs, on the engine line, at the height the pitch allows', () => {
    const path = fixturePath('good_length', 'off', 'good');
    const f = buildFlight(path, 'pace', 512);
    expect(f.contactMs).toBe(512);
    expect(f.physics.fit.converged).toBe(true);
    const p = f.at(512);
    // Hard targets to the millimetre: the plane at the validated time, and the line.
    expect(Math.abs(p.z - CONTACT_Z)).toBeLessThan(1e-3);
    expect(Math.abs(p.x - path.lineAtBatM)).toBeLessThan(1e-3);
    expect(f.atBat).toEqual(p);
    // The height is soft: the fitted bounce gets as close as the pitch's restitution allows, and the ball drawn is the
    // ball the fit reports.
    expect(Math.abs(p.y - f.physics.fit.heightAtBatM)).toBeLessThan(2e-3);
    expect(Math.abs(p.y - path.heightAtBatM)).toBeLessThan(0.15);
  });

  it('pitches at bounceAtM and travels monotonically on into the keeper’s gloves', () => {
    const path = fixturePath('good_length', 'middle', 'good');
    const f = buildFlight(path, 'pace');
    expect(f.bounce).not.toBeNull();
    expect(f.bounceMs!).toBeLessThan(f.contactMs);
    expect(Math.abs(f.at(f.bounceMs!).y - BALL_R)).toBeLessThan(2e-3);
    expect(Math.abs(f.bounce!.z - (-PITCH_HALF + path.bounceAtM))).toBeLessThan(0.02);
    let z = -Infinity;
    for (let ms = 0; ms <= f.keeperMs; ms += 5) {
      const q = f.at(ms);
      expect(q.z).toBeGreaterThanOrEqual(z - 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(BALL_R - 2e-3);
      z = q.z;
    }
    expect(f.keeperMs).toBeGreaterThan(f.stumpsMs);
    expect(f.keeper.z).toBeGreaterThan(PITCH_HALF);
  });

  it('meets a yorker on the full: it pitches under the bat, after the contact plane, so no bounce before contact', () => {
    const y = buildFlight(fixturePath('yorker', 'middle', 'full'), 'pace');
    expect(y.bounce).toBeNull();
    expect(y.bounceMs).toBeNull();
    expect(y.pitchMs!).toBeGreaterThan(y.contactMs);
    expect(y.at(y.contactMs).y).toBeLessThan(0.25);
  });

  it('swings and turns as the path says and still meets the bat on the line', () => {
    for (const v of ['inswing', 'outswing', 'offspin', 'legspin'] as const) {
      const path = fixturePath(v, 'off', 'good');
      const f = buildFlight(path, v.includes('spin') ? 'spin' : 'swing', 700);
      expect(Math.abs(f.at(700).x - path.lineAtBatM)).toBeLessThan(1e-3);
      expect(Math.abs(f.physics.fit.swingM - path.swingM)).toBeLessThan(0.02);
      expect(Math.abs(f.physics.fit.turnM - path.turnM)).toBeLessThan(0.02);
    }
    expect(defaultFlightMs(fixturePath('bouncer', 'middle', 'short'))).toBeGreaterThan(300);
  });

  it('caches the fit per path, so a live shot rebuilding its script at the tap does not fit again', () => {
    const path = fixturePath('good_length', 'off', 'good');
    expect(buildFlight(path, 'pace', 600)).toBe(buildFlight(path, 'pace', 600));
    expect(buildFlight(path, 'pace', 600)).not.toBe(buildFlight(path, 'pace', 601));
  });
});

describe('ground', () => {
  it('quantises bearings to the nearest zone and back', () => {
    for (const z of ZONES) expect(zoneForBearing(ZONE_BEARING[z])).toBe(z);
    expect(zoneForBearing(0)).toMatch(/mid_(on|off)/);
  });
  it('places every fielder inside the rope for every field', () => {
    for (const f of ['attacking', 'balanced', 'sweeper'] as const) {
      const spots = fieldSpots(f);
      expect(spots).toHaveLength(9);
      for (const s of spots) expect(Math.hypot(s.pos.x, s.pos.z)).toBeLessThan(BOUNDARY_R);
    }
  });
});

describe('timeline', () => {
  const log = fixtureMatchLog();

  it('orders a full replay: intro, innings, every ball, break, result', () => {
    const tl = buildTimeline(log, 'full');
    const kinds = tl.segments.map((s) => s.kind);
    expect(kinds[0]).toBe('intro');
    expect(kinds[kinds.length - 1]).toBe('result');
    expect(kinds.filter((k) => k === 'ball')).toHaveLength(log.innings[0].balls.length + log.innings[1].balls.length);
    expect(kinds).toContain('innings_end');
    let t = 0;
    for (const s of tl.segments) {
      expect(s.t0).toBe(t);
      expect(s.dur).toBeGreaterThan(0);
      t += s.dur;
    }
    expect(tl.duration).toBe(t);
  });

  it('cuts Key Moments to key balls and Result Only to intro plus result', () => {
    const full = buildTimeline(log, 'full');
    const key = buildTimeline(log, 'key_moments');
    expect(key.duration).toBeLessThan(full.duration);
    for (const i of key.balls) expect(key.segments[i].key).toBe(true);
    const ro = buildTimeline(log, 'result_only');
    expect(ro.segments.map((s) => s.kind)).toEqual(['intro', 'result']);
    expect(resultTime(full)).toBe(full.segments[full.segments.length - 1].t0);
  });

  it('locates times on segment boundaries and keeps the slow-motion warp invertible', () => {
    const tl = buildTimeline(log, 'full');
    for (const s of tl.segments) {
      expect(locate(tl, s.t0).seg).toBe(s);
      expect(locate(tl, s.t0 + s.dur - 1).seg).toBe(s);
    }
    const slow = tl.segments.find((s) => s.slow);
    expect(slow).toBeTruthy();
    if (!slow?.slow) return;
    // Slow motion lengthens the segment by (window)(1/rate - 1).
    const natural = slow.sceneEnd - slow.sceneStart;
    expect(slow.dur).toBe(Math.round(natural + (slow.slow.t1 - slow.slow.t0) * (1 / slow.slow.rate - 1)));
    let prev = -Infinity;
    for (let l = 0; l <= slow.dur; l += 37) {
      const scene = sceneTimeOf(slow, l);
      expect(scene).toBeGreaterThanOrEqual(prev);
      prev = scene;
      expect(timelineTimeOf(slow, scene)).toBeCloseTo(slow.t0 + l, 0);
    }
  });

  it('builds the reveal progressively: the first frame waits for the first ball only, and every answer is exact', () => {
    const full = buildTimeline(log, 'full');
    const lazy = buildTimeline(log, 'full', { progressive: true });
    const balls = lazy.balls.length;
    expect(balls).toBeGreaterThan(3);
    expect(full.pending).toBe(0);
    expect(lazy.pending).toBe(balls - 1);
    // The opening moments need nothing more.
    locate(lazy, 0);
    scoreAt(lazy, 10);
    expect(lazy.pending).toBe(balls - 1);
    // A later moment builds what comes before it, and gets the answer the complete timeline gives.
    const mid = full.segments[full.balls[3]].t0 + 700;
    const a = locate(lazy, mid);
    const b = locate(full, mid);
    expect([a.index, a.local, a.scene, a.slow]).toEqual([b.index, b.local, b.scene, b.slow]);
    expect(lazy.pending).toBeGreaterThan(0);
    expect(lazy.pending).toBeLessThan(balls - 1);
    // A pending ball's script builds on first use (and everything before it), in order.
    const lastBall = lazy.segments[lazy.balls[balls - 1]];
    expect(lastBall.script.times.contact).toBeGreaterThan(0);
    expect(lazy.pending).toBe(0);
    // Complete, it is exactly the eager layout.
    const layout = (tl: typeof full) => tl.segments.map((x) => [x.kind, x.t0, x.dur, x.sceneStart, x.sceneEnd, x.slow]);
    expect(layout(lazy)).toEqual(layout(full));
    expect(lazy.duration).toBe(full.duration);
    expect(resultTime(lazy)).toBe(resultTime(full));
    expect(completeTimeline(lazy)).toBe(false);
  });

  it('shares one progressive timeline per log and mode, and finishes it in idle time', async () => {
    const own = fixtureMatchLog();
    const tl = replayTimeline(own, 'full');
    expect(replayTimeline(own, 'full')).toBe(tl);
    expect(replayTimeline(own, 'key_moments')).not.toBe(tl);
    expect(tl.pending).toBeGreaterThan(0);
    const version = tl.version;
    await vi.waitFor(() => expect(tl.pending).toBe(0), { timeout: 15_000, interval: 20 });
    expect(tl.version).toBeGreaterThan(version);
    const eager = buildTimeline(own, 'full');
    expect(tl.duration).toBe(eager.duration);
  });

  it('switches the score bug to the new score only at the decisive moment', () => {
    const tl = buildTimeline(log, 'full');
    const four = tl.segments.find((s) => s.outcome?.runs === 4)!;
    const before = scoreAt(tl, four.t0 + 10).score!;
    const after = scoreAt(tl, four.t0 + four.dur - 10).score!;
    expect(after.runs - before.runs).toBe(4);
  });
});

describe('choreography', () => {
  it('sequences release, bounce and contact, and resolves every fate', () => {
    for (const k of ['six', 'four', 'bowled', 'caught', 'lbw', 'block', 'beaten', 'runs', 'fielded', 'runout', 'stumped'] as const) {
      const s = scriptFor(k);
      const kinds = s.events.map((e) => e.kind);
      expect(s.times.release).toBeGreaterThan(0);
      expect(s.times.bounce).toBeGreaterThan(s.times.release);
      // A ball met on the full (the bowled yorker) has no bounce before contact: no bounce event, bounce = contact.
      if (kinds.includes('bounce')) expect(s.times.contact).toBeGreaterThan(s.times.bounce);
      else expect(s.times.bounce).toBe(s.times.contact);
      expect(s.times.decisive).toBeGreaterThanOrEqual(s.times.contact);
      expect(s.duration).toBeGreaterThan(s.times.decisive);
      // Only physics paths move the ball.
      for (const seg of s.ball) expect(['hand', 'path', 'gone']).toContain(seg.k);
      if (k === 'bowled') expect(kinds).toContain('stumps');
      if (k === 'six') expect(kinds).toContain('six');
      if (k === 'four') expect(kinds).toContain('boundary');
      if (k === 'caught') expect(kinds).toContain('catch');
      if (k === 'bowled') expect(s.stumps.striker?.t).toBeCloseTo(s.times.decisive, 0);
      if (k === 'runout') expect(s.stumps.nonStriker).toBeTruthy();
      // Every actor is covered until the end.
      for (const a of s.actors) expect(a.moves[a.moves.length - 1].t1).toBeGreaterThanOrEqual(s.duration);
    }
  });

  it('puts the ball where the outcome says, through the physics, at the moment the choreography marks', () => {
    const at = (s: BallScript, t: number) => sampleBall(s, t).pos;
    const ev = (s: BallScript, kind: string) => s.events.find((e) => e.kind === kind)!;
    // A four crosses the rope as the boundary sounds.
    const four = scriptFor('four');
    const rope = at(four, ev(four, 'boundary').t);
    expect(Math.abs(Math.hypot(rope.x, rope.z) - BOUNDARY_R)).toBeLessThan(0.05);
    // A six comes down in the stands beyond the rope.
    const six = scriptFor('six');
    const seat = at(six, ev(six, 'six').t);
    expect(Math.hypot(seat.x, seat.z)).toBeGreaterThan(BOUNDARY_R + 4);
    expect(seat.y).toBeGreaterThan(0.4);
    // Bowled: the ball meets the front of the stumps, between them, when they break.
    const bowled = scriptFor('bowled');
    const hit = at(bowled, ev(bowled, 'stumps').t);
    expect(Math.abs(hit.z - STUMPS_FRONT_Z)).toBeLessThan(0.01);
    expect(Math.abs(hit.x)).toBeLessThan(STUMPS_HALF_W + BALL_R);
    // Caught: in the catcher's hands at the catch.
    const caught = scriptFor('caught');
    const c = ev(caught, 'catch');
    const hands = at(caught, c.t - 1);
    expect(Math.hypot(hands.x - c.at!.x, hands.z - c.at!.z)).toBeLessThan(0.3);
    // Run out: the throw hits the bowler's stumps.
    const ro = scriptFor('runout');
    const st = ev(ro, 'stumps');
    const p = at(ro, st.t);
    expect(Math.hypot(p.x - st.at!.x, p.y - st.at!.y, p.z - st.at!.z)).toBeLessThan(0.05);
    // Fielded: the ball reaches the fielder's spot when it is fielded.
    const fielded = scriptFor('fielded');
    const f = ev(fielded, 'fielded');
    const q = at(fielded, f.t - 1);
    expect(Math.hypot(q.x - f.at!.x, q.z - f.at!.z)).toBeLessThan(0.6);
  });

  it('aligns release and contact with the engine timeline when given', () => {
    const outcome = fixtureBall('four');
    const s = buildBallScript({ outcome, field: 'balanced', cast, seed: 1, engineTimeline: { releaseAtMs: 2200, contactAtMs: 2700, endMs: 7000 } });
    expect(s.times.release).toBeCloseTo(2200, 0);
    expect(s.times.contact).toBeCloseTo(2700, 0);
  });

  it('re-times engine camera cues onto the animation (release and contact anchors unchanged)', () => {
    const times = { runStart: 0, release: 2000, bounce: 2300, contact: 2500, decisive: 4000, shotEnd: 3000, celebrate: null, end: 7000 };
    const cues = retimeCameras(
      [
        { shot: 'bowler_follow', atMs: 0, durationMs: 1750 },
        { shot: 'broadcast_end', atMs: 1750, durationMs: 950 },
        { shot: 'crowd', atMs: 2700, durationMs: 1800 },
      ],
      { releaseAtMs: 2000, contactAtMs: 2500, endMs: 4500 },
      times,
      false,
    );
    expect(cues[1].atMs).toBe(1750);
    expect(cues[2].atMs + cues[2].durationMs).toBe(7000);
  });

  it('keeps live balls sealed: nothing after the seal can hint at runs or wickets', () => {
    const delivery = fixtureDelivery(0, 'good_length');
    for (const contact of ['middle', 'thick_edge', 'miss', 'pad', 'none'] as const) {
      const s = buildLiveScript({ delivery, field: 'balanced', cast, seed: 7, shot: { shot: contact === 'none' ? 'leave' : 'drive', timing: 'good', contact, zone: 'cover', tapMs: delivery.timing.releaseToContactMs } });
      expect(s.sealAt).toBeGreaterThan(s.times.contact);
      expect(s.stumps.striker).toBeNull();
      const kinds = s.events.map((e) => e.kind);
      for (const forbidden of ['boundary', 'six', 'stumps', 'bails', 'catch', 'appeal', 'signal', 'fireworks'] as const) expect(kinds).not.toContain(forbidden);
      expect(sampleBall(s, s.sealAt! + 1).visible).toBe(false);
      expect(s.overlay.some((o) => o.kind === 'sealed')).toBe(true);
    }
  });
});

describe('camera plans', () => {
  it('covers every scene millisecond with a shot and honours reduced motion', () => {
    for (const k of ['six', 'bowled', 'caught', 'runs', 'block'] as const) {
      const s = scriptFor(k);
      const plan = defaultPlan(s, false);
      expect(plan[0].atMs).toBe(0);
      for (let i = 1; i < plan.length; i++) expect(plan[i].atMs).toBe(plan[i - 1].atMs + plan[i - 1].durationMs);
      for (let t = 0; t < s.duration; t += 250) expect(cueAt(plan, t)).not.toBeNull();
      const reduced = planFor({ ...s, cameras: [{ shot: 'aerial', atMs: 0, durationMs: s.duration }] }, true);
      expect(reduced[0].shot).toBe('broadcast_end');
    }
  });
});

describe('animation clips', () => {
  it('compiles every clip with ordered keys, markers inside the clip and unit quaternions', () => {
    const pose = createPose();
    for (const id of ALL_CLIPS) {
      const def = CLIPS[id] as { duration: number; keys: Array<{ t: number }>; markers?: Record<string, number> };
      expect(def.duration).toBeGreaterThan(0);
      for (let i = 1; i < def.keys.length; i++) expect(def.keys[i].t).toBeGreaterThanOrEqual(def.keys[i - 1].t);
      for (const m of Object.values(def.markers ?? {})) expect(m).toBeLessThanOrEqual(def.duration);
      getClip(id);
      for (let t = 0; t <= def.duration; t += def.duration / 7) {
        sampleClip(id, t, pose);
        for (let b = 0; b < pose.q.length; b += 4) expect(Math.hypot(pose.q[b], pose.q[b + 1], pose.q[b + 2], pose.q[b + 3])).toBeCloseTo(1, 4);
      }
    }
  });
});

describe('determinism', () => {
  it('evaluates actors, ball and poses identically regardless of evaluation order', () => {
    const s = scriptFor('six');
    const times = Array.from({ length: 40 }, (_, i) => (i * 997) % s.duration);
    const snap = (t: number) => {
      const actors = s.actors.map((a) => {
        const st = evaluateActor(a, t);
        const pose = sampleClip(st.current.clip, st.current.time, createPose());
        return [st.pos.x, st.pos.z, st.heading, ...Array.from(pose.q)];
      });
      const b = sampleBall(s, t);
      return JSON.stringify([actors, b.pos, b.visible]);
    };
    const forward = times.map(snap);
    const backward = [...times].reverse().map(snap).reverse();
    expect(backward).toEqual(forward);
  });

  it('builds identical scripts for the same outcome and seed', () => {
    const a = scriptFor('caught');
    const b = scriptFor('caught');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const looks: Look[] = a.actors.map((x) => x.look);
    expect(looks.length).toBeGreaterThan(10);
  });
});
