import { describe, expect, it } from 'vitest';
import {
  PRACTICE_SIM_VERSION,
  makeUnityPracticeMessage,
  packUnityPracticeMessage,
  unityPracticeReplayDigest,
  type UnityPracticeInitialize,
  type UnityPracticeMessage,
  type UnityPracticePayloadByType,
  type UnityPracticeResolution,
  type UnityPracticeScene,
  type UnityPracticeSenderFor,
  type UnityPracticeUnityMessageType,
} from '@/contracts';
import type {
  UnityPracticeAvailability,
  UnityPracticeBridge,
  UnityPracticeNativeError,
} from '@/platform/unityPractice';
import {
  UnityPracticeSessionCoordinator,
  type UnityPracticeCoordinatorEvent,
} from '@/practice/unity';
import { REFERENCE_BALL, REFERENCE_OVER } from '@/practice/game';
import { fixtureField, fixtureFlight, fixtureResult } from '../render3d/practiceFixtures';

const BUILD_ID = 'result-tail-build';
const SESSION_ID = 'result-tail-session';
const DELIVERY_ID = 'result-tail-delivery';

const initialize: UnityPracticeInitialize = {
  locale: 'en-IN',
  pixelsPerDp: 3,
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
};

const scene: UnityPracticeScene = {
  conditions: 'balanced',
  field: fixtureField(),
  fieldIntent: 'attack_outside_off',
  trainingObjective: 'reference',
  bowler: REFERENCE_OVER.bowler,
  ball: REFERENCE_BALL,
  handedness: 'right',
  batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
};

type IncomingType = UnityPracticeUnityMessageType | 'bridge.ack';

class ResultTailBridge implements UnityPracticeBridge {
  readonly sent: UnityPracticeMessage[] = [];
  unloads = 0;
  private unitySequence = 0;
  private clockIndex = 0;
  private messageListener: ((packet: Parameters<UnityPracticeBridge['launch']>[0], receivedPerfMs: number) => void) | null = null;

  async availability(): Promise<UnityPracticeAvailability> {
    return { available: true, reason: 'ready', unityVersion: '6000.3.test' };
  }

  async launch(packet: Parameters<UnityPracticeBridge['launch']>[0]): Promise<boolean> {
    return this.accept(packet);
  }

  async send(packet: Parameters<UnityPracticeBridge['send']>[0]): Promise<boolean> {
    return this.accept(packet);
  }

  async setVisible(): Promise<boolean> {
    return true;
  }

  async unload(): Promise<boolean> {
    this.unloads += 1;
    return true;
  }

  async onMessage(listener: NonNullable<ResultTailBridge['messageListener']>): Promise<() => Promise<void>> {
    this.messageListener = listener;
    return async () => {
      this.messageListener = null;
    };
  }

  async onError(listener: (error: UnityPracticeNativeError) => void): Promise<() => Promise<void>> {
    void listener;
    return async () => undefined;
  }

  async acknowledgeResult(): Promise<void> {
    const result = this.sent.findLast((message) => message.type === 'host.result');
    if (!result) throw new Error('No result is available to acknowledge.');
    await this.emit('bridge.ack', { acknowledgedMessageId: result.messageId });
  }

  async emit<T extends IncomingType>(
    type: T,
    payload: UnityPracticePayloadByType[T],
    deliveryId: string | null = null,
    receivedPerfMs = 0,
  ): Promise<void> {
    const message = makeUnityPracticeMessage(
      {
        buildId: BUILD_ID,
        sessionId: SESSION_ID,
        deliveryId,
        messageId: `unity:${this.unitySequence}:${type}`,
        sequence: this.unitySequence,
        sender: 'unity' as UnityPracticeSenderFor<T>,
      },
      type,
      payload,
    );
    this.unitySequence += 1;
    this.messageListener?.(await packUnityPracticeMessage(message), receivedPerfMs);
  }

  private async accept(packet: Parameters<UnityPracticeBridge['launch']>[0]): Promise<boolean> {
    const message = JSON.parse(packet.body) as UnityPracticeMessage;
    this.sent.push(message);
    if (message.type !== 'host.result') {
      await this.emit('bridge.ack', { acknowledgedMessageId: message.messageId });
    }
    if (message.type === 'host.initialize') {
      await this.emit('unity.ready', { renderer: 'Vulkan', unityVersion: '6000.3.test' });
    } else if (message.type === 'host.clock_sync') {
      const roundTripMs = [12, 4, 10, 8, 6][this.clockIndex];
      this.clockIndex += 1;
      const { sampleId, hostSendPerfMs } = message.payload;
      const unityReceiveMs = hostSendPerfMs - 50 + roundTripMs / 2;
      await this.emit(
        'unity.clock_sync',
        { sampleId, hostSendPerfMs, unityReceiveMs, unitySendMs: unityReceiveMs + 1 },
        null,
        hostSendPerfMs + roundTripMs + 1,
      );
    }
    return true;
  }
}

