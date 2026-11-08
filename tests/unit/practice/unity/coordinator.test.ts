import { describe, expect, it, vi } from 'vitest';
import {
  PRACTICE_SIM_VERSION,
  makeUnityPracticeMessage,
  makeUnityPracticeResolution,
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
import { NATIVE_TIMEOUT_MS } from '@/platform/capacitor';
import {
  UNITY_PRACTICE_ACK_TIMEOUT_MS,
  UNITY_PRACTICE_LAUNCH_TIMEOUT_MS,
  UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS,
  UnityPracticeClock,
  UnityPracticeSessionCoordinator,
  normalizeEphemeralUnityGesture,
  type UnityPracticeCoordinatorEvent,
  type UnityPracticeTimers,
} from '@/practice/unity';
import { REFERENCE_BALL, REFERENCE_OVER } from '@/practice/game';
import { fixtureField, fixtureFlight, fixtureResult } from '../../render3d/practiceFixtures';

const BUILD_ID = 'unity-coordinator-test';
const SESSION_ID = 'session-one';
const DELIVERY_ID = 'delivery-one';

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
  trainingObjective: 'random',
  bowler: REFERENCE_OVER.bowler,
  ball: REFERENCE_BALL,
  handedness: 'right',
  batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
};

class ManualTimers implements UnityPracticeTimers {
  private next = 0;
  private elapsedMs = 0;
  private readonly callbacks = new Map<number, { callback: () => void; dueMs: number }>();

  set(callback: () => void, delayMs: number): number {
    this.next += 1;
    this.callbacks.set(this.next, { callback, dueMs: this.elapsedMs + delayMs });
    return this.next;
  }

  clear(handle: unknown): void {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  fireAll(): void {
    const callbacks = [...this.callbacks.values()].map(({ callback }) => callback);
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }

  advanceBy(ms: number): void {
    const target = this.elapsedMs + ms;
    while (true) {
      const due = [...this.callbacks.entries()]
        .filter(([, timer]) => timer.dueMs <= target)
        .sort((left, right) => left[1].dueMs - right[1].dueMs || left[0] - right[0])[0];
      if (!due) break;
      this.callbacks.delete(due[0]);
      this.elapsedMs = due[1].dueMs;
      due[1].callback();
    }
    this.elapsedMs = target;
  }
}

type IncomingType = UnityPracticeUnityMessageType | 'bridge.ack';

class FakeUnityBridge implements UnityPracticeBridge {
  readonly sent: UnityPracticeMessage[] = [];
  readonly clockSampleIds: string[] = [];
  readonly omitAckFor = new Set<string>();
  unloads = 0;
  emitUnloadedOnDispose = false;
  omitReadyOnInitialize = false;
  private unitySequence = 0;
  private messageListener:
    ((packet: Parameters<UnityPracticeBridge['launch']>[0], receivedPerfMs: number) => void) | null = null;
  private errorListener: ((error: UnityPracticeNativeError) => void) | null = null;
  private clockIndex = 0;

  async availability(): Promise<UnityPracticeAvailability> {
    return { available: true, reason: 'ready', unityVersion: '6000.3.test' };
  }

  async launch(packet: Parameters<UnityPracticeBridge['launch']>[0]): Promise<boolean> {
    return this.accept(packet);
  }

  async send(packet: Parameters<UnityPracticeBridge['send']>[0]): Promise<boolean> {
    return this.accept(packet);
  }

  async unload(): Promise<boolean> {
    this.unloads += 1;
    return true;
  }

  async setVisible(): Promise<boolean> {
    return true;
  }

  async onMessage(listener: NonNullable<FakeUnityBridge['messageListener']>): Promise<() => Promise<void>> {
    this.messageListener = listener;
    return async () => {
      this.messageListener = null;
    };
  }

  async onError(listener: (error: UnityPracticeNativeError) => void): Promise<() => Promise<void>> {
    this.errorListener = listener;
    return async () => {
      this.errorListener = null;
    };
  }

  fail(code = 'unity_runtime'): void {
    this.errorListener?.({ code, detail: 'injected native failure', operationId: null });
  }

  async acknowledgeLast(type: UnityPracticeMessage['type']): Promise<void> {
    const message = this.sent.findLast((candidate) => candidate.type === type);
    if (!message) throw new Error(`No ${type} message is available to acknowledge.`);
    await this.emit('bridge.ack', { acknowledgedMessageId: message.messageId });
  }

  async emit<T extends IncomingType>(
    type: T,
    payload: UnityPracticePayloadByType[T],
    deliveryId: string | null = null,
    receivedPerfMs = 0,
    deliver = true,
  ): Promise<Parameters<UnityPracticeBridge['launch']>[0]> {
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
    const packet = await packUnityPracticeMessage(message);
    if (deliver) this.messageListener?.(packet, receivedPerfMs);
    return packet;
  }

  deliver(packet: Parameters<UnityPracticeBridge['launch']>[0], receivedPerfMs = 0): void {
    this.messageListener?.(packet, receivedPerfMs);
  }

