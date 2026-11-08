import { describe, expect, it, vi } from 'vitest';
import {
  PRACTICE_SIM_VERSION,
  canonicalUnityPracticeJson,
  makeUnityPracticeMessage,
  makeUnityPracticeResolution,
  packUnityPracticeMessage,
  unityPracticeReplayDigest,
  type UnityPracticeMessage,
  type UnityPracticePayloadByType,
  type UnityPracticeResolution,
  type CoachOption,
  type UnityPracticeSenderFor,
  type UnityPracticeUnityMessageType,
} from '@/contracts';
import type {
  StageDeliveryContext,
  StageGuide,
} from '@/practice/ui/flow/types';
import type {
  UnityPracticeAvailability,
  UnityPracticeBridge,
  UnityPracticeNativeError,
} from '@/platform/unityPractice';
import type { UnityPracticeTimers } from '@/practice/unity/coordinator';
import { createUnityPracticeStage, type UnityPracticeInputSink } from '@/practice/unity/stage';
import { effectiveUnityTextScale } from '@/practice/ui/ports';
import { REFERENCE_BALL, REFERENCE_OVER } from '@/practice/game';
import { fixtureField, fixtureFlight, fixtureResult } from '../../render3d/practiceFixtures';
import { countLargeStringifies } from '../../contracts/largeStringifies';

const BUILD_ID = 'unity-stage-test';
const SESSION_ID = 'unity-stage-session';

type IncomingType = UnityPracticeUnityMessageType | 'bridge.ack';

/**
 * Virtual time for the stage's own bounds (ack, launch, release, dead ball). These tests are about what the stage does, not
 * how fast the machine is: a bound that is a real timer expires on a loaded machine while a packet is still being hashed.
 * Nothing here times out by itself; a test that is about a bound arms it by waiting for `armed(delay)` and fires it.
 */
class ManualTimers implements UnityPracticeTimers {
  private next = 0;
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>();

  set(callback: () => void, delayMs: number): number {
    this.next += 1;
    this.timers.set(this.next, { callback, delayMs });
    return this.next;
  }

  clear(handle: unknown): void {
    if (typeof handle === 'number') this.timers.delete(handle);
  }

  /** How many timers of exactly this delay are waiting. */
  armed(delayMs: number): number {
    return [...this.timers.values()].filter((timer) => timer.delayMs === delayMs).length;
  }

  /** Lets the time pass for the timers of exactly this delay. */
  fire(delayMs: number): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.delayMs !== delayMs) continue;
      this.timers.delete(id);
      timer.callback();
    }
  }
}

class StageBridge implements UnityPracticeBridge {
  readonly sent: UnityPracticeMessage[] = [];
  readonly visibility: boolean[] = [];
  readonly readyVisibility: Array<{ visible: boolean; hint: string }> = [];
  canvas: HTMLCanvasElement | null = null;
  readonly attachCanvas?: (canvas: HTMLCanvasElement) => void;
  selectedClockId: string | null = null;
  unloads = 0;
  autoDead = true;
  visibilityWorks = true;
  contextLosses: number | null = 0;
  private unitySequence = 0;
  private clockIndex = 0;
  private messageListener: ((packet: Parameters<UnityPracticeBridge['send']>[0], receivedPerfMs: number) => void) | null = null;

  constructor(canvasBacked = true) {
    if (canvasBacked) this.attachCanvas = (canvas) => {
      this.canvas = canvas;
    };
  }

  async availability(): Promise<UnityPracticeAvailability> {
    return { available: true, reason: 'ready', unityVersion: '6000.3.test' };
  }

  async launch(packet: Parameters<UnityPracticeBridge['launch']>[0]): Promise<boolean> {
    return this.accept(packet);
  }

  async send(packet: Parameters<UnityPracticeBridge['send']>[0]): Promise<boolean> {
    return this.accept(packet);
  }

  async setVisible(visible: boolean): Promise<boolean> {
    this.visibility.push(visible);
    if (this.visibilityWorks && this.canvas) {
      this.canvas.style.opacity = visible ? '1' : '0';
      this.canvas.style.pointerEvents = visible ? 'auto' : 'none';
    }
    return this.visibilityWorks;
  }

  async setReadyVisible(visible: boolean, hint: string): Promise<boolean> {
    this.readyVisibility.push({ visible, hint });
    if (this.visibilityWorks && this.canvas) {
      this.canvas.style.opacity = visible ? '1' : '0';
      this.canvas.style.pointerEvents = 'none';
    }
    return this.visibilityWorks;
  }

  async unload(): Promise<boolean> {
    this.unloads += 1;
    return true;
  }

  async onMessage(listener: NonNullable<StageBridge['messageListener']>): Promise<() => Promise<void>> {
    this.messageListener = listener;
    return async () => {
      this.messageListener = null;
    };
  }

