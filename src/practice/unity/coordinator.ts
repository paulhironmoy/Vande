/**
 * Stateful coordinator for the optional Unity Practice surface.
 *
 * It owns transport order, clock conversion and lifecycle only. The existing TypeScript input normalizer, physics,
 * scoring, innings, replay and Coach remain the sole authorities.
 */
import {
  UnityPracticeProtocolGuard,
  hasValidUnityPracticeResolutionIdentity,
  makeUnityPracticeMessage,
  packUnityPracticeMessage,
  unpackUnityPracticePacket,
  type GestureInput,
  type Handedness,
  type NormalizedSwing,
  type UnityPracticeDelivery,
  type UnityPracticeDeadBallAction,
  type UnityPracticeDeadBallUi,
  type UnityPracticeDemonstration,
  type UnityPracticeHostMessageType,
  type UnityPracticeInitialize,
  type UnityPracticeMessage,
  type UnityPracticePayloadByType,
  type UnityPracticeProtocolDecision,
  type UnityPracticeReplay,
  type UnityPracticeResolution,
  type UnityPracticeScene,
  type UnityPracticeSenderFor,
  type UnityPracticeBenchmarkResult,
  type UnityPracticeStats,
} from '@/contracts';
import { normalizeGesture } from '@/input';
import type { UnityPracticeBridge, UnityPracticeNativeError } from '@/platform/unityPractice';
import { UNITY_PRACTICE_CLOCK_SAMPLE_COUNT, UnityPracticeClock, type UnityPracticeClockEstimate } from './clock';

export type UnityPracticeSessionStatus =
  | 'idle'
  | 'launching'
  | 'synchronizing'
  | 'synchronized'
  | 'scene_pending'
  | 'scene_ready'
  | 'delivery_pending'
  | 'delivery'
  | 'result_pending'
  | 'resolved'
  | 'dead_ball'
  | 'replay_pending'
  | 'replaying'
  | 'demonstration_pending'
  | 'demonstrating'
  | 'disposing'
  | 'unloaded'
  | 'fallback';

export type UnityPracticeCoordinatorEvent =
  | { type: 'ready'; renderer: string; unityVersion: string }
  | { type: 'clock_synchronized'; sampleCount: 5; sampleId: string; roundTripMs: number; hostMinusUnityMs: number }
  | { type: 'scene_ready' }
  | { type: 'delivery_started'; deliveryId: string }
  | { type: 'release'; deliveryId: string; releasePerfMs: number }
  | {
      type: 'pointer';
      deliveryId: string;
      phase: 'down' | 'cancel';
      atPerfMs: number;
      pointer: GestureInput['pointer'];
    }
  | { type: 'gesture'; deliveryId: string; swing: NormalizedSwing | null }
  | { type: 'result_committed'; deliveryId: string; replayDigest: string }
  | { type: 'dead'; deliveryId: string; deadT: number; replayDigest: string }
  | { type: 'dead_ball_action'; deliveryId: string; action: UnityPracticeDeadBallAction; replayDigest: string }
  | { type: 'protected_regions'; deliveryId: string; payload: UnityPracticePayloadByType['unity.protected_regions'] }
  | { type: 'replay_complete'; deliveryId: string; deadT: number; replayDigest: string }
  | { type: 'demonstration_started'; deliveryId: string }
  | { type: 'demonstration_complete'; deliveryId: string; deadT: number; replayDigest: string }
  | { type: 'demonstration_cancelled'; deliveryId: string }
  | { type: 'profile_changed'; quality: UnityPracticePayloadByType['host.profile']['quality'] }
  | { type: 'paused'; reason: UnityPracticePayloadByType['host.pause']['reason'] }
  | { type: 'resumed'; reason: UnityPracticePayloadByType['host.resume']['reason'] }
  | { type: 'stats'; stats: UnityPracticeStats }
  | { type: 'pause_requested' }
  | { type: 'quiet'; quiet: boolean }
  | { type: 'runtime_error'; error: UnityPracticePayloadByType['unity.error'] | UnityPracticeNativeError }
  | {
      type: 'protocol_rejected';
      messageType: string;
      decision:
        | UnityPracticeProtocolDecision
        | 'invalid_packet'
        | 'unexpected_ack'
        | 'unexpected_clock'
        | 'gesture_before_release'
        | 'duplicate_semantic'
        | 'resolution_mismatch';
    }
  | { type: 'unload_deferred'; inFlightDeliveryId: string }
  | { type: 'fallback'; reason: string; inFlightDeliveryId: string | null }
  | { type: 'unloaded'; clean: boolean; retainedMemoryMb: number | null };

export interface UnityPracticeTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface UnityPracticeCoordinatorOptions {
  bridge: UnityPracticeBridge;
  buildId: string;
  sessionId: string;
  initialize: UnityPracticeInitialize;
  calibrationMs: number;
  calibrations?: Partial<Record<GestureInput['pointer'], number>>;
  ackTimeoutMs?: number;
  /** Cold Unity load/ready is intentionally much longer than an in-session bridge ACK. */
  launchTimeoutMs?: number;
  now?: () => number;
  messageId?: (purpose: string, ordinal: number) => string;
  timers?: UnityPracticeTimers;
  onEvent?: (event: UnityPracticeCoordinatorEvent) => void;
}

export interface UnityPracticeCoordinatorSnapshot {
  status: UnityPracticeSessionStatus;
  clockSamples: number;
  selectedClock: Readonly<UnityPracticeClockEstimate> | null;
  activeDeliveryId: string | null;
  pendingDeliveryId: string | null;
}

interface BooleanWaiter {
  timer: unknown;
  finish(value: boolean): void;
}

interface ClockWaiter {
  timer: unknown;
  finish(value: UnityPracticeClockEstimate | null): void;
}