  private async accept(packet: Parameters<UnityPracticeBridge['launch']>[0]): Promise<boolean> {
    const message = JSON.parse(packet.body) as UnityPracticeMessage;
    this.sent.push(message);
    if (!this.omitAckFor.has(message.type)) {
      await this.emit('bridge.ack', { acknowledgedMessageId: message.messageId });
    }
    if (message.type === 'host.initialize') {
      if (!this.omitReadyOnInitialize) {
        await this.emit('unity.ready', { renderer: 'Vulkan', unityVersion: '6000.3.test' });
      }
    } else if (message.type === 'host.clock_sync') {
      const roundTripMs = [12, 4, 10, 8, 6][this.clockIndex];
      this.clockIndex += 1;
      const { sampleId, hostSendPerfMs } = message.payload;
      this.clockSampleIds.push(sampleId);
      const unityReceiveMs = hostSendPerfMs - 50 + roundTripMs / 2;
      await this.emit(
        'unity.clock_sync',
        { sampleId, hostSendPerfMs, unityReceiveMs, unitySendMs: unityReceiveMs + 1 },
        null,
        hostSendPerfMs + roundTripMs + 1,
      );
    } else if (message.type === 'host.benchmark') {
      await this.emit('unity.benchmark', {
        benchmarkId: message.payload.benchmarkId,
        quality: message.payload.quality,
        frameIntervalsMs: [16.7, 16.6, 16.8],
        warmup: {
          frames: message.payload.warmupFrames,
          durationMs: 480,
          shaderWarmupMs: 37,
          shaderWarmupCompleted: true,
        },
        graphics: { api: 'Vulkan', device: 'Adreno 619', contextGeneration: null, contextLosses: null },
        memoryMb: 230,
        thermalState: 'nominal',
      });
    } else if (message.type === 'host.dispose' && this.emitUnloadedOnDispose) {
      await this.emit('unity.unloaded', { retainedMemoryMb: 196 });
    }
    return true;
  }
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

function harness(options: { useDefaultAckTimeout?: boolean } = {}) {
  const bridge = new FakeUnityBridge();
  const timers = new ManualTimers();
  const events: UnityPracticeCoordinatorEvent[] = [];
  let perfMs = 1_000;
  const coordinator = new UnityPracticeSessionCoordinator({
    bridge,
    buildId: BUILD_ID,
    sessionId: SESSION_ID,
    initialize,
    calibrationMs: 0,
    ...(options.useDefaultAckTimeout ? {} : { ackTimeoutMs: 25 }),
    timers,
    now: () => {
      const value = perfMs;
      perfMs += 100;
      return value;
    },
    onEvent: (event) => events.push(event),
  });
  return { bridge, timers, events, coordinator };
}

async function startAtScene(h: ReturnType<typeof harness>): Promise<void> {
  expect(await h.coordinator.launch()).toBe(true);
  expect(await h.coordinator.setScene(scene)).toBe(true);
}

async function resolution(flight = fixtureFlight({ seed: 'coordinator-flight' })): Promise<UnityPracticeResolution> {
  const result = fixtureResult(flight, { kind: 'drive' });
  const record = {
    version: PRACTICE_SIM_VERSION,
    overIndex: 0,
    ballIndex: 0,
    bowler: REFERENCE_OVER.bowler,
    plan: flight.plan,
    seed: flight.seed,
    conditions: 'balanced' as const,
    ball: REFERENCE_BALL,
    field: fixtureField(),
    handedness: 'right' as const,
    assist: 'play' as const,
    tierToleranceMs: 0,
    swing: result.swing,
    runs: result.outcome.runs,
    dismissal: result.outcome.dismissal,
  };
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

function demonstration(resolved: UnityPracticeResolution) {
  return {
    delivery: {
      overIndex: resolved.record.overIndex,
      ballIndex: resolved.record.ballIndex,
      plan: resolved.record.plan,
      seed: resolved.record.seed,
      flight: resolved.result.flight,
      presentation: { learnCue: false, coach: null },
    },
    resolution: resolved,
    speed: 1,
  } as const;
}

describe('Unity Practice session coordinator', () => {
  it('keeps the protocol ACK budget above the bounded native transport budget', () => {
    expect(UNITY_PRACTICE_ACK_TIMEOUT_MS).toBeGreaterThan(NATIVE_TIMEOUT_MS);
    expect(UNITY_PRACTICE_ACK_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS).toBeGreaterThan(UNITY_PRACTICE_ACK_TIMEOUT_MS);
    expect(UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('accepts launch ACK and ready after the former 12 s boundary but before the independent outer cap', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    h.bridge.omitAckFor.add('host.initialize');
    h.bridge.omitReadyOnInitialize = true;

    const pending = h.coordinator.launch();
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.initialize'));
    h.timers.advanceBy(12_001);
    expect(h.coordinator.status).toBe('launching');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.bridge.unloads).toBe(0);

    await h.bridge.acknowledgeLast('host.initialize');
    await h.bridge.emit('unity.ready', { renderer: 'Vulkan', unityVersion: '6000.3.test' });
    await h.coordinator.flushInbound();

    expect(await pending).toBe(true);
    expect(h.coordinator.status).toBe('synchronized');
    expect(h.events.filter((event) => event.type === 'ready')).toHaveLength(1);
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.bridge.unloads).toBe(0);
  });

  it('falls back and unloads once at the independent outer cap, and late launch ACK and ready cannot revive it', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    h.bridge.omitAckFor.add('host.initialize');
    h.bridge.omitReadyOnInitialize = true;

    const pending = h.coordinator.launch();
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.initialize'));
    h.timers.advanceBy(UNITY_PRACTICE_LAUNCH_TIMEOUT_MS - 1);
    expect(h.coordinator.status).toBe('launching');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.bridge.unloads).toBe(0);

    h.timers.advanceBy(1);
    expect(await pending).toBe(false);
    expect(h.coordinator.status).toBe('fallback');
    expect(h.events.filter((event) => event.type === 'fallback')).toHaveLength(1);
    expect(h.bridge.unloads).toBe(1);

    await h.bridge.acknowledgeLast('host.initialize');
    await h.bridge.emit('unity.ready', { renderer: 'Vulkan', unityVersion: '6000.3.test' });
    await h.coordinator.flushInbound();

    expect(h.coordinator.status).toBe('fallback');
    expect(h.events.filter((event) => event.type === 'ready')).toEqual([]);
    expect(h.events.filter((event) => event.type === 'fallback')).toHaveLength(1);
    expect(h.bridge.unloads).toBe(1);
    expect(await h.coordinator.launch()).toBe(false);
  });

  it('accepts a validated native delivery ACK after the former 1.5 s deadline', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'slow-native-delivery-ack' });
    h.bridge.omitAckFor.add('host.delivery');

