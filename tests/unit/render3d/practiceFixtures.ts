/**
 * TEST FIXTURES ONLY: BallFlight and DeliveryResult values for the Practice stage's tests and the dev harness, built
 * with a deliberately simple ballistic model (gravity, one pitch bounce, a straight hit, rolling). This is not the
 * physics (src/physics is); it only gives the presentation realistic-looking data to draw. Never import it from
 * production code.
 */
import type {
  BallFlight,
  BallSample,
  BatSample,
  ContactKind,
  DeliveryResult,
  DeliveryVariation,
  FieldLayout,
  Fielder,
  FielderPath,
  NormalizedSwing,
  SimEvent,
  SwingTiming,
  Vec3,
} from '@/contracts/practice';

const G = 9.81;
const BALL_R = 0.036;
const PITCH_HALF = 10.06;
const DT = 0.002;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export interface FlightFixture {
  speedKph?: number;
  /** Metres in front of the striker's stumps. */
  lengthM?: number;
  /** Line at the stumps (m, + off side). */
  lineM?: number;
  releaseX?: number;
  releaseY?: number;
  variation?: DeliveryVariation;
  seed?: string;
  spinRps?: number;
  seamDeg?: number;
}

export function fixtureFlight(o: FlightFixture = {}): BallFlight {
  const speedKph = o.speedKph ?? 136;
  const speed = speedKph / 3.6;
  const rel = v(o.releaseX ?? 0.42, o.releaseY ?? 2.15, -PITCH_HALF + 1.4);
  const lengthM = o.lengthM ?? 6;
  const lineM = o.lineM ?? 0.05;
  const bz = PITCH_HALF - lengthM;
  const vz = speed * 0.985;
  const tb = (bz - rel.z) / vz;
  const tStumpsGuess = tb + (PITCH_HALF - bz) / (vz * 0.88);
  const vx = (lineM - rel.x) / tStumpsGuess;
  const vy = (BALL_R - rel.y + 0.5 * G * tb * tb) / tb;
  const samples: BallSample[] = [];
  let p = { ...rel };
  let vel = v(vx, vy, vz);
  let bounced = false;
  let bounce: BallFlight['bounce'] = null;
  for (let t = 0; t <= 3 && p.z <= PITCH_HALF + 0.35; t += DT) {
    samples.push({ t: Math.round(t * 1e6) / 1e6, p: { ...p }, v: { ...vel } });
    const np = v(p.x + vel.x * DT, p.y + vel.y * DT - 0.5 * G * DT * DT, p.z + vel.z * DT);
    let nv = v(vel.x, vel.y - G * DT, vel.z);
    if (!bounced && np.y <= BALL_R) {
      bounced = true;
      np.y = BALL_R;
      bounce = { t: t + DT, p: { ...np } };
      nv = v(nv.x, -nv.y * 0.53, nv.z * 0.88);
    }
    p = np;
    vel = nv;
  }
  const timeAtZ = (z: number) => samples.find((s) => s.p.z >= z)?.t ?? samples[samples.length - 1].t;
  const stumpsT = timeAtZ(PITCH_HALF);
  const at = samples.find((s) => s.t >= stumpsT) ?? samples[samples.length - 1];
  return {
    version: 1,
    plan: { variation: o.variation ?? 'stock', lengthM, lineM, speedKph },
    seed: o.seed ?? `fixture:${speedKph}:${lengthM}:${lineM}`,
    release: { p: rel, v: v(vx, vy, vz), spinRps: o.spinRps ?? 13, seamDeg: o.seamDeg ?? 0, speedKph },
    bounce,
    // Back-spin about −x (rad/s), a little less after the pitch.
    spin: { release: v(-2 * Math.PI * (o.spinRps ?? 13), 0, 0), afterBounce: bounce ? v(-2 * Math.PI * (o.spinRps ?? 13) * 0.8, 0, 0) : null },
    idealContactT: timeAtZ(PITCH_HALF - 1.5),
    stumpsT,
    wouldHitStumps: Math.abs(at.p.x) <= 0.1143 + BALL_R && at.p.y <= 0.724 + BALL_R,
    samples,
  };
}