interface BenchmarkWaiter {
  timer: unknown;
  finish(value: UnityPracticeBenchmarkResult | null): void;
}

/**
 * Native delivery packets are hundreds of kilobytes within the bounded 1 MiB
 * wire limit. The Android transport already has its own 3 s acceptance bound,
 * and the runtime must still validate, parse and acknowledge the packet after
 * that hand-off. Keep this protocol-level bound above the transport bound so a
 * valid low-end-device ACK cannot lose a race to our own fail-closed timer.
 */
export const UNITY_PRACTICE_ACK_TIMEOUT_MS = 5_000;
/**
 * Result/replay payloads contain both canonical resolution traces and digest
 * inputs. On a fresh two-core Android 16 emulator the transport accepted a
 * valid result, but no validated protocol ACK returned by the ordinary 5 s
 * boundary. Give only those bounded heavy messages a longer deadline; all
 * other in-session ACKs stay at 5 s.
 */
export const UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS = 10_000;
/** Independent outer fail-safe cap. This is not the product's acceptable first-delivery latency target. */
export const UNITY_PRACTICE_LAUNCH_TIMEOUT_MS = 40_000;
const DEFAULT_TIMERS: UnityPracticeTimers = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function clearRawGesture(input: GestureInput): void {
  input.samples.splice(0, input.samples.length);
}

/**
 * Converts and normalizes synchronously, then destroys the only retained raw sample array. The returned value contains
 * no pointer coordinates and is the only gesture representation the coordinator may publish.
 */
export function normalizeEphemeralUnityGesture(
  input: GestureInput,
  clock: Pick<UnityPracticeClock, 'toHostPerfMs'>,
  options: {
    releasePerfMs: number;
    calibrationMs: number;
    calibrations?: Partial<Record<GestureInput['pointer'], number>>;
    handedness: Handedness;
  },
): NormalizedSwing | null {
  const converted: GestureInput = {
    ...input,
    surface: { ...input.surface },
    samples: input.samples.map((sample) => ({ ...sample, t: clock.toHostPerfMs(sample.t) })),
    key: input.key ? { ...input.key } : undefined,
  };
  clearRawGesture(input);
  return normalizeGesture(converted, options);
}

/** One coordinator instance owns exactly one Unity Practice session. */
export class UnityPracticeSessionCoordinator {
  private readonly guard = new UnityPracticeProtocolGuard();
  private readonly clock = new UnityPracticeClock();
  private readonly ackTimeoutMs: number;
  private readonly resultAckTimeoutMs: number;
  private readonly launchTimeoutMs: number;
  private readonly now: () => number;
  private readonly ids: (purpose: string, ordinal: number) => string;
  private readonly timers: UnityPracticeTimers;
  private readonly pendingAcks = new Map<string, BooleanWaiter>();
  private readonly pendingClocks = new Map<string, ClockWaiter>();
  private readonly pendingBenchmarks = new Map<string, BenchmarkWaiter>();
  private readonly deliveryPromises = new Map<string, Promise<boolean>>();
  private readonly resultPromises = new Map<string, Promise<boolean>>();
  private readonly demonstrationPromises = new Map<string, Promise<boolean>>();
  private readonly releases = new Map<string, number>();
  private readonly gestures = new Set<string>();
  private readonly deadDeliveries = new Set<string>();
  /** Host-authoritative completion identity. Unity may only echo these exact values. */
  private readonly expectedDead = new Map<string, { deadT: number; replayDigest: string }>();
  /** Bounded by one session; absorbs release/dead packets already queued when Skip is acknowledged. */
  private readonly cancelledDemonstrations = new Set<string>();
  private readyWaiter: BooleanWaiter | null = null;
  private unsubscribeMessage: (() => Promise<void>) | null = null;
  private unsubscribeError: (() => Promise<void>) | null = null;
  private inboundTail: Promise<void> = Promise.resolve();
  private outboundTail: Promise<void> = Promise.resolve();
  private fallbackTask: Promise<boolean> | null = null;
  private ordinal = 0;
  private benchmarkOrdinal = 0;
  private hostSequence = 0;
  private statusValue: UnityPracticeSessionStatus = 'idle';
  private activeDeliveryId: string | null = null;
  private pendingDeliveryId: string | null = null;
  private lastDeliveryId: string | null = null;
  private demonstrationReturnStatus: 'scene_ready' | 'dead_ball' | null = null;
  /** Runtime-side teardown report; native unload completion remains the only clean-unload authority. */
  private retainedMemoryMb: number | null = null;

  constructor(private readonly options: UnityPracticeCoordinatorOptions) {
    if (!options.buildId || !options.sessionId) throw new TypeError('Unity Practice requires build and session ids.');
    if (!Number.isFinite(options.calibrationMs)) throw new TypeError('Unity Practice calibration must be finite.');
    this.ackTimeoutMs = options.ackTimeoutMs ?? UNITY_PRACTICE_ACK_TIMEOUT_MS;
    if (!Number.isFinite(this.ackTimeoutMs) || this.ackTimeoutMs <= 0)
      throw new RangeError('Unity Practice timeout must be positive.');
    // An explicit timeout remains an exact test/integration override for every
    // message. Production gets the separately bounded heavy-payload budget.
    this.resultAckTimeoutMs = options.ackTimeoutMs ?? UNITY_PRACTICE_RESULT_ACK_TIMEOUT_MS;
    this.launchTimeoutMs = options.launchTimeoutMs ?? UNITY_PRACTICE_LAUNCH_TIMEOUT_MS;
    if (!Number.isFinite(this.launchTimeoutMs) || this.launchTimeoutMs <= 0)
      throw new RangeError('Unity Practice launch timeout must be positive.');
    this.now = options.now ?? (() => performance.now());
    this.ids = options.messageId ?? ((purpose, ordinal) => `${options.sessionId}:${purpose}:${ordinal}`);
    this.timers = options.timers ?? DEFAULT_TIMERS;
  }

