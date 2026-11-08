/**
 * DEVELOPMENT GALLERY ONLY (served by the Vite dev server at /src/render3d/dev/assets.html; never in the build).
 * Close-up and gameplay-distance views of the Practice stage's assets for art review and the asset register's
 * acceptance screenshots (constitution §32): the bat, the wickets, the pitch surfaces, the sight screens, the players'
 * faces and kits, the first-person gloves and the stadium in each environment.
 *   ?profile=lite|standard|high
 * window.__a.view(name, { light, sky, pitch, sight, led, excite, time, hit, hand }) renders one frame of a view.
 */
import '@fontsource-variable/manrope';
import { Vector3, type WebGLRenderer } from 'three';
import type { KitSpec } from '@/contracts';
import type { PitchCondition, QualityProfileId } from '@/contracts/practice';
import { KITS } from '@/ui/avatar/traits';
import type { ActorTrack, Look } from '../core/actors';
import { BATTER_EYE } from '../core/camera';
import type { BallScript } from '../core/choreo';
import type { ClipId } from '../core/clips';
import { PITCH_HALF } from '../core/ground';
import { PRACTICE_PROFILES } from '../core/quality';
import { FIRST_PERSON_READY } from '../practice/bat';
import { batToWorld } from '../practice/frame';
import type { PracticeEnvironment } from '../practice/types';
import { flight as physicsFlight } from '@/physics/delivery';
import { autoField } from '@/physics/field';
import { buildPracticeScript } from '../practice/script';
import { createFirstPerson } from '../three/firstPerson';
import { createBat, placeBatSpan } from '../three/props';
import type { Stadium } from '../three/stadium';
import { StageScene } from '../three/stageScene';

type Extra = Partial<{ setRenderer(r: WebGLRenderer): void; exposure(): number; shadowSources(): readonly Vector3[] }>;
type Led = Partial<{ setLed(on: boolean): void }>;

export interface ViewOptions {
  light?: PracticeEnvironment['light'];
  sky?: PracticeEnvironment['sky'];
  pitch?: PitchCondition | 'dry';
  sight?: 'dark' | 'white';
  led?: boolean;
  /** Crowd arousal 0..1. */
  excite?: number;
  /** Stadium clock, ms. */
  time?: number;
  /** For 'stumps-hit': ms after the hit; for 'scuff': ms after the bounce. */
  hit?: number;
  quiet?: boolean;
  focus?: { x: number; z: number } | null;
  /** Hides named stadium parts (debugging the art). */
  hide?: string[];
}

declare global {
  interface Window {
    __a?: { ready: boolean; errors: string[]; views: string[]; view(name: string, o?: ViewOptions): Promise<void>; stage?: StageScene; bench?(frames: number): number };
  }
}

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

const look = (seed: string, team: 0 | 1, gear: Look['gear']): Look => ({ seed, team, gear });
const still = (id: string, role: ActorTrack['role'], lk: Look, x: number, z: number, heading: number, clip: ClipId, clipStart = 0): ActorTrack => ({
  id,
  role,
  look: lk,
  start: { x, y: 0, z },
  heading,
  moves: [{ t0: 0, t1: 1e9, clip, clipStart, rate: 0 }],
});

/** The lineup: a batter, the keeper, a bowler, two fielders and an umpire, side by side on the outfield. */
function lineup(z: number, x0: number, gap: number, heading: number): ActorTrack[] {
  return [
    still('striker', 'batter', look('gallery-bat-1', 0, 'batter'), x0, z, heading, 'stance'),
    still('keeper', 'keeper', look('gallery-keep-3', 1, 'keeper'), x0 + gap, z, heading, 'idle'),
    still('bowler', 'bowler', look('gallery-bowl-7', 1, 'bowler'), x0 + gap * 2, z, heading, 'idle'),
    still('f1', 'fielder', look('gallery-field-2', 1, 'fielder'), x0 + gap * 3, z, heading, 'ready'),
    still('f2', 'fielder', look('gallery-field-9', 1, 'fielder'), x0 + gap * 4, z, heading, 'idle', 0.4),
    still('umpire', 'umpire', look('gallery-ump-4', 0, 'umpire'), x0 + gap * 5, z, heading, 'ump_stand'),
  ];
}

/** Everyone upright (idle), for faces and kits from the front. */
function uprightLineup(z: number, x0: number, gap: number, heading: number): ActorTrack[] {
  return lineup(z, x0, gap, heading).map((t) => ({ ...t, moves: [{ t0: 0, t1: 1e9, clip: t.id === 'umpire' ? 'ump_stand' : 'idle', clipStart: 0.2, rate: 0 }] }));
}

