/**
 * Practice fielders on real physics fielding (src/physics/fielding.ts, read-only): the presentation choreography
 * (src/render3d/practice/fielding.ts) must keep every fielder exactly on its FielderPath, land each clip's marker on
 * the physics event it shows, and never "run on the spot", spin, or stand frozen through a fumble.
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryResult, FieldLayout, FielderPath, SimEvent } from '@/contracts/practice';
import { evaluateActor, type ActorTrack } from '@/render3d/core/actors';
import { clipMarker, type ClipId } from '@/render3d/core/clips';
import { angleDelta } from '@/render3d/core/math';
import { CHASE_SPEED_SHARE, DIVE_BODY_MAX_M, DIVE_HAND_REACH_M, chasedBall, fieldingMoves } from '@/render3d/practice/fielding';
import { ballAt, ballVelocityAt, simToScene, toWorld } from '@/render3d/practice/frame';
import { buildPracticeScript, WALK_IN } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { simulate } from '@/physics/ball';
import { autoField } from '@/physics/field';
import { ATHLETICS, fielderClass, keeperTake, simulateFielding, type FieldingResult, type PostContactBall } from '@/physics/fielding';
import { CONTACT_Z, PITCH_HALF } from '@/physics/geometry';
import { fixtureFlight, fixtureResult } from './practiceFixtures';

const DEG = Math.PI / 180;
const REL = 2000;
const bowler = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'b1' } as const;
const field: FieldLayout = autoField(bowler, 'balanced');

interface Case {
  key: string;
  post: PostContactBall;
  fielding: FieldingResult;
}

/** A struck ball from the crease (bearing from the striker, + off side), fielded by the physics. */
function hit(bearingDeg: number, speed: number, elevDeg: number, seed: string): Case {
  const a = bearingDeg * DEG;
  const e = elevDeg * DEG;
  const v = { x: Math.sin(a) * Math.cos(e) * speed, y: Math.sin(e) * speed, z: -Math.cos(a) * Math.cos(e) * speed };
  const sim = simulate({ t: 0.5, p: { x: 0.2, y: 0.6, z: CONTACT_Z }, v, spinRps: 0 });
  const post: PostContactBall = { t0: 0.5, samples: sim.samples, bounces: sim.bounces.map((b) => ({ t: b.t, p: b.p })), boundary: sim.boundary };
  const fielding = simulateFielding(field, post, { seed });
  const p = fielding.play;
  const key = p.kind === 'fielded' ? `${p.how}${p.dive ? '+dive' : ''}` : `${p.kind}${p.kind === 'caught' && p.dive ? '+dive' : ''}`;
  return { key, post, fielding };
}

/** A bounded scan for real examples of every way the physics fields a ball (at most 3 each). */
const CASES: Case[] = (() => {
  const byKey = new Map<string, Case[]>();
  for (const seed of ['a', 'b', 'c', 'd'])
    for (const elev of [-3, 6, 16])
      for (const speed of [10, 18, 26, 34])
        for (let b = -170; b <= 170; b += 20) {
          const c = hit(b, speed, elev, `${seed}${b}${speed}${elev}`);
          const list = byKey.get(c.key) ?? [];
          if (list.length < 3) list.push(c);
          byKey.set(c.key, list);
        }
  return [...byKey.values()].flat();
})();

const primaryOf = (c: Case) => (c.fielding.play.kind === 'boundary' ? null : c.fielding.play.fielderId);

/** The physics position of a path at t (linear between samples, as the path is defined). */
function physicsAt(path: FielderPath, t: number, mirror: boolean) {
  const s = path.samples;
  if (t <= s[0].t) return toWorld({ x: s[0].x, y: 0, z: s[0].z }, mirror);
  for (let i = 0; i + 1 < s.length; i++) {
    if (t < s[i + 1].t) {
      const u = (t - s[i].t) / (s[i + 1].t - s[i].t);
      return toWorld({ x: s[i].x + (s[i + 1].x - s[i].x) * u, y: 0, z: s[i].z + (s[i + 1].z - s[i].z) * u }, mirror);
    }
  }
  const l = s[s.length - 1];
  return toWorld({ x: l.x, y: 0, z: l.z }, mirror);
}

