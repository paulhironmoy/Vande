import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BallFlight, DeliveryResult, NormalizedSwing, UnityPracticeResolution } from '@/contracts';
import { hasValidUnityPracticeResolutionIdentity, unityPracticeReplayDigest } from '@/contracts';
import type { BenchmarkOptions } from '@/perf';
import { updatePracticeSettings } from '@/practice/store';
import type {
  PracticeStageLike,
  StageDeliveryContext,
  StageFactory,
  StageGuide,
  StageInputSink,
  StageDeadBallUi,
  StageScene,
} from '@/practice/ui/flow/types';
import { assessmentForRenderer, nativeAssessmentEligible } from '@/practice/ui/flow/stageHost';
import {
  UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID,
  unityPracticeEngineeringPreviewEnabled,
} from '@/practice/unity/engineeringPreview';
import { isCoachSafeUnityStage } from '@/practice/unity/coachSafeStage';
import { assessment, FakeStage, memoryStore } from './fakes';
import { attack, setup, until, useFakeTimers } from './flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

class NativeInputStage extends FakeStage {
  readonly ownsInput = true;
  sink: StageInputSink | null = null;
  readonly bowls: Array<{ flight: BallFlight; context: StageDeliveryContext | undefined }> = [];
  readonly resolutions: UnityPracticeResolution[] = [];
  readonly played: DeliveryResult[] = [];
  readonly authorityOrder: string[] = [];
  readonly readyPresentation: boolean[] = [];
  readonly deadBallUi: StageDeadBallUi[] = [];
  readonly scenes: StageScene[] = [];

  constructor(
    store: ReturnType<typeof memoryStore>,
    private readonly nativeSwing: NormalizedSwing | 'pause',
    private readonly inputTiming: 'next-task' | 'same-task' = 'next-task',
  ) {
    super('3d', store);
  }

  setInputSink(sink: StageInputSink | null): void {
    this.sink = sink;
  }

  setScene(scene?: StageScene): void {
    if (scene) this.scenes.push(scene);
    super.setScene();
  }

  async presentReady(visible: boolean): Promise<boolean> {
    this.readyPresentation.push(visible);
    return true;
  }

  async presentDeadBallUi(ui: StageDeadBallUi): Promise<boolean> {
    this.deadBallUi.push(ui);
    return true;
  }

  async bowl(): Promise<{ releasePerfMs: number }>;
  async bowl(flight: BallFlight, context?: StageDeliveryContext): Promise<{ releasePerfMs: number }>;
  async bowl(flight?: BallFlight, context?: StageDeliveryContext): Promise<{ releasePerfMs: number }> {
    if (!flight) return super.bowl();
    this.bowls.push({ flight, context });
    const released = await super.bowl();
    const emitInput = () => {
      if (this.nativeSwing === 'pause') {
        this.sink?.onPauseRequest?.();
        return;
      }
      this.sink?.onSwingStart(released.releasePerfMs + 380, 'touch');
      this.sink?.onSwing(this.nativeSwing);
    };
    // Both schedules are legal: multiple native messages can be delivered before the promise continuation created
    // by the release message gets a turn.
    if (this.inputTiming === 'same-task') emitInput();
    else setTimeout(emitInput, 0);
    return released;
  }

  supplyResolution(resolution: UnityPracticeResolution): void {
    this.authorityOrder.push('resolution');
    this.resolutions.push(resolution);
  }

  stats() {
    return { ...super.stats(), sampleCount: 120, spikes: 1 };
  }

  async play(): Promise<void>;
  async play(result: DeliveryResult): Promise<void>;
  async play(result?: DeliveryResult): Promise<void> {
    if (result) {
      this.authorityOrder.push('play');
      this.played.push(result);
    }
    await super.play();
  }
}

class DeferredReadyNativeStage extends NativeInputStage {
  private resolveReady: ((shown: boolean) => void) | null = null;

  async presentReady(visible: boolean): Promise<boolean> {
    this.readyPresentation.push(visible);
    if (!visible) return true;
    return new Promise<boolean>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  readyPending(): boolean {
    return this.resolveReady !== null;
  }

  acknowledgeReady(shown = true): void {
    const resolve = this.resolveReady;
    this.resolveReady = null;
    resolve?.(shown);
  }
}

class LifecycleNativeStage extends NativeInputStage {
  visible = false;
  readonly pauses: Array<'player' | 'background' | 'interruption'> = [];
  readonly resumes: Array<'player' | 'foreground' | 'recreated'> = [];

  async bowl(): Promise<{ releasePerfMs: number }>;
  async bowl(flight: BallFlight, context?: StageDeliveryContext): Promise<{ releasePerfMs: number }>;
  async bowl(flight?: BallFlight, context?: StageDeliveryContext): Promise<{ releasePerfMs: number }> {
    this.visible = true;
    return flight ? super.bowl(flight, context) : super.bowl();
  }

  async pause(reason: 'player' | 'background' | 'interruption' = 'background'): Promise<boolean> {
    this.pauses.push(reason);
    this.visible = false;
    return true;
  }

