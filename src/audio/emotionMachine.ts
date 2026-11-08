/**
 * The emotion machine's transitions (the model is described in emotionCore.ts). One function per input: each reads the
 * state as it stands at the input's time, then writes the new state. Nothing is read after it is written, so a
 * transition may run in place (out === state); the machine does exactly that, with one preallocated state and one
 * preallocated sample, so neither a moment nor a frame allocates.
 *
 *   approach    anticipation: the murmur swells as the bowler runs in (more under pressure)
 *   gather      concentration: the hush of the delivery stride
 *   release     the collective breath while the ball travels
 *   contact     the contact response: the breath out at a clean hit, an "ooh" for an edge
 *   carry       (first) the crowd lifts as a hit goes somewhere; a block that goes nowhere gets no reaction
 *   pad         the appeal's intake of breath, held until the decision
 *   beaten      a close call: an "ooh" by how close it was
 *   carry       rising expectation as a hit nears the rope (accelerating: progress squared)
 *   fielded     a ball racing to the rope, stopped: frustration at the missed opportunity
 *   four        a strong release; six: peak celebration (bands that never overlap; both shrink with habituation)
 *   wicket      decisive silence within 150 ms, then the shift: a low murmur of dismay (subdued after it)
 *   survived    relief after a close call
 *   dot         mild pressure: a restless murmur (frustration when a middled hit came to nothing); a leave is
 *               restrained, the crowd quietly resettles
 *   runs        acknowledgement: applause; milestones bring an ovation
 *   reflection  the settle before the next ball, back to the murmur (subdued after a damaging wicket)
 */
import {
  CROWD,
  baseLevel,
  blankCrowdEmotion,
  clamp01,
  clampV,
  expectationAt,
  initialEmotion,
  moodAt,
  outcomeAt,
  phaseAt,
  reactionValue,
  restLevel,
  tailValue,
  sampleEmotion,
  valenceAt,
  type CrowdEmotion,
  type CrowdMood,
  type CrowdReaction,
  type DeliveryContext,
  type EmotionMoment,
  type EmotionState,
} from './emotionCore';

export type EmotionInput =
  { type: 'context'; context: DeliveryContext; at: number } | { type: 'moment'; moment: EmotionMoment; at: number };

// The state's values at the input's time, read before anything is written (module scratch: no allocation).
let nowBase = 0;
let nowReaction = 0;
let nowTail = 0;
let nowValence = 0;
let nowExpect = 0;
let anchored = false;

function begin(s: Readonly<EmotionState>, at: number, out: EmotionState): number {
  const t = at > s.at ? at : s.at;
  nowBase = baseLevel(s, t);
  nowReaction = reactionValue(s, t);
  nowTail = tailValue(s, t);
  nowValence = valenceAt(s, t);
  nowExpect = expectationAt(s, t);
  const fatigue = s.fatigue * Math.exp(-Math.max(0, t - s.fatigueAt) / CROWD.fatigueTauMs);
  const phaseBefore = phaseAt(s, t);
  const moodBefore = moodAt(s, t);
  const outcomeBefore = outcomeAt(s, t);
  if (out !== s) Object.assign(out, s);
  out.switchAt = t;
  out.phaseBefore = phaseBefore;
  out.moodBefore = moodBefore;
  out.outcomeBefore = outcomeBefore;
  out.at = t;
  out.fatigue = fatigue;
  out.fatigueAt = t;
  out.reaction = null;
  out.reactionLevel = 0;
  out.caption = null;
  anchored = false;
  return t;
}

/** The base heads for `to` (time constant tau); after `hold` it relaxes to the resting murmur. */
function base(
  o: EmotionState,
  t: number,
  to: number,
  tau: number,
  hold = Number.POSITIVE_INFINITY,
  relax: number = CROWD.relaxMs,
) {
  o.from = nowBase;
  o.to = clamp01(to);
  o.t0 = t;
  o.tau = tau;
  o.hold = hold;
  o.relax = relax;
  o.rest = restLevel(o);
  anchored = true;
}

function valence(o: EmotionState, t: number, to: number, tau: number) {
  o.vFrom = nowValence;
  o.vTo = clampV(to);
  o.vT0 = t;
  o.vTau = tau;
}