  async onError(_listener: (error: UnityPracticeNativeError) => void): Promise<() => Promise<void>> {
    return async () => undefined;
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

  private async accept(packet: Parameters<UnityPracticeBridge['send']>[0]): Promise<boolean> {
    const message = JSON.parse(packet.body) as UnityPracticeMessage;
    this.sent.push(message);
    await this.emit('bridge.ack', { acknowledgedMessageId: message.messageId });
    if (message.type === 'host.initialize') {
      await this.emit('unity.ready', { renderer: 'Vulkan', unityVersion: '6000.3.test' });
    } else if (message.type === 'host.clock_sync') {
      const roundTripMs = [12, 4, 10, 8, 6][this.clockIndex];
      this.clockIndex += 1;
      const unityReceiveMs = message.payload.hostSendPerfMs - 50 + roundTripMs / 2;
      await this.emit(
        'unity.clock_sync',
        {
          ...message.payload,
          unityReceiveMs,
          unitySendMs: unityReceiveMs + 1,
        },
        null,
        message.payload.hostSendPerfMs + roundTripMs + 1,
      );
    } else if (message.type === 'host.clock_selected') {
      this.selectedClockId = message.payload.sampleId;
    } else if (message.type === 'host.benchmark') {
      await this.emit('unity.benchmark', {
        benchmarkId: message.payload.benchmarkId,
        quality: message.payload.quality,
        frameIntervalsMs: [16.7, 16.6, 16.8],
        warmup: { frames: message.payload.warmupFrames, durationMs: 460, shaderWarmupMs: 31, shaderWarmupCompleted: true },
        graphics: { api: 'Vulkan', device: 'Adreno 619', contextGeneration: null, contextLosses: this.contextLosses },
        memoryMb: 225,
        thermalState: 'nominal',
      });
    } else if (this.autoDead && message.type === 'host.result') {
      await this.emit(
        'unity.dead',
        { deadT: message.payload.result.deadT, replayDigest: message.payload.replayDigest },
        message.deliveryId,
      );
    } else if (this.autoDead && message.type === 'host.replay') {
      await this.emit(
        'unity.dead',
        { deadT: message.payload.resolution.result.deadT, replayDigest: message.payload.resolution.replayDigest },
        message.deliveryId,
      );
    } else if (this.autoDead && message.type === 'host.demonstration') {
      await this.emit(
        'unity.dead',
        { deadT: message.payload.resolution.result.deadT, replayDigest: message.payload.resolution.replayDigest },
        message.deliveryId,
      );
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

function makeStage(
  bridge = new StageBridge(),
  deadTimeoutMs = 1_000,
  accessibility: { textScale: number; highContrast: boolean } = { textScale: 1, highContrast: false },
) {
  let perfMs = 1_000;
  const timers = new ManualTimers();
  const stage = createUnityPracticeStage({
    enableUnityPractice: true,
    bridge,
    timers,
    buildId: BUILD_ID,
    sessionId: SESSION_ID,
    deviceTier: 'full',
    assistance: 'play',
    pixelsPerDp: 3,
    ...accessibility,
    readyHint: 'Localized one-gesture cue',
    // The bounds below are virtual (ManualTimers): they say how long the stage may wait, and no wall clock enforces them here.
    ackTimeoutMs: 100,
    launchTimeoutMs: 100,
    releaseTimeoutMs: 1_000,
    deadTimeoutMs,
    now: () => {
      const value = perfMs;
      perfMs += 100;
      return value;
    },
  });
  return { bridge, stage, timers };
}

async function mountAndScene(stage: ReturnType<typeof makeStage>['stage']): Promise<void> {
  await stage.mount(document.createElement('canvas'), {
    profile: 'standard',
    handedness: 'right',
    reducedMotion: false,
    learnCue: false,
  });
  stage.setScene({
    field: fixtureField(),
    fieldIntent: 'attack_outside_off',
    trainingObjective: 'random',
    bowler: REFERENCE_OVER.bowler,
    conditions: 'balanced',
    handedness: 'right',
    ball: REFERENCE_BALL,
  });
}

async function makeResolution(
  flight: ReturnType<typeof fixtureFlight>,
  overIndex = 0,
  ballIndex = 0,
  authoritativeSwing?: UnityPracticeResolution['result']['swing'],
): Promise<UnityPracticeResolution> {
  const fixture = fixtureResult(flight, { kind: 'drive' });
  const result = authoritativeSwing === undefined ? fixture : { ...fixture, swing: authoritativeSwing };
  const record = {
    version: PRACTICE_SIM_VERSION,
    overIndex,
    ballIndex,
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

function coachOptionOf(resolution: UnityPracticeResolution): CoachOption {
  const result = resolution.result;
  return {
    kind: 'recommended',
    decision: result.swing ? 'attack' : 'leave',
    swing: result.swing,
    footwork: result.footwork,
    outcome: result.outcome,
    contact: result.contact.kind,
    contactPoint: result.contact.point,
    contactT: result.contact.t,
    dismissalRisk: 0,
    expectedRuns: result.outcome.runs,
    region: null,
    risks: [],
  };
}

async function bowlAndRelease(
  stage: ReturnType<typeof makeStage>['stage'],
  bridge: StageBridge,
  flight: ReturnType<typeof fixtureFlight>,
  overIndex = 0,
  ballIndex = 0,
): Promise<{ releasePerfMs: number; deliveryId: string }> {
  // Remove this compatibility cast when the root-owned StageDeliveryContext gains the Unity identity fields.
  const context = { overIndex, ballIndex, seed: flight.seed } as StageDeliveryContext;
  const deliveryCount = bridge.sent.filter((message) => message.type === 'host.delivery').length;
  const bowl = stage.bowl(flight, context);
  // If the stage gives up before it sends the delivery, fail with its own error at once instead of waiting out the ceiling.
  let refused: { error: unknown } | null = null;
  bowl.catch((error: unknown) => {
    refused = { error };
  });
  await spinUntil(() => refused !== null || bridge.sent.filter((message) => message.type === 'host.delivery').length > deliveryCount);
  if (refused !== null) throw (refused as { error: unknown }).error;
  const delivery = bridge.sent.findLast((message) => message.type === 'host.delivery');
  if (!delivery?.deliveryId || !bridge.selectedClockId) throw new Error('delivery was not sent');
  await bridge.emit(
    'unity.release',
    { releaseUnityMs: 2_000, clockSampleId: bridge.selectedClockId },
    delivery.deliveryId,
  );
  return { ...(await bowl), deliveryId: delivery.deliveryId };
}

describe('Unity Practice stage adapter', () => {
  it('reveals an acknowledged ready scene without arming or starting a delivery', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);

    expect(await stage.presentReady(true)).toBe(true);
    expect(bridge.readyVisibility).toEqual([
      { visible: true, hint: 'Localized one-gesture cue' },
    ]);
    expect(bridge.sent.filter((message) => message.type === 'host.scene')).toHaveLength(1);
    expect(bridge.sent.filter((message) => message.type === 'host.delivery')).toHaveLength(0);
    expect(stage.snapshot()).toMatchObject({ visible: true, quiet: false, activeDeliveryId: null });

    expect(await stage.presentReady(false)).toBe(true);
    expect(bridge.readyVisibility.at(-1)).toEqual({ visible: false, hint: 'Localized one-gesture cue' });
    expect(stage.snapshot()).toMatchObject({ visible: false, quiet: false, activeDeliveryId: null });

    stage.setLanguage('hi', 'खींचें · देखें · आगे फ्लिक करें · छोड़ने के लिए कुछ न करें');
    await spinUntil(() => bridge.sent.some((message) => message.type === 'host.locale'));
    expect(bridge.sent.findLast((message) => message.type === 'host.locale')?.payload).toEqual({ locale: 'hi' });
    expect(await stage.presentReady(true)).toBe(true);
    expect(bridge.readyVisibility.at(-1)).toEqual({
      visible: true,
      hint: 'खींचें · देखें · आगे फ्लिक करें · छोड़ने के लिए कुछ न करें',
    });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('presents the authoritative Coach response on the identical Unity canvas with input inert', async () => {
    const bridge = new StageBridge();
    bridge.autoDead = false;
    const { stage } = makeStage(bridge);
    const input: string[] = [];
    stage.setInputSink({
      onSwingStart: () => input.push('start'),
      onGestureCancel: () => input.push('cancel'),
      onSwing: () => input.push('swing'),
    });
    await mountAndScene(stage);
    const canvas = bridge.canvas;
    const resolved = await makeResolution(fixtureFlight({ seed: 'unity-stage-demonstration' }));

    const shown = stage.demonstrate(resolved.result, coachOptionOf(resolved), {
      source: resolved.record,
    });
    await spinUntil(() => bridge.sent.some((message) => message.type === 'host.demonstration'));
    const packet = bridge.sent.findLast((message) => message.type === 'host.demonstration');
    expect(packet?.payload.resolution.result).toEqual(resolved.result);
    expect(packet?.payload.resolution.record).toEqual(resolved.record);
    expect(bridge.canvas).toBe(canvas);
    expect(canvas?.dataset.gameplayInput).toBe('blocked');
    expect(canvas?.style.pointerEvents).toBe('none');
    expect(input).toEqual([]);
    expect(bridge.sent.some((message) => message.type === 'host.delivery')).toBe(false);
    expect(bridge.sent.some((message) => message.type === 'host.result')).toBe(false);

    if (!packet?.deliveryId) throw new Error('demonstration id missing');
    await bridge.emit('unity.dead', {
      deadT: resolved.result.deadT,
      replayDigest: packet.payload.resolution.replayDigest,
    }, packet.deliveryId);
    await shown;

    expect(bridge.canvas).toBe(canvas);
    expect(stage.snapshot()).toMatchObject({
      visible: true,
      retainingFinalPose: true,
      inputActive: false,
      activeDeliveryId: null,
      coordinatorStatus: 'scene_ready',
    });
    expect(input).toEqual([]);
    stage.dispose();
    await stage.whenDisposed();
  });

  it('accepts Coach body-contact metadata that intentionally omits the physics impact coordinates', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);
    const resolved = await makeResolution(fixtureFlight({ seed: 'unity-stage-body-demonstration' }));
    const bodyResult: UnityPracticeResolution['result'] = {
      ...resolved.result,
      contact: {
        ...resolved.result.contact,
        kind: 'body',
        t: resolved.result.contact.t ?? 0.8,
        point: resolved.result.contact.point ?? { x: 0.15, y: 0.62, z: 8.4 },
      },
      events: resolved.result.events.map((event) =>
        event.kind === 'contact' ? { ...event, contact: 'body' as const } : event),
    };
    const option: CoachOption = {
      ...coachOptionOf(resolved),
      contact: 'body',
      contactT: null,
      contactPoint: null,
      outcome: bodyResult.outcome,
      footwork: bodyResult.footwork,
      swing: bodyResult.swing,
      decision: bodyResult.swing?.kind ?? 'leave',
    };

    await stage.demonstrate(bodyResult, option, { source: resolved.record });

    const packet = bridge.sent.findLast((message) => message.type === 'host.demonstration');
    expect(packet?.payload.resolution.result.contact).toMatchObject({
      kind: 'body',
      t: bodyResult.contact.t,
      point: bodyResult.contact.point,
    });
    expect(packet?.payload.delivery.presentation.coach).toMatchObject({
      contactT: null,
      contactPoint: null,
    });
    expect(stage.snapshot()).toMatchObject({
      retainingFinalPose: true,
      inputActive: false,
      coordinatorStatus: 'scene_ready',
    });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('cancels first-run teaching without unloading and does not let a live ball overtake the cancel ACK', async () => {
    const bridge = new StageBridge();
    bridge.autoDead = false;
    const { stage } = makeStage(bridge);
    await mountAndScene(stage);
    const canvas = bridge.canvas;
    const resolved = await makeResolution(fixtureFlight({ seed: 'unity-stage-cancel-demo' }));
    const abort = new AbortController();
    const shown = stage.demonstrate(resolved.result, coachOptionOf(resolved), {
      source: resolved.record,
      signal: abort.signal,
    });
    await spinUntil(() => bridge.sent.some((message) => message.type === 'host.demonstration'));

    abort.abort();
    const liveFlight = fixtureFlight({ seed: 'live-after-demo-cancel' });
    const released = bowlAndRelease(stage, bridge, liveFlight);
    await expect(shown).rejects.toMatchObject({ name: 'AbortError' });
    const live = await released;

    const cancelIndex = bridge.sent.findIndex((message) => message.type === 'host.demonstration_cancel');
    const deliveryIndex = bridge.sent.findIndex((message) => message.type === 'host.delivery');
    expect(cancelIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryIndex).toBeGreaterThan(cancelIndex);
    expect(bridge.unloads).toBe(0);
    expect(bridge.canvas).toBe(canvas);
    expect(canvas?.dataset.gameplayInput).toBe('active');

    bridge.autoDead = true;
    const liveResolution = await makeResolution(liveFlight);
    stage.supplyResolution(liveResolution);
    await stage.play(liveResolution.result);
    expect(live.deliveryId).toContain(':delivery:');
    stage.dispose();
    await stage.whenDisposed();
  });

  it('retains the authoritative browser final pose without retaining gameplay input', async () => {
    const { bridge, stage } = makeStage();
    const quiet: boolean[] = [];
    stage.on('quiet', ({ quiet: value }) => quiet.push(value));
    const starts: Array<{ atPerfMs: number; pointer: string }> = [];
    let cancels = 0;
    let pauseRequests = 0;
    const swings: Array<Parameters<UnityPracticeInputSink['onSwing']>[0]> = [];
    stage.setInputSink({
      onSwingStart: (atPerfMs, pointer) => starts.push({ atPerfMs, pointer }),
      onGestureCancel: () => {
        cancels += 1;
      },
      onSwing: (swing) => swings.push(swing),
      onPauseRequest: () => {
        pauseRequests += 1;
      },
    });
    await mountAndScene(stage);
    expect(stage.ownsInput).toBe(true);
    expect(bridge.visibility).toEqual([false]);
    expect(bridge.selectedClockId).toBe(`${SESSION_ID}:clock:2`);

    const flight = fixtureFlight({ seed: 'stage-live-flight' });
    expect(() => stage.setAssistance(null, null)).not.toThrow();
    const released = await bowlAndRelease(stage, bridge, flight);
    expect(released.releasePerfMs).toBe(2_050);
    expect(bridge.visibility).toEqual([false, true]);
    await bridge.emit(
      'unity.pointer',
      { phase: 'down', atUnityMs: 2_010, clockSampleId: bridge.selectedClockId! , pointer: 'touch' },
      released.deliveryId,
    );
    await bridge.emit(
      'unity.pointer',
      { phase: 'cancel', atUnityMs: 2_011, clockSampleId: bridge.selectedClockId! , pointer: 'touch' },
      released.deliveryId,
    );
    await bridge.emit(
      'unity.gesture',
      {
        retention: 'memory-until-resolution',
        clockSampleId: bridge.selectedClockId!,
        input: {
          pointer: 'touch',
          surface: { width: 400, height: 800 },
          samples: [
            { t: 2_010, x: 100, y: 500 },
            { t: 2_020, x: 101, y: 501 },
          ],
        },
      },
      released.deliveryId,
    );
    await spinUntil(() => swings.length === 1);
    expect(starts).toEqual([{ atPerfMs: 2_060, pointer: 'touch' }]);
    expect(cancels).toBe(1);
    expect(swings[0]).toEqual({ kind: 'defend', startT: 0.01, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' });
    await bridge.emit('unity.pause_request', { reason: 'player' });
    // The bridge delivers packets into the coordinator's ordered async inbound queue. Under a loaded shared runner,
    // give that queue a real bounded deadline rather than assuming 100 zero-delay timer turns are enough.
    await vi.waitFor(() => expect(pauseRequests).toBe(1), { timeout: 5_000, interval: 10 });

    const resolution = await makeResolution(flight, 0, 0, swings[0]);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);
    expect(bridge.sent.filter((message) => message.type === 'host.result')).toHaveLength(1);
    expect(bridge.sent.find((message) => message.type === 'host.result')?.payload).toEqual(resolution);
    expect(bridge.visibility).toEqual([false, true]);
    expect(quiet).toEqual([true, false]);
    expect(stage.snapshot()).toMatchObject({
      visible: true,
      retainingFinalPose: true,
      inputActive: false,
      quiet: false,
      activeDeliveryId: null,
    });
    expect(bridge.canvas?.style.opacity).toBe('1');
    expect(bridge.canvas?.style.pointerEvents).toBe('none');
    expect(bridge.canvas?.dataset.gameplayInput).toBe('blocked');
    await bridge.emit('unity.pause_request', { reason: 'player' });
    await vi.waitFor(() => expect(pauseRequests).toBe(2), { timeout: 5_000, interval: 10 });

    await stage.replay(resolution.result, { speed: 0.3, diagnostics: true });
    expect(bridge.sent.filter((message) => message.type === 'host.replay')).toHaveLength(1);
    expect(bridge.visibility.at(-1)).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    expect(bridge.canvas?.style.pointerEvents).toBe('none');
    stage.dispose();
    await stage.whenDisposed();
    expect(bridge.unloads).toBe(1);
  });

  it('re-arms only the next acknowledged delivery and restores a frozen pose after pause/resume', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);
    const firstFlight = fixtureFlight({ seed: 'continuity-first-flight' });
    await bowlAndRelease(stage, bridge, firstFlight);
    const firstResolution = await makeResolution(firstFlight);
    stage.supplyResolution(firstResolution);
    await stage.play(firstResolution.result);

    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    expect(await stage.pause('background')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: false, retainingFinalPose: true, inputActive: false });
    expect(await stage.resume('foreground')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: false, retainingFinalPose: true, inputActive: false });
    expect(await stage.resume('player')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    expect(bridge.canvas?.style.pointerEvents).toBe('none');

    const secondFlight = fixtureFlight({ seed: 'continuity-second-flight' });
    await bowlAndRelease(stage, bridge, secondFlight, 0, 1);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: false, inputActive: true });
    expect(bridge.canvas?.style.pointerEvents).toBe('auto');
    const secondResolution = await makeResolution(secondFlight, 0, 1);
    stage.supplyResolution(secondResolution);
    await stage.play(secondResolution.result);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    expect(bridge.canvas?.style.pointerEvents).toBe('none');

    stage.dispose();
    await stage.whenDisposed();
  });

  it('retains the native Unity final pose at dead ball with gameplay input inert', async () => {
    const bridge = new StageBridge(false);
    const { stage } = makeStage(bridge);
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'native-overlay-dead-ball' });
    await bowlAndRelease(stage, bridge, flight);
    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);

    expect(bridge.visibility).toEqual([false, true]);
    expect(stage.snapshot()).toMatchObject({
      visible: true,
      retainingFinalPose: true,
      inputActive: false,
      activeDeliveryId: null,
    });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('binds native dead-ball guidance and one action to the retained exact pose', async () => {
    const bridge = new StageBridge(false);
    const { stage } = makeStage(bridge);
    const onDeadBallAction = vi.fn();
    stage.setInputSink({
      onSwingStart: vi.fn(),
      onGestureCancel: vi.fn(),
      onSwing: vi.fn(),
      onDeadBallAction,
    });
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'native-dead-ball-ui' });
    await bowlAndRelease(stage, bridge, flight);
    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);

    const initial = {
      reason: 'Reading your shot…',
      recommendation: '',
      primaryAction: 'practice_ball' as const,
      primaryLabel: 'Practice this ball',
      secondaryAction: 'next_ball' as const,
      secondaryLabel: 'Next ball',
    };
    expect(await stage.presentDeadBallUi(initial)).toBe(true);
    expect(await stage.presentDeadBallUi({
      ...initial,
      reason: 'You played too early',
      recommendation: 'Wait for the ball',
    })).toBe(true);
    const guidance = bridge.sent.filter((message) => message.type === 'host.dead_ball_ui');
    expect(guidance).toHaveLength(2);
    expect(guidance[0]).toMatchObject({
      deliveryId: `${SESSION_ID}:delivery:1`,
      payload: { replayDigest: resolution.replayDigest, recommendation: '' },
    });

    await bridge.emit('unity.dead_ball_action', {
      action: 'practice_ball',
      replayDigest: resolution.replayDigest,
    }, `${SESSION_ID}:delivery:1`);
    await spinUntil(() => onDeadBallAction.mock.calls.length === 1);
    expect(onDeadBallAction).toHaveBeenCalledWith('practice_ball');
    expect(await stage.presentDeadBallUi(initial)).toBe(false);

    await bridge.emit('unity.dead_ball_action', {
      action: 'next_ball',
      replayDigest: resolution.replayDigest,
    }, `${SESSION_ID}:delivery:1`);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    expect(onDeadBallAction).toHaveBeenCalledTimes(1);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('restores the same localized native dead-ball UI after an exact replay', async () => {
    const bridge = new StageBridge(false);
    const { stage } = makeStage(bridge);
    let deadBallPause: Promise<boolean> | null = null;
    const onPauseRequest = vi.fn(() => {
      deadBallPause = stage.pause('player');
    });
    stage.setInputSink({
      onSwingStart: vi.fn(),
      onGestureCancel: vi.fn(),
      onSwing: vi.fn(),
      onPauseRequest,
    });
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'native-replay-dead-ball-ui' });
    await bowlAndRelease(stage, bridge, flight);
    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);
    expect(await stage.presentDeadBallUi({
      reason: 'Wait for the ball',
      recommendation: 'Play later',
      primaryAction: 'next_ball',
      primaryLabel: 'Next ball',
      secondaryAction: null,
      secondaryLabel: null,
    })).toBe(true);
    expect(bridge.sent.filter((message) => message.type === 'host.dead_ball_ui')).toHaveLength(1);