interface View {
  cam: { pos: [number, number, number]; target: [number, number, number]; fov: number };
  /** Frame this actor's head (after posing): distance in front of the face, height offset, side angle (deg). */
  faceOf?: { id: string; dist: number; yaw?: number };
  actors?: ActorTrack[];
  bat?: 'face' | 'back' | 'edge';
  firstPerson?: boolean;
  stumpsHit?: boolean;
  /** A real physics delivery's bounce (the Practice scuff), `hit` ms after it. */
  scuff?: boolean;
}

const LX = 5;
const LZ = 2;
const head = (i: number) => LX + i * 1.3;
const VIEWS: Record<string, View> = {
  'bat-face': { cam: { pos: [3, 0.5, 6.95], target: [3, 0.43, 6], fov: 34 }, bat: 'face' },
  'bat-back': { cam: { pos: [3, 0.5, 6.95], target: [3, 0.43, 6], fov: 34 }, bat: 'back' },
  'bat-edge': { cam: { pos: [3.55, 0.5, 6.75], target: [3, 0.43, 6], fov: 34 }, bat: 'edge' },
  'bat-grip': { cam: { pos: [3, 0.78, 6.35], target: [3, 0.72, 6], fov: 32 }, bat: 'face' },
  'bat-toe': { cam: { pos: [3.1, 0.22, 6.32], target: [3, 0.14, 6], fov: 34 }, bat: 'face' },
  stumps: { cam: { pos: [0.35, 0.62, PITCH_HALF - 1.25], target: [0, 0.5, PITCH_HALF], fov: 34 } },
  bails: { cam: { pos: [0.08, 0.78, PITCH_HALF - 0.32], target: [0, 0.715, PITCH_HALF], fov: 34 } },
  'stumps-hit': { cam: { pos: [1.6, 0.9, PITCH_HALF - 2.4], target: [0, 0.4, PITCH_HALF + 0.3], fov: 38 }, stumpsHit: true },
  'pitch-eye': { cam: { pos: [-BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z], target: [0.3, 0.9, -9], fov: 54 } },
  'pitch-near': { cam: { pos: [0.6, 1.25, PITCH_HALF - 3.2], target: [0, 0, PITCH_HALF - 0.9], fov: 46 } },
  'pitch-far': { cam: { pos: [0.4, 1.3, -PITCH_HALF + 4.6], target: [0, 0, -PITCH_HALF + 1.2], fov: 46 } },
  'pitch-rough': { cam: { pos: [1.4, 1.1, PITCH_HALF - 5.5], target: [0.55, 0, PITCH_HALF - 2.6], fov: 42 } },
  'pitch-top': { cam: { pos: [0, 31, 0.01], target: [0, 0, 0], fov: 42 } },
  'pitch-macro': { cam: { pos: [0.15, 0.55, PITCH_HALF - 2.1], target: [0.15, 0, PITCH_HALF - 1.2], fov: 40 } },
  screen: { cam: { pos: [-BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z], target: [0.25, 2.6, -70], fov: 54 } },
  gameplay: { cam: { pos: [-BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z], target: [0.4, 1.5, -9], fov: 54 }, firstPerson: true },
  gloves: { cam: { pos: [-BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z], target: [0.35, 1.2, 7.4], fov: 54 }, firstPerson: true },
  kits: { cam: { pos: [LX + 3.25, 1.15, LZ + 6.2], target: [LX + 3.25, 0.95, LZ], fov: 46 }, actors: lineup(LZ, LX, 1.3, 0) },
  'kits-back': { cam: { pos: [LX + 3.25, 1.15, LZ - 6.2], target: [LX + 3.25, 0.95, LZ], fov: 46 }, actors: lineup(LZ, LX, 1.3, 0) },
  'face-batter': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'striker', dist: 0.62 } },
  'face-batter-side': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 30 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'striker', dist: 0.7, yaw: 55 } },
  'face-keeper': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'keeper', dist: 0.62 } },
  'face-bowler': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'bowler', dist: 0.62 } },
  'face-bowler-34': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'bowler', dist: 0.66, yaw: 35 } },
  'face-fielder': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'f1', dist: 0.62 } },
  'face-fielder2': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'f2', dist: 0.62 } },
  'face-umpire': { cam: { pos: [0, 0, 0], target: [0, 0, 0], fov: 28 }, actors: uprightLineup(LZ, LX, 1.3, 0), faceOf: { id: 'umpire', dist: 0.62 } },
  'heads-6m': { cam: { pos: [LX + 3.25, 1.7, LZ + 4.5], target: [LX + 3.25, 1.55, LZ], fov: 30 }, actors: uprightLineup(LZ, LX, 1.3, 0) },
  'heads-20m': { cam: { pos: [LX + 3.25, 1.68, LZ + 19], target: [LX + 3.25, 1.5, LZ], fov: 54 }, actors: uprightLineup(LZ, LX, 1.3, 0) },
  'pads-gloves': { cam: { pos: [head(0) + 0.4, 0.75, LZ + 1.5], target: [head(0), 0.6, LZ], fov: 40 }, actors: lineup(LZ, LX, 1.3, 0) },
  'far-players': { cam: { pos: [-BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z], target: [0, 1.4, -10], fov: 54 }, actors: [
    still('bowler', 'bowler', look('gallery-bowl-7', 1, 'bowler'), 0.7, -PITCH_HALF + 0.6, Math.PI, 'idle'),
    still('umpire', 'umpire', look('gallery-ump-4', 0, 'umpire'), -0.55, -PITCH_HALF - 1.7, Math.PI, 'ump_stand'),
    still('nonStriker', 'batter', look('gallery-bat-5', 0, 'batter'), -1.15, -PITCH_HALF + 1.6, Math.PI, 'idle'),
  ] },
  scuff: { cam: { pos: [0.5, 0.7, 5.6], target: [0.12, 0, 4.0], fov: 36 }, scuff: true },
  'scuff-eye': { cam: { pos: [-BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z], target: [0.2, 0.4, 1], fov: 54 }, scuff: true },
  'stadium-wide': { cam: { pos: [48, 26, 40], target: [0, 4, -10], fov: 50 } },
  'stadium-pavilion': { cam: { pos: [0, 6, 30], target: [0, 10, -84], fov: 40 } },
  'stadium-scoreboard': { cam: { pos: [0, 6, -30], target: [0, 14, 84], fov: 40 } },
  'stadium-side': { cam: { pos: [-20, 3, 0], target: [70, 12, 0], fov: 55 } },
  crowd: { cam: { pos: [40, 4, 10], target: [72, 6, 22], fov: 40 } },
};