export function fixtureField(): FieldLayout {
  const f = (id: string, role: Fielder['role'], x: number, z: number): Fielder => ({ id, role, x, z });
  return {
    id: 'fixture',
    fielders: [
      f('wk', 'keeper', 0.1, PITCH_HALF + 12),
      f('bw', 'bowler', 0.6, -PITCH_HALF - 1),
      f('sl', 'slip', 1.6, PITCH_HALF + 13),
      f('pt', 'point', 21, 6),
      f('cv', 'cover', 18, -6),
      f('mo', 'mid_off', 7, -14),
      f('mn', 'mid_on', -7, -14),
      f('mw', 'midwicket', -19, -4),
      f('sq', 'square_leg', -22, 8),
      f('fl', 'fine_leg', -38, 40),
      f('lo', 'long_off', 14, -50),
    ],
  };
}

export type ResultKind = 'drive' | 'defend' | 'edge' | 'miss' | 'leave' | 'bowled' | 'six' | 'catch';

export interface ResultFixture {
  kind: ResultKind;
  /** Signed timing error (ms, + late). */
  timingMs?: number;
  /** Intended and exit bearing (deg). */
  bearing?: number;
  exitBearing?: number;
}

/** The ball's position at t on the delivery (interpolated; any sample spacing). */
function flightAt(f: BallFlight, t: number): Vec3 {
  const s = f.samples;
  let lo = 0;
  let hi = s.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const i = Math.max(0, Math.min(s.length - 2, lo));
  const a = s[i];
  const b = s[i + 1];
  const u = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-9, b.t - a.t)));
  return v(a.p.x + (b.p.x - a.p.x) * u, a.p.y + (b.p.y - a.p.y) * u, a.p.z + (b.p.z - a.p.z) * u);
}

/** A bat swinging down a vertical-ish plane so its sweet spot passes `through` at time `tc`. */
function batTrack(startT: number, tc: number, through: Vec3, bearingDeg: number): BatSample[] {
  const out: BatSample[] = [];
  const a = (bearingDeg * Math.PI) / 180;
  const fwd = v(Math.sin(a), 0, -Math.cos(a));
  for (let t = startT; t <= tc + 0.3 + 1e-9; t += 0.005) {
    // Swing angle: −110° (backlift) → 0° (vertical, at contact) → +100° (follow-through).
    const u = (t - tc) / (tc - startT);
    const ang = Math.max(-1.9, Math.min(1.75, u * 1.9));
    const sweet = 0.74;
    const dir = v(fwd.x * Math.sin(ang) * 0.9 + 0.05, -Math.cos(ang), fwd.z * Math.sin(ang) * 0.9);
    const l = Math.hypot(dir.x, dir.y, dir.z);
    const d = v(dir.x / l, dir.y / l, dir.z / l);
    const grip = v(through.x - d.x * sweet, through.y - d.y * sweet, through.z - d.z * sweet);
    const toe = v(grip.x + d.x * 0.86, grip.y + d.y * 0.86, grip.z + d.z * 0.86);
    out.push({ t: Math.round(t * 1e6) / 1e6, grip, toe, face: v(fwd.x, 0.05, fwd.z) });
  }
  return out;
}

/** A hit: a straight launch along the bearing with bounces and a roll, until it stops or reaches `untilR`. */
function hitPath(from: Vec3, t0: number, bearingDeg: number, speed: number, elevDeg: number, untilR = 64, stopAt?: number): BallSample[] {
  const a = (bearingDeg * Math.PI) / 180;
  const e = (elevDeg * Math.PI) / 180;
  let p = { ...from };
  let vel = v(Math.sin(a) * Math.cos(e) * speed, Math.sin(e) * speed, -Math.cos(a) * Math.cos(e) * speed);
  const out: BallSample[] = [];
  const dt = 0.01;
  for (let t = t0; t < t0 + 9; t += dt) {
    out.push({ t: Math.round(t * 1e6) / 1e6, p: { ...p }, v: { ...vel } });
    if (stopAt !== undefined && t >= stopAt) break;
    if (Math.hypot(p.x, p.z) >= untilR) break;
    const np = v(p.x + vel.x * dt, p.y + vel.y * dt - 0.5 * G * dt * dt, p.z + vel.z * dt);
    let nv = v(vel.x, vel.y - G * dt, vel.z);
    if (np.y <= BALL_R) {
      np.y = BALL_R;
      nv = v(nv.x * 0.8, Math.abs(nv.y) > 1.2 ? -nv.y * 0.4 : 0, nv.z * 0.8);
      if (nv.y === 0) {
        const s = Math.hypot(nv.x, nv.z);
        const ns = Math.max(0, s - (0.5 + 0.35 * s) * dt);
        if (ns < 0.15) break;
        nv = v((nv.x / s) * ns, 0, (nv.z / s) * ns);
      }
    }
    p = np;
    vel = nv;
  }
  return out;
}

