import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, Scene, ShaderMaterial, Texture, Vector3 } from 'three';
import { sampleBall } from '@/render3d/core/choreo';
import { evaluateActor } from '@/render3d/core/actors';
import { createPose, type SampledPose } from '@/render3d/core/clips';
import { BALL_R } from '@/render3d/core/ground';
import { cameraAt, practicePlan } from '@/render3d/core/camera';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { ballDiameterPx, closeUpBallDiameterPx, PRACTICE_BALL, projectBallSurface, releaseSurfaceTangent, rotatedBallSurface } from '@/render3d/practice/ballLook';
import { buildEmotion, emotionAt } from '@/render3d/practice/emotion';
import { simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import { createBall } from '@/render3d/three/ball';
import { COACH_CLOSEUP_HOLDER, COACH_GHOST, ThreePracticeStage, measureReleaseBall, practiceBallStyle, presentationOccluders } from '@/render3d/three/ThreePracticeStage';
import { setRigShadowPolicy } from '@/render3d/three/players';
import { StageScene } from '@/render3d/three/stageScene';
import type { StageClock, StageFrame } from '@/render3d/practice/session';
import { KITS } from '@/ui/avatar/traits';
import { caseScript, deliveryCases, horizontalFov, VIEWPORTS } from './readabilityHarness';
import { fixtureFlight, fixtureResult } from './practiceFixtures';

function actualBallEnvelope(fx: ReturnType<typeof createBall>, camera: PerspectiveCamera, viewport: { w: number; h: number }) {
  fx.group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const ball = fx.group.getObjectByName('cricket-ball') as Group;
  const sphere = ball.getObjectByName('ball-polished-half') as Mesh;
  const surround = fx.group.getObjectByName('practice-ball-surround') as Mesh;
  const radius = (sphere.geometry as unknown as { parameters: { radius: number } }).parameters.radius;
  const scale = sphere.getWorldScale(new Vector3());
  const worldRadius = radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  const centre = ball.getWorldPosition(new Vector3()).applyMatrix4(camera.matrixWorldInverse);
  const d = -centre.z;
  if (!(d > worldRadius && d * d > worldRadius * worldRadius)) throw new Error('close-up sphere intersects the camera');
  const projection = camera.projectionMatrix.elements;
  const tangent = (c: number) => {
    const root = Math.sqrt(c * c + d * d - worldRadius * worldRadius);
    const denominator = d * d - worldRadius * worldRadius;
    return [(c * d - worldRadius * root) / denominator, (c * d + worldRadius * root) / denominator] as const;
  };
  const [sx0, sx1] = tangent(centre.x);
  const [sy0, sy1] = tangent(centre.y);
  const bounds = {
    left: ((projection[0] * sx0 - projection[8] + 1) / 2) * viewport.w,
    right: ((projection[0] * sx1 - projection[8] + 1) / 2) * viewport.w,
    top: ((1 - (projection[5] * sy1 - projection[9])) / 2) * viewport.h,
    bottom: ((1 - (projection[5] * sy0 - projection[9])) / 2) * viewport.h,
  };
  const position = surround.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const point = new Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(surround.matrixWorld).project(camera);
    const x = ((point.x + 1) / 2) * viewport.w;
    const y = ((1 - point.y) / 2) * viewport.h;
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  return { centre, worldRadius, bounds };
}

describe('integrated Practice ball readability', () => {
  it('applies the inspection holder only after the real draw and restores every stage presentation path', () => {
    const { script, flight } = caseScript(deliveryCases().find((item) => item.name === 'pace good right')!);
    const source = JSON.stringify(script);
    const viewport = { w: 915, h: 412 };
    const fx = createBall(new Texture());
    fx.setStyle(practiceBallStyle(PRACTICE_PROFILES.standard));
    const ball = fx.group.getObjectByName('cricket-ball') as Group;
    const polished = ball.getObjectByName('ball-polished-half') as Mesh;
    const ballMaterial = polished.material;
    const camera = new PerspectiveCamera(30, viewport.w / viewport.h, 0.1, 1200);
    const stage = Object.create(StageScene.prototype) as StageScene;
    const renderedMaterials: Array<{ bowler: unknown; striker: unknown }> = [];
    Object.assign(stage, {
      scene: new Scene(), camera, ballFx: fx,
      stumpsFx: { update: vi.fn() }, eventFx: { update: vi.fn() },
      blobs: { begin: vi.fn(), end: vi.fn(), add: vi.fn() },
      stadium: { group: new Group(), setTime: vi.fn(), setExcitement: vi.fn(), setCrowdMood: vi.fn(), setBoardFlash: vi.fn() },
      preset: PRACTICE_PROFILES.standard.preset, cssHeight: viewport.h,
      rigs: new Map(), bats: new Map(), mirrored: new Map(),
      pose: createPose(), poseB: createPose(), lower: createPose(), towers: [],
      applyPreset: vi.fn(),
      render: vi.fn(() => {
        renderedMaterials.push({
          bowler: stage.rigOf('bowler')?.meshes[0].material,
          striker: stage.rigOf('striker')?.meshes[0].material,
        });
      }),
      dispose: vi.fn(),
    });
    const pendingTimers: unknown[] = [];
    const clock: StageClock = {
      now: () => 0,
      raf: () => 1,
      caf: vi.fn(),
      setTimer: (fn) => (pendingTimers.push(fn), fn),
      clearTimer: (id) => {
        const at = pendingTimers.indexOf(id);
        if (at >= 0) pendingTimers.splice(at, 1);
      },
    };
    const practice = new ThreePracticeStage(clock);
    const fp = { group: new Group(), update: vi.fn(), dispose: vi.fn() };
    const overlays = { landing: vi.fn(), edgeFlash: vi.fn(), setDiagnostics: vi.fn(), update: vi.fn(), dispose: vi.fn() };
    Object.assign(practice, {
      stage, fp, overlays, size: viewport, kits: [KITS[0], KITS[1]], contextLost: false,
      shownDiagnostics: null, closeUpGhostHolder: null, sink: null, resize: vi.fn(),
    });
    const drawFrame = (frame: StageFrame) => Reflect.apply(
      (ThreePracticeStage.prototype as unknown as { drawFrame(frame: StageFrame): void }).drawFrame,
      practice,
      [frame],
    );
    const heldScene = script.practice!.releaseScene - 260;
    const closePlan = [{ shot: 'ball_close' as const, atMs: 0, durationMs: script.duration }];
    const base: Omit<StageFrame, 'mode' | 'plan' | 'coachOption' | 'closeUpFlight'> = {
      script, scene: heldScene, clockMs: 0, slow: true, diagnostics: null, bands: null,
    };
    const closeUp: StageFrame = { ...base, mode: 'closeup', plan: closePlan, coachOption: null, closeUpFlight: flight };
    const ordinary: StageFrame = { ...base, mode: 'live', plan: closePlan, coachOption: null, closeUpFlight: null };
    const demonstration: StageFrame = { ...base, mode: 'demo', plan: closePlan, coachOption: {} as StageFrame['coachOption'], closeUpFlight: null };
    const strikerHeldScript = {
      ...script,
      ball: script.ball.map((segment) => segment.k === 'hand' ? { ...segment, actor: 'striker' } : segment),
    };
    const strikerCloseUp: StageFrame = { ...closeUp, script: strikerHeldScript };

    drawFrame(closeUp);
    const bowler = stage.rigOf('bowler');
    const striker = stage.rigOf('striker');
    if (!bowler || !striker) throw new Error('real Practice rigs were not created');
    const posedHand = stage.handOf('bowler');
    expect(posedHand).not.toBeNull();
    expect(ball.position.distanceTo(posedHand!), 'inspection leaves the physical ball on the current real hand').toBeLessThan(1e-9);
    expect(bowler.root.visible).toBe(true);
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.ghostMaterial && mesh.renderOrder === 6 && !mesh.castShadow)).toBe(true);
    expect(bowler.ghostMaterial.opacity).toBe(COACH_CLOSEUP_HOLDER.opacity);
    expect(polished.material).toBe(ballMaterial);
    expect(renderedMaterials.at(-1)?.bowler).toBe(bowler.ghostMaterial);
    expect(renderedMaterials.at(-1)?.striker).toBe(striker.material);

    // An arbitrary reverse seek keeps the same source and treatment; a profile shadow-policy update while translucent
    // is retained when the next ordinary (live/dead) frame actively restores the solid rig.
    drawFrame({ ...closeUp, scene: heldScene - 120 });
    setRigShadowPolicy(bowler, false);
    drawFrame(ordinary);
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.material && mesh.renderOrder === 0 && !mesh.castShadow)).toBe(true);
    expect(striker.meshes.every((mesh) => mesh.material === striker.material && mesh.renderOrder === 0)).toBe(true);
    expect(renderedMaterials.at(-1)?.bowler).toBe(bowler.material);

    // A synthetic holder id exercises the generic transition itself (without changing the preserved source script):
    // the old striker inspection treatment is restored before the real striker demonstration is applied.
    drawFrame(strikerCloseUp);
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.material && mesh.renderOrder === 0 && !mesh.castShadow)).toBe(true);
    expect(striker.meshes.every((mesh) => mesh.material === striker.ghostMaterial && mesh.renderOrder === 6 && !mesh.castShadow)).toBe(true);
    expect(striker.ghostMaterial.opacity).toBe(COACH_CLOSEUP_HOLDER.opacity);
    drawFrame(demonstration);
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.material && mesh.renderOrder === 0 && !mesh.castShadow)).toBe(true);
    expect(striker.meshes.every((mesh) => mesh.material === striker.ghostMaterial && mesh.renderOrder === 6 && !mesh.castShadow)).toBe(true);
    expect(striker.ghostMaterial.opacity).toBe(COACH_GHOST.opacity);
    drawFrame(ordinary);
    expect(striker.meshes.every((mesh) => mesh.material === striker.material && mesh.renderOrder === 0)).toBe(true);

    // Context loss and disposal use the same active restoration path; neither can leave a teaching material behind.
    drawFrame(closeUp);
    const preventDefault = vi.fn();
    (practice as unknown as { onLost(event: Event): void }).onLost({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.material && mesh.renderOrder === 0 && !mesh.castShadow)).toBe(true);
    (practice as unknown as { onRestored(): void }).onRestored();
    expect(pendingTimers).toHaveLength(0);
    drawFrame(closeUp);
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.ghostMaterial && mesh.renderOrder === 6 && !mesh.castShadow)).toBe(true);
    expect(JSON.stringify(script)).toBe(source);
    practice.dispose();
    expect(bowler.meshes.every((mesh) => mesh.material === bowler.material && mesh.renderOrder === 0 && !mesh.castShadow)).toBe(true);
    expect(fp.dispose).toHaveBeenCalledOnce();
    expect(overlays.dispose).toHaveBeenCalledOnce();
    expect(stage.dispose).toHaveBeenCalledOnce();
    expect(pendingTimers).toHaveLength(0);
    fx.dispose();
  });

  it('reanchors the real StageScene ball-close camera to its current held ball across arms and viewports', () => {
    const cases = [
      deliveryCases().find((item) => item.name === 'pace good right')!,
      deliveryCases().find((item) => item.name === 'spin stock left')!,
    ];
    for (const item of cases) {
      for (const vp of VIEWPORTS) {
        const fx = createBall(new Texture());
        fx.setStyle(practiceBallStyle(PRACTICE_PROFILES.standard));
        const camera = new PerspectiveCamera(30, vp.w / vp.h, 0.1, 1200);
        const stage = Object.create(StageScene.prototype) as StageScene;
        Object.assign(stage, {
          scene: new Scene(),
          camera,
          ballFx: fx,
          stumpsFx: { update: vi.fn() },
          eventFx: { update: vi.fn() },
          blobs: { begin: vi.fn(), end: vi.fn(), add: vi.fn() },
          stadium: { group: new Group(), setTime: vi.fn(), setExcitement: vi.fn(), setCrowdMood: vi.fn(), setBoardFlash: vi.fn() },
          preset: PRACTICE_PROFILES.standard.preset,
          cssHeight: vp.h,
          rigs: new Map(),
          bats: new Map(),
          mirrored: new Map(),
          pose: createPose(),
          poseB: createPose(),
          lower: createPose(),
          towers: [],
        });

        // The same calibration path ThreePracticeStage uses: measure the uncued release ball on the real rig, then
        // build the script around it. The rendered frames below use the production release cue and current pose.
        // The ball in the palm (players.ts ballInHand: hand + BALL_IN_HAND), measured exactly as ThreePracticeStage's
        // releaseHand measures it and StageScene.handOf draws it held (lead ruling 2026-11-04: the palm point,
        // MOTION-BOWL and Unity parity; never a root rise).
        const measured = measureReleaseBall(stage, item.bowler, [KITS[0], KITS[1]]);
        if (!measured) throw new Error('release measurement rig unavailable');
        const base = caseScript(item);
        const script = buildPracticeScript({ setup: base.setup, flight: base.flight, releaseHand: { x: measured.x, y: measured.y, z: measured.z } });
        const p = script.practice!;
        const source = JSON.stringify(script);
        const plan = [{ shot: 'ball_close' as const, atMs: 0, durationMs: script.duration }];
        const holder = script.ball.find((segment) => segment.k === 'hand')?.actor;
        expect(holder).toBe('bowler');
        // The stage's own pose hooks (the release cue, the ball held in the palm through it, the arm's reach), not a copy.
        const hookSelf = { hookCache: new WeakMap(), reducedMotion: false, cueHook: (ThreePracticeStage.prototype as unknown as { cueHook: unknown }).cueHook };
        const cueHook = (ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): ((track: { id: string }, pose: SampledPose, scene: number) => void) | undefined }).poseHooks.call(hookSelf, script, p);
        const hidden = new Set(script.actors.filter((actor) => actor.id !== holder).map((actor) => actor.id));
        const draw = (scene: number) => {
          const cam = cameraAt(script, scene, plan, { aspect: vp.w / vp.h, reducedMotion: false });
          stage.drawScript(script, scene, cam, {
            kits: [KITS[0], KITS[1]],
            slow: true,
            clockMs: 0,
            reducedMotion: false,
            hidden,
            poseHook: cueHook,
            ballCloseUp: true,
          });
          const ball = fx.group.getObjectByName('cricket-ball') as Group;
          const hand = stage.handOf(holder!);
          const envelope = actualBallEnvelope(fx, camera, vp);
          if (scene < p.releaseScene) {
            expect(hand).not.toBeNull();
            expect(ball.position.distanceTo(hand!), `${item.bowler.arm} ${vp.name} current real hand`).toBeLessThan(1e-9);
          }
          expect(envelope.bounds.left, `${item.bowler.arm} ${vp.name} actual sphere/surround left`).toBeGreaterThanOrEqual(-1e-6);
          expect(envelope.bounds.right, `${item.bowler.arm} ${vp.name} actual sphere/surround right`).toBeLessThanOrEqual(vp.w + 1e-6);
          expect(envelope.bounds.top, `${item.bowler.arm} ${vp.name} actual sphere/surround top`).toBeGreaterThanOrEqual(-1e-6);
          expect(envelope.bounds.bottom, `${item.bowler.arm} ${vp.name} actual sphere/surround bottom`).toBeLessThanOrEqual(vp.h + 1e-6);
          return { ball: ball.position.clone(), camera: camera.position.clone(), quaternion: camera.quaternion.clone() };
        };

        const heldScene = p.releaseScene - 260;
        draw(heldScene);
        draw(p.releaseScene - 0.001);
        draw(p.releaseScene + 0.001);
        expect(JSON.stringify(script)).toBe(source);

        const holderTrack = script.actors.find((actor) => actor.id === holder)!;
        const holderRoot = evaluateActor(holderTrack, heldScene).pos;
        const nominalCamera = cameraAt(script, heldScene, plan, { aspect: 1366 / 768, reducedMotion: false });
        const nearHolder = { ...nominalCamera, pos: { x: holderRoot.x, y: 1.5, z: holderRoot.z + 0.55 }, target: { x: holderRoot.x, y: 1.5, z: holderRoot.z } };
        expect(presentationOccluders(script, heldScene, nearHolder, false)).toContain(holder);
        expect(presentationOccluders(script, heldScene, nearHolder, true)).not.toContain(holder);
        fx.dispose();
      }
    }
  });

  it('keeps the real posed hand, physical ball and close-up camera continuous through release', () => {
    const cases = [
      deliveryCases().find((item) => item.name === 'pace good right')!,
      deliveryCases().find((item) => item.name === 'spin stock left')!,
    ];
    for (const item of cases) {
      for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
        const fx = createBall(new Texture());
        fx.setStyle(practiceBallStyle(PRACTICE_PROFILES.standard));
        const camera = new PerspectiveCamera(30, vp.w / vp.h, 0.1, 1200);
        const stage = Object.create(StageScene.prototype) as StageScene;
        Object.assign(stage, {
          scene: new Scene(), camera, ballFx: fx,
          stumpsFx: { update: vi.fn() }, eventFx: { update: vi.fn() },
          blobs: { begin: vi.fn(), end: vi.fn(), add: vi.fn() },
          stadium: { group: new Group(), setTime: vi.fn(), setExcitement: vi.fn(), setCrowdMood: vi.fn(), setBoardFlash: vi.fn() },
          preset: PRACTICE_PROFILES.standard.preset, cssHeight: vp.h,
          rigs: new Map(), bats: new Map(), mirrored: new Map(),
          pose: createPose(), poseB: createPose(), lower: createPose(), towers: [],
        });
        // The ball in the palm (players.ts ballInHand: hand + BALL_IN_HAND), measured exactly as ThreePracticeStage's
        // releaseHand measures it and StageScene.handOf draws it held (lead ruling 2026-11-04: the palm point,
        // MOTION-BOWL and Unity parity; never a root rise).
        const measured = measureReleaseBall(stage, item.bowler, [KITS[0], KITS[1]]);
        if (!measured) throw new Error('release measurement rig unavailable');
        const base = caseScript(item);
        const script = buildPracticeScript({ setup: base.setup, flight: base.flight, releaseHand: { x: measured.x, y: measured.y, z: measured.z } });
        const p = script.practice!;
        const source = JSON.stringify(script);
        const holder = script.ball.find((segment) => segment.k === 'hand')?.actor;
        if (!holder) throw new Error('practice holder unavailable');
        // The stage's own pose hooks (the release cue, the ball held in the palm through it, the arm's reach), not a copy.
        const hookSelf = { hookCache: new WeakMap(), reducedMotion: false, cueHook: (ThreePracticeStage.prototype as unknown as { cueHook: unknown }).cueHook };
        const cueHook = (ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): ((track: { id: string }, pose: SampledPose, scene: number) => void) | undefined }).poseHooks.call(hookSelf, script, p);
        const hidden = new Set(script.actors.filter((actor) => actor.id !== holder).map((actor) => actor.id));
        const draw = (scene: number) => {
          const cam = cameraAt(script, scene, [{ shot: 'ball_close' as const, atMs: 0, durationMs: script.duration }], { aspect: vp.w / vp.h, reducedMotion: false });
          stage.drawScript(script, scene, cam, { kits: [KITS[0], KITS[1]], slow: true, clockMs: 0, reducedMotion: false, hidden, poseHook: cueHook, ballCloseUp: true });
          const ball = fx.group.getObjectByName('cricket-ball') as Group;
          return { ball: ball.position.clone(), camera: camera.position.clone(), quaternion: camera.quaternion.clone(), hand: stage.handOf(holder)?.clone() ?? null };
        };
        const before = draw(p.releaseScene - 0.001);
        const after = draw(p.releaseScene + 0.001);
        expect(before.hand).not.toBeNull();
        expect(before.ball.distanceTo(before.hand!), `${item.bowler.arm} ${vp.name} pre-release ball remains in the real hand`).toBeLessThan(1e-9);
        const evidence = JSON.stringify({
          arm: item.bowler.arm, viewport: vp.name,
          preHand: before.hand!.toArray(), preBall: before.ball.toArray(), postBall: after.ball.toArray(),
          preCamera: before.camera.toArray(), postCamera: after.camera.toArray(), release: [p.releaseWorld.x, p.releaseWorld.y, p.releaseWorld.z],
        });
        expect.soft(before.ball.distanceTo(after.ball), `${evidence} physical release position`).toBeLessThan(0.01);
        expect.soft(before.camera.distanceTo(after.camera), `${evidence} close-up camera transition`).toBeLessThan(0.01);
        expect.soft(1 - Math.abs(before.quaternion.dot(after.quaternion)), `${evidence} close-up camera orientation`).toBeLessThan(1e-5);
        expect(JSON.stringify(script)).toBe(source);
        fx.dispose();
      }
    }
  });

  it('matches the installed Three shortest-arc release roll, including its near-antiparallel fallback', () => {
    const nearX = 1 - 5e-9;
    const poles = [
      new Vector3(1, 0, 0),
      new Vector3(nearX, Math.sqrt(1 - nearX * nearX), 0),
      new Vector3(-0.42, 0.63, -0.65345237).normalize(),
    ];
    for (const pole of poles) {
      const expected = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(-1, 0, 0), pole));
      const actual = releaseSurfaceTangent(pole);
      expect(new Vector3(actual.x, actual.y, actual.z).distanceTo(expected)).toBeLessThan(1e-12);
    }
  });

  it('draws the shared minimum diameter on every tier and supported viewport, without additive glow', () => {
    const { script } = caseScript(deliveryCases()[0]);
    const t = script.times.release + 1;
    for (const profile of Object.values(PRACTICE_PROFILES)) {
      const style = practiceBallStyle(profile);
      expect(style.glowOpacity).toBe(0);
      expect(profile.preset.trailPoints).toBe(PRACTICE_BALL.trace.samples);
      expect(profile.ball.trailAlpha).toBe(PRACTICE_BALL.trace.alpha);
      for (const vp of VIEWPORTS) {
        const fx = createBall(new Texture());
        fx.setStyle(style);
        const pose = cameraAt(script, t, practicePlan(script, false), { aspect: vp.w / vp.h, reducedMotion: false });
        expect(horizontalFov(pose.fov, vp.w / vp.h)).toBeLessThanOrEqual(75 + 1e-6);
        const camera = new PerspectiveCamera(pose.fov, vp.w / vp.h, 0.1, 1200);
        camera.position.copy(pose.pos as Vector3);
        camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
        camera.updateMatrixWorld();
        fx.update(script, t, () => null, false, profile.preset.trailPoints, camera.position, { camera, height: vp.h });
        const ball = fx.group.getObjectByName('cricket-ball') as Group;
        const depth = -ball.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
        const focal = vp.h / (2 * Math.tan(pose.fov * Math.PI / 360));
        const diameter = 2 * BALL_R * ball.scale.x * focal / depth;
        expect(diameter).toBeCloseTo(ballDiameterPx(depth, focal), 6);
        expect(diameter).toBeGreaterThanOrEqual(PRACTICE_BALL.minDiameterPx - 1e-6);
        const shade = fx.group.getObjectByName('practice-ball-surround') as Mesh;
        expect(shade.visible).toBe(true);
        const material = shade.material as ShaderMaterial;
        const version = material.version;
        fx.setStyle({ ...style, focusAid: true });
        fx.update(script, t, () => null, false, profile.preset.trailPoints, camera.position, { camera, height: vp.h });
        expect(material.uniforms.focus.value).toBe(1);
        expect(material.version).toBe(version);
        fx.dispose();
      }
    }
  });

  it('keeps distinct polished/rough hemispheres, raised seam and scuffs on the one physics-rotated ball', () => {
    const { script } = caseScript(deliveryCases()[0]);
    const fx = createBall(new Texture());
    const ball = fx.group.getObjectByName('cricket-ball') as Group;
    const polished = ball.getObjectByName('ball-polished-half') as Mesh;
    const rough = ball.getObjectByName('ball-rough-half') as Mesh;
    const seam = ball.getObjectByName('ball-raised-seam') as Mesh;
    const scuffs = ball.children.filter((child) => child.name.startsWith('ball-scuff-')) as Mesh[];
    expect(polished.parent).toBe(ball);
    expect(rough.parent).toBe(ball);
    expect(seam.parent).toBe(ball);
    expect(scuffs).toHaveLength(3);
    expect(scuffs.every((scuff) => scuff.parent === ball)).toBe(true);
    const polishedMaterial = polished.material as MeshStandardMaterial;
    const roughMaterial = rough.material as MeshStandardMaterial;
    expect(polishedMaterial.roughness).toBeLessThan(roughMaterial.roughness);
    expect(polishedMaterial.color.getHex()).not.toBe(roughMaterial.color.getHex());
    fx.setColour('red');
    expect(polishedMaterial.color.getHex()).not.toBe(roughMaterial.color.getHex());

    const pose = cameraAt(script, script.times.release, practicePlan(script, false), { aspect: 915 / 412, reducedMotion: false });
    const camera = new PerspectiveCamera(pose.fov, 915 / 412, 0.1, 1200);
    camera.position.copy(pose.pos as Vector3);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    const releaseSegment = script.ball.find((segment) => segment.k === 'path');
    expect(releaseSegment?.k).toBe('path');
    if (!releaseSegment || releaseSegment.k !== 'path' || !releaseSegment.shineAxis || !releaseSegment.surfaceTangent) throw new Error('missing complete release surface');
    fx.update(script, script.times.release, () => null, false, 6, camera.position, { camera, height: 412 });
    const polishedWorld = new Vector3(-1, 0, 0).applyQuaternion(ball.quaternion);
    expect(polishedWorld.distanceTo(new Vector3(releaseSegment.shineAxis.x, releaseSegment.shineAxis.y, releaseSegment.shineAxis.z))).toBeLessThan(1e-6);
    const tangentWorld = new Vector3(0, 1, 0).applyQuaternion(ball.quaternion);
    expect(tangentWorld.distanceTo(new Vector3(releaseSegment.surfaceTangent.x, releaseSegment.surfaceTangent.y, releaseSegment.surfaceTangent.z))).toBeLessThan(1e-6);
    const q0 = new Quaternion();
    fx.update(script, script.times.release + 1, () => null, false, 6, camera.position, { camera, height: 412 });
    q0.copy(ball.quaternion);
    fx.update(script, script.times.release + 45, () => null, false, 6, camera.position, { camera, height: 412 });
    expect(1 - Math.abs(q0.dot(ball.quaternion))).toBeGreaterThan(1e-8);
    fx.dispose();
  });

  it('makes the same physical ball large in training close-up and projects Classic seam/shine from spin and camera', () => {
    const { script } = caseScript(deliveryCases()[0]);
    const fx = createBall(new Texture());
    const ball = fx.group.getObjectByName('cricket-ball') as Group;
    const pose = cameraAt(script, script.times.release + 1, [{ shot: 'ball_close', atMs: 0, durationMs: script.duration }], { aspect: 915 / 412, reducedMotion: false });
    const camera = new PerspectiveCamera(pose.fov, 915 / 412, 0.1, 1200);
    camera.position.copy(pose.pos as Vector3);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    fx.setStyle(practiceBallStyle(PRACTICE_PROFILES.standard));
    fx.update(script, script.times.release + 1, () => null, true, 6, camera.position, { camera, height: 412, closeUp: true });
    const depth = -ball.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const focal = 412 / (2 * Math.tan(pose.fov * Math.PI / 360));
    const diameter = 2 * BALL_R * ball.scale.x * focal / depth;
    expect(diameter).toBeCloseTo(closeUpBallDiameterPx(412), 5);
    expect(diameter).toBeGreaterThan(90);
    const cameraBasis = { forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
    const front = projectBallSurface(0, { spinAxis: { x: 0, y: 0, z: 1 }, seamAxis: { x: 1, y: 0, z: 0 }, shineAxis: { x: 1, y: 0, z: 0 } }, cameraBasis);
    const roughSide = projectBallSurface(0, { spinAxis: { x: 0, y: 0, z: 1 }, seamAxis: { x: 1, y: 0, z: 0 }, shineAxis: { x: -1, y: 0, z: 0 } }, cameraBasis);
    const quarterTurn = projectBallSurface(Math.PI / 2, { spinAxis: { x: 0, y: 0, z: 1 }, seamAxis: { x: 1, y: 0, z: 0 }, shineAxis: { x: 1, y: 0, z: 0 } }, cameraBasis);
    expect(front.polishedAngle).toBeCloseTo(0, 9);
    expect(Math.abs(roughSide.polishedAngle)).toBeCloseTo(Math.PI, 9);
    expect(quarterTurn.polishedAngle).toBeCloseTo(-Math.PI / 2, 9);
    expect(front.seamMinor).toBeCloseTo(0, 9);
    const viewedAlongShine = projectBallSurface(0, { spinAxis: { x: 0, y: 0, z: 1 }, seamAxis: { x: 1, y: 0, z: 0 }, shineAxis: { x: 1, y: 0, z: 0 } }, { forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } });
    expect(viewedAlongShine.polishedFacing).toBe(-1);
    expect(viewedAlongShine.seamMinor).toBe(1);
    fx.dispose();
  });

  it('keeps scrambled seam, shine and physical spin as distinct source-derived axes', () => {
    const flight = fixtureFlight({ presentation: 'scrambled', seamDeg: 35, spinRps: 11 });
    const result = fixtureResult(flight, { kind: 'drive' });
    const { script } = caseScript(deliveryCases()[0], result);
    const segment = script.ball.find((item) => item.k === 'path');
    expect(segment?.k).toBe('path');
    if (!segment || segment.k !== 'path' || !segment.spinAxis || !segment.seamAxis || !segment.shineAxis) throw new Error('missing exact surface axes');
    const sameLine = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
    expect(sameLine(segment.seamAxis, segment.spinAxis)).toBeLessThan(0.999);
    expect(sameLine(segment.seamAxis, segment.shineAxis)).toBeCloseTo(1, 6);
    expect(segment.shineAxis).toEqual(flight.seam.shine);
  });

  it('carries the complete rigid cutter surface and physical marks continuously and seek-safely across the bounce', () => {
    for (const handedness of ['right', 'left'] as const) {
      const base = deliveryCases().find((item) => item.name === `pace good ${handedness}`)!;
      const delivery = { ...base, name: `cutter continuity ${handedness}`, plan: { variation: 'cutter' as const, lengthM: 6.2, lineM: 0.12, speedKph: 124 } };
      const { script, flight } = caseScript(delivery);
      expect(flight.seam.wobble).toBeGreaterThan(0);
      expect(flight.bounce).not.toBeNull();
      const bounce = simToScene(script.practice!, flight.bounce!.t);
      const before = sampleBall(script, bounce - 0.001);
      const after = sampleBall(script, bounce + 0.001);
      if (!before.spinAxis || !before.seamAxis || !before.shineAxis || !before.surfaceTangent || !after.spinAxis || !after.seamAxis || !after.shineAxis || !after.surfaceTangent) throw new Error('missing complete carried cutter surface');
      const a = rotatedBallSurface(before.spin, before as Required<Pick<typeof before, 'spinAxis' | 'seamAxis' | 'shineAxis' | 'surfaceTangent'>>);
      const b = rotatedBallSurface(after.spin, after as Required<Pick<typeof after, 'spinAxis' | 'seamAxis' | 'shineAxis' | 'surfaceTangent'>>);
      const dot = (u: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) => u.x * v.x + u.y * v.y + u.z * v.z;
      expect(dot(a.seamAxis, b.seamAxis), `${handedness} seam`).toBeGreaterThan(0.999999);
      expect(dot(a.shineAxis, b.shineAxis), `${handedness} shine`).toBeGreaterThan(0.999999);
      expect(dot(a.surfaceTangent, b.surfaceTangent), `${handedness} material tangent`).toBeGreaterThan(0.999999);

      const fx = createBall(new Texture());
      const ball = fx.group.getObjectByName('cricket-ball') as Group;
      const scuff = ball.getObjectByName('ball-scuff-1') as Mesh;
      const position = scuff.geometry.getAttribute('position');
      const physicalLocalPoint = new Vector3(position.getX(0), position.getY(0), position.getZ(0));
      const rendered = (sceneTime: number) => {
        fx.update(script, sceneTime, () => null, false, 6, new Vector3(0, 2, 20));
        fx.group.updateMatrixWorld(true);
        const centre = ball.localToWorld(new Vector3());
        const mark = scuff.localToWorld(physicalLocalPoint.clone()).sub(centre).normalize();
        return { quaternion: ball.quaternion.clone(), mark };
      };
      const renderedBefore = rendered(bounce - 0.001);
      const renderedAfter = rendered(bounce + 0.001);
      expect(Math.abs(renderedBefore.quaternion.dot(renderedAfter.quaternion)), `${handedness} renderer quaternion`).toBeGreaterThan(0.999999);
      expect(renderedBefore.mark.dot(renderedAfter.mark), `${handedness} physical scuff vertex`).toBeGreaterThan(0.999999);
      rendered(bounce - 0.001);
      const soughtAfter = rendered(bounce + 0.001);
      expect(Math.abs(renderedAfter.quaternion.dot(soughtAfter.quaternion)), `${handedness} seek quaternion`).toBeGreaterThan(1 - 1e-12);
      expect(renderedAfter.mark.distanceTo(soughtAfter.mark), `${handedness} seek scuff vertex`).toBeLessThan(1e-12);
      fx.dispose();

      const cameraBasis = { forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
      const classicBefore = projectBallSurface(before.spin, {
        spinAxis: before.spinAxis,
        seamAxis: before.seamAxis,
        shineAxis: before.shineAxis,
        surfaceTangent: before.surfaceTangent,
      }, cameraBasis);
      const classicAfter = projectBallSurface(after.spin, {
        spinAxis: after.spinAxis,
        seamAxis: after.seamAxis,
        shineAxis: after.shineAxis,
        surfaceTangent: after.surfaceTangent,
      }, cameraBasis);
      for (let mark = 0; mark < classicBefore.roughScuffs.length; mark++) {
        for (let point = 0; point < classicBefore.roughScuffs[mark].length; point++) {
          const p = classicBefore.roughScuffs[mark][point];
          const q = classicAfter.roughScuffs[mark][point];
          expect(q.visible, `${handedness} Classic scuff ${mark}:${point} visibility`).toBe(p.visible);
          expect(Math.hypot(q.x - p.x, q.y - p.y), `${handedness} Classic scuff ${mark}:${point}`).toBeLessThan(0.001);
        }
      }
      const second = script.ball.filter((item) => item.k === 'path')[1];
      expect(second?.spinOrigin).toBeCloseTo(bounce, 9);
    }
  });
});

describe('causal delivery emotion', () => {
  it('does not announce the result or interpolate celebration before a physical boundary', () => {
    const result = fixtureResult(fixtureFlight(), { kind: 'six', timingMs: 5 });
    const releaseScene = 2000;
    const plan = buildEmotion({ releaseScene, result, delivery: true, duration: 15000 });
    const boundary = result.events.find((event) => event.kind === 'boundary')!;
    expect(boundary).toBeDefined();
    const confirmed = releaseScene + boundary.t * 1000;
    const before = emotionAt(plan, confirmed - 1);
    expect(before.outcome).toBeNull();
    expect(before.valence).toBeLessThan(0.7);
    expect(emotionAt(plan, confirmed).outcome).toBe('six');
    expect(plan.moments.filter((moment) => moment.kind === 'six')).toHaveLength(1);
    expect(plan.moments.find((moment) => moment.kind === 'six')!.scene).toBe(confirmed);
    // A ball's eventual travel must not trigger a future-informed carry reaction immediately after contact.
    const carry = plan.moments.find((moment) => moment.kind === 'carry');
    if (carry) expect(carry.t).toBeGreaterThan(result.contact.t! + 0.3);
  });
});