  async resume(reason: 'player' | 'foreground' | 'recreated' = 'foreground'): Promise<boolean> {
    this.resumes.push(reason);
    if (reason !== 'foreground') this.visible = true;
    return true;
  }
}

class DeferredMountLanguageNativeStage extends NativeInputStage {
  readonly languages: Array<{ locale: string; readyHint: string }> = [];
  mountStarted = false;
  private finishMount: (() => void) | null = null;

  async mount(canvas: HTMLCanvasElement): Promise<void> {
    this.mountStarted = true;
    await new Promise<void>((resolve) => {
      this.finishMount = resolve;
    });
    await super.mount(canvas);
  }

  setLanguage(locale: string, readyHint: string): void {
    this.languages.push({ locale, readyHint });
  }

  releaseMount(): void {
    const finish = this.finishMount;
    this.finishMount = null;
    finish?.();
  }
}

/** Unity can present live Learn/Coach guides and demonstrations; only close-up is retained. */
class CoachUnsafeNativeStage extends NativeInputStage {
  readonly unsupported = { assistance: 0, demonstrate: 0, closeUp: 0, learnCue: 0 };
  readonly guides: Array<StageGuide | null> = [];

  setAssistance(...args: Parameters<PracticeStageLike['setAssistance']>): void {
    const [stage, guide = null] = args;
    this.guides.push(guide);
    super.setAssistance(stage);
  }

  async demonstrate(
    _result?: Parameters<PracticeStageLike['demonstrate']>[0],
    _option?: Parameters<PracticeStageLike['demonstrate']>[1],
    _context?: Parameters<PracticeStageLike['demonstrate']>[2],
  ): Promise<void> {
    this.unsupported.demonstrate++;
    await super.demonstrate();
  }

  async closeUp(
    _flight?: Parameters<PracticeStageLike['closeUp']>[0],
    _options?: Parameters<PracticeStageLike['closeUp']>[1],
  ): Promise<void> {
    this.unsupported.closeUp++;
    throw new Error('native Coach close-up is unavailable');
  }

  setLearnCue(on = false): void {
    void on;
    super.setLearnCue();
  }
}

class RetainedCoachStage extends FakeStage {
  readonly guides: Array<StageGuide | null> = [];

  setAssistance(...args: Parameters<PracticeStageLike['setAssistance']>): void {
    const [stage, guide = null] = args;
    this.guides.push(guide);
    super.setAssistance(stage);
  }
}

const qualifiedNativeAssessment = () => ({
  ...assessment('full'),
  backend: 'unity' as const,
  webgl2: false,
});

/** Native-flow tests that are not explicitly about first-run teaching begin at the live delivery boundary. */
function nativeStore(): ReturnType<typeof memoryStore> {
  const store = memoryStore();
  updatePracticeSettings({ teach: false, demoSeen: true }, store);
  return store;
}

describe('native Practice-stage integration', () => {
  it('shows the acknowledged native scene during teaching before it starts exactly one delivery', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: true }, store);
    const stage = new NativeInputStage(store, attack(0.62, 5));
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'ready');

    expect(stage.readyPresentation).toEqual([true]);
    expect(stage.bowls).toHaveLength(0);
    expect(stage.calls().indexOf('setScene')).toBeGreaterThanOrEqual(0);