  get status(): UnityPracticeSessionStatus {
    return this.statusValue;
  }

  snapshot(): UnityPracticeCoordinatorSnapshot {
    return {
      status: this.statusValue,
      clockSamples: this.clock.sampleCount,
      selectedClock: this.clock.selected,
      activeDeliveryId: this.activeDeliveryId,
      pendingDeliveryId: this.pendingDeliveryId,
    };
  }

  /** Resolves after every packet already delivered by the bridge has been checked and handled. */
  async flushInbound(): Promise<void> {
    await this.inboundTail;
  }

  async launch(): Promise<boolean> {
    if (this.statusValue !== 'idle') return false;
    this.statusValue = 'launching';
    try {
      const availability = await this.options.bridge.availability();
      if (!availability.available) {
        await this.fallback(`unavailable:${availability.reason}`);
        return false;
      }
      this.unsubscribeMessage = await this.options.bridge.onMessage((packet, receivedPerfMs) => {
        this.inboundTail = this.inboundTail.then(
          () => this.receive(packet, receivedPerfMs),
          () => this.receive(packet, receivedPerfMs),
        );
      });
      this.unsubscribeError = await this.options.bridge.onError((error) => {
        this.emit({ type: 'runtime_error', error });
        void this.fallback(`native:${error.code}`);
      });

      const ready = this.waitForReady(this.launchTimeoutMs);
      const initialized = this.sendHost(
        'host.initialize',
        this.options.initialize,
        null,
        true,
        undefined,
        this.launchTimeoutMs,
      );
      if (!(await initialized) || !(await ready)) {
        await this.fallback('launch_timeout');
        return false;
      }
      this.statusValue = 'synchronizing';
      if (!(await this.synchronizeClock())) return false;
      const selected = this.clock.selected;
      if (!selected) {
        await this.fallback('clock_missing');
        return false;
      }
      if (!(await this.sendHost('host.clock_selected', { sampleId: selected.sampleId }, null))) return false;
      this.statusValue = 'synchronized';
      this.emit({
        type: 'clock_synchronized',
        sampleCount: UNITY_PRACTICE_CLOCK_SAMPLE_COUNT,
        sampleId: selected.sampleId,
        roundTripMs: selected.roundTripMs,
        hostMinusUnityMs: selected.hostMinusUnityMs,
      });
      return true;
    } catch {
      await this.fallback('launch_error');
      return false;
    }
  }

  async setScene(scene: UnityPracticeScene): Promise<boolean> {
    if (!this.clock.ready || !['synchronized', 'scene_ready', 'dead_ball'].includes(this.statusValue)) {
      this.emit({ type: 'protocol_rejected', messageType: 'host.scene', decision: 'clock_unsynchronized' });
      return false;
    }
    const previous = this.statusValue;
    this.statusValue = 'scene_pending';
    const ok = await this.sendHost('host.scene', scene, null, false, () => {
      this.statusValue = 'scene_ready';
      this.emit({ type: 'scene_ready' });
    });
    if (!ok && !this.inFallback()) this.statusValue = previous;
    return ok;
  }

  startDelivery(deliveryId: string, delivery: UnityPracticeDelivery): Promise<boolean> {
    const existing = this.deliveryPromises.get(deliveryId);
    if (existing) return existing;
    if (!deliveryId || !['scene_ready', 'dead_ball'].includes(this.statusValue)) return Promise.resolve(false);
    this.statusValue = 'delivery_pending';
    this.pendingDeliveryId = deliveryId;
    const promise = this.sendHost('host.delivery', delivery, deliveryId, false, () => {
      this.pendingDeliveryId = null;
      this.activeDeliveryId = deliveryId;
      this.statusValue = 'delivery';
      this.emit({ type: 'delivery_started', deliveryId });
    }).then((ok) => {
      if (!ok && this.statusValue !== 'fallback') {
        this.pendingDeliveryId = null;
        this.statusValue = 'scene_ready';
      }
      return ok;
    });
    this.deliveryPromises.set(deliveryId, promise);
    return promise;
  }

  async sendProvisionalSwing(
    deliveryId: string,
    payload: UnityPracticePayloadByType['host.provisional_swing'],
  ): Promise<boolean> {
    if (this.statusValue !== 'delivery' || deliveryId !== this.activeDeliveryId) return false;
    return this.sendHost('host.provisional_swing', payload, deliveryId);
  }

  async setProfile(quality: UnityPracticePayloadByType['host.profile']['quality']): Promise<boolean> {
    return this.sendHost('host.profile', { quality }, null, false, () => {
      this.emit({ type: 'profile_changed', quality });
    });
  }

  /** Updates presentation language only; it cannot alter delivery, input, physics or score authority. */
  async setLocale(locale: string): Promise<boolean> {
    return this.sendHost('host.locale', { locale }, null);
  }

  /** Runs a bounded renderer-local benchmark. No WebView probe may stand in for this response. */
  async benchmark(
    quality: UnityPracticePayloadByType['host.profile']['quality'],
    durationMs: number,
    warmupFrames = 30,
    sampleCap = Math.min(1_200, Math.max(2, Math.ceil((durationMs / 1_000) * 120) + 1)),
  ): Promise<UnityPracticeBenchmarkResult | null> {
    if (!['synchronized', 'scene_ready'].includes(this.statusValue)) return null;
    this.benchmarkOrdinal += 1;
    const benchmarkId = `${this.options.sessionId}:benchmark:${this.benchmarkOrdinal}`;
    const result = this.waitForBenchmark(benchmarkId, durationMs + 5_000);
    const sent = await this.sendHost(
      'host.benchmark',
      {
        benchmarkId,
        durationMs,
        warmupFrames,
        sampleCap,
        quality,
      },
      null,
    );
    if (!sent) {
      this.cancelBenchmark(benchmarkId);
      return null;
    }
    return result;
  }

