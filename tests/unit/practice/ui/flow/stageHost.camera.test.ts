/**
 * R-43 (STAGE-CAMERA): the camera never runs on the Unity stage. The Unity stage owns the batting input and hides React,
 * so the camera's consent, readiness and lost-tracking cards could not be seen and a camera swing could not arm. While
 * the control in force is Camera the stage host therefore builds a web renderer (Three.js or Classic) and never asks the
 * factory for Unity; a Unity stage already in use is swapped out once, between balls, by the same path a renderer
 * fallback takes. Unity stays touch-only. Nothing here touches a delivery: the same seed and swings give the same balls.
 *
 * The environment is a fake Unity-eligible one: the factory returns a Unity-like stage (it owns input and delivers its
 * own swing through the sink) for a plain request and a web stage for `skipUnity` or `force2d`, as ports.ts does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceAssessment, NormalizedSwing } from '@/contracts';
import { memoryStore, updatePracticeSettings, type KeyStore } from '@/practice/store';
import { cameraGate, type CameraGate } from '@/practice/ui/camera/gate';
import { setCameraForTests, type ControlsCameraPort } from '@/practice/ui/controls/cameraPort';
import { controlOptions, readControlEnv, type ControlId } from '@/practice/ui/controls/model';
import {
  currentControl,
  setControl,
  setControlGuard,
  startControls,
  subscribeControl,
} from '@/practice/ui/controls/state';
import type { PracticeFlow } from '@/practice/ui/flow/controller';
import type { PracticeStageLike, StageFactory, StageInputSink } from '@/practice/ui/flow/types';
import { isCoachSafeUnityStage } from '@/practice/unity/coachSafeStage';
import { assessment, FakeStage } from '../fakes';
import { attack, setup, until, useFakeTimers } from '../flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

const RENDERER_ATTRIBUTE = 'data-vande-practice-renderer';
const renderer = () => document.documentElement.getAttribute(RENDERER_ATTRIBUTE);

/** What the Unity benchmark returns: native evidence, never WebGL evidence. */
const unityAssessment = (tier: DeviceAssessment['tier'] = 'full'): DeviceAssessment => ({
  ...assessment(tier),
  backend: 'unity',
  webgl2: false,
});
/** What the web renderer's own device check returns. */
const webAssessment = (tier: DeviceAssessment['tier'] = 'full'): DeviceAssessment => ({
  ...assessment(tier),
  backend: 'webgl2',
});

/** A Unity-like stage: it owns the batting input and delivers its own, already normalized, swing through the sink. */
class UnityLikeStage extends FakeStage {
  readonly ownsInput = true;
  sink: StageInputSink | null = null;

  constructor(
    store: KeyStore,
    private readonly nativeSwing: NormalizedSwing,
  ) {
    super('3d', store);
  }

  setInputSink(sink: StageInputSink | null): void {
    this.sink = sink;
  }

  override async bowl(): Promise<{ releasePerfMs: number }> {
    const released = await super.bowl();
    setTimeout(() => {
      this.sink?.onSwingStart(released.releasePerfMs + 380, 'touch');
      this.sink?.onSwing(this.nativeSwing);
    }, 0);
    return released;
  }
}

interface RigOptions {
  /** The control in force when the visit starts. */
  control?: ControlId;
  /** The Unity benchmark's answer, and the web renderer's own. */
  unity?: DeviceAssessment;
  web?: DeviceAssessment;
  /** An assessment already in force when the visit starts (a Unity one cached by an earlier visit with a finger). */
  fixed?: DeviceAssessment;
  /** The web 3D stage cannot start (Classic must then carry the camera). */
  web3dFails?: boolean;
  /** Use another gate instead of the test's own. */
  gate?: CameraGate;
}