    await until(() => flow.getState().phase === 'dead');
    expect(stage.bowls).toHaveLength(1);
    expect(stage.scenes.at(-1)).toMatchObject({
      fieldIntent: expect.any(String),
      trainingObjective: 'random',
    });
    flow.dispose();
  });

  it('does not resurrect ready or bowl after leaving while the native ready acknowledgement is pending', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: true }, store);
    const stage = new DeferredReadyNativeStage(store, attack(0.62, 5));
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => stage.readyPending());

    flow.leave();
    expect(flow.getState()).toMatchObject({ screen: 'idle', phase: 'idle' });
    stage.acknowledgeReady(true);
    await until(() => stage.readyPresentation.length === 2);

    expect(stage.readyPresentation).toEqual([true, false]);
    expect(stage.bowls).toHaveLength(0);
    expect(flow.getState()).toMatchObject({ screen: 'idle', phase: 'idle' });
    flow.dispose();
  });

  it('replays a language change onto a native stage whose mount was already pending', async () => {
    const store = memoryStore();
    const stage = new DeferredMountLanguageNativeStage(store, attack(0.62, 5));
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });
    const words = { runup: (n: number) => `ball ${n}`, outcome: () => 'outcome' };

    flow.init();
    flow.setLanguage('en', 'old ready cue', words);
    flow.prepareOver({ kind: 'random' });
    await until(() => stage.mountStarted);
    flow.setLanguage('hi', 'new ready cue', words);
    stage.releaseMount();
    await until(() => flow.getState().stageReady);

    expect(stage.languages.at(-1)).toEqual({ locale: 'hi', readyHint: 'new ready cue' });
    flow.dispose();
  });

  it('preserves an explicit pause while a later native ready acknowledgement is pending', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: true }, store);
    const stage = new DeferredReadyNativeStage(store, attack(0.62, 5));
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => stage.readyPending());
    stage.acknowledgeReady(true);
    await until(() => flow.getState().phase === 'dead');
    expect(stage.bowls).toHaveLength(1);

    flow.nextBall();
    await until(() => stage.readyPending());
    stage.sink?.onPauseRequest?.();
    expect(flow.getState().phase).toBe('paused');
    stage.acknowledgeReady(true);
    await until(() => stage.readyPresentation.at(-1) === false);

    expect(stage.bowls).toHaveLength(1);
    expect(flow.getState().phase).toBe('paused');

    flow.resume();
    await until(() => stage.readyPending());
    stage.acknowledgeReady(true);
    await until(() => flow.getState().phase === 'dead');
    expect(stage.bowls).toHaveLength(2);
    flow.dispose();
  });

  it('never reuses a cached assessment across native and WebGL renderers', () => {
    const web = { ...assessment('full'), backend: 'webgl2' as const };
    const unity = { ...assessment('full'), backend: 'unity' as const, webgl2: false };

    expect(assessmentForRenderer(web, 'unity')).toBeNull();
    expect(assessmentForRenderer(unity, 'webgl2')).toBeNull();
    expect(assessmentForRenderer(unity, 'unity')).toBe(unity);
    expect(nativeAssessmentEligible(unity)).toBe(true);
    expect(assessmentForRenderer({ ...unity, inputToFrameMs: null }, 'unity')).toBeNull();
    expect(nativeAssessmentEligible({ ...unity, tier: 'below' })).toBe(false);
    expect(assessmentForRenderer(web, 'webgl2')).toBe(web);
    // Old cache entries without a backend were produced only by the established WebGL path.
    expect(assessmentForRenderer(assessment('full'), 'webgl2')).not.toBeNull();
  });

  it('routes native low-memory admission straight to Classic without Unity, Three or fabricated evidence', async () => {
    const store = nativeStore();
    const classic = new FakeStage('2d', store);
    const createStage = vi.fn<StageFactory>(async ({ force2d }) =>
      force2d ? classic : { kind: 'route', target: 'classic', reason: 'low_memory_device' },
    );
    const benchmark = vi.fn(async () => qualifiedNativeAssessment());
    const { flow } = setup({ store, deps: { createStage, benchmark } });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);

    expect(createStage).toHaveBeenCalledTimes(2);
    expect(createStage.mock.calls[0]?.[0]).toMatchObject({ force2d: false, skipUnity: false });
    expect(createStage.mock.calls[1]?.[0]).toMatchObject({ force2d: true, skipUnity: true });
    expect(benchmark).not.toHaveBeenCalled();
    expect(flow.getState()).toMatchObject({
      assessment: null,
      quality: { stage: '2d', profile: 'lite', tier: 'full', toleranceMs: 0 },
      notice: 'classic',
    });
    expect(document.documentElement.getAttribute('data-vande-practice-renderer')).toBe('classic');

    updatePracticeSettings({ quality: 'high' }, store);
    flow.refreshSettings();
    expect(flow.getState().quality).toMatchObject({ stage: '2d', profile: 'lite' });
    expect(createStage).toHaveBeenCalledTimes(2);

    flow.dispose();
    expect(document.documentElement.hasAttribute('data-vande-practice-renderer')).toBe(false);
  });

  it('binds native input and sends one already-normalized swing through the authoritative result handoff', async () => {
    const store = nativeStore();
    const nativeSwing = attack(0.67, -24);
    const stage = new NativeInputStage(store, nativeSwing);
    const createStage: StageFactory = async () => stage;
    const { flow, engine } = setup({
      store,
      deps: {
        createStage,
        benchmark: async () => qualifiedNativeAssessment(),
        deliveryContext: () => ({ pressure: 0.72, milestone: null, wicketEndsInnings: true, runs: 0 }),
      },
    });
    const normalize = vi.spyOn(engine, 'normalizeGesture');
    const resolve = vi.spyOn(engine, 'resolveDelivery');

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);

    expect(flow.stageOwnsInput()).toBe(true);
    expect(stage.sink).not.toBeNull();

    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    expect(normalize).not.toHaveBeenCalled();

    expect(stage.bowls).toHaveLength(1);
    const [{ flight, context }] = stage.bowls;
    const authoritativeCalls = resolve.mock.calls.filter(([args]) => args.flight.seed === flight.seed);
    expect(authoritativeCalls).toHaveLength(1);
    expect(authoritativeCalls[0][0].swing).toEqual(nativeSwing);
    expect(context).toEqual({
      pressure: 0.72,
      milestone: null,
      wicketEndsInnings: true,
      runs: 0,
      overIndex: 0,
      ballIndex: 0,
      seed: flight.seed,
    });

    expect(stage.resolutions).toHaveLength(1);
    expect(stage.played).toHaveLength(1);
    expect(stage.authorityOrder).toEqual(['resolution', 'play']);
    const resolution = stage.resolutions[0];
    expect(resolution.result).toBe(stage.played[0]);
    expect(resolution.record).toMatchObject({
      overIndex: context?.overIndex,
      ballIndex: context?.ballIndex,
      seed: context?.seed,
      swing: nativeSwing,
      runs: resolution.result.outcome.runs,
      dismissal: resolution.result.outcome.dismissal,
    });
    expect(resolution.result.flight).toEqual(flight);
    expect(resolution.score).toEqual({ runs: 4, wickets: 0, balls: 1, maxOvers: 10 });
    expect(resolution.replayDigest).toBe(await unityPracticeReplayDigest(resolution.record, resolution.result));
    // The flow made the resolution once (makeUnityPracticeResolution): the identity check reuses that digest, and the
    // trace it holds is the one it digested (nothing between the commit and the end of the ball changed it).
    const digestCalls = vi.spyOn(globalThis.crypto.subtle, 'digest');
    expect(await hasValidUnityPracticeResolutionIdentity(resolution)).toBe(true);
    expect(digestCalls).not.toHaveBeenCalled();

    const guidance: StageDeadBallUi = {
      reason: 'Reading your shot…',
      recommendation: '',
      primaryAction: 'practice_ball',
      primaryLabel: 'Practice this ball',
      secondaryAction: 'next_ball',
      secondaryLabel: 'Next ball',
    };
    expect(isCoachSafeUnityStage(flow.host.stage)).toBe(true);
    await expect(flow.presentDeadBallUi(guidance)).resolves.toBe(true);
    expect(stage.deadBallUi).toEqual([guidance]);

    const practice = vi.spyOn(flow.coachLoop, 'practiceThisBall').mockImplementation(() => undefined);
    const next = vi.spyOn(flow, 'nextBall').mockImplementation(() => undefined);
    stage.sink?.onDeadBallAction?.('practice_ball');
    stage.sink?.onDeadBallAction?.('next_ball');
    expect(practice).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    stage.sink?.onPauseRequest?.();
    expect(flow.getState().phase).toBe('paused');
    stage.sink?.onDeadBallAction?.('practice_ball');
    stage.sink?.onDeadBallAction?.('next_ball');
    expect(practice).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    flow.dispose();
    expect(stage.sink).toBeNull();
  });

  it('ignores an unavailable native Practice action and still accepts one Next action', async () => {
    const store = nativeStore();
    const stage = new NativeInputStage(store, attack());
    const { flow } = setup({
      store,
      coach: false,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');
    const next = vi.spyOn(flow, 'nextBall').mockImplementation(() => undefined);

    stage.sink?.onDeadBallAction?.('practice_ball');
    expect(flow.getState().phase).toBe('dead');
    expect(next).not.toHaveBeenCalled();
    stage.sink?.onDeadBallAction?.('next_ball');
    stage.sink?.onDeadBallAction?.('next_ball');
    expect(next).toHaveBeenCalledTimes(1);
    flow.dispose();
  });

  it('does not lose a native gesture delivered in the same task as release', async () => {
    const store = nativeStore();
    const nativeSwing = attack(0.64, 18);
    const stage = new NativeInputStage(store, nativeSwing, 'same-task');
    const { flow, engine } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });
    const resolve = vi.spyOn(engine, 'resolveDelivery');

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    expect(resolve.mock.calls.at(-1)?.[0].swing).toEqual(nativeSwing);
    expect(flow.getState().last?.record.swing).toEqual(nativeSwing);
    expect(flow.getState().last?.interrupted).toBe(false);
    flow.dispose();
  });

  it('uses native delivery frame evidence and never samples the hidden WebView animation clock', async () => {
    const store = nativeStore();
    const start = vi.fn();
    const stop = vi.fn();
    const stage = new NativeInputStage(store, attack());
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
        frameSampler: () => ({ start, stop, running: false }),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(flow.sessionFps()).toHaveLength(1);
    expect(flow.sessionFps()[0]).toBeCloseTo(1000 / 16.7, 5);
    flow.dispose();
  });

  it('keeps innings play, replay and demonstration on the same Unity surface, routing only close-up', async () => {
    const store = nativeStore();
    const native = new CoachUnsafeNativeStage(store, attack());
    const retained: RetainedCoachStage[] = [];
    const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) => {
      if (!skipUnity) return native;
      const made = new RetainedCoachStage(force2d ? '2d' : '3d', store);
      retained.push(made);
      return made;
    });
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true
            ? qualifiedNativeAssessment()
            : assessment(candidate?.kind === '2d' ? 'below' : 'full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const liveCanvas = native.mountedCanvas;
    const liveCanvasKey = flow.getState().canvasKey;
    const coachCanvasKey = flow.getState().coachCanvasKey;
    void flow.play();
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');

    expect(native.bowls).toHaveLength(1);
    expect(native.played).toHaveLength(1);
    expect(flow.stageOwnsInput()).toBe(true);
    expect(createStage.mock.calls.some(([opts]) => opts.skipUnity)).toBe(false);

    flow.coachLoop.replayLast();
    await until(() => flow.getState().replay?.playing === false);
    expect(native.calls()).toContain('replay');
    expect(retained).toHaveLength(0);
    expect(createStage.mock.calls.some(([opts]) => opts.skipUnity)).toBe(false);
    flow.coachLoop.closeReplay();

    const demonstration = flow.coachLoop.demonstrateLast();
    await until(() => native.unsupported.demonstrate === 1);
    await until(() => flow.getState().phase === 'dead');
    await demonstration;
    expect(native.unsupported.demonstrate).toBe(1);
    expect(native.disposed).toBe(false);
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(retained).toHaveLength(0);
    expect(flow.getState().canvasKey).toBe(liveCanvasKey);
    expect(flow.getState().coachCanvasKey).toBe(coachCanvasKey);
    expect(createStage.mock.calls.some(([opts]) => opts.skipUnity === true)).toBe(false);

    const closeUp = flow.coachLoop.closeUpLast();
    await until(() => retained[0]?.calls().includes('closeUp') === true);
    await until(() => flow.stageOwnsInput() && retained[0].disposed);
    await closeUp;
    expect(native.unsupported.closeUp).toBe(0);
    expect(retained[0].calls()).toContain('closeUp');
    expect(retained[0].mountedCanvas).not.toBe(liveCanvas);
    expect(flow.getState().canvasKey).toBe(liveCanvasKey);
    expect(native.disposed).toBe(false);
    expect(flow.getState().phase).toBe('dead');
    flow.dispose();
  });

  it('uses the same Unity renderer for first-run teaching and the first live ball', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: false }, store);
    const native = new CoachUnsafeNativeStage(store, attack());
    const retained: RetainedCoachStage[] = [];
    const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) => {
      if (!skipUnity) return native;
      const made = new RetainedCoachStage(force2d ? '2d' : '3d', store);
      retained.push(made);
      return made;
    });
    const { flow } = setup({
      store,
      teach: true,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true
            ? qualifiedNativeAssessment()
            : assessment(candidate?.kind === '2d' ? 'below' : 'full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const liveCanvas = native.mountedCanvas;
    const liveCanvasKey = flow.getState().canvasKey;
    void flow.play();
    await until(() => native.unsupported.demonstrate === 1);
    await until(() => native.bowls.length === 1);
    await until(() => flow.getState().phase === 'dead');

    const retainedRequests = createStage.mock.calls
      .map(([options]) => options)
      .filter((options) => options.skipUnity === true);
    expect(retainedRequests).toHaveLength(0);
    expect(retained).toHaveLength(0);
    expect(native.unsupported.demonstrate).toBe(1);
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(flow.getState().canvasKey).toBe(liveCanvasKey);
    expect(native.disposed).toBe(false);
    expect(native.played).toHaveLength(1);
    expect(flow.stageOwnsInput()).toBe(true);
    flow.dispose();
  });

  it('lets one-tap teaching Skip cancel the same-surface Unity demonstration before the live ball', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: false }, store);
    class AbortableDemoNativeStage extends CoachUnsafeNativeStage {
      demoSignal: AbortSignal | null = null;
      demoCancelRequested = 0;
      demoCancelled = 0;
      finishDemoCancellation: (() => void) | null = null;

      override async demonstrate(
        _result?: Parameters<PracticeStageLike['demonstrate']>[0],
        _option?: Parameters<PracticeStageLike['demonstrate']>[1],
        context?: Parameters<PracticeStageLike['demonstrate']>[2],
      ): Promise<void> {
        this.unsupported.demonstrate++;
        this.demoSignal = context?.signal ?? null;
        await new Promise<void>((_resolve, reject) => {
          if (!context?.signal || context.signal.aborted) {
            const error = new Error('demonstration cancelled');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          context.signal.addEventListener(
            'abort',
            () => {
              this.demoCancelRequested++;
              this.finishDemoCancellation = () => {
                this.demoCancelled++;
                const error = new Error('demonstration cancelled');
                error.name = 'AbortError';
                reject(error);
              };
            },
            { once: true },
          );
        });
      }
    }
    const native = new AbortableDemoNativeStage(store, attack());
    const pause = vi.fn(async () => true);
    const resume = vi.fn(async () => true);
    const nativeWithLifecycle = Object.assign(native, { pause, resume });
    const createStage = vi.fn<StageFactory>(async ({ skipUnity }) => {
      if (skipUnity) throw new Error('demo must not request a retained renderer');
      return nativeWithLifecycle;
    });
    const { flow } = setup({
      store,
      teach: true,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true ? qualifiedNativeAssessment() : assessment('full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const liveCanvas = native.mountedCanvas;
    void flow.play();
    await until(() => flow.getState().phase === 'intro');
    await until(() => native.demoSignal !== null);

    flow.skipTeaching(true);
    await until(() => native.demoCancelRequested === 1);
    expect(native.bowls).toHaveLength(0);
    native.finishDemoCancellation?.();
    await until(() => native.bowls.length === 1);

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(native.disposed).toBe(false);
    expect(native.demoSignal?.aborted).toBe(true);
    expect(native.demoCancelled).toBe(1);
    expect(createStage.mock.calls.some(([options]) => options.skipUnity === true)).toBe(false);
    expect(flow.stageOwnsInput()).toBe(true);

    await until(() => flow.getState().phase === 'dead');

    expect(native.played).toHaveLength(1);
    expect(flow.getState().last?.record.swing).not.toBeNull();
    flow.dispose();
  });

  it('keeps the Unity canvas live while an asynchronous native teaching demonstration completes', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: false }, store);
    let finishDemo!: () => void;
    let demoStarted = false;
    class PendingDemoStage extends CoachUnsafeNativeStage {
      override async demonstrate(): Promise<void> {
        this.unsupported.demonstrate++;
        demoStarted = true;
        await new Promise<void>((resolve) => {
          finishDemo = resolve;
        });
      }
    }
    const native = new PendingDemoStage(store, attack());
    const pause = vi.fn(async () => true);
    const resume = vi.fn(async () => true);
    const nativeWithLifecycle = Object.assign(native, { pause, resume });
    const createStage = vi.fn<StageFactory>(async ({ skipUnity }) => {
      if (skipUnity) throw new Error('demo must not request a retained renderer');
      return nativeWithLifecycle;
    });
    const { flow } = setup({
      store,
      teach: true,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true ? qualifiedNativeAssessment() : assessment('below'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const liveCanvas = native.mountedCanvas;
    void flow.play();
    await until(() => demoStarted);

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(native.disposed).toBe(false);
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(native.bowls).toHaveLength(0);
    expect(createStage.mock.calls.some(([options]) => options.skipUnity === true)).toBe(false);
    expect(flow.stageOwnsInput()).toBe(true);

    finishDemo();
    await until(() => native.bowls.length === 1);
    await until(() => flow.getState().phase === 'dead');

    expect(native.played).toHaveLength(1);
    expect(flow.getState().last?.record.swing).not.toBeNull();
    flow.dispose();
  });

  it('never pauses, resumes or replaces Unity for an explicit Coach demonstration', async () => {
    const store = nativeStore();
    const native = new CoachUnsafeNativeStage(store, attack());
    const pause = vi.fn(async () => true);
    const resume = vi.fn(async () => true);
    const nativeWithLifecycle = Object.assign(native, { pause, resume });
    const retained = new RetainedCoachStage('3d', store);
    const createStage = vi.fn<StageFactory>(async ({ skipUnity }) => (skipUnity ? retained : nativeWithLifecycle));
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true ? qualifiedNativeAssessment() : assessment('full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const liveCanvas = native.mountedCanvas;
    const liveCanvasKey = flow.getState().canvasKey;
    void flow.play();
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');

    const demo = flow.coachLoop.demonstrateLast();
    await until(() => flow.getState().phase === 'demo');
    await until(() => flow.getState().phase === 'dead');
    await demo;

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(native.bowls).toHaveLength(1);
    expect(native.unsupported.demonstrate).toBe(1);
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(flow.getState().canvasKey).toBe(liveCanvasKey);
    expect(createStage.mock.calls.some(([options]) => options.skipUnity === true)).toBe(false);
    expect(retained.mountedCanvas).toBeNull();
    expect(native.disposed).toBe(false);
    expect(native.played).toHaveLength(1);
    expect(flow.getState().phase).toBe('dead');
    expect(flow.stageOwnsInput()).toBe(true);
    flow.dispose();
  });

  it('continues to the first live ball without replacing Unity when the optional intro demo fails', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: false }, store);
    class FailingDemoStage extends CoachUnsafeNativeStage {
      override async demonstrate(): Promise<void> {
        this.unsupported.demonstrate++;
        throw new Error('demo presentation failed');
      }
    }
    const native = new FailingDemoStage(store, attack());
    const createStage = vi.fn<StageFactory>(async ({ skipUnity }) => {
      if (skipUnity) throw new Error('demo failure must not mount a legacy renderer');
      return native;
    });
    const { flow } = setup({
      store,
      teach: true,
      deps: {
        createStage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const liveCanvas = native.mountedCanvas;
    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    expect(native.unsupported.demonstrate).toBe(1);
    expect(native.bowls).toHaveLength(1);
    expect(native.played).toHaveLength(1);
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(native.disposed).toBe(false);
    expect(createStage.mock.calls.some(([options]) => options.skipUnity === true)).toBe(false);
    expect(flow.getState().last?.record.swing).not.toBeNull();
    flow.dispose();
  });

  it('settles an explicit native demo failure back to the original dead ball without legacy fallback', async () => {
    const store = nativeStore();
    class FailingDemoStage extends CoachUnsafeNativeStage {
      override async demonstrate(): Promise<void> {
        this.unsupported.demonstrate++;
        throw new Error('demo presentation failed');
      }
    }
    const native = new FailingDemoStage(store, attack());
    const createStage = vi.fn<StageFactory>(async ({ skipUnity }) => {
      if (skipUnity) throw new Error('demo failure must not mount a legacy renderer');
      return native;
    });
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');
    const last = flow.getState().last;

    await flow.coachLoop.demonstrateLast();

    expect(native.unsupported.demonstrate).toBe(1);
    expect(native.disposed).toBe(false);
    expect(createStage.mock.calls.some(([options]) => options.skipUnity === true)).toBe(false);
    expect(flow.getState().phase).toBe('dead');
    expect(flow.getState().last).toBe(last);
    expect(flow.getState().innings?.balls).toBe(1);
    flow.dispose();
  });

  it('keeps the exact-ball guide and complete retry native without mounting a retained renderer', async () => {
    const store = nativeStore();
    const native = new CoachUnsafeNativeStage(store, attack());
    const retained = new RetainedCoachStage('3d', store);
    const classic = new RetainedCoachStage('2d', store);
    const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) =>
      force2d ? classic : skipUnity ? retained : native,
    );
    const { flow, swings } = setup({
      store,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true
            ? qualifiedNativeAssessment()
            : assessment(candidate?.kind === '2d' ? 'below' : 'full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');

    swings.push(attack(0.2));
    flow.coachLoop.practiceThisBall();
    await until(
      () =>
        flow.getState().screen === 'coach' &&
        flow.getState().phase === 'idle' &&
        flow.getState().coach?.latest !== null,
    );

    const liveCanvas = native.mountedCanvas;
    const liveCanvasKey = flow.getState().canvasKey;
    const coachDemo = flow.coachLoop.coachDemonstrate();
    await until(() => flow.getState().phase === 'demo');
    await until(() => flow.getState().phase === 'idle');
    await coachDemo;

    expect(native.unsupported).toEqual({ assistance: 0, demonstrate: 1, closeUp: 0, learnCue: 0 });
    expect(native.disposed).toBe(false);
    expect(native.mountedCanvas).toBe(liveCanvas);
    expect(flow.getState().canvasKey).toBe(liveCanvasKey);
    expect(flow.getState()).toMatchObject({ screen: 'coach', phase: 'idle' });
    expect(native.assistance).toContain(1);
    expect(native.guides.some((guide) => guide !== null)).toBe(true);
    expect(native.calls()).toEqual(expect.arrayContaining(['bowl', 'play']));
    expect(native.bowls).toHaveLength(2);
    expect(native.played).toHaveLength(2);
    expect(retained.calls()).toEqual([]);
    expect(classic.calls()).toEqual([]);
    expect(flow.stageOwnsInput()).toBe(true);

    flow.coachLoop.leaveCoach();
    expect(native.disposed).toBe(false);
    expect(flow.getState()).toMatchObject({ screen: 'live', phase: 'dead' });
    flow.dispose();
  });

  it('falls through a failed retained 3D Coach handoff to complete Classic instead of calling native Coach APIs', async () => {
    const store = nativeStore();
    const native = new CoachUnsafeNativeStage(store, attack());
    const retained = new RetainedCoachStage('3d', store, { failMount: true });
    const classic = new RetainedCoachStage('2d', store);
    const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) =>
      force2d ? classic : skipUnity ? retained : native,
    );
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true
            ? qualifiedNativeAssessment()
            : assessment(candidate?.kind === '2d' ? 'below' : 'full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    const closeUp = flow.coachLoop.closeUpLast();
    await until(() => classic.calls().includes('closeUp'));
    await until(() => flow.stageOwnsInput() && classic.disposed);
    await closeUp;

    expect(retained.disposed).toBe(true);
    expect(native.unsupported.closeUp).toBe(0);
    expect(native.disposed).toBe(false);
    expect(flow.getState()).toMatchObject({ phase: 'dead', stageReady: true });

    const creationsAfterCoach = createStage.mock.calls.length;
    flow.nextBall();
    await until(() => native.bowls.length === 2);
    await until(() => flow.getState().phase === 'dead');
    expect(createStage).toHaveBeenCalledTimes(creationsAfterCoach);
    expect(flow.stageOwnsInput()).toBe(true);
    expect(native.disposed).toBe(false);
    flow.dispose();
  });

  it('keeps a retained-candidate fallback local and reuses healthy Unity for the next ball', async () => {
    const store = nativeStore();
    const native = new CoachUnsafeNativeStage(store, attack());
    class FallbackDuringMountStage extends RetainedCoachStage {
      override async mount(canvas: HTMLCanvasElement): Promise<void> {
        await super.mount(canvas);
        this.emit('fallback', { reason: 'context_lost' });
      }
    }
    const retained = new FallbackDuringMountStage('3d', store);
    const classic = new RetainedCoachStage('2d', store);
    const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) =>
      force2d ? classic : skipUnity ? retained : native,
    );
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true
            ? qualifiedNativeAssessment()
            : assessment(candidate?.kind === '2d' ? 'below' : 'full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    const closeUp = flow.coachLoop.closeUpLast();
    await until(() => classic.calls().includes('closeUp'));
    await until(() => flow.stageOwnsInput() && classic.disposed);
    await closeUp;

    expect(retained.disposed).toBe(true);
    expect(classic.disposed).toBe(true);
    expect(native.disposed).toBe(false);
    expect(flow.getState()).toMatchObject({ phase: 'dead', stageReady: true });

    const creationsAfterCoach = createStage.mock.calls.length;
    flow.nextBall();
    await until(() => native.bowls.length === 2);
    await until(() => flow.getState().phase === 'dead');

    expect(createStage).toHaveBeenCalledTimes(creationsAfterCoach);
    expect(flow.stageOwnsInput()).toBe(true);
    expect(native.disposed).toBe(false);
    expect(native.played).toHaveLength(2);
    flow.dispose();
  });

  it('fails closed with a calm stage error when neither retained Coach renderer can mount', async () => {
    const store = nativeStore();
    const native = new CoachUnsafeNativeStage(store, attack());
    const retained = new RetainedCoachStage('3d', store, { failMount: true });
    const classic = new RetainedCoachStage('2d', store, { failMount: true });
    const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) =>
      force2d ? classic : skipUnity ? retained : native,
    );
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark: async (candidate) =>
          candidate?.ownsInput === true
            ? qualifiedNativeAssessment()
            : assessment(candidate?.kind === '2d' ? 'below' : 'full'),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'dead');

    await flow.coachLoop.closeUpLast();
    await until(() => flow.getState().screen === 'error');

    expect(native.unsupported.closeUp).toBe(0);
    expect(native.disposed).toBe(true);
    expect(retained.disposed).toBe(true);
    expect(classic.disposed).toBe(true);
    expect(flow.host.stage).toBeNull();
    expect(flow.getState()).toMatchObject({ phase: 'idle', stageReady: false, error: 'stage' });
    flow.dispose();
  });

  it('fails closed on a cache-miss native benchmark unless the marked engineering preview is explicit', async () => {
    const store = nativeStore();
    const native = new NativeInputStage(store, attack());
    const retained = new FakeStage('3d', store);
    const classic = new FakeStage('2d', store);
    const created: PracticeStageLike[] = [];
    const createStage: StageFactory = async ({ force2d, skipUnity }) => {
      const made = force2d ? classic : skipUnity ? retained : native;
      created.push(made);
      return made;
    };
    const benchmark = vi.fn(async (candidate: PracticeStageLike | null, opts: BenchmarkOptions = {}) => {
      if (candidate?.ownsInput === true) {
        expect(opts.allowProbeFallback).toBe(false);
        throw new Error('native benchmark unavailable');
      }
      if (candidate === retained) {
        expect(opts.allowProbeFallback).toBe(true);
        return assessment('full');
      }
      return assessment('below');
    });
    const { flow } = setup({
      store,
      deps: {
        createStage,
        benchmark,
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);

    expect(benchmark.mock.calls[0]).toEqual([
      expect.objectContaining({ ownsInput: true }),
      expect.objectContaining({ allowProbeFallback: false }),
    ]);
    if (unityPracticeEngineeringPreviewEnabled()) {
      expect(native.disposed).toBe(false);
      expect(flow.stageOwnsInput()).toBe(true);
      expect(flow.getState().assessment).toBeNull();
      expect(document.getElementById(UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID)?.dataset.reason).toBe(
        'benchmark_unavailable',
      );
    } else {
      expect(native.disposed).toBe(true);
      expect(flow.host.stage).not.toBe(native);
      expect(flow.stageOwnsInput()).toBe(false);
      // Unity-enabled builds recover to retained Three.js; ordinary test builds recover through the established
      // no-stage assessment and Classic path. Neither can retain or classify the failed native stage.
      expect(created).toContain(flow.host.stage);
      if (flow.host.stage === retained) expect(flow.getState().assessment?.tier).toBe('full');
      else {
        expect(flow.host.stage).toBe(classic);
        expect(flow.getState().assessment?.tier).toBe('below');
      }
    }
    flow.dispose();
  });

  it('keeps incomplete native qualification hidden except in the marked engineering preview', async () => {
    const store = nativeStore();
    const native = new NativeInputStage(store, attack());
    const retained = new FakeStage('3d', store);
    const createStage: StageFactory = async ({ skipUnity }) => (skipUnity ? retained : native);
    const benchmark = vi.fn(async (candidate: PracticeStageLike | null) =>
      candidate?.ownsInput === true
        ? { ...assessment('full'), backend: 'unity' as const, webgl2: false, inputToFrameMs: null }
        : { ...assessment('full'), backend: 'webgl2' as const },
    );
    const { flow } = setup({ store, deps: { createStage, benchmark } });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);

    if (unityPracticeEngineeringPreviewEnabled()) {
      expect(native.disposed).toBe(false);
      expect(flow.stageOwnsInput()).toBe(true);
      expect(flow.getState().assessment).toMatchObject({ backend: 'unity', tier: 'full', inputToFrameMs: null });
      expect(document.getElementById(UNITY_PRACTICE_ENGINEERING_PREVIEW_MARKER_ID)?.dataset.reason).toBe(
        'qualification_incomplete',
      );
    } else if (__UNITY_PRACTICE_ENABLED__) {
      expect(native.disposed).toBe(true);
      expect(flow.host.stage).toBe(retained);
      expect(flow.getState().assessment).toMatchObject({ backend: 'webgl2', tier: 'full' });
    } else {
      // A native stage can only be created in this branch by the test's injected factory; production web builds
      // never construct it. This keeps the generic StageHost tests independent of the compile-time Android flag.
      expect(native.disposed).toBe(false);
      expect(flow.stageOwnsInput()).toBe(true);
    }
    flow.dispose();
  });

  it('settles a native Quiet Mode pause request as an interrupted leave, then pauses at dead ball', async () => {
    const store = nativeStore();
    const stage = new LifecycleNativeStage(store, 'pause');
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'paused');

    expect(flow.getState().last).toMatchObject({ interrupted: true });
    expect(flow.getState().last?.record.swing).toBeNull();
    expect(flow.getState().innings?.inFlight).toBeNull();
    expect(flow.getState().innings?.balls).toBe(1);
    expect(stage.pauses).toEqual(['player']);
    expect(stage.visible).toBe(false);

    flow.resume();
    await until(() => flow.getState().phase === 'dead');
    expect(stage.resumes).toEqual(['player']);
    expect(stage.visible).toBe(true);
    flow.dispose();
  });

  it('lets a background hide supersede the deferred native Quiet Mode pause without double-pausing', async () => {
    const store = nativeStore();
    const stage = new LifecycleNativeStage(store, 'pause');
    const { flow } = setup({
      store,
      deps: {
        createStage: async () => stage,
        benchmark: async () => qualifiedNativeAssessment(),
      },
    });

    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'playing');
    flow.setHidden(true);
    await until(() => flow.getState().phase === 'paused');

    expect(stage.pauses).toEqual(['background']);
    expect(stage.visible).toBe(false);
    flow.dispose();
  });
});
