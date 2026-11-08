import { describe, expect, it } from 'vitest';
import {
  PRACTICE_SIM_VERSION,
  UNITY_PRACTICE_CONTRACT_VERSION,
  UnityPracticeContractError,
  UnityPracticeProtocolGuard,
  UnityPracticeSequenceGuard,
  canonicalUnityPracticeJson,
  isUnityPracticeMessage,
  makeUnityPracticeMessage,
  packUnityPracticeMessage,
  parseUnityPracticeMessage,
  unpackUnityPracticePacket,
  unityPracticeReplayDigest,
  unityPracticeSha256,
} from '@/contracts';
import type { UnityPracticeScene } from '@/contracts';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { REFERENCE_BALL, REFERENCE_CONDITIONS, REFERENCE_OVER, ballSeed } from '@/practice/game';

const initialize = () =>
  makeUnityPracticeMessage(
    {
      buildId: 'test-build',
      sessionId: 'session-1',
      messageId: 'host-1',
      sequence: 0,
      sender: 'host',
    },
    'host.initialize',
    {
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
    },
  );

const scene: UnityPracticeScene = {
  conditions: 'balanced',
  fieldIntent: 'attack_outside_off',
  trainingObjective: 'reference',
  field: {
    id: 'test-field',
    fielders: [
      { id: 'keeper', role: 'keeper', x: 0, z: 22 },
      { id: 'bowler', role: 'bowler', x: 0, z: -6 },
      { id: 'slip', role: 'slip', x: 3, z: 19 },
      { id: 'point', role: 'point', x: 20, z: 8 },
      { id: 'cover', role: 'cover', x: 20, z: -3 },
      { id: 'mid-off', role: 'mid_off', x: 9, z: -15 },
      { id: 'mid-on', role: 'mid_on', x: -9, z: -15 },
      { id: 'midwicket', role: 'midwicket', x: -19, z: -3 },
      { id: 'square-leg', role: 'square_leg', x: -20, z: 8 },
      { id: 'fine-leg', role: 'fine_leg', x: -14, z: 22 },
      { id: 'third-man', role: 'third_man', x: 14, z: 22 },
    ],
  },
  bowler: { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'test-bowler' },
  ball: { colour: 'white', age: 'new' },
  handedness: 'right',
  batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
};

const fields = <TSender extends 'host' | 'unity'>(sender: TSender, sequence: number, messageId: string) => ({
  buildId: 'test-build',
  sessionId: 'session-1',
  messageId,
  sequence,
  sender,
});

async function validDemonstrationPayload(seed = 'contract-demonstration') {
  const ballIndex = 0;
  const plan = REFERENCE_OVER.balls[ballIndex];
  const bowler = scene.bowler;
  const flown = flight({
    plan,
    bowler,
    conditions: scene.conditions,
    seed,
    handedness: scene.handedness,
    ball: scene.ball,
  });
  const swing = {
    kind: 'attack' as const,
    startT: flown.idealContactT - batTravelMs('attack', 0.72) / 1_000,
    directionDeg: 10,
    power: 0.72,
    elevation: 0,
    footwork: 'auto' as const,
  };
  const result = resolveDelivery({
    flight: flown,
    swing,
    field: scene.field,
    bowler,
    conditions: scene.conditions,
    handedness: scene.handedness,
    assist: 'play',
    tierToleranceMs: 0,
  });
  const record = {
    version: PRACTICE_SIM_VERSION,
    overIndex: 0,
    ballIndex,
    bowler,
    plan,
    seed,
    conditions: scene.conditions,
    ball: scene.ball,
    field: scene.field,
    handedness: scene.handedness,
    assist: 'play' as const,
    tierToleranceMs: 0,
    swing,
    runs: result.outcome.runs,
    dismissal: result.outcome.dismissal,
  };
  const resolution = {
    record,
    result,
    score: {
      runs: result.outcome.runs,
      wickets: (result.outcome.dismissal === null ? 0 : 1) as 0 | 1,
      balls: 1,
      maxOvers: 10 as const,
    },
    replayDigest: await unityPracticeReplayDigest(record, result),
  };
  return {
    delivery: {
      overIndex: 0,
      ballIndex,
      plan,
      seed,
      flight: flown,
      presentation: { learnCue: false, coach: null },
    },
    resolution,
    speed: 1,
  } as const;
}