function trackFor(c: Case, path: FielderPath, mirror: boolean): ActorTrack {
  const ball = c.fielding.ball;
  const f = field.fielders.find((x) => x.id === path.fielderId)!;
  const moves = fieldingMoves(path, mirror, REL, {
    ball: (t) => {
      const p = ballAt(ball, t);
      return p ? toWorld(p, mirror) : null;
    },
    ballVelocity: (t) => {
      const v = ballVelocityAt(ball, t);
      return v ? toWorld(v, mirror) : null;
    },
    keeper: f.role === 'keeper',
    striker: toWorld({ x: 0, y: 0, z: CONTACT_Z }, mirror),
  });
  return { id: path.fielderId, role: 'fielder', look: { seed: 'x', team: 1, gear: 'fielder' }, start: physicsAt(path, 0, mirror), heading: 0, moves };
}

const sceneOf = (t: number) => simToScene({ releaseScene: REL }, t);
const clipAt = (track: ActorTrack, t: number) => evaluateActor(track, sceneOf(t)).current;

describe('fielders on real physics fielding', () => {
  it('finds every way the physics fields a ball', () => {
    const keys = new Set(CASES.map((c) => c.key));
    for (const k of ['stop', 'dive_stop+dive', 'misfield', 'caught', 'boundary']) expect(keys.has(k), k).toBe(true);
    expect(keys.size).toBeGreaterThanOrEqual(7);
  });

  it('draws every fielder exactly on its physics path, at every instant, for both hands', () => {
    for (const c of CASES)
      for (const mirror of [false, true])
        for (const path of c.fielding.paths) {
          const before = JSON.stringify(path);
          const track = trackFor(c, path, mirror);
          expect(JSON.stringify(path)).toBe(before);
          const end = path.samples[path.samples.length - 1].t;
          for (let t = path.samples[0].t; t <= end; t += 0.005) {
            const drawn = evaluateActor(track, sceneOf(t)).pos;
            const phys = physicsAt(path, t, mirror);
            expect(Math.abs(drawn.x - phys.x) + Math.abs(drawn.z - phys.z), `${c.key} ${path.fielderId} t=${t.toFixed(3)}`).toBeLessThan(1e-6);
          }
        }
  });

  it('lands each clip on its physics event: the throw release, the gather, the catch and the dive reach', () => {
    let throws = 0;
    let gathers = 0;
    let dives = 0;
    let catches = 0;
    for (const c of CASES) {
      const id = primaryOf(c);
      if (!id) continue;
      const path = c.fielding.paths.find((p) => p.fielderId === id)!;
      const track = trackFor(c, path, false);
      const s = path.samples;
      for (let i = 0; i < s.length; i++) {
        const prev = s[i - 1]?.action;
        if (s[i].action === prev) continue;
        const st = clipAt(track, s[i].t);
        if (s[i].action === 'throw') {
          const ev = c.fielding.events.find((e): e is Extract<SimEvent, { kind: 'throw' }> => e.kind === 'throw')!;
          expect(ev.t).toBe(s[i].t);
          expect(st.clip, `${c.key} ${id} throw at ${s[i].t}`).toBe('field_throw');
          expect(st.time).toBeCloseTo(clipMarker('field_throw', 'release'), 3);
          throws++;
        } else if (s[i].action === 'pickup' && prev === 'run') {
          expect(st.clip, `${c.key} ${id} gather at ${s[i].t}`).toBe('field_pickup');
          expect(st.time).toBeCloseTo(clipMarker('field_pickup', 'collect'), 3);
          gathers++;
        } else if (s[i].action === 'catch' && prev !== 'dive') {
          expect(['catch_chest', 'catch_high']).toContain(st.clip);
          expect(st.time).toBeCloseTo(clipMarker(st.clip, 'catch'), 3);
          catches++;
        } else if (prev === 'dive') {
          expect(st.clip).toMatch(/^(field|keep)_dive_[rl]$/);
          expect(st.time).toBeCloseTo(clipMarker(st.clip as ClipId, 'reach'), 3);
          dives++;
        }
      }
    }
    expect(throws).toBeGreaterThan(5);
    expect(gathers).toBeGreaterThanOrEqual(3);
    expect(dives).toBeGreaterThan(3);
    expect(catches).toBeGreaterThan(0);
  });

  it('never runs on the spot, turns within a human rate, and shows a fumble instead of a frozen stand', () => {
    for (const c of CASES)
      for (const path of c.fielding.paths) {
        const track = trackFor(c, path, false);
        let prevHeading: number | null = null;
        for (const m of track.moves) {
          const d = Math.hypot(m.to!.x - m.from!.x, m.to!.z - m.from!.z);
          const speed = d / ((m.t1 - m.t0) / 1000);
          if (m.clip === 'run' || m.clip === 'run_drive' || m.lower === 'run') expect(speed, `${c.key} ${path.fielderId} ${m.clip}`).toBeGreaterThan(0.3);
          if (prevHeading !== null) expect(Math.abs(angleDelta(prevHeading, m.heading!))).toBeLessThan(1e-9);
          const rate = Math.abs(angleDelta(m.heading!, m.headingTo!)) / ((m.t1 - m.t0) / 1000);
          expect(rate).toBeLessThanOrEqual(14 + 1e-6);
          prevHeading = m.headingTo!;
        }
        // Between the fumble or drop and the gather, the body keeps moving: no pose held still for more than 0.6 s.
        if (path.fielderId !== primaryOf(c) || c.fielding.play.kind !== 'fielded') continue;
        const play = c.fielding.play;
        if (play.how !== 'misfield' && play.how !== 'dropped' && play.how !== 'parried') continue;
        let still = 0;
        let worst = 0;
        let last = '';
        for (let t = play.t; t < play.releaseT; t += 0.02) {
          const st = clipAt(track, t);
          const key = `${st.clip}:${Math.min(st.time, 99).toFixed(3)}`;
          const clamped = key === last;
          still = clamped ? still + 0.02 : 0;
          worst = Math.max(worst, still);
          last = key;
        }
        expect(worst, `${c.key}: longest still pose between the ${play.how} and the throw`).toBeLessThanOrEqual(0.6);
        expect(clipAt(track, play.t + 0.3).clip).toMatch(/fumble|spill|dive/);
      }
  });

  it('a dive extends the drawn body towards the ball only while diving, and no further than DIVE_BODY_MAX_M', () => {
    let checked = 0;
    for (const c of CASES) {
      for (const path of c.fielding.paths) {
        const track = trackFor(c, path, false);
        for (const m of track.moves) {
          const diving = /dive/.test(m.clip);
          for (const b of [m.bodyFrom, m.bodyTo]) {
            if (!b) continue;
            expect(diving || Math.hypot(b.x, b.z) < 1e-9).toBe(true);
            expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(DIVE_BODY_MAX_M + 1e-9);
          }
        }
        // At the reach the hands (hips + DIVE_HAND_REACH_M along the dive) meet the physics ball, within the cap.
        const s = path.samples;
        const k = s.findIndex((x, i) => i > 0 && s[i - 1].action === 'dive' && x.action !== 'dive');
        if (k < 0) continue;
        const st = evaluateActor(track, sceneOf(s[k].t));
        const hips = { x: st.pos.x + (st.body?.x ?? 0), z: st.pos.z + (st.body?.z ?? 0) };
        const ball = ballAt(c.fielding.ball, s[k].t)!;
        const gap = Math.hypot(ball.x - hips.x, ball.z - hips.z);
        const phys = Math.hypot(ball.x - st.pos.x, ball.z - st.pos.z);
        if (phys - DIVE_HAND_REACH_M <= DIVE_BODY_MAX_M && phys - DIVE_HAND_REACH_M >= -0.5) {
          expect(Math.abs(gap - DIVE_HAND_REACH_M), `${c.key} ${path.fielderId}`).toBeLessThan(0.02);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('the keeper takes a missed ball square to the bowler, diving to the side the ball passes', () => {
    for (const lateral of [-2.2, -0.9, 0, 1.1, 2.4]) {
      const keeper = field.fielders.find((f) => f.role === 'keeper')!;
      const samples = Array.from({ length: 80 }, (_, i) => ({ t: 0.45 + i * 0.005, p: { x: keeper.x + lateral, y: 0.7, z: PITCH_HALF + i * 0.2 }, v: { x: 0, y: 0, z: 40 } }));
      const take = keeperTake(field, samples, 0)!;
      const c: Case = { key: 'keeper', post: { t0: 0, samples, bounces: [], boundary: null }, fielding: { ball: samples, paths: [take.path] } as unknown as FieldingResult };
      const track = trackFor(c, take.path, false);
      const at = clipAt(track, take.t);
      expect(at.clip).toMatch(take.dive ? (lateral > 0 ? /^keep_dive_r$/ : /^keep_dive_l$/) : /^keep_(take|crouch|shuffle)$/);
      expect(Math.abs(angleDelta(evaluateActor(track, sceneOf(take.t)).heading, Math.PI))).toBeLessThan(1e-6);
      if (!take.dive) expect(at.time).toBeCloseTo(clipMarker('keep_take', 'catch'), 3);
    }
  });
});

describe('the field walks in with the bowler and reacts after the ball', () => {
  const setup: PracticeSceneSetup = { field, bowler, conditions: 'balanced', handedness: 'right' };

  /** A DeliveryResult whose fielding is the physics' own (the delivery and the bat from the test fixture). */
  function resultFrom(c: Case): DeliveryResult {
    const flight = fixtureFlight({ lengthM: 6, lineM: 0.1 });
    const base = fixtureResult(flight, { kind: 'drive', timingMs: 0, bearing: 30 });
    const pre = base.ball.filter((s) => s.t < c.post.t0);
    const p = c.fielding.play;
    const events = [...base.events.filter((e) => e.kind === 'release' || e.kind === 'bounce' || e.kind === 'contact'), ...c.fielding.events, { t: c.fielding.deadT, kind: 'dead' as const }];
    return {
      ...base,
      ball: [...pre, ...c.fielding.ball],
      fielders: c.fielding.paths,
      events: events.sort((a, b) => a.t - b.t),
      outcome: { ...base.outcome, runs: p.kind === 'boundary' ? p.runs : 0, boundary: p.kind === 'boundary' ? p.runs : null, dismissal: p.kind === 'caught' ? 'caught' : null, fielderId: p.kind === 'boundary' ? null : p.fielderId },
      deadT: c.fielding.deadT,
    };
  }

  it('every walking fielder is set at his physics position before the release, and stood further back between balls', () => {
    const c = CASES.find((x) => x.key === 'stop')!;
    const result = resultFrom(c);
    const script = buildPracticeScript({ setup, flight: result.flight, result });
    const rel = script.practice!.releaseScene;
    const idle = buildPracticeScript({ setup, flight: null });
    let walkers = 0;
    for (const f of field.fielders) {
      if (f.role === 'bowler') continue;
      const id = f.role === 'keeper' ? 'keeper' : `fielder:${f.id}`;
      const track = script.actors.find((a) => a.id === id)!;
      const set = evaluateActor(track, rel - WALK_IN.settleMs + 1);
      expect(set.pos.x).toBeCloseTo(f.x, 9);
      expect(set.pos.z).toBeCloseTo(f.z, 9);
      expect(evaluateActor(track, rel).pos.x).toBeCloseTo(f.x, 9);
      const early = evaluateActor(track, 1).pos;
      const back = Math.hypot(early.x - f.x, early.z - f.z);
      const between = evaluateActor(idle.actors.find((a) => a.id === id)!, 5000).pos;
      expect(Math.hypot(between.x - early.x, between.z - early.z)).toBeLessThan(1e-9);
      if (back > 0) {
        walkers++;
        expect(back).toBeGreaterThanOrEqual(0.5);
        expect(back).toBeLessThanOrEqual(WALK_IN.deepM + 1e-9);
        // Further from the striker: he walks in towards him.
        expect(Math.hypot(early.x, early.z - CONTACT_Z)).toBeGreaterThan(Math.hypot(f.x, f.z - CONTACT_Z));
      }
    }
    expect(walkers).toBeGreaterThanOrEqual(6);
    // The keeper is crouched at the release (never the fielders' ready pose).
    expect(evaluateActor(script.actors.find((a) => a.id === 'keeper')!, rel).current.clip).toBe('keep_crouch');
  });

  it('reactions start only after the event that earns them, on the spot', () => {
    for (const key of ['caught', 'boundary']) {
      const c = CASES.find((x) => x.key === key);
      if (!c) continue;
      const result = resultFrom(c);
      const script = buildPracticeScript({ setup, flight: result.flight, result });
      const rel = script.practice!.releaseScene;
      const eventT = key === 'caught' ? result.events.find((e) => e.kind === 'catch')!.t : result.events.find((e) => e.kind === 'boundary')!.t;
      const reaction = key === 'caught' ? /clap|celebrate_jump/ : /hands_on_hips/;
      let reacting = 0;
      for (const track of script.actors.filter((a) => a.id.startsWith('fielder:'))) {
        const id = track.id.slice('fielder:'.length);
        if (id === result.outcome.fielderId) continue;
        for (const m of track.moves) {
          if (!reaction.test(m.clip)) continue;
          expect(m.t0).toBeGreaterThan(simToScene({ releaseScene: rel }, eventT));
          expect(Math.hypot(m.to!.x - m.from!.x, m.to!.z - m.from!.z)).toBeLessThan(1e-9);
          reacting++;
          break;
        }
      }
      expect(reacting, key).toBeGreaterThan(0);
    }
  });
});

describe('FIELD follow-up: reactions only for the chase, and short dives timed to the physics take-off', () => {
  const setup: PracticeSceneSetup = { field, bowler, conditions: 'balanced', handedness: 'right' };
  /** The fastest the path moves over any window of at least 0.2 s (m/s). */
  const peakSpeed = (path: FielderPath) => {
    const s = path.samples;
    let peak = 0;
    for (let i = 0, j = 0; i < s.length; i++) {
      while (j < s.length && s[j].t - s[i].t < 0.2 - 1e-9) j++;
      if (j >= s.length) break;
      peak = Math.max(peak, Math.hypot(s[j].x - s[i].x, s[j].z - s[i].z) / (s[j].t - s[i].t));
    }
    return peak;
  };

  it('after a boundary only the fielders who chased the ball put their hands on their hips', () => {
    const boundaries: Case[] = [];
    for (const seed of ['e', 'f'])
      for (const speed of [26, 32, 38])
        for (let b = -170; b <= 170; b += 10) {
          const c = hit(b, speed, 4, `${seed}${b}${speed}`);
          if (c.fielding.play.kind === 'boundary') boundaries.push(c);
        }
    expect(boundaries.length).toBeGreaterThan(10);
    let reacted = 0;
    let fewerThanBefore = 0;
    for (const c of boundaries) {
      const flight = fixtureFlight({ lengthM: 6, lineM: 0.1 });
      const base = fixtureResult(flight, { kind: 'drive', timingMs: 0, bearing: 30 });
      const pre = base.ball.filter((x) => x.t < c.post.t0);
      const p = c.fielding.play as Extract<FieldingResult['play'], { kind: 'boundary' }>;
      const events = [...base.events.filter((e) => e.kind === 'release' || e.kind === 'bounce' || e.kind === 'contact'), ...c.fielding.events, { t: c.fielding.deadT, kind: 'dead' as const }];
      const result: DeliveryResult = { ...base, ball: [...pre, ...c.fielding.ball], fielders: c.fielding.paths, events: events.sort((a, b) => a.t - b.t), outcome: { ...base.outcome, runs: p.runs, boundary: p.runs, dismissal: null, fielderId: null }, deadT: c.fielding.deadT };
      const script = buildPracticeScript({ setup, flight: result.flight, result });
      const hips = new Set<string>();
      for (const track of script.actors) for (const m of track.moves) if (m.clip === 'hands_on_hips') hips.add(track.id.replace(/^fielder:/, ''));
      for (const f of field.fielders) {
        const path = c.fielding.paths.find((x) => x.fielderId === f.id)!;
        const chased = chasedBall(path, f, p.p, p.t);
        expect(hips.has(f.id), `${f.id} chased ${chased}`).toBe(chased);
        if (!hips.has(f.id)) continue;
        // A chaser ran harder than anyone closing in may (0.6 of his top speed in the physics) and is never the keeper or bowler.
        expect(peakSpeed(path)).toBeGreaterThan(CHASE_SPEED_SHARE * ATHLETICS[fielderClass(f)].topSpeed);
        expect(f.role === 'keeper' || f.role === 'bowler').toBe(false);
      }
      if (hips.size > 0) reacted++;
      expect(hips.size).toBeLessThanOrEqual(4);
      const before = c.fielding.paths.filter((x) => x.samples.some((q) => q.action === 'run')).length;
      if (hips.size < before) fewerThanBefore++;
    }
    expect(reacted).toBeGreaterThan(boundaries.length / 2);
    expect(fewerThanBefore).toBe(boundaries.length);
  });

  it('a dive shorter than its clip\'s launch starts at the physics take-off, never during the run, with the hands out at the reach', () => {
    let short = 0;
    const check = (path: FielderPath, track: ActorTrack) => {
      const s = path.samples;
      for (let i = 0; i + 1 < s.length; i++) {
        if (s[i].action !== 'dive') continue;
        const takeoff = s[i].t;
        const reach = s[i + 1].t;
        const at = clipAt(track, reach);
        expect(at.clip).toMatch(/^(field|keep)_dive_[rl]$/);
        const marker = clipMarker(at.clip as ClipId, 'reach');
        expect(at.time).toBeCloseTo(marker, 3);
        if (reach - takeoff >= marker - 1e-6) continue;
        short++;
        // The launch begins exactly at the take-off: no dive pose before it, the clip at its start just after it.
        expect(clipAt(track, takeoff - 0.004).clip).not.toMatch(/dive/);
        const just = clipAt(track, takeoff + 0.0005);
        expect(just.clip).toBe(at.clip);
        expect(just.time).toBeLessThan(marker * 0.5);
      }
    };
    // The keeper reading a missed ball late dives quicker than his clip's 0.15 s launch.
    const keeper = field.fielders.find((f) => f.role === 'keeper')!;
    for (const lateral of [1.4, 2, 2.6])
      for (const watch of [0.5, 0.55]) {
        const samples = Array.from({ length: 120 }, (_, i) => ({ t: 0.45 + i * 0.005, p: { x: keeper.x + lateral, y: 0.7, z: PITCH_HALF + i * 0.2 }, v: { x: 0, y: 0, z: 40 } }));
        const take = keeperTake(field, samples, watch)!;
        const c: Case = { key: 'keeper', post: { t0: 0, samples, bounces: [], boundary: null }, fielding: { ball: samples, paths: [take.path] } as unknown as FieldingResult };
        check(take.path, trackFor(c, take.path, false));
      }
    // And every dive the physics makes on the struck balls of this file.
    for (const c of CASES) for (const path of c.fielding.paths) check(path, trackFor(c, path, false));
    expect(short).toBeGreaterThan(2);
  });
});