function expect(o: EmotionState, t: number, to: number, tau: number) {
  o.eFrom = nowExpect;
  o.eTo = clamp01(to);
  o.eT0 = t;
  o.eTau = tau;
}

function mood(o: EmotionState, t: number, m: CrowdMood, holdMs = Number.POSITIVE_INFINITY, next: CrowdMood = m) {
  o.mood = m;
  o.moodUntil = t + holdMs;
  o.nextMood = next;
}

/**
 * A crowd reaction whose total (base + tail + transient) peaks at `peak`. The previous reaction becomes the tail and
 * keeps decaying on its own; an older tail still sounding (small by then) joins the base.
 */
function react(
  o: EmotionState,
  t: number,
  kind: CrowdReaction,
  peak: number,
  attack: number,
  decay: number,
  delay = 0,
) {
  if (nowTail > 0) {
    if (!anchored) {
      o.from = nowBase;
      o.t0 = t;
    }
    o.from = Math.min(1, o.from + nowTail);
  }
  o.tAmp = o.rAmp;
  o.tAt = o.rAt;
  o.tAttack = o.rAttack;
  o.tDecay = o.rDecay;
  const target = clamp01(peak);
  const xs = attack * Math.log((attack + decay) / attack);
  const m = (decay / (attack + decay)) * Math.pow(attack / (attack + decay), attack / decay);
  // Aim the transient so base + transient peaks at the target (the base may still be moving after the transient's
  // own peak): start from the transient's peak, then correct twice by the measured overshoot.
  const t1 = t + delay;
  let amp = Math.max(0.02, target - baseLevel(o, t1 + xs) - tailValue(o, t1 + xs));
  const span = xs * 4 + decay;
  for (let pass = 0; pass < 2; pass++) {
    let best = 0;
    for (let i = 1; i <= 64; i++) {
      const x = (i / 64) * span;
      const v =
        baseLevel(o, t1 + x) + tailValue(o, t1 + x) + (amp / m) * (1 - Math.exp(-x / attack)) * Math.exp(-x / decay);
      if (v > best) best = v;
    }
    amp = Math.max(0.02, amp - (best - target));
  }
  o.rAmp = amp / m;
  o.rAt = t1;
  o.rAttack = attack;
  o.rDecay = decay;
  o.reaction = kind;
  o.reactionLevel = target;
}

/** Whether this ball's runs take the striker past 50 or 100 (and keeps the running total). */
function milestone(o: EmotionState, runs: number): 'fifty' | 'hundred' | null {
  const before = o.runsBefore;
  if (before === null) return null;
  const after = before + runs;
  o.runsBefore = after;
  const fifties = Math.floor(after / 50);
  if (fifties <= Math.floor(before / 50)) return null;
  return fifties % 2 === 0 ? 'hundred' : 'fifty';
}

const milestoneCaption = (ms: 'fifty' | 'hundred') => (ms === 'fifty' ? 'milestone_fifty' : 'milestone_hundred');

/** The match context for the coming delivery. */
function applyEmotionContext(
  s: Readonly<EmotionState>,
  ctx: DeliveryContext,
  at: number,
  out?: EmotionState,
): EmotionState {
  const o = out ?? { ...s };
  const t = begin(s, at, o);
  o.pressure = clamp01(Number.isFinite(ctx.pressure) ? (ctx.pressure as number) : 0);
  o.milestone = ctx.milestone ?? null;
  o.wicketEndsInnings = ctx.wicketEndsInnings ?? true;
  if (typeof ctx.runs === 'number' && Number.isFinite(ctx.runs)) o.runsBefore = ctx.runs;
  o.fresh = true;
  // Between balls the murmur follows the new context; a celebration or a silence is never cut short.
  if (o.phase === 'between' || (o.phase === 'reflection' && t >= o.settleAt)) base(o, t, restLevel(o), 1500);
  return o;
}