export function fixtureResult(flight: BallFlight, o: ResultFixture): DeliveryResult {
  const field = fixtureField();
  const err = o.timingMs ?? 0;
  const bearing = o.bearing ?? 25;
  const exitBearing = o.exitBearing ?? bearing;
  const events: SimEvent[] = [{ t: 0, kind: 'release' }];
  if (flight.bounce) events.push({ t: flight.bounce.t, kind: 'bounce', p: flight.bounce.p });
  const leave = o.kind === 'leave';
  const tc = flight.idealContactT + err / 1000;
  const swing: NormalizedSwing | null = leave ? null : { kind: o.kind === 'defend' ? 'defend' : 'attack', startT: Math.round((tc - 0.135) * 1e4) / 1e4, directionDeg: bearing, power: o.kind === 'defend' ? 0.2 : 0.8, elevation: o.kind === 'six' ? 0.9 : 0.1, footwork: 'auto' };
  const at = flightAt(flight, Math.min(tc, flight.samples[flight.samples.length - 1].t));
  const bat = swing ? batTrack(swing.startT, tc, o.kind === 'miss' || o.kind === 'bowled' ? v(at.x + 0.25, at.y + 0.1, at.z) : at, bearing) : [];
  const pre = flight.samples.filter((s) => s.t <= tc);
  let ball: BallSample[] = flight.samples;
  let deadT = flight.samples[flight.samples.length - 1].t + 0.4;
  let kind: ContactKind = leave ? 'leave' : 'miss';
  let timing: SwingTiming = leave ? 'none' : 'missed';
  const fielders: FielderPath[] = field.fielders.map((f) => ({ fielderId: f.id, samples: [{ t: 0, x: f.x, z: f.z, action: 'set' }] }));
  const outcome: DeliveryResult['outcome'] = { runs: 0, boundary: null, dismissal: null, fielderId: null, endBearingDeg: null, endDistanceM: null, region: null };
  if (o.kind === 'drive' || o.kind === 'defend' || o.kind === 'edge' || o.kind === 'six' || o.kind === 'catch') {
    kind = o.kind === 'edge' ? 'outside_edge' : 'middle';
    timing = Math.abs(err) <= 25 ? 'perfect' : Math.abs(err) <= 55 ? 'solid' : 'mistimed';
    const speed = o.kind === 'six' ? 42 : o.kind === 'defend' ? 6 : o.kind === 'edge' ? 24 : 30;
    const elev = o.kind === 'six' ? 34 : o.kind === 'catch' ? 22 : o.kind === 'edge' ? 8 : 4;
    const fielder = o.kind === 'catch' ? field.fielders.find((f) => f.id === 'cv')! : o.kind === 'drive' ? field.fielders.find((f) => f.id === 'mo')! : null;
    let stopAt: number | undefined;
    if (fielder && o.kind === 'catch') {
      // Caught at chest height once the ball reaches the fielder's distance.
      const d = Math.hypot(fielder.x - at.x, fielder.z - at.z);
      stopAt = tc + d / (speed * Math.cos((elev * Math.PI) / 180));
    }
    const out = hitPath(at, tc, exitBearing, speed, elev, 64, stopAt);
    ball = [...pre, ...out];
    events.push({ t: tc, kind: 'contact', contact: kind, p: at });
    const end = out[out.length - 1];
    deadT = end.t + 0.3;
    if (o.kind === 'six') {
      events.push({ t: end.t, kind: 'boundary', runs: 6, p: end.p });
      outcome.runs = 6;
      outcome.boundary = 6;
    } else if (o.kind === 'catch' && fielder) {
      events.push({ t: end.t, kind: 'catch', fielderId: fielder.id, p: end.p });
      outcome.dismissal = 'caught';
      outcome.fielderId = fielder.id;
      const fp = fielders.find((p) => p.fielderId === fielder.id)!;
      fp.samples = [
        { t: 0, x: fielder.x, z: fielder.z, action: 'set' },
        { t: tc + 0.25, x: fielder.x, z: fielder.z, action: 'run' },
        { t: end.t - 0.3, x: end.p.x, z: end.p.z, action: 'run' },
        { t: end.t - 0.1, x: end.p.x, z: end.p.z, action: 'catch' },
        { t: end.t + 1.2, x: end.p.x, z: end.p.z, action: 'celebrate' },
      ];
    } else if (o.kind === 'drive' && fielder) {
      events.push({ t: end.t, kind: 'field', fielderId: fielder.id, p: end.p });
      events.push({ t: end.t + 2.2, kind: 'run', completed: 1 });
      outcome.runs = 1;
      outcome.fielderId = fielder.id;
      const fp = fielders.find((p) => p.fielderId === fielder.id)!;
      fp.samples = [
        { t: 0, x: fielder.x, z: fielder.z, action: 'set' },
        { t: tc + 0.2, x: fielder.x, z: fielder.z, action: 'run' },
        { t: end.t - 0.4, x: end.p.x, z: end.p.z, action: 'run' },
        { t: end.t - 0.3, x: end.p.x, z: end.p.z, action: 'pickup' },
        { t: end.t + 0.5, x: end.p.x, z: end.p.z, action: 'throw' },
        { t: end.t + 1.6, x: end.p.x, z: end.p.z, action: 'idle' },
      ];
      deadT = end.t + 2.4;
    }
    outcome.endBearingDeg = exitBearing;
    outcome.endDistanceM = Math.hypot(end.p.x, end.p.z - (PITCH_HALF - 1.47));
  } else if (o.kind === 'bowled') {
    const hit = flight.samples.find((s) => s.p.z >= PITCH_HALF)!;
    events.push({ t: hit.t, kind: 'stumps', p: hit.p });
    outcome.dismissal = 'bowled';
    ball = flight.samples.filter((s) => s.t <= hit.t);
    deadT = hit.t + 0.5;
  } else {
    const take = flight.samples[flight.samples.length - 1];
    events.push({ t: take.t, kind: 'keeper_take', p: take.p });
  }
  events.push({ t: deadT, kind: 'dead' });
  events.sort((a, b) => a.t - b.t);
  return {
    version: 1,
    flight,
    swing,
    footwork: flight.plan.lengthM > 6.5 ? 'back' : 'forward',
    lbw: null,
    contact: {
      kind,
      t: leave ? null : tc,
      timingErrorMs: leave ? null : err,
      timing,
      point: kind === 'middle' || kind.endsWith('_edge') ? at : null,
      bladeU: kind === 'middle' ? 0.22 : kind.endsWith('_edge') ? 0.3 : null,
      faceBearingDeg: swing ? bearing : null,
      batSpeedKph: swing ? 80 : null,
      exitSpeedKph: kind === 'middle' ? 108 : null,
      exitBearingDeg: kind === 'middle' || kind.endsWith('_edge') ? exitBearing : null,
      exitElevationDeg: kind === 'middle' ? 4 : null,
      intendedBearingDeg: swing ? bearing : null,
    },
    bat,
    ball,
    fielders,
    events,
    outcome,
    coaching: { reason: o.kind === 'six' ? 'cleared_the_rope' : o.kind === 'leave' ? 'left_well' : 'hit_to_fielder', timing: err < -25 ? 'early' : err > 25 ? 'late' : 'on_time', zone: null, fielderRole: null, lbw: null },
    deadT,
  };
}