    bridge.autoDead = false;
    const replay = stage.replay(resolution.result);
    await spinUntil(() => bridge.sent.some((message) => message.type === 'host.replay'));
    await bridge.emit('unity.pause_request', { reason: 'player' });
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    expect(onPauseRequest).not.toHaveBeenCalled();
    await bridge.emit('unity.dead', {
      deadT: resolution.result.deadT,
      replayDigest: resolution.replayDigest,
    }, `${SESSION_ID}:delivery:1`);
    await replay;
    await spinUntil(() => bridge.sent.filter((message) => message.type === 'host.dead_ball_ui').length === 2);
    const guidance = bridge.sent.filter((message) => message.type === 'host.dead_ball_ui');
    expect(guidance[1]).toMatchObject({
      deliveryId: `${SESSION_ID}:delivery:1`,
      payload: { replayDigest: resolution.replayDigest, reason: 'Wait for the ball' },
    });
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });

    await bridge.emit('unity.pause_request', { reason: 'player' });
    await spinUntil(() => onPauseRequest.mock.calls.length === 1);
    await deadBallPause;
    expect(stage.snapshot()).toMatchObject({ visible: false, retainingFinalPose: true, inputActive: false });
    expect(await stage.resume('player')).toBe(true);
    await spinUntil(() => bridge.sent.filter((message) => message.type === 'host.dead_ball_ui').length === 3);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('settles a dead-ball frame hidden by an interruption and reveals it inert on resume', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'hidden-dead-ball-race' });
    await bowlAndRelease(stage, bridge, flight);
    expect(await stage.pause('background')).toBe(true);
    expect(stage.snapshot().visible).toBe(false);

    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await expect(stage.play(resolution.result)).resolves.toBeUndefined();
    expect(stage.snapshot()).toMatchObject({
      visible: false,
      retainingFinalPose: true,
      inputActive: false,
      activeDeliveryId: null,
    });

    expect(await stage.resume('foreground')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: false, retainingFinalPose: true, inputActive: false });
    expect(await stage.resume('player')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    expect(bridge.canvas?.style.pointerEvents).toBe('none');
    stage.dispose();
    await stage.whenDisposed();
  });

  it('keeps the Android overlay hidden across ready and mid-delivery foreground until player Resume', async () => {
    const bridge = new StageBridge(false);
    const { stage } = makeStage(bridge);
    await mountAndScene(stage);

    expect(await stage.presentReady(true)).toBe(true);
    expect(stage.snapshot().visible).toBe(true);
    expect(await stage.pause('background')).toBe(true);
    expect(stage.snapshot().visible).toBe(false);
    expect(await stage.resume('foreground')).toBe(true);
    expect(stage.snapshot().visible).toBe(false);
    // Explicit Resume in a ready state clears the lifecycle hold; the next
    // delivery, not the foreground callback, reveals Unity.
    expect(await stage.resume('player')).toBe(true);
    expect(stage.snapshot().visible).toBe(false);

    const flight = fixtureFlight({ seed: 'android-foreground-mid-delivery' });
    await bowlAndRelease(stage, bridge, flight);
    expect(stage.snapshot()).toMatchObject({ visible: true, inputActive: true });
    expect(await stage.pause('background')).toBe(true);
    expect(stage.snapshot().visible).toBe(false);
    expect(await stage.resume('foreground')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: false, inputActive: false });

    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);
    expect(stage.snapshot()).toMatchObject({ visible: false, retainingFinalPose: true, inputActive: false });
    expect(await stage.resume('player')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('launches with the effective accessibility presentation and preserves it across dead-ball resume', async () => {
    const bridge = new StageBridge(false);
    const effectiveTextScale = effectiveUnityTextScale(1, 2);
    expect(effectiveTextScale).toBe(2);
    expect(effectiveUnityTextScale(2, 3)).toBe(2);
    expect(effectiveUnityTextScale(1, 0.5)).toBe(1);
    const { stage } = makeStage(bridge, 1_000, { textScale: effectiveTextScale, highContrast: true });
    await mountAndScene(stage);
    await spinUntil(() => bridge.sent.some((message) => message.type === 'host.scene'));
    const initialize = bridge.sent.find((message) => message.type === 'host.initialize');
    expect(initialize?.payload).toMatchObject({
      pixelsPerDp: 3,
      reducedMotion: false,
      textScale: 2,
      highContrast: true,
    });
    expect(bridge.sent.find((message) => message.type === 'host.scene')?.payload).toMatchObject({
      fieldIntent: 'attack_outside_off',
      trainingObjective: 'random',
    });

    const flight = fixtureFlight({ seed: 'accessibility-resume' });
    await bowlAndRelease(stage, bridge, flight);
    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);
    expect(await stage.pause('background')).toBe(true);
    expect(await stage.resume('foreground')).toBe(true);
    expect(bridge.sent.filter((message) => message.type === 'host.initialize')).toHaveLength(1);
    expect(stage.snapshot()).toMatchObject({ visible: false, retainingFinalPose: true, inputActive: false });
    expect(await stage.resume('player')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ visible: true, retainingFinalPose: true, inputActive: false });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('fails closed with in-flight diagnostics when play lacks authoritative record/score context', async () => {
    const { bridge, stage } = makeStage();
    const fallbacks: string[] = [];
    stage.on('fallback', (event) => fallbacks.push(event.message ?? event.reason));
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'missing-resolution-flight' });
    const released = await bowlAndRelease(stage, bridge, flight);

    await expect(stage.play(fixtureResult(flight, { kind: 'drive' }))).rejects.toThrow(/resolution missing/i);
    expect(stage.snapshot().diagnostics).toContainEqual({
      code: 'resolution_missing',
      detail: 'Unity presentation requires the committed authoritative resolution.',
      inFlightDeliveryId: released.deliveryId,
    });
    expect(fallbacks).toHaveLength(1);
    expect(bridge.visibility.at(-1)).toBe(false);
    expect(bridge.unloads).toBe(1);
  });

  it('fails closed, hides, and unloads when an acknowledged replay never reaches dead ball', async () => {
    const bridge = new StageBridge();
    const { stage, timers } = makeStage(bridge, 5);
    const fallbacks: string[] = [];
    stage.on('fallback', (event) => fallbacks.push(event.message ?? event.reason));
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'replay-dead-timeout-flight' });
    await bowlAndRelease(stage, bridge, flight);
    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);
    await stage.play(resolution.result);

    bridge.autoDead = false;
    const replaying = expect(stage.replay(resolution.result)).rejects.toThrow(/replay dead-ball timeout/i);
    // The replay was acknowledged and the dead ball never comes: the bound (5 ms of virtual time) is armed, and passes.
    await spinUntil(() => timers.armed(5) > 0);
    timers.fire(5);
    await replaying;

    expect(stage.snapshot()).toMatchObject({ visible: false, quiet: false, activeDeliveryId: null });
    expect(stage.snapshot().diagnostics).toContainEqual({
      code: 'dead_timeout',
      detail: 'Unity replay did not reach dead ball within the bounded presentation window.',
      inFlightDeliveryId: null,
    });
    expect(fallbacks).toEqual(['Unity replay did not reach dead ball within the bounded presentation window.']);
    expect(bridge.visibility.at(-1)).toBe(false);
    expect(bridge.unloads).toBe(1);
  });

  it('uses correlated native renderer evidence and requires explicit opt-in', async () => {
    const bridge = new StageBridge();
    expect(() =>
      createUnityPracticeStage({
        enableUnityPractice: false as true,
        bridge,
        buildId: BUILD_ID,
        sessionId: SESSION_ID,
        deviceTier: 'full',
        assistance: 'play',
        pixelsPerDp: 3,
        textScale: 1,
        highContrast: false,
      }),
    ).toThrow(/explicit opt-in/);

    const { stage } = makeStage(bridge);
    await mountAndScene(stage);
    await spinUntil(() => stage.snapshot().coordinatorStatus === 'scene_ready');
    expect(await stage.benchmark(1_400)).toEqual({
      backend: 'unity',
      frameMs: [16.7, 16.6, 16.8],
      shaderCompileMs: 31,
      contextLosses: 0,
      renderer: 'Vulkan Adreno 619',
      webgl2: false,
      hardware: true,
    });
    expect(bridge.sent.find((message) => message.type === 'host.benchmark')?.payload).toMatchObject({
      benchmarkId: `${SESSION_ID}:benchmark:1`,
      durationMs: 1_400,
      quality: 'standard',
    });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('latches the current Learn cue atomically into the authoritative delivery', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);
    expect(() => stage.setAssistance(null, null)).not.toThrow();
    stage.setLearnCue(true);

    const flight = fixtureFlight({ seed: 'ordinary-delivery-after-assistance-clear' });
    await expect(bowlAndRelease(stage, bridge, flight)).resolves.toMatchObject({ deliveryId: expect.any(String) });
    const delivery = bridge.sent.findLast((message) => message.type === 'host.delivery');
    expect(delivery?.payload.presentation).toEqual({ learnCue: true, coach: null });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('keeps an exact-ball Coach attempt on Unity with only host-authoritative guide data', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'coach-guide-delivery' });
    const result = fixtureResult(flight, { kind: 'drive' });
    const guide: StageGuide = {
      result,
      option: {
        kind: 'recommended',
        decision: 'attack',
        swing: result.swing,
        footwork: result.footwork,
        outcome: result.outcome,
        contact: result.contact.kind,
        contactPoint: result.contact.point,
        contactT: result.contact.t,
        dismissalRisk: 0,
        expectedRuns: result.outcome.runs,
        region: result.outcome.region,
        risks: [],
      },
    };
    stage.setLearnCue(true);
    stage.setAssistance(3, guide);

    await expect(bowlAndRelease(stage, bridge, flight)).resolves.toMatchObject({ deliveryId: expect.any(String) });
    const delivery = bridge.sent.findLast((message) => message.type === 'host.delivery');
    expect(delivery?.payload.presentation).toEqual({
      learnCue: false,
      coach: { stage: 3, contactT: result.contact.t, contactPoint: result.contact.point },
    });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('fails closed before native delivery when a Coach guide belongs to another ball', async () => {
    const { bridge, stage } = makeStage();
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed: 'coach-guide-current' });
    const other = fixtureFlight({ seed: 'coach-guide-other' });
    const result = fixtureResult(other, { kind: 'drive' });
    stage.setAssistance(1, {
      result,
      option: {
        kind: 'recommended', decision: 'attack', swing: result.swing, footwork: result.footwork,
        outcome: result.outcome, contact: result.contact.kind, contactPoint: result.contact.point,
        contactT: result.contact.t, dismissalRisk: 0, expectedRuns: result.outcome.runs,
        region: result.outcome.region, risks: [],
      },
    });

    await expect(stage.bowl(flight, { overIndex: 0, ballIndex: 0, seed: flight.seed } as StageDeliveryContext))
      .rejects.toThrow(/guide delivery mismatch/);
    expect(bridge.sent.filter((message) => message.type === 'host.delivery')).toHaveLength(0);
    stage.dispose();
    await stage.whenDisposed();
  });

  it('rejects a native benchmark when context-loss evidence is unknown', async () => {
    const bridge = new StageBridge();
    bridge.contextLosses = null;
    const { stage } = makeStage(bridge);
    await mountAndScene(stage);
    await spinUntil(() => stage.snapshot().coordinatorStatus === 'scene_ready');

    await expect(stage.benchmark(1_400)).rejects.toThrow(/context-loss evidence unavailable/);
    stage.dispose();
    await stage.whenDisposed();
  });
});