    const pending = h.coordinator.startDelivery(DELIVERY_ID, {
      overIndex: 0,
      ballIndex: 0,
      plan: flight.plan,
      seed: flight.seed,
      flight,
      presentation: { learnCue: false, coach: null },
    });
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.delivery'));
    h.timers.advanceBy(2_216);
    expect(h.coordinator.status).toBe('delivery_pending');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.bridge.unloads).toBe(0);

    await h.bridge.acknowledgeLast('host.delivery');
    await h.coordinator.flushInbound();
    expect(await pending).toBe(true);
    expect(h.coordinator.status).toBe('delivery');
    expect(h.bridge.unloads).toBe(0);
  });

  it('still fails closed once the default 5 s delivery ACK budget is exhausted', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'missing-native-delivery-ack' });
    h.bridge.omitAckFor.add('host.delivery');

    const pending = h.coordinator.startDelivery(DELIVERY_ID, {
      overIndex: 0,
      ballIndex: 0,
      plan: flight.plan,
      seed: flight.seed,
      flight,
      presentation: { learnCue: false, coach: null },
    });
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.delivery'));
    h.timers.advanceBy(UNITY_PRACTICE_ACK_TIMEOUT_MS - 1);
    expect(h.coordinator.status).toBe('delivery_pending');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);

    h.timers.advanceBy(1);
    expect(await pending).toBe(false);
    expect(h.events).toContainEqual({
      type: 'fallback',
      reason: 'ack_timeout:host.delivery',
      inFlightDeliveryId: DELIVERY_ID,
    });
    expect(h.coordinator.status).toBe('fallback');
    expect(h.bridge.unloads).toBe(1);
  });

  it('accepts a validated native result ACK after the ordinary 5 s deadline', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'slow-native-result-ack' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    h.bridge.omitAckFor.add('host.result');

    const pending = h.coordinator.sendResult(DELIVERY_ID, await resolution(flight));
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.result'));
    h.timers.advanceBy(7_000);
    expect(h.coordinator.status).toBe('result_pending');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.bridge.unloads).toBe(0);

    await h.bridge.acknowledgeLast('host.result');
    await h.coordinator.flushInbound();
    expect(await pending).toBe(true);
    expect(h.coordinator.status).toBe('resolved');
    expect(h.bridge.unloads).toBe(0);
  });

  it('accepts a validated native replay ACK after the ordinary 5 s deadline', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'slow-native-replay-ack' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    h.bridge.omitAckFor.add('host.replay');

    const pending = h.coordinator.replay(DELIVERY_ID, {
      resolution: resolved,
      speed: 0.5,
      diagnostics: false,
    });
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.replay'));
    h.timers.advanceBy(7_000);
    expect(h.coordinator.status).toBe('replay_pending');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.bridge.unloads).toBe(0);

    await h.bridge.acknowledgeLast('host.replay');
    await h.coordinator.flushInbound();
    expect(await pending).toBe(true);
    expect(h.coordinator.status).toBe('replaying');
    expect(h.bridge.unloads).toBe(0);
  });

  it('rejects a false result replay identity before result phase or sequence mutation', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'false-result-identity' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    const falseDigest = resolved.replayDigest === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);

    expect(await h.coordinator.sendResult(DELIVERY_ID, { ...resolved, replayDigest: falseDigest })).toBe(false);
    expect(h.bridge.sent.some((message) => message.type === 'host.result')).toBe(false);
    expect(h.events).toContainEqual({
      type: 'fallback',
      reason: 'replay_identity:host.result',
      inFlightDeliveryId: DELIVERY_ID,
    });
  });

  it('rejects a false nested replay identity before replay phase or sequence mutation', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'false-replay-identity' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    const falseDigest = resolved.replayDigest === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);

    expect(
      await h.coordinator.replay(DELIVERY_ID, {
        resolution: { ...resolved, replayDigest: falseDigest },
        speed: 0.5,
        diagnostics: false,
      }),
    ).toBe(false);
    expect(h.bridge.sent.some((message) => message.type === 'host.replay')).toBe(false);
    expect(h.events).toContainEqual({
      type: 'fallback',
      reason: 'replay_identity:host.replay',
      inFlightDeliveryId: DELIVERY_ID,
    });
  });

  it('uses an explicit short ACK override for both result and replay messages', async () => {
    const resultHarness = harness();
    await startAtScene(resultHarness);
    const resultFlight = fixtureFlight({ seed: 'short-result-override' });
    expect(
      await resultHarness.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: resultFlight.plan,
        seed: resultFlight.seed,
        flight: resultFlight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    resultHarness.bridge.omitAckFor.add('host.result');
    const pendingResult = resultHarness.coordinator.sendResult(DELIVERY_ID, await resolution(resultFlight));
    await spinUntil(() => resultHarness.bridge.sent.some((message) => message.type === 'host.result'));
    resultHarness.timers.advanceBy(24);
    expect(resultHarness.coordinator.status).toBe('result_pending');
    resultHarness.timers.advanceBy(1);
    expect(await pendingResult).toBe(false);
    expect(resultHarness.events).toContainEqual({
      type: 'fallback',
      reason: 'ack_timeout:host.result',
      inFlightDeliveryId: DELIVERY_ID,
    });

    const replayHarness = harness();
    await startAtScene(replayHarness);
    const replayFlight = fixtureFlight({ seed: 'short-replay-override' });
    expect(
      await replayHarness.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: replayFlight.plan,
        seed: replayFlight.seed,
        flight: replayFlight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(replayFlight);
    expect(await replayHarness.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    replayHarness.bridge.omitAckFor.add('host.replay');
    const pendingReplay = replayHarness.coordinator.replay(DELIVERY_ID, {
      resolution: resolved,
      speed: 0.5,
      diagnostics: false,
    });
    await spinUntil(() => replayHarness.bridge.sent.some((message) => message.type === 'host.replay'));
    replayHarness.timers.advanceBy(24);
    expect(replayHarness.coordinator.status).toBe('replay_pending');
    replayHarness.timers.advanceBy(1);
    expect(await pendingReplay).toBe(false);
    expect(replayHarness.events).toContainEqual({
      type: 'fallback',
      reason: 'ack_timeout:host.replay',
      inFlightDeliveryId: DELIVERY_ID,
    });
  });

  it('cannot be revived by a result ACK that arrives after the 10 s fallback', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'late-result-ack' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    h.bridge.omitAckFor.add('host.result');
    const pending = h.coordinator.sendResult(DELIVERY_ID, await resolution(flight));
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.result'));
    h.timers.advanceBy(UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS);
    expect(await pending).toBe(false);
    expect(h.coordinator.status).toBe('fallback');

    await h.bridge.acknowledgeLast('host.result');
    await h.coordinator.flushInbound();
    expect(h.coordinator.status).toBe('fallback');
    expect(h.events.filter((event) => event.type === 'result_committed')).toEqual([]);
    expect(h.events.filter((event) => event.type === 'fallback')).toHaveLength(1);
  });

  it('ACK-gates launch/scene/delivery, takes five clock samples and converts pointer and gesture time', async () => {
    const h = harness();
    expect(await h.coordinator.setScene(scene)).toBe(false);
    await startAtScene(h);

    expect(h.coordinator.snapshot()).toMatchObject({
      status: 'scene_ready',
      clockSamples: 5,
      selectedClock: { sampleId: `${SESSION_ID}:clock:2`, roundTripMs: 4, hostMinusUnityMs: 50 },
    });
    expect(h.bridge.sent.filter((message) => message.type === 'host.clock_sync')).toHaveLength(5);
    expect(h.bridge.sent.find((message) => message.type === 'host.clock_selected')?.payload).toEqual({
      sampleId: `${SESSION_ID}:clock:2`,
    });

    expect(await h.coordinator.setLocale('hi')).toBe(true);
    expect(h.bridge.sent.find((message) => message.type === 'host.locale')?.payload).toEqual({ locale: 'hi' });

    const flight = fixtureFlight({ seed: 'delivery-flight' });
    const first = h.coordinator.startDelivery(DELIVERY_ID, {
      overIndex: 0,
      ballIndex: 0,
      plan: flight.plan,
      seed: flight.seed,
      flight,
      presentation: { learnCue: false, coach: null },
    });
    const duplicate = h.coordinator.startDelivery(DELIVERY_ID, {
      overIndex: 0,
      ballIndex: 0,
      plan: flight.plan,
      seed: flight.seed,
      flight,
      presentation: { learnCue: false, coach: null },
    });
    expect(first).toBe(duplicate);
    expect(await first).toBe(true);
    expect(h.bridge.sent.filter((message) => message.type === 'host.delivery')).toHaveLength(1);

    const clockSampleId = h.bridge.clockSampleIds[1];
    await h.bridge.emit('unity.release', { releaseUnityMs: 2_000, clockSampleId }, DELIVERY_ID);
    await h.bridge.emit(
      'unity.pointer',
      { phase: 'down', atUnityMs: 2_010, clockSampleId, pointer: 'touch' },
      DELIVERY_ID,
    );
    await h.bridge.emit(
      'unity.gesture',
      {
        retention: 'memory-until-resolution',
        clockSampleId,
        input: {
          pointer: 'touch',
          surface: { width: 400, height: 800 },
          samples: [
            { t: 2_010, x: 100, y: 500 },
            { t: 2_020, x: 101, y: 501 },
          ],
        },
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();

    expect(h.events).toContainEqual({ type: 'release', deliveryId: DELIVERY_ID, releasePerfMs: 2_050 });
    expect(h.events).toContainEqual({
      type: 'pointer',
      deliveryId: DELIVERY_ID,
      phase: 'down',
      atPerfMs: 2_060,
      pointer: 'touch',
    });
    expect(h.events.find((event) => event.type === 'gesture')).toEqual({
      type: 'gesture',
      deliveryId: DELIVERY_ID,
      swing: { kind: 'defend', startT: 0.01, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' },
    });
    expect(JSON.stringify(h.events)).not.toContain('"samples"');
  });

  it('sends a result exactly once and emits a repeated dead packet exactly once', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'exactly-once-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    const first = h.coordinator.sendResult(DELIVERY_ID, resolved);
    const duplicate = h.coordinator.sendResult(DELIVERY_ID, resolved);
    expect(first).toBe(duplicate);
    expect(await first).toBe(true);
    expect(h.bridge.sent.filter((message) => message.type === 'host.result')).toHaveLength(1);

    const dead = await h.bridge.emit(
      'unity.dead',
      { deadT: resolved.result.deadT, replayDigest: resolved.replayDigest },
      DELIVERY_ID,
    );
    h.bridge.deliver(dead);
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead')).toHaveLength(1);
    expect(h.coordinator.status).toBe('dead_ball');
  });

  it('completes a score-inert demonstration and preserves the last real dead-ball identity', async () => {
    const h = harness();
    await startAtScene(h);
    const liveFlight = fixtureFlight({ seed: 'live-before-demonstration' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: liveFlight.plan,
        seed: liveFlight.seed,
        flight: liveFlight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const live = await resolution(liveFlight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, live)).toBe(true);
    await h.bridge.emit(
      'unity.dead',
      {
        deadT: live.result.deadT,
        replayDigest: live.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();

    const demoId = 'demonstration-one';
    const demo = await resolution(fixtureFlight({ seed: 'recommended-demonstration' }));
    expect(await h.coordinator.demonstrate(demoId, demonstration(demo))).toBe(true);
    expect(h.coordinator.status).toBe('demonstrating');
    expect(h.events).toContainEqual({ type: 'demonstration_started', deliveryId: demoId });
    expect(h.bridge.sent.filter((message) => message.type === 'host.demonstration')).toHaveLength(1);

    await h.bridge.emit(
      'unity.dead',
      {
        deadT: demo.result.deadT,
        replayDigest: demo.replayDigest,
      },
      demoId,
    );
    await h.coordinator.flushInbound();

    expect(h.coordinator.status).toBe('dead_ball');
    expect(h.events).toContainEqual({
      type: 'demonstration_complete',
      deliveryId: demoId,
      deadT: demo.result.deadT,
      replayDigest: demo.replayDigest,
    });
    expect(h.events.filter((event) => event.type === 'dead')).toHaveLength(1);
    expect(
      await h.coordinator.sendDeadBallUi(DELIVERY_ID, {
        replayDigest: live.replayDigest,
        reason: 'Original ball',
        recommendation: 'Keep watching it',
        primaryAction: 'next_ball',
        primaryLabel: 'Next ball',
        secondaryAction: null,
        secondaryLabel: null,
      }),
    ).toBe(true);
    expect(
      await h.coordinator.replay(DELIVERY_ID, {
        resolution: live,
        speed: 0.3,
        diagnostics: true,
      }),
    ).toBe(true);
  });

  it('cancels a pending demonstration at an ACK boundary and ignores its queued native tail', async () => {
    const h = harness();
    await startAtScene(h);
    const demoId = 'demonstration-cancelled';
    const resolved = await resolution(fixtureFlight({ seed: 'cancelled-demonstration' }));
    h.bridge.omitAckFor.add('host.demonstration');
    h.bridge.omitAckFor.add('host.demonstration_cancel');

    const started = h.coordinator.demonstrate(demoId, demonstration(resolved));
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.demonstration'));
    expect(h.coordinator.status).toBe('demonstration_pending');
    const cancelled = h.coordinator.cancelDemonstration(demoId);

    h.bridge.omitAckFor.delete('host.demonstration');
    await h.bridge.acknowledgeLast('host.demonstration');
    await h.coordinator.flushInbound();
    expect(await started).toBe(true);
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.demonstration_cancel'));
    expect(h.bridge.sent.filter((message) => message.type === 'host.demonstration_cancel')).toHaveLength(1);

    // These packets can be queued by the renderer before its cancel ACK. They
    // must consume Unity sequence numbers without becoming a real delivery.
    await h.bridge.emit(
      'unity.release',
      {
        releaseUnityMs: 2_000,
        clockSampleId: h.bridge.clockSampleIds[1],
      },
      demoId,
    );
    await h.bridge.emit(
      'unity.protected_regions',
      {
        regions: [{ kind: 'ball_path', x: 10, y: 10, width: 30, height: 40 }],
        viewportHeight: 200,
        viewportWidth: 300,
      },
      demoId,
    );
    await h.bridge.emit(
      'unity.dead',
      {
        deadT: resolved.result.deadT,
        replayDigest: resolved.replayDigest,
      },
      demoId,
    );
    h.bridge.omitAckFor.delete('host.demonstration_cancel');
    await h.bridge.acknowledgeLast('host.demonstration_cancel');
    await h.coordinator.flushInbound();
    expect(await cancelled).toBe(true);
    expect(h.coordinator.status).toBe('scene_ready');
    expect(h.events).toContainEqual({ type: 'demonstration_cancelled', deliveryId: demoId });
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    expect(h.events.some((event) => event.type === 'demonstration_complete')).toBe(false);

    const liveId = 'delivery-after-demonstration-cancel';
    expect(await h.coordinator.startDelivery(liveId, demonstration(resolved).delivery)).toBe(true);
    await h.bridge.emit(
      'unity.release',
      {
        releaseUnityMs: 2_100,
        clockSampleId: h.bridge.clockSampleIds[1],
      },
      liveId,
    );
    await h.coordinator.flushInbound();
    expect(h.coordinator.status).toBe('delivery');
    expect(h.events).toContainEqual(expect.objectContaining({ type: 'release', deliveryId: liveId }));
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
  });

  it('never lets an immediate cancel overtake demonstration digest verification and start', async () => {
    const h = harness();
    await startAtScene(h);
    const demoId = 'demonstration-immediate-cancel';
    const resolved = await resolution(fixtureFlight({ seed: 'immediate-cancel-demonstration' }));

    const started = h.coordinator.demonstrate(demoId, demonstration(resolved));
    const cancelled = h.coordinator.cancelDemonstration(demoId);

    expect(await started).toBe(true);
    expect(await cancelled).toBe(true);
    const startIndex = h.bridge.sent.findIndex((message) => message.type === 'host.demonstration');
    const cancelIndex = h.bridge.sent.findIndex((message) => message.type === 'host.demonstration_cancel');
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(cancelIndex).toBeGreaterThan(startIndex);
    expect(h.coordinator.status).toBe('scene_ready');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
  });

  it('fails closed when a demonstration does not return its bounded ACK', async () => {
    const h = harness();
    await startAtScene(h);
    const resolved = await resolution(fixtureFlight({ seed: 'demonstration-timeout' }));
    h.bridge.omitAckFor.add('host.demonstration');

    const pending = h.coordinator.demonstrate('demonstration-timeout', demonstration(resolved));
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.demonstration'));
    h.timers.fireAll();

    expect(await pending).toBe(false);
    expect(h.coordinator.status).toBe('fallback');
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: 'fallback',
        reason: 'ack_timeout:host.demonstration',
      }),
    );
  });

  it('publishes repeatable guidance and accepts one current action across a pause race', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'dead-ball-actions-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    await h.bridge.emit(
      'unity.dead',
      {
        deadT: resolved.result.deadT,
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();

    const initial = {
      replayDigest: resolved.replayDigest,
      reason: 'Reading your shot…',
      recommendation: '',
      primaryAction: 'practice_ball' as const,
      primaryLabel: 'Practice this ball',
      secondaryAction: 'next_ball' as const,
      secondaryLabel: 'Next ball',
    };
    expect(await h.coordinator.sendDeadBallUi(DELIVERY_ID, initial)).toBe(true);
    expect(
      await h.coordinator.sendDeadBallUi(DELIVERY_ID, {
        ...initial,
        reason: 'You played too early',
        recommendation: 'Wait for the ball',
      }),
    ).toBe(true);
    expect(h.bridge.sent.filter((message) => message.type === 'host.dead_ball_ui')).toHaveLength(2);

    expect(await h.coordinator.pause('background')).toBe(true);
    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'practice_ball',
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toHaveLength(0);
    expect(h.events).toContainEqual({
      type: 'protocol_rejected',
      messageType: 'unity.dead_ball_action',
      decision: 'action_unavailable',
    });

    expect(await h.coordinator.resume('foreground')).toBe(true);
    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'practice_ball',
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toHaveLength(0);
    expect(
      h.events.filter((event) => event.type === 'protocol_rejected' && event.decision === 'action_unavailable'),
    ).toHaveLength(2);

    expect(await h.coordinator.resume('player')).toBe(true);
    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'practice_ball',
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toEqual([
      {
        type: 'dead_ball_action',
        deliveryId: DELIVERY_ID,
        action: 'practice_ball',
        replayDigest: resolved.replayDigest,
      },
    ]);

    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'next_ball',
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toHaveLength(1);
    expect(h.coordinator.status).toBe('dead_ball');
  });

  it('fails closed on a dead-ball action for the wrong replay digest', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'dead-ball-digest-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    await h.bridge.emit(
      'unity.dead',
      {
        deadT: resolved.result.deadT,
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(
      await h.coordinator.sendDeadBallUi(DELIVERY_ID, {
        replayDigest: resolved.replayDigest,
        reason: 'Reading your shot…',
        recommendation: '',
        primaryAction: 'next_ball',
        primaryLabel: 'Next ball',
        secondaryAction: null,
        secondaryLabel: null,
      }),
    ).toBe(true);

    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'next_ball',
        replayDigest: 'f'.repeat(64),
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toEqual([]);
    expect(h.coordinator.status).toBe('fallback');
  });

  it('benignly ACKs a queued insight update consumed before send without reopening the action', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'queued-dead-ball-ui-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    await h.bridge.emit(
      'unity.dead',
      {
        deadT: resolved.result.deadT,
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    const initial = {
      replayDigest: resolved.replayDigest,
      reason: 'Reading your shot…',
      recommendation: '',
      primaryAction: 'practice_ball' as const,
      primaryLabel: 'Practice this ball',
      secondaryAction: 'next_ball' as const,
      secondaryLabel: 'Next ball',
    };
    expect(await h.coordinator.sendDeadBallUi(DELIVERY_ID, initial)).toBe(true);

    h.bridge.omitAckFor.add('host.locale');
    const blocker = h.coordinator.setLocale('hi');
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.locale'));
    const update = h.coordinator.sendDeadBallUi(DELIVERY_ID, {
      ...initial,
      reason: 'You played too early',
      recommendation: 'Wait for the ball',
    });

    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'practice_ball',
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toHaveLength(1);

    h.bridge.omitAckFor.delete('host.locale');
    h.bridge.omitAckFor.add('host.dead_ball_ui');
    await h.bridge.acknowledgeLast('host.locale');
    await h.coordinator.flushInbound();
    expect(await blocker).toBe(true);
    await spinUntil(() => h.bridge.sent.filter((message) => message.type === 'host.dead_ball_ui').length === 2);

    await h.bridge.emit(
      'unity.dead_ball_action',
      {
        action: 'next_ball',
        replayDigest: resolved.replayDigest,
      },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();
    expect(h.events.filter((event) => event.type === 'dead_ball_action')).toHaveLength(1);

    h.bridge.omitAckFor.delete('host.dead_ball_ui');
    await h.bridge.acknowledgeLast('host.dead_ball_ui');
    await h.coordinator.flushInbound();
    expect(await update).toBe(true);
    expect(h.coordinator.status).toBe('dead_ball');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
  });

  it('fails closed when Unity echoes a dead time that is not the host-authoritative resolution', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'wrong-dead-time-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);

    await h.bridge.emit(
      'unity.dead',
      { deadT: resolved.result.deadT + 0.001, replayDigest: resolved.replayDigest },
      DELIVERY_ID,
    );
    await h.coordinator.flushInbound();

    expect(h.events.filter((event) => event.type === 'dead')).toEqual([]);
    expect(h.events).toContainEqual({
      type: 'protocol_rejected',
      messageType: 'unity.dead',
      decision: 'resolution_mismatch',
    });
    expect(h.coordinator.status).toBe('fallback');
    expect(h.bridge.unloads).toBe(1);
  });

  it('cannot be revived by a dead packet whose validation finishes after native fallback', async () => {
    const h = harness();
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'late-dead-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    const resolved = await resolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, resolved)).toBe(true);
    const dead = await h.bridge.emit(
      'unity.dead',
      { deadT: resolved.result.deadT, replayDigest: resolved.replayDigest },
      DELIVERY_ID,
      0,
      false,
    );

    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...args) => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
      return digest(...args);
    });
    try {
      h.bridge.deliver(dead);
      h.bridge.fail('lifecycle');
      await spinUntil(() => h.coordinator.status === 'fallback');
      await h.coordinator.flushInbound();
    } finally {
      digestSpy.mockRestore();
    }

    expect(h.coordinator.status).toBe('fallback');
    expect(h.events.filter((event) => event.type === 'dead')).toEqual([]);
    expect(h.events.filter((event) => event.type === 'fallback')).toHaveLength(1);
  });

  it('correlates native benchmark evidence and forwards a native pause request', async () => {
    const h = harness();
    await startAtScene(h);
    const measured = await h.coordinator.benchmark('standard', 1_400, 24, 180);
    expect(measured).toMatchObject({
      benchmarkId: `${SESSION_ID}:benchmark:1`,
      quality: 'standard',
      frameIntervalsMs: [16.7, 16.6, 16.8],
      warmup: { shaderWarmupMs: 37, shaderWarmupCompleted: true },
      graphics: { api: 'Vulkan', device: 'Adreno 619' },
    });
    expect(h.bridge.sent.find((message) => message.type === 'host.benchmark')?.payload).toEqual({
      benchmarkId: `${SESSION_ID}:benchmark:1`,
      durationMs: 1_400,
      warmupFrames: 24,
      sampleCap: 180,
      quality: 'standard',
    });

    await h.bridge.emit('unity.pause_request', { reason: 'player' });
    await h.coordinator.flushInbound();
    expect(h.events).toContainEqual({ type: 'pause_requested' });
  });

  it('fails closed at the bounded 10 s result ACK deadline and falls back once', async () => {
    const h = harness({ useDefaultAckTimeout: true });
    await startAtScene(h);
    const flight = fixtureFlight({ seed: 'timeout-flight' });
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    h.bridge.omitAckFor.add('host.result');

    const pending = h.coordinator.sendResult(DELIVERY_ID, await resolution(flight));
    await spinUntil(() => h.bridge.sent.some((message) => message.type === 'host.result'));
    expect(h.events.some((event) => event.type === 'result_committed')).toBe(false);
    h.timers.advanceBy(UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS - 1);
    expect(h.coordinator.status).toBe('result_pending');
    expect(h.events.some((event) => event.type === 'fallback')).toBe(false);
    h.timers.advanceBy(1);
    expect(await pending).toBe(false);

    expect(h.events).toContainEqual({
      type: 'fallback',
      reason: 'ack_timeout:host.result',
      inFlightDeliveryId: DELIVERY_ID,
    });
    expect(h.bridge.unloads).toBe(1);
    expect(h.coordinator.status).toBe('fallback');
  });

  it('treats runtime teardown as a report and native unload completion as the clean-dispose authority', async () => {
    const h = harness();
    h.bridge.emitUnloadedOnDispose = true;
    expect(await h.coordinator.launch()).toBe(true);
    expect(await h.coordinator.dispose('complete')).toBe(true);
    expect(h.bridge.unloads).toBe(1);
    expect(h.coordinator.status).toBe('unloaded');
    expect(h.events.filter((event) => event.type === 'fallback')).toEqual([]);
    expect(h.events.filter((event) => event.type === 'unloaded')).toEqual([
      { type: 'unloaded', clean: true, retainedMemoryMb: 196 },
    ]);
  });

  it('destroys raw samples synchronously and retains only the normalized swing', () => {
    const clock = new UnityPracticeClock();
    clock.add({
      sampleId: 'best',
      hostSendPerfMs: 1_000,
      unityReceiveMs: 950,
      unitySendMs: 951,
      hostReceivePerfMs: 1_001,
    });
    const raw = {
      pointer: 'touch' as const,
      surface: { width: 400, height: 800 },
      samples: [
        { t: 2_000, x: 100, y: 500 },
        { t: 2_010, x: 101, y: 501 },
      ],
    };
    const swing = normalizeEphemeralUnityGesture(raw, clock, {
      releasePerfMs: 2_040,
      calibrationMs: 0,
      handedness: 'right',
    });
    expect(raw.samples).toEqual([]);
    expect(swing).toEqual({
      kind: 'defend',
      startT: 0.01,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'auto',
    });
    expect(swing).not.toHaveProperty('samples');
  });

  it('normalizes a Unity pullback-hold-forward packet from forward reversal, not pullback or pointer-up', () => {
    const clock = new UnityPracticeClock();
    clock.add({
      sampleId: 'best',
      hostSendPerfMs: 1_000,
      unityReceiveMs: 950,
      unitySendMs: 951,
      hostReceivePerfMs: 1_001,
    });
    const raw = {
      pointer: 'touch' as const,
      surface: { width: 400, height: 368 },
      samples: [
        { t: 2_000, x: 200, y: 50 },
        { t: 2_020, x: 200, y: 90 },
        { t: 2_040, x: 200, y: 140 },
        // The Unity transport keeps the same contact open through this hold.
        { t: 2_300, x: 200, y: 140 },
        { t: 2_320, x: 210, y: 115 },
        { t: 2_340, x: 225, y: 80 },
        { t: 2_360, x: 235, y: 50 },
      ],
    };

    const swing = normalizeEphemeralUnityGesture(raw, clock, {
      releasePerfMs: 2_050,
      calibrationMs: 0,
      handedness: 'right',
    });

    expect(raw.samples).toEqual([]);
    expect(swing).not.toBeNull();
    expect(swing).toMatchObject({ kind: 'attack', footwork: 'auto' });
    // Unity→host clock offset is +50 ms. The 260 ms hold therefore remains in
    // real timing, while the shot starts at the interpolated forward departure
    // just after 2,300 ms Unity time—not at pullback and not at 2,360 ms lift.
    expect(swing!.startT).toBeGreaterThan(0.3);
    expect(swing!.startT).toBeLessThan(0.32);
    expect(swing!.directionDeg).toBeGreaterThan(0);
    expect(swing!.power).toBeGreaterThan(0.2);
    expect(swing!.elevation).toBeGreaterThan(0);
  });
});

