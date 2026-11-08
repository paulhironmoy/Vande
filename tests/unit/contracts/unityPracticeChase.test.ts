import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRACTICE_SIM_VERSION,
  UNITY_PRACTICE_CONTRACT_VERSION,
  UnityPracticeContractError,
  canonicalUnityPracticeJson,
  isUnityPracticeChase,
  isUnityPracticeMessage,
  makeUnityPracticeChase,
  makeUnityPracticeMessage,
  makeUnityPracticeResolution,
  packUnityPracticeMessage,
  parseUnityPracticeMessage,
  unityPracticeReplayDigest,
  unityPracticeRequiredRateX100,
  unityPracticeSha256,
  unpackUnityPracticePacket,
} from '@/contracts';
import type { DeliveryRecord, DeliveryResult, UnityPracticeChase, UnityPracticeScene } from '@/contracts';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { chaseBridgeBlock, chaseReducer, dueBall, makeChase, startChase } from '@/practice/chase';
import type { BallRuns, ChaseState } from '@/practice/chase';
import type { Dismissal } from '@/contracts';
import { REFERENCE_BALL, REFERENCE_CONDITIONS, REFERENCE_OVER, ballSeed } from '@/practice/game';

/**
 * Bridge contract v7: the optional Target Chase block (docs: release/product-sequence/stage-3-chase/UNITY/BRIDGE-V7.md).
 * The wire figures are exercised here against real physics results, so the score cross-checks see real dismissals.
 */

const fields = (sequence: number, messageId: string) => ({
  buildId: 'test-build',
  sessionId: 'session-chase',
  messageId,
  sequence,
  sender: 'host' as const,
});

/** A round trip keeps the canonical text (the packer writes -0 as 0, so object equality would be too strict). */
function expectSameMessage(actual: unknown, expected: unknown): void {
  expect(canonicalUnityPracticeJson(actual)).toBe(canonicalUnityPracticeJson(expected));
}

const bowler = REFERENCE_OVER.bowler;
const field = autoField(bowler, REFERENCE_CONDITIONS, 'right', REFERENCE_BALL);

const scene: UnityPracticeScene = {
  conditions: REFERENCE_CONDITIONS,
  fieldIntent: 'attack_outside_off',
  trainingObjective: 'random',
  field,
  bowler,
  ball: REFERENCE_BALL,
  handedness: 'right',
  batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
};

/** The standard start of a 12-ball chase for 22. */
const start = makeUnityPracticeChase({
  target: 22,
  maxBalls: 12,
  runsNeeded: 22,
  ballsLeft: 12,
  outcome: 'in_progress',
});

interface Resolved {
  record: DeliveryRecord;
  result: DeliveryResult;
}

/** One reference ball played with an attacking swing at the given power, or left alone. */
function resolveBall(ballIndex: number, power: number | null): Resolved {
  const plan = REFERENCE_OVER.balls[ballIndex];
  const seed = ballSeed(REFERENCE_OVER, ballIndex);
  const flown = flight({
    plan,
    bowler,
    conditions: REFERENCE_CONDITIONS,
    seed,
    handedness: 'right',
    ball: REFERENCE_BALL,
  });
  const swing =
    power === null
      ? null
      : {
          kind: 'attack' as const,
          startT: flown.idealContactT - batTravelMs('attack', power) / 1_000,
          directionDeg: 10,
          power,
          elevation: 0,
          footwork: 'auto' as const,
        };
  const result = resolveDelivery({
    flight: flown,
    swing,
    field,
    bowler,
    conditions: REFERENCE_CONDITIONS,
    handedness: 'right',
    assist: 'real',
    tierToleranceMs: 0,
  });
  const record: DeliveryRecord = {
    version: PRACTICE_SIM_VERSION,
    overIndex: 0,
    ballIndex,
    bowler,
    plan,
    seed,
    conditions: REFERENCE_CONDITIONS,
    ball: REFERENCE_BALL,
    field,
    handedness: 'right',
    assist: 'real',
    tierToleranceMs: 0,
    swing,
    runs: result.outcome.runs,
    dismissal: result.outcome.dismissal,
  };
  return { record, result };
}