describe('Unity Practice stage with a resolution made once', () => {
  async function madeResolution(flight: ReturnType<typeof fixtureFlight>): Promise<UnityPracticeResolution> {
    const byHand = await makeResolution(flight);
    return makeUnityPracticeResolution(byHand.record, byHand.result, byHand.score);
  }

  // A full canonicalization of the result is one JSON.stringify call at least this long.
  const fullResultLength = (resolution: UnityPracticeResolution) => Math.floor(canonicalUnityPracticeJson(resolution.result).length * 0.9);

  async function stageAtRelease(seed: string) {
    const bridge = new StageBridge(false);
    const { stage } = makeStage(bridge);
    await mountAndScene(stage);
    const flight = fixtureFlight({ seed });
    await bowlAndRelease(stage, bridge, flight);
    return { bridge, stage, flight };
  }

  it('plays and replays a made resolution without canonicalizing its result again', async () => {
    const { stage, flight } = await stageAtRelease('stage-made-once');
    const resolution = await madeResolution(flight);
    stage.supplyResolution(resolution);

    const played = await countLargeStringifies(fullResultLength(resolution), () => stage.play(resolution.result));
    expect(played, 'play').toBe(0);
    const replayed = await countLargeStringifies(fullResultLength(resolution), () => stage.replay(resolution.result));
    expect(replayed, 'replay').toBe(0);
    expect(stage.snapshot()).toMatchObject({ retainingFinalPose: true, inputActive: false });
    stage.dispose();
    await stage.whenDisposed();
  });

  it('still compares and canonicalizes, as before, for a resolution built by hand', async () => {
    const { stage, flight } = await stageAtRelease('stage-by-hand');
    const resolution = await makeResolution(flight);
    stage.supplyResolution(resolution);

    const played = await countLargeStringifies(fullResultLength(resolution), () => stage.play(resolution.result));
    expect(played, 'play: sameResult twice, the identity checks, the packet').toBeGreaterThanOrEqual(4);
    const replayed = await countLargeStringifies(fullResultLength(resolution), () => stage.replay(resolution.result));
    expect(replayed, 'replay').toBeGreaterThanOrEqual(4);
    stage.dispose();
    await stage.whenDisposed();
  });

  it('refuses a result that is not the made resolution\'s result, by content, as before', async () => {
    const { bridge, stage, flight } = await stageAtRelease('stage-other-result');
    const resolution = await madeResolution(flight);
    stage.supplyResolution(resolution);
    const other = { ...resolution.result, deadT: resolution.result.deadT + 0.5 };

    await expect(stage.play(other)).rejects.toThrow('Unity Practice authoritative result mismatch.');
    expect(bridge.sent.some((message) => message.type === 'host.result')).toBe(false);
    stage.dispose();
    await stage.whenDisposed();
  });

  it('accepts an equal copy of the result of a made resolution by content', async () => {
    const { bridge, stage, flight } = await stageAtRelease('stage-equal-copy');
    const resolution = await madeResolution(flight);
    stage.supplyResolution(resolution);
    const copy = JSON.parse(JSON.stringify(resolution.result)) as typeof resolution.result;

    const canonicalizations = await countLargeStringifies(fullResultLength(resolution), () => stage.play(copy));
    expect(canonicalizations, 'a copy is not the made result: sameResult canonicalizes both').toBeGreaterThanOrEqual(2);
    expect(bridge.sent.some((message) => message.type === 'host.result')).toBe(true);
    stage.dispose();
    await stage.whenDisposed();
  });

  it('throws, as before, when the made result became impossible to canonicalize', async () => {
    const { bridge, stage, flight } = await stageAtRelease('stage-impossible-after-make');
    const resolution = await madeResolution(flight);
    stage.supplyResolution(resolution);
    resolution.result.deadT = Number.NaN;

    // The identity shortcut must not hide this: the changed result is compared by content, which cannot be canonicalized.
    await expect(stage.play(resolution.result)).rejects.toThrow('Canonical JSON cannot contain a non-finite number.');
    expect(bridge.sent.some((message) => message.type === 'host.result')).toBe(false);
    stage.dispose();
    await stage.whenDisposed();
  });

  it('fails closed, as before, when the made resolution changed after it was made', async () => {
    const { bridge, stage, flight } = await stageAtRelease('stage-changed-after-make');
    const resolution = await madeResolution(flight);
    stage.supplyResolution(resolution);
    resolution.result.deadT += 0.25;

    await expect(stage.play(resolution.result)).rejects.toThrow('Unity Practice result failed.');
    expect(bridge.sent.some((message) => message.type === 'host.result')).toBe(false);
    stage.dispose();
    await stage.whenDisposed();
  });
});