describe('Unity Practice bridge contract', () => {
  it('stamps an independent bridge version and the authoritative simulation version', () => {
    expect(initialize()).toMatchObject({
      contractVersion: UNITY_PRACTICE_CONTRACT_VERSION,
      simVersion: PRACTICE_SIM_VERSION,
      deliveryId: null,
      sender: 'host',
      type: 'host.initialize',
    });
  });

  it('strictly carries bounded text scale and high contrast in initialization', () => {
    const base = initialize();
    expect(base.payload).toMatchObject({ pixelsPerDp: 1, textScale: 1, highContrast: false, reducedMotion: false });
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, pixelsPerDp: 8 } })).toBe(true);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, pixelsPerDp: 0.99 } })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, pixelsPerDp: 8.01 } })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, pixelsPerDp: Number.NaN } })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, textScale: 2, highContrast: true } })).toBe(
      true,
    );
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, textScale: 0.99 } })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, textScale: 2.01 } })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, textScale: Number.NaN } })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, highContrast: 'yes' } })).toBe(false);
    const { textScale: _missing, ...withoutTextScale } = base.payload;
    expect(isUnityPracticeMessage({ ...base, payload: withoutTextScale })).toBe(false);
  });

  it('strictly carries the authoritative field intent and training objective in scenes', () => {
    const message = makeUnityPracticeMessage(fields('host', 1, 'scene-context'), 'host.scene', scene);
    expect(isUnityPracticeMessage(message)).toBe(true);
    expect(isUnityPracticeMessage({ ...message, payload: { ...message.payload, fieldIntent: 'unknown' } })).toBe(false);
    expect(
      isUnityPracticeMessage({ ...message, payload: { ...message.payload, trainingObjective: 'challenge' } }),
    ).toBe(false);
    const { fieldIntent: _intent, ...withoutIntent } = message.payload;
    expect(isUnityPracticeMessage({ ...message, payload: withoutIntent })).toBe(false);
    const { trainingObjective: _objective, ...withoutObjective } = message.payload;
    expect(isUnityPracticeMessage({ ...message, payload: withoutObjective })).toBe(false);
  });

  it('canonicalizes keys and negative zero without changing array order', () => {
    expect(canonicalUnityPracticeJson({ z: -0, b: [2, 1], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"b":[2,1],"z":0}',
    );
  });

  it('round-trips a checksummed packet', async () => {
    const message = initialize();
    const packet = await packUnityPracticeMessage(message);
    expect(packet.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await unpackUnityPracticePacket(packet)).toEqual(message);
  });

  it('strictly validates a v6 score-inert demonstration, its digest, and its exact cancel packet', async () => {
    const payload = await validDemonstrationPayload();
    const message = makeUnityPracticeMessage(
      {
        ...fields('host', 1, 'demonstration-1'),
        deliveryId: 'demonstration-1',
      },
      'host.demonstration',
      payload,
    );
    expect(isUnityPracticeMessage(message)).toBe(true);
    expect(await unpackUnityPracticePacket(await packUnityPracticeMessage(message))).toEqual(message);

    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          delivery: { ...message.payload.delivery, seed: 'different-seed' },
        },
      }),
    ).toBe(false);
    expect(isUnityPracticeMessage({ ...message, payload: { ...message.payload, scoreMutation: true } })).toBe(false);
    const forgedDigest = {
      ...message,
      payload: {
        ...message.payload,
        resolution: { ...message.payload.resolution, replayDigest: 'f'.repeat(64) },
      },
    };
    expect(isUnityPracticeMessage(forgedDigest)).toBe(true);
    await expect(packUnityPracticeMessage(forgedDigest)).rejects.toMatchObject({ code: 'integrity' });

    const cancel = makeUnityPracticeMessage(
      {
        ...fields('host', 2, 'demonstration-cancel-1'),
        deliveryId: 'demonstration-1',
      },
      'host.demonstration_cancel',
      {},
    );
    expect(isUnityPracticeMessage(cancel)).toBe(true);
    expect(isUnityPracticeMessage({ ...cancel, payload: { reason: 'skip' } })).toBe(false);
    expect(isUnityPracticeMessage({ ...cancel, deliveryId: null })).toBe(false);
  });

  it('bounds every envelope identifier to the native 256-character contract', () => {
    const base = initialize();
    const edge = 'x'.repeat(256);
    expect(isUnityPracticeMessage({ ...base, buildId: edge, sessionId: edge, messageId: edge })).toBe(true);
    expect(isUnityPracticeMessage({ ...base, buildId: `${edge}x` })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, sessionId: `${edge}x` })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, messageId: `${edge}x` })).toBe(false);
    expect(isUnityPracticeMessage({ ...base, buildId: 'bad\nidentifier' })).toBe(false);
  });

  it('fails closed on tampering and incompatible versions', async () => {
    const packet = await packUnityPracticeMessage(initialize());
    await expect(unpackUnityPracticePacket({ ...packet, body: `${packet.body} ` })).rejects.toMatchObject({
      code: 'integrity',
    });

    const incompatible = JSON.stringify({ ...initialize(), contractVersion: 99 });
    expect(() => parseUnityPracticeMessage(incompatible)).toThrowError(UnityPracticeContractError);
  });

  it('rejects a correctly hashed but non-canonical body', async () => {
    const body = JSON.stringify(initialize(), null, 2);
    await expect(unpackUnityPracticePacket({ body, sha256: await unityPracticeSha256(body) })).rejects.toMatchObject({
      code: 'integrity',
    });
  });

  it('couples sender direction to message type at construction and validation', () => {
    const forged = { ...initialize(), sender: 'unity' };
    expect(isUnityPracticeMessage(forged)).toBe(false);
    expect(() =>
      makeUnityPracticeMessage(
        { ...fields('host', 1, 'forged'), sender: 'unity' as 'host' },
        'host.initialize',
        initialize().payload,
      ),
    ).toThrow(/cannot emit/);
  });

  it('bounds and strictly validates ephemeral Unity gesture traces', () => {
    const gesture = {
      ...initialize(),
      sender: 'unity',
      type: 'unity.gesture',
      deliveryId: 'delivery-1',
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
    expect(isUnityPracticeMessage({ ...gesture, deliveryId: null })).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...gesture,
        payload: {
          ...gesture.payload,
          input: {
            ...gesture.payload.input,
            samples: [
              { t: 20, x: 0, y: 0 },
              { t: 10, x: 1, y: 1 },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...gesture,
        payload: { ...gesture.payload, input: { ...gesture.payload.input, forbidden: 'persist-me' } },
      }),
    ).toBe(false);
  });

  it('strictly bounds the v3 dead-ball UI and action message set', () => {
    const digest = 'a'.repeat(64);
    const ui = makeUnityPracticeMessage(
      {
        ...fields('host', 1, 'dead-ui'),
        deliveryId: 'delivery-1',
      },
      'host.dead_ball_ui',
      {
        replayDigest: digest,
        reason: 'Reading your shot…',
        recommendation: '',
        primaryAction: 'practice_ball',
        primaryLabel: 'Practice this ball',
        secondaryAction: 'next_ball',
        secondaryLabel: 'Next ball',
      },
    );
    expect(isUnityPracticeMessage(ui)).toBe(true);
    expect(isUnityPracticeMessage({ ...ui, payload: { ...ui.payload, hiddenControl: true } })).toBe(false);
    expect(isUnityPracticeMessage({ ...ui, payload: { ...ui.payload, replayDigest: digest.toUpperCase() } })).toBe(
      false,
    );
    expect(isUnityPracticeMessage({ ...ui, payload: { ...ui.payload, reason: '' } })).toBe(false);
    expect(isUnityPracticeMessage({ ...ui, payload: { ...ui.payload, reason: `bad\nreason` } })).toBe(false);
    expect(isUnityPracticeMessage({ ...ui, payload: { ...ui.payload, reason: 'x'.repeat(161) } })).toBe(false);
    expect(isUnityPracticeMessage({ ...ui, payload: { ...ui.payload, primaryLabel: 'x'.repeat(65) } })).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...ui,
        payload: { ...ui.payload, primaryAction: 'next_ball', secondaryAction: 'next_ball', secondaryLabel: 'Next' },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...ui,
        payload: {
          ...ui.payload,
          primaryAction: 'next_ball',
          primaryLabel: 'Next ball',
          secondaryAction: null,
          secondaryLabel: null,
        },
      }),
    ).toBe(true);

    const action = makeUnityPracticeMessage(
      {
        ...fields('unity', 1, 'dead-action'),
        deliveryId: 'delivery-1',
      },
      'unity.dead_ball_action',
      { action: 'practice_ball', replayDigest: digest },
    );
    expect(isUnityPracticeMessage(action)).toBe(true);
    expect(isUnityPracticeMessage({ ...action, payload: { ...action.payload, replayDigest: 'A'.repeat(64) } })).toBe(
      false,
    );
    expect(isUnityPracticeMessage({ ...action, payload: { ...action.payload, action: 'replay' } })).toBe(false);
    expect(isUnityPracticeMessage({ ...action, payload: { ...action.payload, extra: true } })).toBe(false);
  });

  it('rejects values outside the bounded Unity float and trace-time domains', () => {
    const ballIndex = 0;
    const plan = REFERENCE_OVER.balls[ballIndex];
    const bowler = REFERENCE_OVER.bowler;
    const seed = ballSeed(REFERENCE_OVER, ballIndex);
    const flown = flight({
      plan,
      bowler,
      conditions: REFERENCE_CONDITIONS,
      seed,
      handedness: 'right',
      ball: REFERENCE_BALL,
    });
    const delivery = makeUnityPracticeMessage(
      {
        ...fields('host', 1, 'delivery-float-domain'),
        deliveryId: 'delivery-float-domain',
      },
      'host.delivery',
      {
        overIndex: 0,
        ballIndex,
        plan,
        seed,
        flight: flown,
        presentation: { learnCue: false, coach: null },
      },
    );
    const provisional = makeUnityPracticeMessage(
      {
        ...fields('host', 2, 'swing-float-domain'),
        deliveryId: 'delivery-float-domain',
      },
      'host.provisional_swing',
      {
        atPerfMs: 1_000,
        calibrationMs: 0,
        swing: { kind: 'attack', startT: 0.25, directionDeg: 10, power: 0.7, elevation: 0.2, footwork: 'auto' },
      },
    );

    expect(isUnityPracticeMessage(delivery)).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...delivery,
        payload: {
          ...delivery.payload,
          presentation: {
            learnCue: false,
            coach: { stage: 3, contactT: flown.idealContactT, contactPoint: flown.samples.at(-1)!.p },
          },
        },
      }),
    ).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...delivery,
        payload: {
          ...delivery.payload,
          presentation: {
            learnCue: true,
            coach: { stage: 3, contactT: flown.idealContactT, contactPoint: flown.samples.at(-1)!.p },
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...delivery,
        payload: {
          ...delivery.payload,
          presentation: {
            learnCue: false,
            coach: { stage: 4, contactT: flown.idealContactT, contactPoint: flown.samples.at(-1)!.p },
          },
        },
      }),
    ).toBe(false);
    expect(isUnityPracticeMessage(provisional)).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...makeUnityPracticeMessage(fields('host', 0, 'scene-float-domain'), 'host.scene', scene),
        payload: {
          ...scene,
          field: {
            ...scene.field,
            fielders: scene.field.fielders.map((fielder, index) =>
              index === 0 ? { ...fielder, x: 1_000_001 } : fielder,
            ),
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...delivery,
        payload: {
          ...delivery.payload,
          flight: { ...flown, release: { ...flown.release, spinRps: 1_000_001 } },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...delivery,
        payload: {
          ...delivery.payload,
          flight: {
            ...flown,
            samples: flown.samples.map((sample, index) =>
              index === 0 ? { ...sample, p: { ...sample.p, x: Number.MAX_VALUE } } : sample,
            ),
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...delivery,
        payload: {
          ...delivery.payload,
          flight: {
            ...flown,
            samples: flown.samples.map((sample, index) =>
              index === flown.samples.length - 1 ? { ...sample, t: 31 } : sample,
            ),
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...provisional,
        payload: { ...provisional.payload, swing: { ...provisional.payload.swing, directionDeg: 1_000_001 } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...provisional,
        payload: { ...provisional.payload, swing: { ...provisional.payload.swing, startT: 31 } },
      }),
    ).toBe(false);
  });

  it('accepts a complete production-engine result and binds its exact replay digest', async () => {
    const ballIndex = 2;
    const plan = REFERENCE_OVER.balls[ballIndex];
    const bowler = REFERENCE_OVER.bowler;
    const seed = ballSeed(REFERENCE_OVER, ballIndex);
    const field = autoField(bowler, REFERENCE_CONDITIONS, 'right', REFERENCE_BALL);
    const flown = flight({
      plan,
      bowler,
      conditions: REFERENCE_CONDITIONS,
      seed,
      handedness: 'right',
      ball: REFERENCE_BALL,
    });
    const swing = {
      kind: 'attack' as const,
      startT: flown.idealContactT - batTravelMs('attack', 0.72) / 1000,
      directionDeg: 10,
      power: 0.72,
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
    const record = {
      version: PRACTICE_SIM_VERSION,
      overIndex: 0,
      ballIndex,
      bowler,
      plan,
      seed,
      conditions: REFERENCE_CONDITIONS,
      ball: REFERENCE_BALL,
      field,
      handedness: 'right' as const,
      assist: 'real' as const,
      tierToleranceMs: 0,
      swing,
      runs: result.outcome.runs,
      dismissal: result.outcome.dismissal,
    };
    const replayDigest = await unityPracticeReplayDigest(record, result);
    const message = makeUnityPracticeMessage(
      {
        ...fields('host', 5, 'result-1'),
        deliveryId: 'delivery-1',
      },
      'host.result',
      {
        record,
        result,
        score: {
          runs: result.outcome.runs,
          wickets: result.outcome.dismissal === null ? 0 : 1,
          balls: 1,
          maxOvers: 10,
        },
        replayDigest,
      },
    );
    expect(isUnityPracticeMessage(message)).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterRootOffset: { x: 0.18, z: 0 } } },
      }),
    ).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterRootOffset: { x: 0.1800000000001, z: 0 } } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterRootOffset: { x: 0, z: 0, y: 0 } } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterRootOffset: { x: Number.NaN, z: 0 } } },
      }),
    ).toBe(false);
    const { batterBodyFrame: _missingBodyFrame, ...withoutBodyFrame } = result;
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: withoutBodyFrame },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: {
            ...result,
            batterBodyFrame: {
              ...result.batterBodyFrame,
              stance: { ...result.batterBodyFrame.stance, inferred: true },
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: {
            ...result,
            batterBodyFrame: {
              ...result.batterBodyFrame,
              stance: { ...result.batterBodyFrame.stance, x: 3.000001 },
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: {
            ...result,
            batterBodyFrame: {
              ...result.batterBodyFrame,
              headCentre: { ...result.batterBodyFrame.headCentre, y: result.batterBodyFrame.torsoTop.y - 0.001 },
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterPosture: { crouchM: 0.18 } } },
      }),
    ).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterPosture: { crouchM: 0.1800000000001 } } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, result: { ...result, batterPosture: { crouchM: 0, inferred: true } } },
      }),
    ).toBe(false);
    const noBatResult = {
      ...result,
      batterRootOffset: { x: 0, z: 0 },
      batterPosture: { crouchM: 0 },
      batterMotion: null,
      bat: [],
      contact: { ...result.contact, kind: 'miss' as const, t: null, point: null, bladeU: null },
      events: result.events.filter(
        (event) =>
          !(
            event.kind === 'contact' &&
            ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'].includes(event.contact ?? '')
          ),
      ),
    };
    const noBatMessage = {
      ...message,
      payload: { ...message.payload, result: noBatResult },
    };
    expect(isUnityPracticeMessage(noBatMessage)).toBe(true);
    expect(
      isUnityPracticeMessage({
        ...noBatMessage,
        payload: { ...noBatMessage.payload, result: { ...noBatResult, batterRootOffset: { x: 0.0000011, z: 0 } } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...noBatMessage,
        payload: { ...noBatMessage.payload, result: { ...noBatResult, batterPosture: { crouchM: 0.0000011 } } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: { ...message.payload, score: { ...message.payload.score, runs: 361 } },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: {
            ...result,
            ball: result.ball.map((sample, index) => (index === 0 ? { ...sample, t: 0.0000011 } : sample)),
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: {
            ...result,
            fielders: result.fielders.map((path, index) =>
              index === 1 ? { ...path, fielderId: result.fielders[0].fielderId } : path,
            ),
          },
        },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: { ...result, events: Array.from({ length: 1_025 }, () => result.events[0]) },
        },
      }),
    ).toBe(false);
    const falseDigest = 'a'.repeat(64) === replayDigest ? 'b'.repeat(64) : 'a'.repeat(64);
    const falseIdentity = { ...message, payload: { ...message.payload, replayDigest: falseDigest } };
    expect(isUnityPracticeMessage(falseIdentity)).toBe(true);
    await expect(packUnityPracticeMessage(falseIdentity)).rejects.toMatchObject({ code: 'integrity' });
    const forgedBody = canonicalUnityPracticeJson(falseIdentity);
    await expect(
      unpackUnityPracticePacket({
        body: forgedBody,
        sha256: await unityPracticeSha256(forgedBody),
      }),
    ).rejects.toMatchObject({ code: 'integrity' });
    if (result.bat.length >= 2) {
      expect(result.batterMotion).not.toBeNull();
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: { ...message.payload, result: { ...result, batterMotion: null } },
        }),
      ).toBe(false);
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: {
            ...message.payload,
            result: {
              ...result,
              batterMotion: { ...result.batterMotion!, startT: result.batterMotion!.startT + 0.001 },
            },
          },
        }),
      ).toBe(false);
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: {
            ...message.payload,
            result: {
              ...result,
              batterMotion: { ...result.batterMotion!, contactT: result.batterMotion!.endT + 0.001 },
            },
          },
        }),
      ).toBe(false);
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: {
            ...message.payload,
            result: {
              ...result,
              bat: result.bat.map((sample, index) => (index === 1 ? { ...sample, t: result.bat[0].t } : sample)),
            },
          },
        }),
      ).toBe(false);

      const invalidLength = result.bat.map((sample, index) =>
        index === 0 ? { ...sample, toe: { ...sample.toe, x: sample.toe.x + 0.01 } } : sample,
      );
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: { ...message.payload, result: { ...result, bat: invalidLength } },
        }),
      ).toBe(false);

      const invalidFace = result.bat.map((sample, index) =>
        index === 0 ? { ...sample, face: { x: 0, y: 0, z: 0 } } : sample,
      );
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: { ...message.payload, result: { ...result, bat: invalidFace } },
        }),
      ).toBe(false);

      const invalidTime = result.bat.map((sample, index) => (index === 0 ? { ...sample, t: -0.001 } : sample));
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: { ...message.payload, result: { ...result, bat: invalidTime } },
        }),
      ).toBe(false);
    }

    const batContactEvent = result.events.find(
      (event) =>
        event.kind === 'contact' &&
        ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'].includes(event.contact ?? ''),
    );
    if (batContactEvent && result.bat.length > 0) {
      const exactIndex = result.bat.findIndex((sample) => Math.abs(sample.t - batContactEvent.t) <= 1e-12);
      expect(exactIndex).toBeGreaterThanOrEqual(0);
      const independentMotionPeak = result.bat.find(
        (sample) =>
          sample.t > result.batterMotion!.startT &&
          sample.t < result.batterMotion!.endT &&
          Math.abs(sample.t - batContactEvent.t) > 1e-12,
      );
      expect(independentMotionPeak).toBeDefined();
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: {
            ...message.payload,
            result: {
              ...result,
              batterMotion: { ...result.batterMotion!, contactT: independentMotionPeak!.t },
            },
          },
        }),
      ).toBe(true);
      const near = { ...result.bat[exactIndex], t: batContactEvent.t - 5e-13 };
      const ambiguous = [...result.bat.slice(0, exactIndex), near, ...result.bat.slice(exactIndex)];
      expect(
        isUnityPracticeMessage({
          ...message,
          payload: { ...message.payload, result: { ...result, bat: ambiguous } },
        }),
      ).toBe(false);
    }
    expect(
      isUnityPracticeMessage({
        ...message,
        payload: {
          ...message.payload,
          result: {
            ...result,
            fielders: result.fielders.map((fielder, index) =>
              index === 0
                ? {
                    ...fielder,
                    samples: fielder.samples.map((sample, sampleIndex) =>
                      sampleIndex === 0 ? { ...sample, x: 1_000_001 } : sample,
                    ),
                  }
                : fielder,
            ),
          },
        },
      }),
    ).toBe(false);
    expect(replayDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalUnityPracticeJson(await unpackUnityPracticePacket(await packUnityPracticeMessage(message)))).toBe(
      canonicalUnityPracticeJson(message),
    );
  });

  it('rejects non-finite, undefined and cyclic canonical data', () => {
    expect(() => canonicalUnityPracticeJson({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalUnityPracticeJson({ value: undefined })).toThrow(/undefined/);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalUnityPracticeJson(cyclic)).toThrow(/cycle/);
  });

  it('makes duplicate delivery idempotent and rejects a new stale sequence', () => {
    const guard = new UnityPracticeSequenceGuard();
    expect(guard.accept({ messageId: 'a', sequence: 4 })).toBe('accept');
    expect(guard.accept({ messageId: 'a', sequence: 4 })).toBe('duplicate');
    expect(guard.accept({ messageId: 'b', sequence: 3 })).toBe('out_of_order');
    expect(guard.accept({ messageId: 'c', sequence: 5 })).toBe('accept');
  });

  it('requires readiness, five matched clock samples, an explicit selected clock and handedness before scene setup', () => {
    const guard = new UnityPracticeProtocolGuard();
    const initial = initialize();
    expect(guard.accept(initial)).toBe('accept');
    expect(guard.accept(initial)).toBe('duplicate');
    expect(guard.phase).toBe('loading');

    const ready = makeUnityPracticeMessage(fields('unity', 0, 'unity-ready'), 'unity.ready', {
      renderer: 'Vulkan',
      unityVersion: '6000.3.test',
    });
    expect(guard.accept(ready)).toBe('accept');
    expect(guard.phase).toBe('ready');

    const tooEarly = makeUnityPracticeMessage(fields('host', 1, 'scene-too-early'), 'host.scene', scene);
    expect(guard.accept(tooEarly)).toBe('clock_unsynchronized');

    for (let index = 0; index < 5; index++) {
      const sampleId = `clock-${index}`;
      const hostSendPerfMs = 100 + index * 10;
      expect(
        guard.accept(
          makeUnityPracticeMessage(fields('host', index + 1, `ping-${index}`), 'host.clock_sync', {
            sampleId,
            hostSendPerfMs,
          }),
        ),
      ).toBe('accept');
      expect(
        guard.accept(
          makeUnityPracticeMessage(fields('unity', index + 1, `pong-${index}`), 'unity.clock_sync', {
            sampleId,
            hostSendPerfMs,
            unityReceiveMs: 500 + index * 10,
            unitySendMs: 501 + index * 10,
          }),
        ),
      ).toBe('accept');
      if (index === 2) expect(guard.clockReady).toBe(false);
    }
    expect(guard.clockReady).toBe(true);
    expect(
      guard.accept(makeUnityPracticeMessage(fields('host', 6, 'scene-before-selection'), 'host.scene', scene)),
    ).toBe('clock_unsynchronized');
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('host', 6, 'select-clock'), 'host.clock_selected', {
          sampleId: 'clock-1',
        }),
      ),
    ).toBe('accept');
    expect(guard.accept(makeUnityPracticeMessage(fields('host', 7, 'scene'), 'host.scene', scene))).toBe('accept');
    expect(guard.phase).toBe('scene_ready');

    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('host', 8, 'locale'), 'host.locale', {
          locale: 'hi-Latn',
        }),
      ),
    ).toBe('accept');
    expect(
      isUnityPracticeMessage({
        ...makeUnityPracticeMessage(fields('host', 9, 'bad-locale'), 'host.locale', { locale: 'hi' }),
        payload: { locale: 'hi', extra: true },
      }),
    ).toBe(false);

    const benchmark = makeUnityPracticeMessage(fields('host', 9, 'benchmark'), 'host.benchmark', {
      benchmarkId: 'benchmark-1',
      durationMs: 1_400,
      warmupFrames: 30,
      sampleCap: 180,
      quality: 'standard',
    });
    expect(guard.accept(benchmark)).toBe('accept');
    const benchmarkResult = {
      benchmarkId: 'benchmark-1',
      quality: 'standard' as const,
      frameIntervalsMs: [16.7, 16.6, 16.8],
      warmup: { frames: 30, durationMs: 520, shaderWarmupMs: 42, shaderWarmupCompleted: true },
      graphics: { api: 'Vulkan', device: 'Adreno 619', contextGeneration: null, contextLosses: null },
      memoryMb: 220,
      thermalState: 'nominal' as const,
    };
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('unity', 6, 'wrong-benchmark'), 'unity.benchmark', {
          ...benchmarkResult,
          benchmarkId: 'stale-benchmark',
        }),
      ),
    ).toBe('benchmark_mismatch');
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('unity', 6, 'benchmark-result'), 'unity.benchmark', benchmarkResult),
      ),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('unity', 7, 'pause-request'), 'unity.pause_request', {
          reason: 'player',
        }),
      ),
    ).toBe('accept');
  });

  it('rejects oversized, uncorrelated or embellished native benchmark evidence', () => {
    const base = makeUnityPracticeMessage(fields('unity', 0, 'benchmark-result'), 'unity.benchmark', {
      benchmarkId: 'benchmark-1',
      quality: 'standard',
      frameIntervalsMs: [16.7],
      warmup: { frames: 30, durationMs: 500, shaderWarmupMs: null, shaderWarmupCompleted: false },
      graphics: { api: 'Vulkan', device: 'Adreno', contextGeneration: null, contextLosses: null },
      memoryMb: null,
      thermalState: 'unknown',
    });
    expect(isUnityPracticeMessage(base)).toBe(true);
    expect(isUnityPracticeMessage({ ...base, payload: { ...base.payload, hidden: true } })).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...base,
        payload: { ...base.payload, frameIntervalsMs: Array.from({ length: 1_201 }, () => 16.7) },
      }),
    ).toBe(false);
    expect(
      isUnityPracticeMessage({
        ...base,
        payload: { ...base.payload, warmup: { ...base.payload.warmup, shaderWarmupMs: -1 } },
      }),
    ).toBe(false);
  });

  it('treats verified input after an authoritative result as inert protocol tail without weakening correlation', async () => {
    const guard = new UnityPracticeProtocolGuard();
    expect(guard.accept(initialize())).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('unity', 0, 'tail-ready'), 'unity.ready', {
          renderer: 'Vulkan',
          unityVersion: '6000.3.test',
        }),
      ),
    ).toBe('accept');

    for (let index = 0; index < 5; index += 1) {
      const sampleId = `tail-clock-${index}`;
      const hostSendPerfMs = 1_000 + index * 10;
      expect(
        guard.accept(
          makeUnityPracticeMessage(fields('host', index + 1, `tail-ping-${index}`), 'host.clock_sync', {
            sampleId,
            hostSendPerfMs,
          }),
        ),
      ).toBe('accept');
      expect(
        guard.accept(
          makeUnityPracticeMessage(fields('unity', index + 1, `tail-pong-${index}`), 'unity.clock_sync', {
            sampleId,
            hostSendPerfMs,
            unityReceiveMs: hostSendPerfMs - 48,
            unitySendMs: hostSendPerfMs - 47,
          }),
        ),
      ).toBe('accept');
    }
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('host', 6, 'tail-clock-selected'), 'host.clock_selected', {
          sampleId: 'tail-clock-1',
        }),
      ),
    ).toBe('accept');
    expect(guard.accept(makeUnityPracticeMessage(fields('host', 7, 'tail-scene'), 'host.scene', scene))).toBe('accept');

    const ballIndex = 0;
    const plan = REFERENCE_OVER.balls[ballIndex];
    const bowler = scene.bowler;
    const seed = ballSeed(REFERENCE_OVER, ballIndex);
    const flown = flight({
      plan,
      bowler,
      conditions: scene.conditions,
      seed,
      handedness: scene.handedness,
      ball: scene.ball,
    });
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('host', 8, 'tail-delivery'),
            deliveryId: 'delivery-1',
          },
          'host.delivery',
          {
            overIndex: 0,
            ballIndex,
            plan,
            seed,
            flight: flown,
            presentation: { learnCue: false, coach: null },
          },
        ),
      ),
    ).toBe('accept');

    const swing = {
      kind: 'attack' as const,
      startT: flown.idealContactT - batTravelMs('attack', 0.72) / 1_000,
      directionDeg: 10,
      power: 0.72,
      elevation: 0,
      footwork: 'auto' as const,
    };
    const result = resolveDelivery({
      flight: flown,
      swing,
      field: scene.field,
      bowler,
      conditions: scene.conditions,
      handedness: scene.handedness,
      assist: 'play',
      tierToleranceMs: 0,
    });
    const record = {
      version: PRACTICE_SIM_VERSION,
      overIndex: 0,
      ballIndex,
      bowler,
      plan,
      seed,
      conditions: scene.conditions,
      ball: scene.ball,
      field: scene.field,
      handedness: scene.handedness,
      assist: 'play' as const,
      tierToleranceMs: 0,
      swing,
      runs: result.outcome.runs,
      dismissal: result.outcome.dismissal,
    };
    const replayDigest = await unityPracticeReplayDigest(record, result);
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('host', 9, 'tail-result'),
            deliveryId: 'delivery-1',
          },
          'host.result',
          {
            record,
            result,
            score: {
              runs: result.outcome.runs,
              wickets: result.outcome.dismissal === null ? 0 : 1,
              balls: 1,
              maxOvers: 10,
            },
            replayDigest,
          },
        ),
      ),
    ).toBe('accept');
    expect(guard.phase).toBe('resolved');

    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 6, 'tail-pointer'),
            deliveryId: 'delivery-1',
          },
          'unity.pointer',
          {
            phase: 'down',
            atUnityMs: 2_010,
            clockSampleId: 'tail-clock-1',
            pointer: 'touch',
          },
        ),
      ),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 7, 'tail-gesture'),
            deliveryId: 'delivery-1',
          },
          'unity.gesture',
          {
            retention: 'memory-until-resolution',
            clockSampleId: 'tail-clock-1',
            input: {
              pointer: 'touch',
              surface: { width: 400, height: 800 },
              samples: [
                { t: 2_010, x: 100, y: 500 },
                { t: 2_020, x: 110, y: 430 },
              ],
            },
          },
        ),
      ),
    ).toBe('accept');

    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 8, 'tail-wrong-delivery'),
            deliveryId: 'delivery-2',
          },
          'unity.pointer',
          {
            phase: 'down',
            atUnityMs: 2_030,
            clockSampleId: 'tail-clock-1',
            pointer: 'touch',
          },
        ),
      ),
    ).toBe('delivery_mismatch');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 8, 'tail-wrong-clock'),
            deliveryId: 'delivery-1',
          },
          'unity.pointer',
          {
            phase: 'down',
            atUnityMs: 2_030,
            clockSampleId: 'tail-clock-4',
            pointer: 'touch',
          },
        ),
      ),
    ).toBe('clock_mismatch');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 8, 'tail-wrong-session'),
            sessionId: 'session-2',
            deliveryId: 'delivery-1',
          },
          'unity.pointer',
          {
            phase: 'down',
            atUnityMs: 2_030,
            clockSampleId: 'tail-clock-1',
            pointer: 'touch',
          },
        ),
      ),
    ).toBe('session_mismatch');

    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 8, 'tail-dead'),
            deliveryId: 'delivery-1',
          },
          'unity.dead',
          {
            deadT: result.deadT,
            replayDigest,
          },
        ),
      ),
    ).toBe('accept');
    expect(guard.phase).toBe('dead_ball');

    const deadUi = {
      replayDigest,
      reason: 'Reading your shot…',
      recommendation: '',
      primaryAction: 'practice_ball' as const,
      primaryLabel: 'Practice this ball',
      secondaryAction: 'next_ball' as const,
      secondaryLabel: 'Next ball',
    };
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('host', 10, 'tail-dead-ui-initial'),
            deliveryId: 'delivery-1',
          },
          'host.dead_ball_ui',
          deadUi,
        ),
      ),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('host', 11, 'tail-dead-ui-ready'),
            deliveryId: 'delivery-1',
          },
          'host.dead_ball_ui',
          {
            ...deadUi,
            reason: 'You played too early',
            recommendation: 'Wait for the ball',
          },
        ),
      ),
    ).toBe('accept');

    expect(
      guard.accept(makeUnityPracticeMessage(fields('host', 12, 'tail-pause'), 'host.pause', { reason: 'background' })),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 9, 'tail-action-paused'),
            deliveryId: 'delivery-1',
          },
          'unity.dead_ball_action',
          { action: 'practice_ball', replayDigest },
        ),
      ),
    ).toBe('action_unavailable');
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('host', 13, 'tail-resume'), 'host.resume', { reason: 'foreground' }),
      ),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 10, 'tail-action-foreground-held'),
            deliveryId: 'delivery-1',
          },
          'unity.dead_ball_action',
          { action: 'practice_ball', replayDigest },
        ),
      ),
    ).toBe('action_unavailable');
    expect(
      guard.accept(
        makeUnityPracticeMessage(fields('host', 14, 'tail-player-resume'), 'host.resume', { reason: 'player' }),
      ),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 11, 'tail-action-wrong-digest'),
            deliveryId: 'delivery-1',
          },
          'unity.dead_ball_action',
          { action: 'practice_ball', replayDigest: 'b'.repeat(64) },
        ),
      ),
    ).toBe('replay_mismatch');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 11, 'tail-action'),
            deliveryId: 'delivery-1',
          },
          'unity.dead_ball_action',
          { action: 'practice_ball', replayDigest },
        ),
      ),
    ).toBe('accept');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('unity', 12, 'tail-action-duplicate'),
            deliveryId: 'delivery-1',
          },
          'unity.dead_ball_action',
          { action: 'next_ball', replayDigest },
        ),
      ),
    ).toBe('duplicate_action');
    expect(
      guard.accept(
        makeUnityPracticeMessage(
          {
            ...fields('host', 15, 'tail-dead-ui-after-action'),
            deliveryId: 'delivery-1',
          },
          'host.dead_ball_ui',
          deadUi,
        ),
      ),
    ).toBe('accept');
  });
});