  async pause(reason: UnityPracticePayloadByType['host.pause']['reason']): Promise<boolean> {
    // A native tap can arrive while the ACK-backed pause packet is in flight.
    // Close the guard first so that race is ignored rather than dispatched.
    this.guard.suspendDeadBallActions();
    return this.sendHost('host.pause', { reason }, null, false, () => {
      this.emit({ type: 'paused', reason });
    });
  }

  async resume(reason: UnityPracticePayloadByType['host.resume']['reason']): Promise<boolean> {
    return this.sendHost('host.resume', { reason }, null, false, () => {
      this.emit({ type: 'resumed', reason });
    });
  }

  sendResult(deliveryId: string, resolution: UnityPracticeResolution): Promise<boolean> {
    const existing = this.resultPromises.get(deliveryId);
    if (existing) return existing;
    if (this.statusValue !== 'delivery' || deliveryId !== this.activeDeliveryId) return Promise.resolve(false);
    const promise = (async () => {
      if (!(await this.hasValidResolutionIdentity(resolution))) {
        await this.fallback('replay_identity:host.result');
        return false;
      }
      if (this.statusValue !== 'delivery' || deliveryId !== this.activeDeliveryId) return false;
      this.statusValue = 'result_pending';
      return this.sendHost(
        'host.result',
        resolution,
        deliveryId,
        false,
        () => {
          this.expectedDead.set(deliveryId, {
            deadT: resolution.result.deadT,
            replayDigest: resolution.replayDigest,
          });
          this.lastDeliveryId = deliveryId;
          this.statusValue = 'resolved';
          this.emit({ type: 'result_committed', deliveryId, replayDigest: resolution.replayDigest });
        },
        this.resultAckTimeoutMs,
      ).then((ok) => {
        if (!ok && this.statusValue !== 'fallback') this.statusValue = 'delivery';
        return ok;
      });
    })();
    this.resultPromises.set(deliveryId, promise);
    return promise;
  }

  /**
   * Publishes localized controls only after the exact authoritative dead ball.
   * Repeated updates are valid while Coach analysis resolves, until one action
   * is consumed or the retained delivery changes.
   */
  sendDeadBallUi(deliveryId: string, payload: UnityPracticeDeadBallUi): Promise<boolean> {
    const expected = this.expectedDead.get(deliveryId);
    if (
      this.statusValue !== 'dead_ball' ||
      deliveryId !== this.lastDeliveryId ||
      !expected ||
      payload.replayDigest !== expected.replayDigest
    )
      return Promise.resolve(false);
    return this.sendHost('host.dead_ball_ui', payload, deliveryId);
  }

  async replay(deliveryId: string, replay: UnityPracticeReplay): Promise<boolean> {
    if (
      !['resolved', 'scene_ready', 'dead_ball'].includes(this.statusValue) ||
      deliveryId !== (this.activeDeliveryId ?? this.lastDeliveryId)
    )
      return false;
    if (!(await this.hasValidResolutionIdentity(replay.resolution))) {
      await this.fallback('replay_identity:host.replay');
      return false;
    }
    if (
      !['resolved', 'scene_ready', 'dead_ball'].includes(this.statusValue) ||
      deliveryId !== (this.activeDeliveryId ?? this.lastDeliveryId)
    )
      return false;
    this.statusValue = 'replay_pending';
    const ok = await this.sendHost(
      'host.replay',
      replay,
      deliveryId,
      false,
      () => {
        this.activeDeliveryId = deliveryId;
        this.statusValue = 'replaying';
      },
      this.resultAckTimeoutMs,
    );
    if (!ok && !this.inFallback()) this.statusValue = 'resolved';
    return ok;
  }

  /**
   * Presents one authoritative, score-inert Coach performance on the live
   * Unity world. Its completion identity is deliberately independent of the
   * last scored delivery, which remains available for replay/dead-ball UI.
   */
  demonstrate(deliveryId: string, demonstration: UnityPracticeDemonstration): Promise<boolean> {
    const existing = this.demonstrationPromises.get(deliveryId);
    if (existing) return existing;
    if (!deliveryId || !['scene_ready', 'dead_ball'].includes(this.statusValue)) return Promise.resolve(false);
    this.demonstrationReturnStatus = this.statusValue === 'dead_ball' ? 'dead_ball' : 'scene_ready';
    this.statusValue = 'demonstration_pending';
    this.pendingDeliveryId = deliveryId;
    const promise = (async () => {
      if (!(await this.hasValidResolutionIdentity(demonstration.resolution))) {
        await this.fallback('replay_identity:host.demonstration');
        return false;
      }
      if (this.statusValue !== 'demonstration_pending' || this.pendingDeliveryId !== deliveryId) return false;
      return this.sendHost(
        'host.demonstration',
        demonstration,
        deliveryId,
        false,
        () => {
          this.pendingDeliveryId = null;
          this.activeDeliveryId = deliveryId;
          this.expectedDead.set(deliveryId, {
            deadT: demonstration.resolution.result.deadT,
            replayDigest: demonstration.resolution.replayDigest,
          });
          this.statusValue = 'demonstrating';
          this.emit({ type: 'demonstration_started', deliveryId });
        },
        this.resultAckTimeoutMs,
      ).then((ok) => {
        if (!ok && !this.inFallback()) {
          this.pendingDeliveryId = null;
          this.activeDeliveryId = null;
          this.expectedDead.delete(deliveryId);
          this.statusValue = this.demonstrationReturnStatus ?? 'scene_ready';
          this.demonstrationReturnStatus = null;
        }
        if (!ok) this.demonstrationPromises.delete(deliveryId);
        return ok;
      });
    })();
    this.demonstrationPromises.set(deliveryId, promise);
    void promise.then((ok) => {
      if (!ok && this.demonstrationPromises.get(deliveryId) === promise) {
        this.demonstrationPromises.delete(deliveryId);
      }
    });
    return promise;
  }