describe('Unity Practice coordinator resolution made once', () => {
  async function started(flight: ReturnType<typeof fixtureFlight>) {
    const h = harness();
    await startAtScene(h);
    expect(
      await h.coordinator.startDelivery(DELIVERY_ID, {
        overIndex: 0,
        ballIndex: 0,
        plan: flight.plan,
        seed: flight.seed,
        flight,
        presentation: { learnCue: false, coach: null },
      }),
    ).toBe(true);
    return h;
  }

  async function madeResolution(flight: ReturnType<typeof fixtureFlight>): Promise<UnityPracticeResolution> {
    const byHand = await resolution(flight);
    return makeUnityPracticeResolution(byHand.record, byHand.result, byHand.score);
  }

  it('sends and replays a made resolution as the same messages, without digesting its record and result again', async () => {
    const flight = fixtureFlight({ seed: 'made-once-flight' });
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');

    const byHand = await started(flight);
    const handResolution = await resolution(flight);
    digest.mockClear();
    expect(await byHand.coordinator.sendResult(DELIVERY_ID, handResolution)).toBe(true);
    expect(
      await byHand.coordinator.replay(DELIVERY_ID, { resolution: handResolution, speed: 0.5, diagnostics: false }),
    ).toBe(true);
    const handDigests = digest.mock.calls.length;

    const viaMake = await started(flight);
    const made = await madeResolution(flight);
    digest.mockClear();
    expect(await viaMake.coordinator.sendResult(DELIVERY_ID, made)).toBe(true);
    expect(await viaMake.coordinator.replay(DELIVERY_ID, { resolution: made, speed: 0.5, diagnostics: false })).toBe(
      true,
    );
    const madeDigests = digest.mock.calls.length;

    // The result and the replay each skip the coordinator's identity check and the packer's.
    expect(handDigests - madeDigests).toBe(4);
    for (const type of ['host.result', 'host.replay'] as const) {
      expect(viaMake.bridge.sent.find((message) => message.type === type)).toEqual(
        byHand.bridge.sent.find((message) => message.type === type),
      );
    }
  });

  it('refuses a made resolution whose result changed after its digest, before any phase or sequence change', async () => {
    const flight = fixtureFlight({ seed: 'made-then-changed-flight' });
    const h = await started(flight);
    const made = await madeResolution(flight);
    made.result.deadT += 0.25;

    expect(await h.coordinator.sendResult(DELIVERY_ID, made)).toBe(false);
    expect(h.bridge.sent.some((message) => message.type === 'host.result')).toBe(false);
    expect(h.events).toContainEqual({
      type: 'fallback',
      reason: 'replay_identity:host.result',
      inFlightDeliveryId: DELIVERY_ID,
    });
  });

  it('refuses a made resolution that changed between the result and its replay', async () => {
    const flight = fixtureFlight({ seed: 'made-then-changed-before-replay' });
    const h = await started(flight);
    const made = await madeResolution(flight);
    expect(await h.coordinator.sendResult(DELIVERY_ID, made)).toBe(true);
    made.record.runs += 1;

    expect(await h.coordinator.replay(DELIVERY_ID, { resolution: made, speed: 0.5, diagnostics: false })).toBe(false);
    expect(h.bridge.sent.some((message) => message.type === 'host.replay')).toBe(false);
    expect(h.events).toContainEqual({
      type: 'fallback',
      reason: 'replay_identity:host.replay',
      inFlightDeliveryId: DELIVERY_ID,
    });
  });
});