/** One resolved moment of the delivery, at the time it physically happened. */
function applyEmotionMoment(s: Readonly<EmotionState>, m: EmotionMoment, at: number, out?: EmotionState): EmotionState {
  const o = out ?? { ...s };
  const t = begin(s, at, o);
  const q = clamp01(Number.isFinite(m.intensity) ? m.intensity : 0);
  let p = o.pressure;
  let k = 1 + 0.35 * p;
  switch (m.kind) {
    case 'approach': {
      // A new delivery. After a damaging wicket, play going on means a new innings.
      if (o.subdued) {
        o.subdued = false;
        o.momentum = 0;
        o.dots = 0;
      }
      // Without a context, the stage's approach intensity (0.4 + 0.4 × pressure) still carries the pressure.
      if (!o.fresh && q > 0) o.pressure = clamp01((q - 0.4) / 0.4);
      o.fresh = false;
      p = o.pressure;
      k = 1 + 0.35 * p;
      o.outcome = null;
      o.quality = 0;
      o.edged = false;
      o.padded = false;
      o.carry = 0;
      o.risen = false;
      o.lifted = false;
      o.momentum *= 0.85;
      o.phase = 'approach';
      base(o, t, Math.min(CROWD.approachMax, (restLevel(o) + 0.12) * k), 900);
      valence(o, t, 0.1 * o.momentum, 800);
      expect(o, t, 0.6 + 0.25 * p, 1100);
      mood(o, t, 'anticipation');
      break;
    }
    case 'gather':
      o.phase = 'stride';
      base(o, t, CROWD.hush / k, 120);
      expect(o, t, 0.72 + 0.2 * p, 300);
      mood(o, t, 'concentration');
      break;
    case 'release':
      o.phase = 'flight';
      base(o, t, CROWD.breath / k, 90);
      expect(o, t, 0.78 + 0.2 * p, 200);
      mood(o, t, 'breath');
      break;
    case 'pitch':
    case 'dead':
      break;
    case 'contact': {
      const edge = m.contact ? m.contact !== 'middle' : q < 0.5;
      o.quality = q;
      o.edged = edge;
      o.phase = 'contact';
      if (edge) {
        base(o, t, 0.36 * k, 250, 1800);
        react(o, t, 'ooh', 0.5 * k * (1 - 0.2 * o.fatigue), 50, 600);
        valence(o, t, -0.25, 200);
        expect(o, t, 0.7, 200);
        mood(o, t, 'gasp', 1400, 'murmur');
      } else {
        // The breath out at the crack; the crowd lifts only if the ball goes somewhere (the first carry).
        base(o, t, (0.16 + 0.1 * q) * k, 250, 1500);
        valence(o, t, 0.15 + 0.2 * q, 200);
        expect(o, t, 0.6, 250);
        mood(o, t, 'response', 1200, 'murmur');
      }
      break;
    }
    case 'pad':
      o.padded = true;
      o.phase = 'contact';
      base(o, t, 0.4 * k, 200);
      react(o, t, 'ooh', 0.45 * k, 50, 650);
      valence(o, t, -0.15, 200);
      expect(o, t, 0.7, 200);
      mood(o, t, 'gasp');
      break;
    case 'beaten':
      o.phase = 'contact';
      base(o, t, (0.22 + 0.15 * q) * k, 300, 1600);
      react(o, t, 'ooh', (0.3 + 0.35 * q) * k * (1 - 0.15 * o.fatigue), 60, 650);
      valence(o, t, -0.3 * q, 200);
      expect(o, t, 0.4, 300);
      mood(o, t, 'gasp', 1400, 'murmur');
      if (q >= 0.6) o.caption = 'crowd_gasps';
      break;
    case 'carry': {
      if (q > o.carry) o.carry = q;
      o.phase = 'chase';
      // No look-ahead: until the outcome is confirmed the crowd stays at or under CROWD.expectMax, below every four,
      // with whatever reaction is still sounding counted in.
      const room = CROWD.expectMax - nowReaction - nowTail;
      base(o, t, Math.max(0.1, Math.min(room, (0.3 + 0.3 * q * q) * k)), 260);
      if (!o.lifted && (!o.edged || q >= 0.45)) {
        o.lifted = true;
        react(
          o,
          t,
          'lift',
          Math.min(CROWD.expectMax, (0.3 + 0.25 * o.quality + 0.15 * q) * k * (1 - 0.2 * o.fatigue)),
          70,
          700,
        );
      }
      valence(o, t, 0.15 + 0.45 * q, 260);
      expect(o, t, 0.35 + 0.6 * q, 260);
      if (moodAt(o, t) !== 'expectation') mood(o, t, 'expectation');
      if (!o.risen && q >= 0.45) {
        o.risen = true;
        o.caption = 'crowd_rises';
      }
      break;
    }
    case 'fielded':
      if (o.phase === 'chase' && o.carry >= 0.55) {
        // Racing to the rope, and stopped: the missed opportunity.
        base(o, t, restLevel(o) + 0.04, 500, 1400);
        react(o, t, 'groan', 0.46 * (1 - 0.2 * o.fatigue), 120, 900);
        valence(o, t, -0.25, 300);
        expect(o, t, 0.1, 400);
        mood(o, t, 'frustration', 1800, 'murmur');
        o.caption = 'crowd_groans';
      } else if (o.phase === 'chase') {
        base(o, t, restLevel(o) + 0.02, 500, 1200);
        expect(o, t, 0.1, 400);
      }
      break;
    case 'four':
    case 'six': {
      const six = m.kind === 'six';
      const ms = milestone(o, six ? 6 : 4);
      // Non-overlapping bands (constitution: proportional feedback): a six 0.84–1.0, a four 0.66–0.83.
      const f = o.fatigue;
      const peak = six
        ? CROWD.six + 0.08 * p - 0.08 * f + (ms ? 0.05 : 0)
        : Math.min(0.83, CROWD.four + 0.08 * p - 0.08 * f + (ms ? 0.05 : 0));
      o.phase = 'outcome';
      o.outcome = six ? 'six' : 'four';
      o.momentum = Math.min(1, o.momentum + (six ? 0.5 : 0.35));
      o.dots = 0;
      if (six) base(o, t, 0.62, 300, ms ? 4800 : 3800, 3800);
      else base(o, t, 0.48, 300, ms ? 4800 : 3400, 3400);
      react(
        o,
        t,
        ms ? 'ovation' : six ? 'eruption' : 'cheer',
        Math.min(1, peak),
        six ? 160 : 140,
        ms ? 3800 : six ? 3800 : 3200,
      );
      valence(o, t, six ? 1 : 0.8, 200);
      expect(o, t, 0, 400);
      mood(o, t, ms ? 'ovation' : six ? 'eruption' : 'celebration', ms ? 6000 : six ? 4800 : 3500, 'murmur');
      o.fatigue = Math.min(1, o.fatigue + (six ? 0.35 : 0.25));
      o.caption = ms ? milestoneCaption(ms) : six ? 'crowd_erupts' : 'crowd_cheers';
      break;
    }
    case 'wicket': {
      // Decisive silence: everything the crowd was doing collapses within 150 ms (one continuous fall, no spike);
      // then the shift, a low murmur of dismay as the ground takes it in.
      const damaging = o.wicketEndsInnings;
      o.phase = 'outcome';
      o.outcome = 'wicket';
      o.momentum = -0.6;
      o.dots = 0;
      o.subdued = damaging;
      base(o, t, CROWD.silence, 45, CROWD.silenceHoldMs, 1200);
      o.from = Math.min(1, nowBase + nowReaction + nowTail);
      o.rAmp = 0;
      o.tAmp = 0;
      nowTail = 0;
      react(o, t, 'dismay', damaging ? 0.2 : 0.28, 250, 1400, CROWD.silenceHoldMs);
      valence(o, t, -0.9, 150);
      expect(o, t, 0, 150);
      mood(o, t, 'silence', CROWD.silenceHoldMs, 'dismay');
      o.caption = 'crowd_stunned';
      break;
    }
    case 'survived':
      o.phase = 'outcome';
      o.outcome = 'close_call';
      base(o, t, restLevel(o) + 0.02, 700, 1600);
      react(o, t, 'relief', 0.42 * (1 - 0.1 * o.fatigue), 90, 1100);
      valence(o, t, 0.25, 400);
      expect(o, t, 0, 400);
      mood(o, t, 'relief', 1800, 'murmur');
      o.caption = 'crowd_relieved';
      break;
    case 'dot': {
      const leave = o.quality === 0 && !o.padded && !o.edged;
      o.phase = 'outcome';
      o.outcome = leave ? 'leave' : 'dot';
      o.dots += 1;
      o.momentum = Math.max(-1, o.momentum - (leave ? 0.06 : 0.12));
      if (leave) {
        // Restrained: the crowd quietly resettles.
        base(o, t, restLevel(o) - 0.04, 900, 1600);
        valence(o, t, 0, 800);
        expect(o, t, 0, 400);
        mood(o, t, 'murmur');
        break;
      }
      const frustrated = moodAt(o, t) === 'frustration';
      if (!frustrated && o.quality >= 0.8 && !o.edged && o.carry >= 0.3) {
        // Middled and going somewhere, and nothing came of it.
        base(o, t, restLevel(o), 500, 1400);
        react(o, t, 'groan', Math.min(0.42, restLevel(o) + 0.08), 120, 800);
        mood(o, t, 'frustration', 1600, 'restless');
        o.caption = 'crowd_groans';
      } else if (!frustrated) {
        // Mild pressure: a restless murmur, a little more with every dot in a row.
        base(o, t, restLevel(o) + 0.02, 600, 1600);
        mood(o, t, 'restless', 2400, 'murmur');
      }
      valence(o, t, -0.04 * Math.min(4, o.dots), 600);
      expect(o, t, 0, 400);
      break;
    }
    case 'runs': {
      const r = Math.max(1, Math.round(Number.isFinite(m.runs) ? (m.runs as number) : 1));
      const ms = milestone(o, r);
      o.phase = 'outcome';
      o.outcome = 'runs';
      o.dots = 0;
      o.momentum = Math.min(1, o.momentum + 0.04 * r);
      if (ms) {
        base(o, t, 0.55, 400, 4500, 2800);
        react(o, t, 'ovation', Math.min(1, 0.78 + 0.08 * p), 200, 3500);
        mood(o, t, 'ovation', 6000, 'murmur');
        o.caption = milestoneCaption(ms);
      } else {
        // Acknowledgement: always above a dot (rest + 0.1), never near a four (at most 0.6).
        const peak = Math.max(restLevel(o) + 0.1, Math.min(0.6, 0.4 + 0.05 * r + 0.06 * p) - 0.04 * o.fatigue);
        base(o, t, restLevel(o) + 0.03, 600, 1600);
        react(o, t, 'applause', peak, 150, 1300);
        mood(o, t, 'applause', 2000, 'murmur');
        if (r >= 2) o.caption = 'crowd_applauds';
      }
      valence(o, t, 0.3, 400);
      expect(o, t, 0, 400);
      break;
    }
    case 'reflection':
      o.phase = 'reflection';
      o.settleAt = t + CROWD.settleMs;
      base(o, t, restLevel(o), 3200);
      valence(o, t, 0.1 * o.momentum, 1500);
      expect(o, t, 0, 600);
      if (o.subdued) mood(o, t, 'dismay');
      else mood(o, t, 'reflection', CROWD.settleMs, 'murmur');
      break;
  }
  return o;
}