  /** Skip is an ACK-backed reset of demo-only presentation, never a Unity unload. */
  async cancelDemonstration(deliveryId: string): Promise<boolean> {
    if (!deliveryId) return false;
    const matchesPending = this.statusValue === 'demonstration_pending' && this.pendingDeliveryId === deliveryId;
    if (matchesPending) {
      // Digest verification happens before the heavy packet enters the ordered
      // transport queue. Skip can arrive in that short window; wait for the
      // start ACK so cancel can never overtake the demonstration it names.
      const starting = this.demonstrationPromises.get(deliveryId);
      if (!starting || !(await starting)) return false;
    }
    if (this.statusValue !== 'demonstrating' || this.activeDeliveryId !== deliveryId) return false;
    // Mark the identity before the async packet/ACK boundary. Native release,
    // protected-region or dead packets already queued for this demo must still
    // consume Unity sequence numbers without being mistaken for live play.
    this.rememberCancelledDemonstration(deliveryId);
    const ok = await this.sendHost('host.demonstration_cancel', {}, deliveryId, false, () => {
      this.settleCancelledDemonstration(deliveryId);
    });
    if (!ok && !this.inFallback() && this.statusValue === 'demonstrating') {
      this.cancelledDemonstrations.delete(deliveryId);
    }
    return ok;
  }

  async dispose(reason: UnityPracticePayloadByType['host.dispose']['reason'] = 'complete'): Promise<boolean> {
    const inFlight = this.activeDeliveryId ?? this.pendingDeliveryId;
    if (inFlight !== null && !['scene_ready', 'synchronized'].includes(this.statusValue)) {
      this.emit({ type: 'unload_deferred', inFlightDeliveryId: inFlight });
      return false;
    }
    if (['idle', 'unloaded', 'fallback'].includes(this.statusValue)) return this.statusValue === 'unloaded';
    const sent = await this.sendHost('host.dispose', { reason }, null, false, () => {
      this.statusValue = 'disposing';
    });
    if (!sent) return false;
    // ACK and the runtime teardown report are emitted back-to-back. Drain packets already accepted by the bridge
    // before asking Android to destroy UnityPlayer, so the optional retained-memory observation is not lost.
    await this.flushInbound();
    const unloaded = await this.options.bridge.unload().catch(() => false);
    if (!unloaded) {
      await this.fallback('unload_failed');
      return false;
    }
    if (this.statusValue !== 'unloaded') {
      this.statusValue = 'unloaded';
      this.emit({ type: 'unloaded', clean: true, retainedMemoryMb: this.retainedMemoryMb });
    }
    await this.removeListeners();
    return true;
  }

  /**
   * Failure-only escape hatch. It reports an in-flight delivery first, sends the existing dispose message best effort,
   * then asks the native bridge to unload even when an ACK can no longer be trusted.
   */
  async forceDispose(
    reason: Extract<
      UnityPracticePayloadByType['host.dispose']['reason'],
      'cancelled' | 'fallback' | 'error'
    > = 'fallback',
  ): Promise<boolean> {
    return this.fallback(`forced_dispose:${reason}`, reason);
  }

  private async synchronizeClock(): Promise<boolean> {
    for (let index = 0; index < UNITY_PRACTICE_CLOCK_SAMPLE_COUNT; index += 1) {
      const sampleId = `${this.options.sessionId}:clock:${index + 1}`;
      const hostSendPerfMs = this.now();
      const pong = this.waitForClock(sampleId);
      if (!(await this.sendHost('host.clock_sync', { sampleId, hostSendPerfMs }, null))) {
        this.cancelClock(sampleId);
        return false;
      }
      if (!(await pong)) {
        await this.fallback(`clock_timeout:${sampleId}`);
        return false;
      }
    }
    if (!this.clock.complete) {
      await this.fallback('clock_incomplete');
      return false;
    }
    return true;
  }

  private sendHost<T extends UnityPracticeHostMessageType>(
    type: T,
    payload: UnityPracticePayloadByType[T],
    deliveryId: string | null,
    launch = false,
    onAcknowledged?: () => void,
    ackTimeoutMs = this.ackTimeoutMs,
  ): Promise<boolean> {
    return this.enqueueOutbound(async () => {
      if (this.statusValue === 'fallback' || this.statusValue === 'unloaded') return false;
      const message = makeUnityPracticeMessage(
        {
          buildId: this.options.buildId,
          sessionId: this.options.sessionId,
          deliveryId,
          messageId: this.nextId(type),
          sequence: this.hostSequence,
          sender: 'host' as UnityPracticeSenderFor<T>,
        },
        type,
        payload,
      );
      try {
        const packet = await packUnityPracticeMessage(message);
        const decision = this.guard.accept(message);
        if (decision !== 'accept') {
          this.emit({ type: 'protocol_rejected', messageType: type, decision });
          return false;
        }
        this.hostSequence += 1;
        const acknowledged = this.waitForAck(message.messageId, onAcknowledged, ackTimeoutMs);
        if (this.isTerminal()) {
          this.cancelAck(message.messageId);
          return false;
        }
        const forwarded = launch
          ? await this.options.bridge.launch(packet).catch(() => false)
          : await this.options.bridge.send(packet).catch(() => false);
        if (!forwarded) {
          this.cancelAck(message.messageId);
          await this.fallback(`transport_rejected:${type}`);
          return false;
        }
        if (!(await acknowledged)) {
          await this.fallback(`ack_timeout:${type}`);
          return false;
        }
        return true;
      } catch {
        this.cancelAck(message.messageId);
        await this.fallback(`transport_error:${type}`);
        return false;
      }
    });
  }