function rig(o: RigOptions = {}) {
  const store = memoryStore();
  updatePracticeSettings({ teach: false, demoSeen: true }, store);
  const swing = attack(0.6, 30);
  const swings: Array<NormalizedSwing | 'leave'> = [];
  const unity: UnityLikeStage[] = [];
  const web: FakeStage[] = [];
  const createStage = vi.fn<StageFactory>(async ({ force2d, skipUnity }) => {
    if (!force2d && !skipUnity) {
      const made = new UnityLikeStage(store, swing);
      unity.push(made);
      return made;
    }
    const made = new FakeStage(force2d ? '2d' : '3d', store, { failMount: !force2d && o.web3dFails });
    web.push(made);
    return made;
  });
  const benchmark = vi.fn(async (candidate: PracticeStageLike | null) =>
    candidate?.ownsInput === true ? (o.unity ?? unityAssessment()) : (o.web ?? webAssessment()),
  );
  let control: ControlId = o.control ?? 'touch';
  const listeners = new Set<() => void>();
  const gate: CameraGate = o.gate ?? {
    wanted: () => control === 'camera',
    ready: () => true,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
  const made = setup({
    store,
    deps: {
      createStage,
      benchmark,
      camera: gate,
      hooks: { takeSwing: () => swings.shift() ?? null, ...(o.fixed ? { assessment: o.fixed } : {}) },
    },
  });
  /** The control changes, as PracticeApp reacts to it: the flow re-reads its settings. */
  const choose = (next: ControlId): void => {
    control = next;
    for (const l of [...listeners]) l();
    made.flow.refreshSettings();
  };
  /** The notices the player was shown, in order, each change once. */
  const notices: Array<string | null> = [];
  made.flow.subscribe(() => {
    const n = made.flow.getState().notice;
    if (notices.at(-1) !== n && !(notices.length === 0 && n === null)) notices.push(n);
  });
  return { ...made, store, swing, swings, unity, web, createStage, benchmark, choose, notices };
}

/** The flow's first screens: the setup of a random over, with its stage prepared. */
async function openOver(flow: PracticeFlow): Promise<void> {
  flow.init();
  flow.prepareOver({ kind: 'random' });
  await until(() => flow.getState().stageReady);
}

/** Bowl until the n-th ball of the innings is dead (the first ball is Play; later ones are "Next ball"). */
async function ball(flow: PracticeFlow, n: number): Promise<void> {
  if (n === 1) {
    await openOver(flow);
    void flow.play();
  } else flow.nextBall();
  await until(() => (flow.getState().innings?.balls ?? 0) >= n && flow.getState().phase === 'dead');
}

const factoryCalls = (r: ReturnType<typeof rig>) => r.createStage.mock.calls.map(([opts]) => opts);
const unityRequests = (r: ReturnType<typeof rig>) => factoryCalls(r).filter((o) => !o.force2d && !o.skipUnity);

describe('R-43: Camera at creation', () => {
  it('builds a web stage and never asks the factory for Unity', async () => {
    const r = rig({ control: 'camera' });
    await openOver(r.flow);

    expect(unityRequests(r)).toHaveLength(0);
    expect(factoryCalls(r).every((o) => o.skipUnity === true)).toBe(true);
    expect(r.unity).toHaveLength(0);
    expect(r.web).toHaveLength(1);
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(r.flow.host.stage).toBe(r.web[0]);
    expect(renderer()).toBe('three-webgl');
    // The web renderer was measured on its own evidence (the Unity benchmark never ran).
    expect(r.benchmark).toHaveBeenCalledTimes(1);
    expect(r.benchmark.mock.calls[0]?.[0]).toBe(r.web[0]);
    // Nothing changed for the player: no notice about a renderer.
    expect(r.flow.getState().notice).toBeNull();
    r.flow.dispose();
  });

  it('drops a Unity measurement left by an earlier visit with a finger: it cannot profile the web renderer', async () => {
    const r = rig({ control: 'camera', fixed: unityAssessment('assisted'), web: webAssessment('full') });
    expect(r.flow.getState().assessment).toMatchObject({ backend: 'unity' });
    await openOver(r.flow);

    expect(r.benchmark).toHaveBeenCalledTimes(1);
    expect(r.flow.getState().assessment).toMatchObject({ backend: 'webgl2', tier: 'full' });
    expect(r.flow.getState().quality).toMatchObject({ stage: '3d', tier: 'full', toleranceMs: 0 });
    expect(r.unity).toHaveLength(0);
    r.flow.dispose();
  });

  it('with the 3D web stage unable to start, Classic carries the camera, never Unity', async () => {
    const r = rig({ control: 'camera', web3dFails: true, web: webAssessment('below') });
    await openOver(r.flow);

    expect(r.unity).toHaveLength(0);
    expect(unityRequests(r)).toHaveLength(0);
    expect(r.flow.host.stage?.kind).toBe('2d');
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(renderer()).toBe('classic');
    r.flow.dispose();
  });

  it('a finger keeps Unity exactly as before: one request, the Unity benchmark, no notice, no web stage', async () => {
    const r = rig({ control: 'touch' });
    await ball(r.flow, 1);
    await ball(r.flow, 2);

    expect(factoryCalls(r)).toEqual([expect.objectContaining({ force2d: false, skipUnity: false })]);
    expect(r.unity).toHaveLength(1);
    expect(r.web).toHaveLength(0);
    // The host hands out the Unity stage inside its Coach-safe facade, as it always did.
    expect(isCoachSafeUnityStage(r.flow.host.stage)).toBe(true);
    expect(r.flow.stageOwnsInput()).toBe(true);
    expect(renderer()).toBe('unity-native');
    expect(r.benchmark).toHaveBeenCalledTimes(1);
    expect(r.benchmark.mock.calls[0]?.[0]?.ownsInput).toBe(true);
    expect(r.unity[0].disposed).toBe(false);
    expect(r.notices).toEqual([]);
    r.flow.dispose();
  });
});

describe('R-43: switching to Camera while Unity is the stage', () => {
  it('swaps once, between balls, with one notice, and leaves the quality and the timing help as they were', async () => {
    const r = rig({ unity: unityAssessment('assisted') });
    await ball(r.flow, 1);
    expect(r.flow.stageOwnsInput()).toBe(true);
    const before = r.flow.getState().quality;
    expect(before).toEqual({ stage: '3d', profile: 'lite', tier: 'assisted', toleranceMs: 12 });

    r.choose('camera');
    // The choice alone changes nothing: the swap waits for the next ball to be asked for.
    expect(r.createStage).toHaveBeenCalledTimes(1);
    expect(r.unity[0].disposed).toBe(false);
    expect(r.flow.stageOwnsInput()).toBe(true);

    r.swings.push(r.swing);
    await ball(r.flow, 2);

    expect(r.unity[0].disposed).toBe(true);
    expect(r.unity[0].sink).toBeNull();
    expect(r.web).toHaveLength(1);
    expect(r.web[0].kind).toBe('3d');
    expect(factoryCalls(r)).toEqual([
      expect.objectContaining({ force2d: false, skipUnity: false }),
      expect.objectContaining({ force2d: false, skipUnity: true }),
    ]);
    expect(r.flow.host.stage).toBe(r.web[0]);
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(renderer()).toBe('three-webgl');
    expect(r.web[0].calls()).toContain('setScene');
    // Only the renderer changed: the device check was not run again, and the quality (profile, tier, timing help) is
    // exactly what it was, so the next over carries the same help and the session monitor works as it always does.
    expect(r.benchmark).toHaveBeenCalledTimes(1);
    expect(r.flow.getState().quality).toEqual(before);
    expect(r.flow.getState().innings!.current!.deliveries.map((d) => d.tierToleranceMs)).toEqual([12, 12]);

    r.swings.push(r.swing);
    await ball(r.flow, 3);
    // One swap, one notice: the next balls neither swap again nor repeat it.
    expect(r.createStage).toHaveBeenCalledTimes(2);
    expect(r.notices).toEqual(['camera_web', null]);
    expect(r.unity).toHaveLength(1);
    r.flow.dispose();
  });

  it('shows the notice at the dead ball of the first web ball', async () => {
    const r = rig();
    await ball(r.flow, 1);
    r.choose('camera');
    r.swings.push(r.swing);
    await ball(r.flow, 2);
    expect(r.flow.getState().notice).toBe('camera_web');
    r.flow.dispose();
  });

  it('swaps at Play when the choice was made on the setup screen, and keeps the notice to the first dead ball', async () => {
    const r = rig();
    await openOver(r.flow);
    // The Unity stage was prepared behind the setup screen; the player then picks Camera there.
    expect(r.flow.stageOwnsInput()).toBe(true);
    r.choose('camera');
    r.swings.push(r.swing);
    void r.flow.play();
    await until(() => r.flow.getState().phase === 'dead');

    expect(r.unity[0].disposed).toBe(true);
    expect(r.web).toHaveLength(1);
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(r.flow.getState().notice).toBe('camera_web');
    expect(r.notices.filter((n) => n !== null)).toEqual(['camera_web']);
    r.flow.dispose();
  });

  it('never swaps while a ball is under way, even if the choice reaches the host then', async () => {
    const r = rig();
    await openOver(r.flow);
    void r.flow.play();
    await until(() => ['runup', 'live', 'playing'].includes(r.flow.getState().phase));
    expect(r.flow.busy()).toBe(true);

    r.choose('camera');
    expect(r.createStage).toHaveBeenCalledTimes(1);
    expect(r.unity[0].disposed).toBe(false);
    expect(r.flow.stageOwnsInput()).toBe(true);

    await until(() => r.flow.getState().phase === 'dead');
    // The ball finished on the stage it began on; the swap is for the next one.
    expect(r.unity[0].disposed).toBe(false);
    expect(r.web).toHaveLength(0);
    expect(r.flow.getState().last?.record.swing).toEqual(r.swing);
    r.swings.push(r.swing);
    await ball(r.flow, 2);
    expect(r.unity[0].disposed).toBe(true);
    expect(r.web).toHaveLength(1);
    r.flow.dispose();
  });

  it('falls back to Classic, never to Unity again, when the web 3D stage cannot start at the swap', async () => {
    const r = rig({ web3dFails: true });
    await ball(r.flow, 1);
    r.choose('camera');
    r.swings.push(r.swing);
    await ball(r.flow, 2);

    expect(r.web.map((w) => w.kind)).toEqual(['3d', '2d']);
    expect(r.unity).toHaveLength(1);
    expect(r.flow.host.stage?.kind).toBe('2d');
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(renderer()).toBe('classic');
    r.flow.dispose();
  });
});

describe('R-43: switching away from Camera', () => {
  it('stays on the web renderer for the rest of the visit, with no swap back and no second notice', async () => {
    const r = rig();
    await ball(r.flow, 1);
    r.choose('camera');
    r.swings.push(r.swing);
    await ball(r.flow, 2);
    const web = r.flow.host.stage;

    r.choose('touch');
    r.swings.push(r.swing);
    await ball(r.flow, 3);

    expect(r.createStage).toHaveBeenCalledTimes(2);
    expect(r.unity).toHaveLength(1);
    expect(r.flow.host.stage).toBe(web);
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(r.notices.filter((n) => n !== null)).toEqual(['camera_web']);
    r.flow.dispose();
  });

  it('keeps asking for the web renderer when the stage is rebuilt later (a graphics change), never for Unity', async () => {
    const r = rig();
    await ball(r.flow, 1);
    r.choose('camera');
    r.swings.push(r.swing);
    await ball(r.flow, 2);
    r.choose('touch');

    // Classic by the player's choice, then 3D again: both rebuilds are web.
    updatePracticeSettings({ quality: 'classic' }, r.store);
    r.flow.refreshSettings();
    r.swings.push(r.swing);
    await ball(r.flow, 3);
    expect(r.flow.host.stage?.kind).toBe('2d');
    updatePracticeSettings({ quality: 'auto' }, r.store);
    r.flow.refreshSettings();
    r.swings.push(r.swing);
    await ball(r.flow, 4);

    expect(r.flow.host.stage?.kind).toBe('3d');
    expect(r.unity).toHaveLength(1);
    expect(unityRequests(r)).toHaveLength(1);
    expect(
      factoryCalls(r)
        .slice(1)
        .every((o) => o.skipUnity === true),
    ).toBe(true);
    expect(r.flow.stageOwnsInput()).toBe(false);
    r.flow.dispose();
  });

  it('"Choose again for this device" after a swap measures the web renderer on its own evidence, never Unity', async () => {
    const r = rig({ web: webAssessment('full') });
    await ball(r.flow, 1);
    r.choose('camera');
    r.swings.push(r.swing);
    await ball(r.flow, 2);
    r.choose('touch');
    expect(r.flow.getState().assessment).toMatchObject({ backend: 'unity' });

    r.flow.rerunDeviceCheck();
    r.flow.leave();
    r.flow.prepareOver({ kind: 'random' });
    await until(() => r.createStage.mock.calls.length === 3);
    await until(() => r.flow.getState().stageReady);

    expect(factoryCalls(r).at(-1)).toMatchObject({ skipUnity: true });
    expect(r.unity).toHaveLength(1);
    expect(r.benchmark).toHaveBeenCalledTimes(2);
    expect(r.benchmark.mock.calls[1]?.[0]).toBe(r.flow.host.stage);
    expect(r.flow.getState().assessment).toMatchObject({ backend: 'webgl2' });
    expect(r.flow.stageOwnsInput()).toBe(false);
    r.flow.dispose();
  });

  it('the next visit starts normally: a new host asks for Unity again when the control is not Camera', async () => {
    const first = rig();
    await ball(first.flow, 1);
    first.choose('camera');
    first.swings.push(first.swing);
    await ball(first.flow, 2);
    first.flow.dispose();

    const next = rig({ control: 'touch' });
    await openOver(next.flow);
    expect(factoryCalls(next)).toEqual([expect.objectContaining({ force2d: false, skipUnity: false })]);
    expect(next.flow.stageOwnsInput()).toBe(true);
    expect(renderer()).toBe('unity-native');
    next.flow.dispose();
  });
});

describe('R-43: the balls and the results do not change with the swap', () => {
  /** Four balls with the same seed and the same swing; optionally the control becomes Camera before ball `swapBefore`. */
  async function fourBalls(swapBefore: number | null) {
    const r = rig();
    const dead: Array<{ record: unknown; outcome: unknown; runs: number }> = [];
    for (let n = 1; n <= 4; n++) {
      if (swapBefore === n) r.choose('camera');
      if (swapBefore !== null && n >= swapBefore) r.swings.push(r.swing);
      await ball(r.flow, n);
      const last = r.flow.getState().last!;
      dead.push({ record: last.record, outcome: last.result.outcome, runs: r.flow.getState().board.runs });
    }
    const out = {
      dead,
      deliveries: r.flow.getState().innings!.current!.deliveries,
      stageOwnsInput: r.flow.stageOwnsInput(),
    };
    r.flow.dispose();
    return out;
  }

  it('gives the same seeds, swings, records, outcomes and tolerance with and without the swap', async () => {
    const without = await fourBalls(null);
    const swapped = await fourBalls(3);

    expect(without.stageOwnsInput).toBe(true);
    expect(swapped.stageOwnsInput).toBe(false);
    expect(without.deliveries).toHaveLength(4);
    expect(swapped.deliveries).toHaveLength(4);
    expect(swapped.deliveries).toEqual(without.deliveries);
    expect(swapped.dead).toEqual(without.dead);
    // Each swing the physics saw is the swing that was made, on either renderer.
    for (const d of swapped.deliveries) expect(d.swing).toEqual(attack(0.6, 30));
  });
});

describe('R-43: the real control guard (controls/state) with the stage host', () => {
  const fakePort = () => ({ Setup: () => null, stop: vi.fn<() => void>() }) satisfies ControlsCameraPort;
  const cameraApi = (on: boolean) =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: on ? { getUserMedia: vi.fn() } : undefined,
    });

  // What the test binds to the app's controls, undone even if it fails half way.
  const undo: Array<() => void> = [];
  beforeEach(() => {
    localStorage.clear();
    cameraApi(true);
    setCameraForTests({ info: { offered: true, packMb: 1 }, port: fakePort() });
  });
  afterEach(() => {
    for (const f of undo.splice(0).reverse()) f();
    setControlGuard(null);
    setCameraForTests(undefined);
    cameraApi(false);
    localStorage.clear();
  });

  it('refuses Camera while a ball is live, accepts it at the dead ball, and the stage swaps at the next ball', async () => {
    // The real gate (wanted and subscribe read the real control state); only "a person is in frame" is faked.
    const r = rig({ gate: { ...cameraGate, ready: () => true } });
    undo.push(startControls(() => !r.flow.busy()));
    undo.push(subscribeControl(() => r.flow.refreshSettings()));

    await openOver(r.flow);
    void r.flow.play();
    await until(() => ['runup', 'live', 'playing'].includes(r.flow.getState().phase));
    expect(r.flow.busy()).toBe(true);
    expect(setControl('camera')).toBe(false);
    expect(currentControl()).not.toBe('camera');
    expect(r.createStage).toHaveBeenCalledTimes(1);
    expect(r.flow.stageOwnsInput()).toBe(true);

    await until(() => r.flow.getState().phase === 'dead');
    expect(setControl('camera')).toBe(true);
    expect(currentControl()).toBe('camera');
    // Still the Unity stage at the dead ball: the swap is the next ball's.
    expect(r.flow.stageOwnsInput()).toBe(true);
    r.swings.push(r.swing);
    await ball(r.flow, 2);

    expect(r.unity[0].disposed).toBe(true);
    expect(r.web).toHaveLength(1);
    expect(r.flow.stageOwnsInput()).toBe(false);
    expect(renderer()).toBe('three-webgl');
    expect(r.flow.getState().notice).toBe('camera_web');

    r.flow.dispose();
  });
});

describe('R-43: the Controls row keeps offering Camera in a Unity-linked build', () => {
  it('the Android shell offers Touch (the default) and an available Camera', () => {
    const env = readControlEnv(true, {
      matchMedia: (q: string) => ({ matches: q.includes('coarse') }),
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: () => undefined } },
    });
    expect(env.native).toBe(true);
    expect(controlOptions(env, true).map((o) => [o.id, o.isDefault, o.available, o.blocked])).toEqual([
      ['touch', true, true, null],
      ['camera', false, true, null],
    ]);
  });

  it('nothing in the controls reads who owns the batting input, so the stage can never hide the choice', () => {
    const dir = join(process.cwd(), 'src/practice/ui/controls');
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/ownsInput|stageOwnsInput/i);
  });
});