async function resolution(): Promise<UnityPracticeResolution> {
  const flight = fixtureFlight({ seed: 'result-tail-flight' });
  // This protocol-tail test is intentionally independent of synthetic bat-rig
  // geometry; a valid leave exercises the same result/ACK/dead lifecycle.
  const result = fixtureResult(flight, { kind: 'leave' });
  const record = {
      version: PRACTICE_SIM_VERSION,
      overIndex: 0,
      ballIndex: 0,
      bowler: REFERENCE_OVER.bowler,
      plan: flight.plan,
      seed: flight.seed,
      conditions: 'balanced',
      ball: REFERENCE_BALL,
      field: fixtureField(),
      handedness: 'right',
      assist: 'play',
      tierToleranceMs: 0,
      swing: result.swing,
      runs: result.outcome.runs,
      dismissal: result.outcome.dismissal,
    } as const;
  return {
    record,
    result,
    score: {
      runs: result.outcome.runs,
      wickets: result.outcome.dismissal === null ? 0 : 1,
      balls: 1,
      maxOvers: 10,
    },
    replayDigest: await unityPracticeReplayDigest(record, result),
  };
}

/** Waits, turn by turn, until the predicate holds. The ceiling is patience (it ends the moment the condition holds): a loaded machine needs time, not more turns. */
async function spinUntil(predicate: () => boolean, ceilingMs = 20_000): Promise<void> {
  const until = Date.now() + ceilingMs;
  do {
    if (predicate()) return;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  } while (Date.now() < until);
  throw new Error('condition did not become true');
}

describe('Unity Practice result-tail handling', () => {
  it('ignores verified late pointer and gesture packets without fallback, then accepts dead', async () => {
    const bridge = new ResultTailBridge();
    const events: UnityPracticeCoordinatorEvent[] = [];
    let perfMs = 1_000;
    const coordinator = new UnityPracticeSessionCoordinator({
      bridge,
      buildId: BUILD_ID,
      sessionId: SESSION_ID,
      initialize,
      calibrationMs: 0,
      ackTimeoutMs: 2_000,
      now: () => {
        const value = perfMs;
        perfMs += 100;
        return value;
      },
      onEvent: (event) => events.push(event),
    });

    expect(await coordinator.launch()).toBe(true);
    expect(await coordinator.setScene(scene)).toBe(true);
    const resolved = await resolution();
    expect(await coordinator.startDelivery(DELIVERY_ID, {
      overIndex: 0,
      ballIndex: 0,
      plan: resolved.record.plan,
      seed: resolved.record.seed,
      flight: resolved.result.flight,
      presentation: { learnCue: false, coach: null },
    })).toBe(true);

    const pendingResult = coordinator.sendResult(DELIVERY_ID, resolved);
    await spinUntil(() => bridge.sent.some((message) => message.type === 'host.result'));
    expect(coordinator.status).toBe('result_pending');

    const clockSampleId = `${SESSION_ID}:clock:2`;
    await bridge.emit('unity.pointer', {
      phase: 'down',
      atUnityMs: 2_010,
      clockSampleId,
      pointer: 'touch',
    }, DELIVERY_ID);
    await bridge.emit('unity.gesture', {
      retention: 'memory-until-resolution',
      clockSampleId,
      input: {
        pointer: 'touch',
        surface: { width: 400, height: 800 },
        samples: [
          { t: 2_010, x: 100, y: 500 },
          { t: 2_020, x: 110, y: 430 },
        ],
      },
    }, DELIVERY_ID);
    await coordinator.flushInbound();

    expect(coordinator.status).toBe('result_pending');
    expect(events.filter((event) => event.type === 'pointer' || event.type === 'gesture')).toEqual([]);
    expect(events.filter((event) => event.type === 'protocol_rejected' || event.type === 'fallback')).toEqual([]);
    expect(bridge.unloads).toBe(0);

    await bridge.acknowledgeResult();
    await coordinator.flushInbound();
    expect(await pendingResult).toBe(true);
    expect(coordinator.status).toBe('resolved');

    await bridge.emit('unity.gesture', {
      retention: 'memory-until-resolution',
      clockSampleId,
      input: {
        pointer: 'touch',
        surface: { width: 400, height: 800 },
        samples: [
          { t: 2_030, x: 110, y: 430 },
          { t: 2_040, x: 120, y: 350 },
        ],
      },
    }, DELIVERY_ID);
    await bridge.emit('unity.dead', {
      deadT: resolved.result.deadT,
      replayDigest: resolved.replayDigest,
    }, DELIVERY_ID);
    await coordinator.flushInbound();

    expect(events.filter((event) => event.type === 'pointer' || event.type === 'gesture')).toEqual([]);
    expect(events.filter((event) => event.type === 'protocol_rejected' || event.type === 'fallback')).toEqual([]);
    expect(events).toContainEqual({
      type: 'dead',
      deliveryId: DELIVERY_ID,
      deadT: resolved.result.deadT,
      replayDigest: resolved.replayDigest,
    });
    expect(coordinator.status).toBe('dead_ball');
    expect(bridge.unloads).toBe(0);
  });
});