  private enqueueOutbound(work: () => Promise<boolean>): Promise<boolean> {
    const result = this.outboundTail.then(work, work);
    this.outboundTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async receive(packet: Parameters<UnityPracticeBridge['launch']>[0], receivedPerfMs: number): Promise<void> {
    let message: UnityPracticeMessage;
    try {
      message = await unpackUnityPracticePacket(packet);
    } catch {
      this.emit({ type: 'protocol_rejected', messageType: 'packet', decision: 'invalid_packet' });
      await this.fallback('invalid_packet');
      return;
    }
    const rawGesture = message.type === 'unity.gesture' ? message.payload.input : null;
    // Skip can win while native release/dead packets are already queued. They
    // remain part of the verified ordered stream, but are inert presentation
    // tail and can never become the last real delivery.
    const cancelledDemonstrationTail = Boolean(
      message.deliveryId &&
      this.cancelledDemonstrations.has(message.deliveryId) &&
      (message.type === 'unity.release' || message.type === 'unity.dead' || message.type === 'unity.protected_regions'),
    );
    // Packet verification is asynchronous and native errors are delivered on a separate callback. A packet that
    // was queued before fallback/dispose must never revive gameplay afterwards. Runtime teardown reporting is the
    // sole exception; it is observational and cannot transition the coordinator back to a playable state.
    if (
      (this.statusValue === 'fallback' || this.statusValue === 'disposing' || this.statusValue === 'unloaded') &&
      message.type !== 'unity.unloaded'
    ) {
      if (rawGesture) clearRawGesture(rawGesture);
      return;
    }
    const decision = this.guard.accept(message);
    if (decision !== 'accept') {
      if (rawGesture) clearRawGesture(rawGesture);
      if (decision === 'duplicate') return;
      if (
        message.type === 'unity.dead_ball_action' &&
        (decision === 'duplicate_action' || decision === 'action_unavailable')
      ) {
        this.emit({ type: 'protocol_rejected', messageType: message.type, decision });
        return;
      }
      if (message.type === 'unity.dead' && message.deliveryId && this.deadDeliveries.has(message.deliveryId)) return;
      this.emit({ type: 'protocol_rejected', messageType: message.type, decision });
      await this.fallback(`protocol:${decision}`);
      return;
    }
    if (cancelledDemonstrationTail) {
      // Dead can narrowly beat the cancel packet. Settle the same local
      // cancellation now; the later exact cancel ACK is deliberately
      // idempotent in both protocol guards.
      if (message.type === 'unity.dead' && message.deliveryId) {
        this.settleCancelledDemonstration(message.deliveryId);
      }
      return;
    }
    // host.result becomes authoritative before its ACK can return. The guard accepts input in its resolved phase
    // only when build, session, delivery, selected clock and Unity ordering still match. Such already-committed
    // pointer/gesture packets are therefore verified transport tail, not a new swing and not a protocol failure.
    if (
      (message.type === 'unity.pointer' || message.type === 'unity.gesture') &&
      (this.statusValue === 'result_pending' || this.statusValue === 'resolved')
    ) {
      if (rawGesture) clearRawGesture(rawGesture);
      return;
    }

    switch (message.type) {
      case 'bridge.ack': {
        const waiter = this.pendingAcks.get(message.payload.acknowledgedMessageId);
        if (!waiter) {
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'unexpected_ack' });
          return;
        }
        this.pendingAcks.delete(message.payload.acknowledgedMessageId);
        this.timers.clear(waiter.timer);
        waiter.finish(true);
        return;
      }
      case 'unity.ready':
        if (this.readyWaiter) {
          const waiter = this.readyWaiter;
          this.readyWaiter = null;
          this.timers.clear(waiter.timer);
          waiter.finish(true);
        }
        this.emit({ type: 'ready', ...message.payload });
        return;
      case 'unity.clock_sync': {
        const waiter = this.pendingClocks.get(message.payload.sampleId);
        if (!waiter) {
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'unexpected_clock' });
          return;
        }
        this.pendingClocks.delete(message.payload.sampleId);
        this.timers.clear(waiter.timer);
        try {
          waiter.finish(this.clock.add({ ...message.payload, hostReceivePerfMs: receivedPerfMs }));
        } catch {
          waiter.finish(null);
        }
        return;
      }
      case 'unity.release': {
        const deliveryId = message.deliveryId;
        if (!deliveryId) return;
        if (this.statusValue === 'demonstrating' && deliveryId === this.activeDeliveryId) return;
        if (this.statusValue !== 'delivery') return;
        if (this.releases.has(deliveryId)) {
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'duplicate_semantic' });
          return;
        }
        const releasePerfMs = this.clock.toHostPerfMs(message.payload.releaseUnityMs);
        this.releases.set(deliveryId, releasePerfMs);
        this.emit({ type: 'release', deliveryId, releasePerfMs });
        return;
      }
      case 'unity.pointer': {
        const deliveryId = message.deliveryId;
        if (!deliveryId || this.statusValue !== 'delivery') return;
        this.emit({
          type: 'pointer',
          deliveryId,
          phase: message.payload.phase,
          atPerfMs: this.clock.toHostPerfMs(message.payload.atUnityMs),
          pointer: message.payload.pointer,
        });
        return;
      }
      case 'unity.gesture': {
        const deliveryId = message.deliveryId;
        if (!deliveryId || this.statusValue !== 'delivery') {
          clearRawGesture(message.payload.input);
          return;
        }
        if (this.gestures.has(deliveryId)) {
          clearRawGesture(message.payload.input);
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'duplicate_semantic' });
          return;
        }
        const releasePerfMs = this.releases.get(deliveryId);
        if (releasePerfMs === undefined) {
          clearRawGesture(message.payload.input);
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'gesture_before_release' });
          return;
        }
        this.gestures.add(deliveryId);
        const swing = normalizeEphemeralUnityGesture(message.payload.input, this.clock, {
          releasePerfMs,
          calibrationMs: this.options.calibrationMs,
          calibrations: this.options.calibrations,
          handedness: this.options.initialize.handedness,
        });
        this.emit({ type: 'gesture', deliveryId, swing });
        return;
      }
      case 'unity.protected_regions': {
        const deliveryId = message.deliveryId;
        if (
          !deliveryId ||
          deliveryId !== this.activeDeliveryId ||
          !['delivery', 'result_pending', 'resolved', 'demonstrating'].includes(this.statusValue)
        )
          return;
        this.emit({ type: 'protected_regions', deliveryId, payload: message.payload });
        return;
      }
      case 'unity.dead': {
        const deliveryId = message.deliveryId;
        if (!deliveryId) return;
        const expected = this.expectedDead.get(deliveryId);
        if (
          !expected ||
          deliveryId !== (this.activeDeliveryId ?? this.lastDeliveryId) ||
          message.payload.deadT !== expected.deadT ||
          message.payload.replayDigest !== expected.replayDigest
        ) {
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'resolution_mismatch' });
          await this.fallback('protocol:resolution_mismatch');
          return;
        }
        if (this.statusValue === 'demonstrating') {
          this.expectedDead.delete(deliveryId);
          this.demonstrationPromises.delete(deliveryId);
          this.activeDeliveryId = null;
          this.pendingDeliveryId = null;
          this.statusValue = this.demonstrationReturnStatus ?? 'scene_ready';
          this.demonstrationReturnStatus = null;
          this.emit({ type: 'demonstration_complete', deliveryId, ...message.payload });
          return;
        }
        if (this.statusValue === 'replaying') {
          this.activeDeliveryId = null;
          this.statusValue = 'dead_ball';
          this.emit({ type: 'replay_complete', deliveryId, ...message.payload });
          return;
        }
        if (this.statusValue !== 'resolved') return;
        if (this.deadDeliveries.has(deliveryId)) return;
        this.deadDeliveries.add(deliveryId);
        this.releases.delete(deliveryId);
        this.gestures.delete(deliveryId);
        this.activeDeliveryId = null;
        this.statusValue = 'dead_ball';
        this.emit({ type: 'dead', deliveryId, ...message.payload });
        return;
      }
      case 'unity.dead_ball_action': {
        const deliveryId = message.deliveryId;
        const expected = deliveryId ? this.expectedDead.get(deliveryId) : null;
        if (
          !deliveryId ||
          this.statusValue !== 'dead_ball' ||
          deliveryId !== this.lastDeliveryId ||
          !expected ||
          message.payload.replayDigest !== expected.replayDigest
        ) {
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'resolution_mismatch' });
          await this.fallback('protocol:resolution_mismatch');
          return;
        }
        this.emit({ type: 'dead_ball_action', deliveryId, ...message.payload });
        return;
      }
      case 'unity.stats':
        this.emit({ type: 'stats', stats: message.payload });
        return;
      case 'unity.benchmark': {
        const waiter = this.pendingBenchmarks.get(message.payload.benchmarkId);
        if (!waiter) {
          this.emit({ type: 'protocol_rejected', messageType: message.type, decision: 'benchmark_mismatch' });
          return;
        }
        this.pendingBenchmarks.delete(message.payload.benchmarkId);
        this.timers.clear(waiter.timer);
        waiter.finish(message.payload);
        return;
      }
      case 'unity.pause_request':
        this.emit({ type: 'pause_requested' });
        return;
      case 'unity.quiet':
        this.emit({ type: 'quiet', quiet: message.payload.quiet });
        return;
      case 'unity.error':
        this.emit({ type: 'runtime_error', error: message.payload });
        await this.fallback(`unity:${message.payload.code}`);
        return;
      case 'unity.unloaded':
        // This is the C# runtime's teardown report, not proof that UnityPlayer.unload() completed. The Capacitor
        // unload promise resolves only from Android's lifecycle callback; dispose() publishes the clean event then.
        this.retainedMemoryMb = message.payload.retainedMemoryMb;
        return;
      default:
        return;
    }
  }

  private waitForAck(messageId: string, onAcknowledged: (() => void) | undefined, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = this.timers.set(() => {
        this.pendingAcks.delete(messageId);
        resolve(false);
      }, timeoutMs);
      this.pendingAcks.set(messageId, {
        timer,
        finish: (value) => {
          if (value) onAcknowledged?.();
          resolve(value);
        },
      });
    });
  }

  private cancelAck(messageId: string): void {
    const waiter = this.pendingAcks.get(messageId);
    if (!waiter) return;
    this.pendingAcks.delete(messageId);
    this.timers.clear(waiter.timer);
    waiter.finish(false);
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = this.timers.set(() => {
        this.readyWaiter = null;
        resolve(false);
      }, timeoutMs);
      this.readyWaiter = { timer, finish: resolve };
    });
  }

  private waitForClock(sampleId: string): Promise<UnityPracticeClockEstimate | null> {
    return new Promise((resolve) => {
      const timer = this.timers.set(() => {
        this.pendingClocks.delete(sampleId);
        resolve(null);
      }, this.ackTimeoutMs);
      this.pendingClocks.set(sampleId, { timer, finish: resolve });
    });
  }

  private cancelClock(sampleId: string): void {
    const waiter = this.pendingClocks.get(sampleId);
    if (!waiter) return;
    this.pendingClocks.delete(sampleId);
    this.timers.clear(waiter.timer);
    waiter.finish(null);
  }

  private waitForBenchmark(benchmarkId: string, timeoutMs: number): Promise<UnityPracticeBenchmarkResult | null> {
    return new Promise((resolve) => {
      const timer = this.timers.set(() => {
        this.pendingBenchmarks.delete(benchmarkId);
        resolve(null);
      }, timeoutMs);
      this.pendingBenchmarks.set(benchmarkId, { timer, finish: resolve });
    });
  }

  private cancelBenchmark(benchmarkId: string): void {
    const waiter = this.pendingBenchmarks.get(benchmarkId);
    if (!waiter) return;
    this.pendingBenchmarks.delete(benchmarkId);
    this.timers.clear(waiter.timer);
    waiter.finish(null);
  }

  private nextId(purpose: string): string {
    this.ordinal += 1;
    return this.ids(purpose, this.ordinal);
  }

  private rememberCancelledDemonstration(deliveryId: string): void {
    this.cancelledDemonstrations.add(deliveryId);
    if (this.cancelledDemonstrations.size <= 32) return;
    const oldest = this.cancelledDemonstrations.values().next().value as string | undefined;
    if (oldest) this.cancelledDemonstrations.delete(oldest);
  }

  private settleCancelledDemonstration(deliveryId: string): void {
    const wasCurrent = this.activeDeliveryId === deliveryId || this.pendingDeliveryId === deliveryId;
    this.expectedDead.delete(deliveryId);
    this.demonstrationPromises.delete(deliveryId);
    if (this.pendingDeliveryId === deliveryId) this.pendingDeliveryId = null;
    if (this.activeDeliveryId === deliveryId) this.activeDeliveryId = null;
    if (!wasCurrent) return;
    this.statusValue = this.demonstrationReturnStatus ?? 'scene_ready';
    this.demonstrationReturnStatus = null;
    this.emit({ type: 'demonstration_cancelled', deliveryId });
  }

  private async hasValidResolutionIdentity(resolution: UnityPracticeResolution): Promise<boolean> {
    try {
      return await hasValidUnityPracticeResolutionIdentity(resolution);
    } catch {
      return false;
    }
  }

  private inFallback(): boolean {
    return this.statusValue === 'fallback';
  }

  private isTerminal(): boolean {
    return this.statusValue === 'fallback' || this.statusValue === 'unloaded';
  }

  private emit(event: UnityPracticeCoordinatorEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // A view callback cannot corrupt transport order or make raw input live longer.
    }
  }

  private fallback(
    reason: string,
    disposeReason: Extract<
      UnityPracticePayloadByType['host.dispose']['reason'],
      'cancelled' | 'fallback' | 'error'
    > = 'error',
  ): Promise<boolean> {
    if (this.fallbackTask) return this.fallbackTask;
    this.fallbackTask = this.performFallback(reason, disposeReason);
    return this.fallbackTask;
  }

  private async performFallback(
    reason: string,
    disposeReason: Extract<UnityPracticePayloadByType['host.dispose']['reason'], 'cancelled' | 'fallback' | 'error'>,
  ): Promise<boolean> {
    const inFlightDeliveryId = this.activeDeliveryId ?? this.pendingDeliveryId;
    this.statusValue = 'fallback';
    this.emit({ type: 'fallback', reason, inFlightDeliveryId });
    this.releaseWaiters();
    await this.sendForcedDispose(disposeReason);
    const unloaded = await this.options.bridge.unload().catch(() => false);
    if (unloaded) this.emit({ type: 'unloaded', clean: false, retainedMemoryMb: this.retainedMemoryMb });
    await this.removeListeners();
    return unloaded;
  }

  private async sendForcedDispose(
    reason: Extract<UnityPracticePayloadByType['host.dispose']['reason'], 'cancelled' | 'fallback' | 'error'>,
  ): Promise<void> {
    const message = makeUnityPracticeMessage(
      {
        buildId: this.options.buildId,
        sessionId: this.options.sessionId,
        deliveryId: null,
        messageId: this.nextId('host.dispose'),
        sequence: this.hostSequence,
        sender: 'host',
      },
      'host.dispose',
      { reason },
    );
    const packet = await packUnityPracticeMessage(message).catch(() => null);
    if (!packet || this.guard.accept(message) !== 'accept') return;
    this.hostSequence += 1;
    await this.options.bridge.send(packet).catch(() => false);
  }

  private releaseWaiters(): void {
    if (this.readyWaiter) {
      this.timers.clear(this.readyWaiter.timer);
      this.readyWaiter.finish(false);
      this.readyWaiter = null;
    }
    for (const waiter of this.pendingAcks.values()) {
      this.timers.clear(waiter.timer);
      waiter.finish(false);
    }
    this.pendingAcks.clear();
    for (const waiter of this.pendingClocks.values()) {
      this.timers.clear(waiter.timer);
      waiter.finish(null);
    }
    this.pendingClocks.clear();
    for (const waiter of this.pendingBenchmarks.values()) {
      this.timers.clear(waiter.timer);
      waiter.finish(null);
    }
    this.pendingBenchmarks.clear();
  }

  private async removeListeners(): Promise<void> {
    const removeMessage = this.unsubscribeMessage;
    const removeError = this.unsubscribeError;
    this.unsubscribeMessage = null;
    this.unsubscribeError = null;
    await Promise.all([removeMessage?.(), removeError?.()]);
  }
}