/** Pure reducer over both inputs (a new state unless `out` is given). */
export function reduceEmotion(s: Readonly<EmotionState>, input: EmotionInput, out?: EmotionState): EmotionState {
  return input.type === 'context'
    ? applyEmotionContext(s, input.context, input.at, out)
    : applyEmotionMoment(s, input.moment, input.at, out);
}

/** One machine per session: the Practice sink owns it and the 3D crowd reads it through the sink's emotionNow(). */
export interface EmotionMachine {
  context(ctx: DeliveryContext, atMs: number): void;
  /** Applies the moment and returns the state, whose reaction, reactionLevel and caption say what to play. */
  moment(m: EmotionMoment, atMs: number): Readonly<EmotionState>;
  /** The emotion at atMs, in one object updated in place. */
  sample(atMs: number): Readonly<CrowdEmotion>;
  state(): Readonly<EmotionState>;
  reset(): void;
}

export function createEmotionMachine(): EmotionMachine {
  const s = initialEmotion();
  const out = blankCrowdEmotion();
  return {
    context: (ctx, atMs) => void applyEmotionContext(s, ctx, atMs, s),
    moment: (m, atMs) => applyEmotionMoment(s, m, atMs, s),
    sample: (atMs) => sampleEmotion(s, atMs, out),
    state: () => s,
    reset: () => void Object.assign(s, initialEmotion()),
  };
}