// Found by search on the frozen simulation and pinned here (a change of either is a physics change, not this test's).
const FOUR = () => resolveBall(1, 0.72); // attack: 4 runs
const CAUGHT = () => resolveBall(4, 0.72); // attack: caught, 0 runs

function score(resolved: Resolved, runs: number, balls: number) {
  return {
    runs,
    wickets: (resolved.result.outcome.dismissal === null ? 0 : 1) as 0 | 1,
    balls,
    maxOvers: 10 as const,
  };
}

async function resultMessage(resolved: Resolved, runs: number, balls: number, chase?: UnityPracticeChase) {
  const resolution = await makeUnityPracticeResolution(
    resolved.record,
    resolved.result,
    score(resolved, runs, balls),
    chase,
  );
  return makeUnityPracticeMessage(
    { ...fields(5, `result-${balls}`), deliveryId: `delivery-${balls}` },
    'host.result',
    resolution,
  );
}

describe('Unity Practice bridge contract v7: the Target Chase block', () => {
  it('is version 7 and stamps it on every message', () => {
    expect(UNITY_PRACTICE_CONTRACT_VERSION).toBe(7);
    expect(makeUnityPracticeMessage(fields(0, 'scene-version'), 'host.scene', scene).contractVersion).toBe(7);
  });

  describe('the required rate', () => {
    it('rounds half up in integers: 14 off 9 is 9.33, 22 off 12 is 11.00, 1 off 12 is 0.50', () => {
      expect(unityPracticeRequiredRateX100(14, 9)).toBe(933);
      expect(unityPracticeRequiredRateX100(22, 12)).toBe(1_100);
      expect(unityPracticeRequiredRateX100(1, 12)).toBe(50);
      expect(unityPracticeRequiredRateX100(1, 1)).toBe(600);
      expect(unityPracticeRequiredRateX100(360, 1)).toBe(216_000);
    });

    it('equals the two-decimal display of runs * 6 / balls for every pair the contract allows', () => {
      let different = 0;
      for (let needed = 1; needed <= 360; needed += 1) {
        for (let left = 1; left <= 60; left += 1) {
          const shown = Math.round(Number(((needed * 6) / left).toFixed(2)) * 100);
          if (unityPracticeRequiredRateX100(needed, left) !== shown) different += 1;
        }
      }
      expect(different).toBe(0);
    });

    it('gives a rate only to a chase still in progress', () => {
      expect(start).toEqual({
        target: 22,
        maxBalls: 12,
        runsNeeded: 22,
        ballsLeft: 12,
        outcome: 'in_progress',
        requiredRateX100: 1_100,
      });
      for (const outcome of ['won', 'lost_wicket', 'lost_balls'] as const) {
        expect(
          makeUnityPracticeChase({
            target: 22,
            maxBalls: 12,
            runsNeeded: outcome === 'won' ? 0 : 5,
            ballsLeft: 0,
            outcome,
          }).requiredRateX100,
        ).toBeNull();
      }
    });
  });

  describe('host.scene', () => {
    it('round-trips a chase scene through a checksummed packet and adds only the block to the canonical body', async () => {
      const plain = makeUnityPracticeMessage(fields(0, 'scene-plain'), 'host.scene', scene);
      const chased = makeUnityPracticeMessage(fields(0, 'scene-plain'), 'host.scene', { ...scene, chase: start });
      expect(isUnityPracticeMessage(chased)).toBe(true);
      const packet = await packUnityPracticeMessage(chased);
      expectSameMessage(await unpackUnityPracticePacket(packet), chased);
      expect(packet.body).toContain(
        '"chase":{"ballsLeft":12,"maxBalls":12,"outcome":"in_progress","requiredRateX100":1100,"runsNeeded":22,"target":22}',
      );
      // The block and its key (`,"chase":`) are the whole difference; nothing else in a scene moves.
      const extra = canonicalUnityPracticeJson(chased).length - canonicalUnityPracticeJson(plain).length;
      expect(extra).toBe(canonicalUnityPracticeJson(start).length + ',"chase":'.length);
    });

    it('leaves a Practice scene exactly as before: no chase key, still valid', async () => {
      const plain = makeUnityPracticeMessage(fields(0, 'scene-plain'), 'host.scene', scene);
      expect(isUnityPracticeMessage(plain)).toBe(true);
      expect(Object.hasOwn(plain.payload, 'chase')).toBe(false);
      expect((await packUnityPracticeMessage(plain)).body).not.toContain('"chase":');
    });

    it.each([
      ['an extra key', { ...start, spare: 1 }],
      ['a missing key', (({ target: _target, ...rest }) => rest)(start)],
      ['a fractional target', { ...start, target: 22.5 }],
      ['a zero target', { ...start, target: 0 }],
      ['a target above 360', { ...start, target: 361 }],
      ['zero balls', { ...start, maxBalls: 0 }],
      ['more than 60 balls', { ...start, maxBalls: 61 }],
      ['runs needed above the target', { ...start, runsNeeded: 23 }],
      ['balls left above the balls', { ...start, ballsLeft: 13 }],
      ['a negative number', { ...start, ballsLeft: -1 }],
      ['numbers as strings', { ...start, target: '22' }],
      ['an unknown outcome', { ...start, outcome: 'tied' }],
      ['a null chase', null],
      ['an array', []],
      ['a wrong rate', { ...start, requiredRateX100: 1_101 }],
      ['no rate while in progress', { ...start, requiredRateX100: null }],
      ['in progress with nothing needed', { ...start, runsNeeded: 0, requiredRateX100: 0 }],
      ['in progress with no balls left', { ...start, ballsLeft: 0, requiredRateX100: 0 }],
      ['a rate on a won chase', { ...start, outcome: 'won', runsNeeded: 0, requiredRateX100: 0 }],
      ['a won chase that still needs runs', { ...start, outcome: 'won', requiredRateX100: null }],
      ['a lost chase that needs nothing', { ...start, outcome: 'lost_wicket', runsNeeded: 0, requiredRateX100: null }],
      ['lost on balls with balls left', { ...start, outcome: 'lost_balls', requiredRateX100: null }],
    ])('rejects %s', (_name, chase) => {
      const message = makeUnityPracticeMessage(fields(0, 'scene-bad'), 'host.scene', scene);
      expect(isUnityPracticeMessage({ ...message, payload: { ...message.payload, chase } })).toBe(false);
    });

    it('accepts each decided outcome that is consistent with itself', () => {
      const decided = [
        makeUnityPracticeChase({ target: 22, maxBalls: 12, runsNeeded: 0, ballsLeft: 3, outcome: 'won' }),
        makeUnityPracticeChase({ target: 22, maxBalls: 12, runsNeeded: 9, ballsLeft: 7, outcome: 'lost_wicket' }),
        makeUnityPracticeChase({ target: 22, maxBalls: 12, runsNeeded: 9, ballsLeft: 0, outcome: 'lost_wicket' }),
        makeUnityPracticeChase({ target: 22, maxBalls: 12, runsNeeded: 9, ballsLeft: 0, outcome: 'lost_balls' }),
      ];
      for (const chase of decided) {
        const message = makeUnityPracticeMessage(fields(0, 'scene-decided'), 'host.scene', { ...scene, chase });
        expect(isUnityPracticeMessage(message), JSON.stringify(chase)).toBe(true);
      }
    });
  });

  describe('host.result and host.replay', () => {
    it('carries the situation after the ball, keeps the replay digest, and accepts the matching score', async () => {
      const four = FOUR();
      const chase = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 18,
        ballsLeft: 11,
        outcome: 'in_progress',
      });
      const plain = await resultMessage(four, 4, 1);
      const chased = await resultMessage(four, 4, 1, chase);
      expect(isUnityPracticeMessage(chased)).toBe(true);
      expect(chased.payload.chase).toEqual(chase);
      // The digest names the ball (record + result); a chase around it never changes it.
      expect(chased.payload.replayDigest).toBe(plain.payload.replayDigest);
      expect(chased.payload.replayDigest).toBe(await unityPracticeReplayDigest(four.record, four.result));
      const packet = await packUnityPracticeMessage(chased);
      expectSameMessage(await unpackUnityPracticePacket(packet), chased);
      const plainPacket = await packUnityPracticeMessage(plain);
      expect(packet.body.length - plainPacket.body.length).toBe(
        canonicalUnityPracticeJson(chase).length + ',"chase":'.length,
      );
    });

    it('keeps a Practice result byte-identical to one made without the argument', async () => {
      const four = FOUR();
      const withoutArgument = await makeUnityPracticeResolution(four.record, four.result, score(four, 4, 1));
      const withUndefined = await makeUnityPracticeResolution(four.record, four.result, score(four, 4, 1), undefined);
      expect(Object.hasOwn(withoutArgument, 'chase')).toBe(false);
      expect(canonicalUnityPracticeJson(withUndefined)).toBe(canonicalUnityPracticeJson(withoutArgument));
    });

    it('accepts the winning ball, the last-ball loss on balls and the wicket, each against its own score', async () => {
      const four = FOUR();
      const caught = CAUGHT();
      const won = makeUnityPracticeChase({ target: 4, maxBalls: 12, runsNeeded: 0, ballsLeft: 11, outcome: 'won' });
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 1, won))).toBe(true);
      // Won on the 12th ball: nothing left, still won.
      const wonLast = makeUnityPracticeChase({ target: 4, maxBalls: 12, runsNeeded: 0, ballsLeft: 0, outcome: 'won' });
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 12, wonLast))).toBe(true);
      // Balls out, target not reached (3 of 4).
      const lostBalls = makeUnityPracticeChase({
        target: 8,
        maxBalls: 12,
        runsNeeded: 4,
        ballsLeft: 0,
        outcome: 'lost_balls',
      });
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 12, lostBalls))).toBe(true);
      // A wicket on the 12th ball may be called either way by the host; both agree with the score.
      for (const outcome of ['lost_wicket', 'lost_balls'] as const) {
        const last = makeUnityPracticeChase({ target: 8, maxBalls: 12, runsNeeded: 8, ballsLeft: 0, outcome });
        expect(isUnityPracticeMessage(await resultMessage(caught, 0, 12, last)), outcome).toBe(true);
      }
      const wicketEarly = makeUnityPracticeChase({
        target: 8,
        maxBalls: 12,
        runsNeeded: 8,
        ballsLeft: 8,
        outcome: 'lost_wicket',
      });
      expect(isUnityPracticeMessage(await resultMessage(caught, 0, 4, wicketEarly))).toBe(true);
    });

    it('rejects a block that disagrees with the score it travels with', async () => {
      const four = FOUR();
      const caught = CAUGHT();
      const wrongNeeded = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 19,
        ballsLeft: 11,
        outcome: 'in_progress',
      });
      const wrongBalls = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 18,
        ballsLeft: 10,
        outcome: 'in_progress',
      });
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 1, wrongNeeded))).toBe(false);
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 1, wrongBalls))).toBe(false);
      // More balls faced than the chase has.
      const tooMany = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 18,
        ballsLeft: 0,
        outcome: 'lost_balls',
      });
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 13, tooMany))).toBe(false);
      // A wicket ball cannot be in progress, and lost_wicket needs a wicket.
      const inProgress = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 22,
        ballsLeft: 8,
        outcome: 'in_progress',
      });
      expect(isUnityPracticeMessage(await resultMessage(caught, 0, 4, inProgress))).toBe(false);
      const lostWicketNoWicket = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 18,
        ballsLeft: 11,
        outcome: 'lost_wicket',
      });
      expect(isUnityPracticeMessage(await resultMessage(four, 4, 1, lostWicketNoWicket))).toBe(false);
    });

    it('rejects an unknown key beside the chase on a result', async () => {
      const four = FOUR();
      const chase = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 18,
        ballsLeft: 11,
        outcome: 'in_progress',
      });
      const message = await resultMessage(four, 4, 1, chase);
      expect(isUnityPracticeMessage({ ...message, payload: { ...message.payload, extra: 1 } })).toBe(false);
    });

    it('carries the same block on the replay of the deciding ball', async () => {
      const four = FOUR();
      const won = makeUnityPracticeChase({ target: 4, maxBalls: 12, runsNeeded: 0, ballsLeft: 11, outcome: 'won' });
      const resolution = await makeUnityPracticeResolution(four.record, four.result, score(four, 4, 1), won);
      const replay = makeUnityPracticeMessage({ ...fields(9, 'replay-1'), deliveryId: 'delivery-1' }, 'host.replay', {
        resolution,
        speed: 1,
        diagnostics: false,
      });
      expect(isUnityPracticeMessage(replay)).toBe(true);
      const unpacked = await unpackUnityPracticePacket(await packUnityPracticeMessage(replay));
      expectSameMessage(unpacked, replay);
      const badReplay = makeUnityPracticeMessage(
        { ...fields(9, 'replay-2'), deliveryId: 'delivery-1' },
        'host.replay',
        {
          resolution: { ...resolution, chase: { ...won, runsNeeded: 1 } },
          speed: 1,
          diagnostics: false,
        },
      );
      expect(isUnityPracticeMessage(badReplay)).toBe(false);
    });

    it('never lets a score-inert Coach demonstration carry a chase', async () => {
      const four = FOUR();
      const plan = four.record.plan;
      const delivery = {
        overIndex: 0,
        ballIndex: four.record.ballIndex,
        plan,
        seed: four.record.seed,
        flight: four.result.flight,
        presentation: { learnCue: false, coach: null },
      };
      const plainResolution = await makeUnityPracticeResolution(four.record, four.result, score(four, 4, 1));
      const ok = makeUnityPracticeMessage(
        { ...fields(7, 'demo-1'), deliveryId: 'demo-delivery-1' },
        'host.demonstration',
        {
          delivery,
          resolution: plainResolution,
          speed: 1,
        },
      );
      expect(isUnityPracticeMessage(ok)).toBe(true);
      const chase = makeUnityPracticeChase({
        target: 22,
        maxBalls: 12,
        runsNeeded: 18,
        ballsLeft: 11,
        outcome: 'in_progress',
      });
      const chased = makeUnityPracticeMessage(
        { ...fields(7, 'demo-2'), deliveryId: 'demo-delivery-1' },
        'host.demonstration',
        {
          delivery,
          resolution: { ...plainResolution, chase },
          speed: 1,
        },
      );
      expect(isUnityPracticeMessage(chased)).toBe(false);
    });

    it('does not allow a chase on any other host message', () => {
      const initialize = makeUnityPracticeMessage(fields(0, 'init'), 'host.initialize', {
        locale: 'en-IN',
        pixelsPerDp: 1,
        quality: 'standard',
        deviceTier: 'full',
        handedness: 'right',
        assistance: 'play',
        reducedMotion: false,
        textScale: 1,
        highContrast: false,
        captions: true,
        audio: true,
        haptics: true,
        coordinateSystem: 'vande-striker-frame-v1',
        handednessPolicy: 'physics-right-handed-presentation-mirrors-once',
      });
      expect(isUnityPracticeMessage({ ...initialize, payload: { ...initialize.payload, chase: start } })).toBe(false);
    });
  });

  describe('against the real chase state of CHASE-CORE', () => {
    const def = makeChase('c000', 'standard');
    if (def === null) throw new Error('seed c000 must be in the chase pool');
    type Step = [runs: BallRuns, dismissal: Dismissal | null];
    const sixes: Step[] = Array.from({ length: 12 }, () => [6, null]);
    const dots: Step[] = Array.from({ length: 12 }, () => [0, null]);
    const scripts: Array<[string, Step[], ChaseState['result']]> = [
      ['sixes to the win', sixes, 'won'],
      ['dots until the balls run out', dots, 'lost_balls'],
      [
        'a wicket on the third ball',
        [
          [0, null],
          [0, null],
          [0, 'caught'],
        ],
        'lost_wicket',
      ],
      ['eleven dots and a wicket on the last ball', [...dots.slice(0, 11), [0, 'bowled']], 'lost_wicket'],
    ];

    it('starts a scene from the start state of the chase', () => {
      const block = chaseBridgeBlock(startChase(def));
      expect(block).not.toBeNull();
      const message = makeUnityPracticeMessage(fields(0, 'scene-real'), 'host.scene', { ...scene, chase: block! });
      expect(isUnityPracticeMessage(message)).toBe(true);
      expect(block).toMatchObject({
        target: def.target,
        maxBalls: 12,
        runsNeeded: def.target,
        ballsLeft: 12,
        outcome: 'in_progress',
      });
    });

    it.each(scripts)('packs a valid result after every ball of %s', async (_name, script, finalResult) => {
      let state = startChase(def);
      for (const [runs, dismissal] of script) {
        if (state.result !== 'in_progress') break;
        const due = dueBall(state.ballsFaced);
        state = chaseReducer(state, {
          type: 'ball',
          overIndex: due.overIndex,
          ballIndex: due.ballIndex,
          runs,
          dismissal,
        });
        const block = chaseBridgeBlock(state);
        expect(block).not.toBeNull();
        const resolved = dismissal === null ? FOUR() : CAUGHT();
        const message = await resultMessage(resolved, state.runs, state.ballsFaced, block!);
        expect(isUnityPracticeMessage(message), `${state.ballsFaced} balls, ${state.result}`).toBe(true);
        // The same figures survive the wire.
        const unpacked = await unpackUnityPracticePacket(await packUnityPracticeMessage(message));
        expectSameMessage(unpacked, message);
      }
      expect(state.result).toBe(finalResult);
      expect(chaseBridgeBlock(state)?.outcome).toBe(finalResult);
    });
  });

  describe('the shared fixture tests/fixtures/unity-practice/chase-v7.json', () => {
    interface Seal {
      sha256: string;
      bodyLength: number;
    }
    interface ChaseFixture {
      baseFixture: { file: string; payloadSha256: string };
      contractVersion: number;
      scenarios: Array<{
        id: string;
        baseCase: string;
        score: { balls: number; maxOvers: 10; runs: number; wickets: 0 | 1 };
        start: UnityPracticeChase;
        after: UnityPracticeChase;
        scene: Seal;
        result: Seal;
        replay: Seal | null;
      }>;
      vectors: Array<{ id: string; chase: string; score: string; accept: boolean }>;
    }
    interface PracticeFixture {
      payloadSha256: string;
      cases: Array<{ id: string; wire: { packets: Record<string, { body: string; sha256: string }> } }>;
    }
    const read = <T>(name: string): T =>
      JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/unity-practice', name), 'utf8')) as T;
    const chaseFixture = read<ChaseFixture>('chase-v7.json');
    const practice = read<PracticeFixture>('practice-v3.json');

    /** The recipe written in the fixture, applied as text: this is what the C# test does too. */
    function derive(base: string, kind: 'scene' | 'result' | 'replay', score: string, chase: string): string {
      const once = (haystack: string, needle: string, replacement: string) => {
        const at = haystack.indexOf(needle);
        expect(at, needle).toBeGreaterThanOrEqual(0);
        expect(haystack.indexOf(needle, at + 1), `${needle} twice`).toBe(-1);
        return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
      };
      const withScore = (body: string) => {
        const found = body.match(/"score":\{[^{}]*\}/g) ?? [];
        expect(found).toHaveLength(1);
        return body.replace(found[0] as string, `"score":${score}`);
      };
      if (kind === 'scene') return once(base, '"conditions":"', `"chase":${chase},"conditions":"`);
      if (kind === 'result') return once(withScore(base), '"payload":{', `"payload":{"chase":${chase},`);
      return once(withScore(base), '"resolution":{', `"resolution":{"chase":${chase},`);
    }

    it('is compact, current, and built on the Practice fixture it sits beside', () => {
      expect(chaseFixture.contractVersion).toBe(UNITY_PRACTICE_CONTRACT_VERSION);
      expect(chaseFixture.baseFixture.payloadSha256).toBe(practice.payloadSha256);
      expect(
        readFileSync(resolve(process.cwd(), 'tests/fixtures/unity-practice/chase-v7.json')).byteLength,
      ).toBeLessThan(30_000);
    });

    it.each(['in-progress', 'won', 'lost-balls'])(
      're-derives the %s packets byte for byte and unpacks them',
      async (id) => {
        const scenario = chaseFixture.scenarios.find((item) => item.id === id);
        expect(scenario, id).toBeDefined();
        const base = practice.cases.find((item) => item.id === scenario!.baseCase)!;
        const score = canonicalUnityPracticeJson(scenario!.score);
        const kinds = (scenario!.replay === null ? ['scene', 'result'] : ['scene', 'result', 'replay']) as Array<
          'scene' | 'result' | 'replay'
        >;
        for (const kind of kinds) {
          const body = derive(
            base.wire.packets[kind].body,
            kind,
            score,
            canonicalUnityPracticeJson(kind === 'scene' ? scenario!.start : scenario!.after),
          );
          const seal = scenario![kind]!;
          expect(body.length, `${id} ${kind} length`).toBe(seal.bodyLength);
          expect(await unityPracticeSha256(body), `${id} ${kind} sha256`).toBe(seal.sha256);
          const message = await unpackUnityPracticePacket({ body, sha256: seal.sha256 });
          expect(message.contractVersion).toBe(UNITY_PRACTICE_CONTRACT_VERSION);
          expect(JSON.stringify(canonicalUnityPracticeJson(message))).toBe(JSON.stringify(body));
        }
        expect(scenario!.replay !== null).toBe(id === 'won');
      },
    );

    it('evaluates the shared rule table exactly as the table says (the C# validator reads the same rows)', () => {
      expect(chaseFixture.vectors.length).toBeGreaterThanOrEqual(30);
      expect(new Set(chaseFixture.vectors.map((row) => row.id)).size).toBe(chaseFixture.vectors.length);
      for (const row of chaseFixture.vectors) {
        const chase: unknown = JSON.parse(row.chase);
        const score =
          row.score === '' ? undefined : (JSON.parse(row.score) as ChaseFixture['scenarios'][number]['score']);
        expect(isUnityPracticeChase(chase, score), row.id).toBe(row.accept);
      }
      expect(chaseFixture.vectors.some((row) => row.accept)).toBe(true);
      expect(chaseFixture.vectors.some((row) => !row.accept)).toBe(true);
    });
  });

  describe('a camera swing and the bridge (owner brief 2, section 8; ruling R-9)', () => {
    // The camera is captured and normalized in the TypeScript/WebView layer. What crosses the bridge is a NormalizedSwing, which
    // carries no input modality, so a swing the camera made is the same bytes as any other swing.
    const cameraSwing = {
      kind: 'attack' as const,
      startT: 0.31,
      directionDeg: 12,
      power: 0.64,
      elevation: 0,
      footwork: 'auto' as const,
    };

    it('passes in host.provisional_swing unchanged', async () => {
      const message = makeUnityPracticeMessage(
        { ...fields(4, 'camera-swing-1'), deliveryId: 'delivery-camera' },
        'host.provisional_swing',
        { atPerfMs: 12_345.5, calibrationMs: 38, swing: cameraSwing },
      );
      expect(isUnityPracticeMessage(message)).toBe(true);
      expectSameMessage(await unpackUnityPracticePacket(await packUnityPracticeMessage(message)), message);
    });

    it('passes in the record of a result and of its replay, whatever the modality that produced the swing', async () => {
      const plan = REFERENCE_OVER.balls[1];
      const seed = ballSeed(REFERENCE_OVER, 1);
      const flown = flight({
        plan,
        bowler,
        conditions: REFERENCE_CONDITIONS,
        seed,
        handedness: 'right',
        ball: REFERENCE_BALL,
      });
      const swing = { ...cameraSwing, startT: flown.idealContactT - batTravelMs('attack', cameraSwing.power) / 1_000 };
      const result = resolveDelivery({
        flight: flown,
        swing,
        field,
        bowler,
        conditions: REFERENCE_CONDITIONS,
        handedness: 'right',
        assist: 'real',
        tierToleranceMs: 0,
      });
      const record: DeliveryRecord = {
        version: PRACTICE_SIM_VERSION,
        overIndex: 0,
        ballIndex: 1,
        bowler,
        plan,
        seed,
        conditions: REFERENCE_CONDITIONS,
        ball: REFERENCE_BALL,
        field,
        handedness: 'right',
        assist: 'real',
        tierToleranceMs: 0,
        swing,
        runs: result.outcome.runs,
        dismissal: result.outcome.dismissal,
      };
      const resolved: Resolved = { record, result };
      const resultPacket = await resultMessage(resolved, result.outcome.runs, 2);
      expect(isUnityPracticeMessage(resultPacket)).toBe(true);
      expectSameMessage(await unpackUnityPracticePacket(await packUnityPracticeMessage(resultPacket)), resultPacket);
      expect(Object.keys(resultPacket.payload.record.swing ?? {}).sort()).toEqual([
        'directionDeg',
        'elevation',
        'footwork',
        'kind',
        'power',
        'startT',
      ]);
    });

    it('does not accept a camera as a Unity-captured pointer: Unity never sends one', () => {
      const pointer = {
        ...makeUnityPracticeMessage(fields(0, 'p'), 'host.scene', scene),
        sender: 'unity',
        type: 'unity.pointer',
        deliveryId: 'delivery-camera',
        payload: { phase: 'down', atUnityMs: 10, clockSampleId: 'clock-1', pointer: 'touch' },
      };
      expect(isUnityPracticeMessage(pointer)).toBe(true);
      for (const kind of ['mouse', 'pen', 'keyboard']) {
        expect(isUnityPracticeMessage({ ...pointer, payload: { ...pointer.payload, pointer: kind } }), kind).toBe(true);
      }
      expect(isUnityPracticeMessage({ ...pointer, payload: { ...pointer.payload, pointer: 'camera' } })).toBe(false);
      const gesture = {
        ...pointer,
        type: 'unity.gesture',
        payload: {
          retention: 'memory-until-resolution',
          clockSampleId: 'clock-1',
          input: {
            pointer: 'touch',
            surface: { width: 400, height: 800 },
            samples: [
              { t: 10, x: 100, y: 500 },
              { t: 20, x: 120, y: 420 },
            ],
          },
        },
      };
      expect(isUnityPracticeMessage(gesture)).toBe(true);
      expect(
        isUnityPracticeMessage({
          ...gesture,
          payload: { ...gesture.payload, input: { ...gesture.payload.input, pointer: 'camera' } },
        }),
      ).toBe(false);
    });
  });

  describe('the version', () => {
    it('refuses a v6 packet (a stale Unity export or host) and a future v8 packet, with a valid checksum', async () => {
      const message = makeUnityPracticeMessage(fields(0, 'scene-old'), 'host.scene', scene);
      for (const contractVersion of [6, 8]) {
        const body = canonicalUnityPracticeJson({ ...message, contractVersion });
        await expect(
          unpackUnityPracticePacket({ body, sha256: await unityPracticeSha256(body) }),
        ).rejects.toBeInstanceOf(UnityPracticeContractError);
        expect(() => parseUnityPracticeMessage(body)).toThrowError(UnityPracticeContractError);
      }
    });

    it('accepts the same message at v7', async () => {
      const message = makeUnityPracticeMessage(fields(0, 'scene-new'), 'host.scene', { ...scene, chase: start });
      const body = canonicalUnityPracticeJson(message);
      expect(parseUnityPracticeMessage(body)).toEqual(message);
    });
  });
});