async function main() {
  const profileId = (q.get('profile') ?? 'high') as QualityProfileId;
  const profile = PRACTICE_PROFILES[profileId];
  const renderer = StageScene.createRenderer(canvas, { antialias: profile.preset.antialias, preserveDrawingBuffer: true });
  const stage = new StageScene(renderer, profile.preset, 'practice');
  const stadium = stage.stadium as Stadium & Extra;
  stadium.setRenderer?.(renderer);
  stage.applyPreset(profile.preset);
  const kits: [KitSpec, KitSpec] = [KITS[0], KITS[1]];
  stage.setConditions({ pitch: 'hard', weather: 'clear' }, kits);
  stage.eventFx.setPractice(true);
  const fp = createFirstPerson(stage.scene);
  fp.setKit(kits[0]);
  const bat = createBat();
  stage.scene.add(bat);
  const size = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    stage.setSize(w, h, Math.min(devicePixelRatio || 1, profile.maxDpr));
  };
  size();
  const emptyScript = { stumps: { striker: null, nonStriker: null }, events: [], ball: [], actors: [] } as unknown as BallScript;

  const view = async (name: string, o: ViewOptions = {}) => {
    const v = VIEWS[name];
    if (!v) throw new Error(`no view ${name}`);
    stadium.setEnvironment({ light: o.light ?? 'evening', sky: o.sky ?? 'clear' });
    if (stadium.exposure) renderer.toneMappingExposure = stadium.exposure();
    stadium.setPracticePitch(o.pitch ?? 'balanced');
    stadium.setSightScreens(o.sight ?? 'dark');
    stadium.setQuiet(Boolean(o.quiet));
    stadium.setCrowdFocus(o.focus ?? null, o.focus ? 1 : 0);
    (stage.stumpsFx as typeof stage.stumpsFx & Led).setLed?.(Boolean(o.led));
    // Parts hidden for this view only (debugging the art); parts hidden by an earlier view come back.
    stadium.group.traverse((obj) => {
      if (!obj.name) return;
      const hide = (o.hide ?? []).includes(obj.name);
      if (hide) {
        obj.visible = false;
        obj.userData.galleryHidden = true;
      } else if (obj.userData.galleryHidden) {
        obj.visible = true;
        obj.userData.galleryHidden = false;
      }
    });
    stadium.setTime(o.time ?? 0);
    stadium.setExcitement(o.excite ?? 0.3);
    // Players: posed through the stage's own pipeline (rigs, kits, the bat in the batter's hands, blob shadows).
    stage.blobs.begin();
    const used = new Set<string>();
    for (const track of v.actors ?? []) {
      stage.poseActor(track, 0, kits, null);
      used.add(track.id);
    }
    const sources = stadium.shadowSources?.() ?? null;
    void sources;
    stage.blobs.end();
    for (const id of ['striker', 'keeper', 'bowler', 'f1', 'f2', 'umpire', 'nonStriker']) {
      const rig = stage.rigOf(id);
      if (rig) rig.root.visible = used.has(id);
    }
    // The gallery bat, upright on its toe.
    bat.visible = Boolean(v.bat);
    if (v.bat) {
      const face = v.bat === 'face' ? { x: 0, y: 0, z: 1 } : v.bat === 'back' ? { x: 0, y: 0, z: -1 } : { x: 1, y: 0, z: 0 };
      placeBatSpan(bat, { x: 3, y: 0.872, z: 6 }, { x: 3, y: 0.012, z: 6 }, face);
    }
    fp.update(v.firstPerson ? batToWorld(FIRST_PERSON_READY, false) : null, { top: { x: 0, y: 1.4, z: 8.8 }, bottom: { x: 0, y: 1.3, z: 9.1 } });
    // Wickets: at rest, or broken `hit` ms after a fast ball struck middle stump.
    const hit = v.stumpsHit ? { ...emptyScript, stumps: { striker: { t: 0, dir: { x: 0.08, y: 0, z: 1 }, strength: 1 }, nonStriker: null }, events: [{ t: 0, kind: 'stumps', intensity: 1, at: { x: 0.01, y: 0.35, z: PITCH_HALF } }] } : null;
    stage.stumpsFx.update((hit as unknown as BallScript) ?? emptyScript, o.hit ?? 0);
    if (v.scuff) {
      const bowler = { family: 'pace' as const, paceBand: 'fast' as const, arm: 'right' as const, lookSeed: 'gallery' };
      const plan = { variation: 'stock' as const, lengthM: 6, lineM: 0.12, speedKph: 136 };
      const fl = physicsFlight({ plan, bowler, conditions: 'balanced', seed: 'gallery-scuff', handedness: 'right' });
      const script = buildPracticeScript({ setup: { field: autoField(bowler, 'balanced', 'right'), bowler, conditions: 'balanced', handedness: 'right' }, flight: fl });
      const bounce = script.events.find((e) => e.kind === 'bounce');
      stage.eventFx.update(script, (bounce?.t ?? 0) + (o.hit ?? 400), stage.camera.position, 1, false);
    } else stage.eventFx.update(emptyScript, 0, stage.camera.position, 1, false);
    const cam = stage.camera;
    cam.position.set(...v.cam.pos);
    cam.lookAt(new Vector3(...v.cam.target));
    if (v.faceOf) {
      const rig = stage.rigOf(v.faceOf.id);
      if (rig) {
        rig.root.updateMatrixWorld(true);
        const headP = new Vector3().setFromMatrixPosition(rig.boneMap.head.matrixWorld).add(new Vector3(0, 0.1 * rig.scale, 0));
        const yaw = ((v.faceOf.yaw ?? 0) * Math.PI) / 180 + rig.root.rotation.y;
        cam.position.set(headP.x + Math.sin(yaw) * v.faceOf.dist, headP.y + 0.02, headP.z + Math.cos(yaw) * v.faceOf.dist);
        cam.lookAt(headP);
      }
    }
    cam.fov = v.cam.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    for (const id of used) {
      const rig = stage.rigOf(id)!;
      rig.lod.update(cam);
      rig.skeleton.update();
    }
    const glows = stadium.group.userData.glows as Array<{ quaternion: { copy(q: unknown): void } }> | undefined;
    if (glows) for (const g of glows) g.quaternion.copy(cam.quaternion);
    stage.render();
    hud.textContent = `${name} ${profileId} ${o.light ?? 'evening'}/${o.sky ?? 'clear'} ${o.pitch ?? 'balanced'} calls ${stage.drawCalls()}`;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  };
  stage.prewarm();
  /** Renders the current view `frames` times and returns the mean ms per frame; a 1-pixel read after each frame waits for it. */
  const bench = (frames: number) => {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    stage.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      stage.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / frames;
  };
  window.__a = { ready: true, errors, views: Object.keys(VIEWS), view, stage, bench };
}

main().catch((e) => {
  errors.push(String(e?.stack ?? e));
  hud.textContent = String(e);
});
