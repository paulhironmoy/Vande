/**
 * The Practice stage's equipment, ground and stadium art (src/render3d/three props, stadium, players, firstPerson):
 * what is drawn must be what collides (bat, stumps, bails, creases against src/physics), every pitch look must come
 * from the physics PITCHES table, the sight screens must sit behind the release and raise the ball's contrast, and
 * Delivery Quiet Mode must freeze decorative motion. jsdom has no WebGL and no 2D canvas: geometry, parameters and
 * uniforms are checked directly (the painters fall back to flat textures).
 */
import { describe, expect, it } from 'vitest';
import { Box3, Color, InstancedMesh, Matrix4, Mesh, Quaternion, Scene, ShaderMaterial, Vector3, type Texture } from 'three';
import {
  BAIL_RISE,
  BLADE_L,
  BLADE_T,
  BLADE_W,
  BOUNDARY_R,
  EDGE_T,
  HANDLE_L,
  PITCHES,
  PITCH_HALF,
  POPPING,
  POPPING_CREASE_HALF,
  RETURN_CREASE_LENGTH,
  RETURN_CREASE_X,
  STUMPS_W,
  STUMP_H,
  STUMP_R,
  STUMP_SPACING,
  SWEET_U,
} from '@/physics/constants';
import type { PitchCondition } from '@/contracts/practice';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import type { BallScript } from '@/render3d/core/choreo';
import {
  BAIL,
  BAIL_AXIS_Y,
  BAIL_TOP_Y,
  BAT_FACE_Z,
  BAT_SPINE_DEPTH,
  BAT_SWEET,
  BAT_TOE_Y,
  SCUFF_SIZE,
  STUMP_GROOVE,
  bailGeometry,
  batGeometry,
  batSection,
  blobLength,
  createBat,
  createEventFx,
  createStumps,
  flatTexture,
  stumpGeometry,
  wicketLayout,
} from '@/render3d/three/props';
import {
  CREASE_LINE_W,
  CROWD_HUSH,
  ENVIRONMENTS,
  SIGHT_SCREEN,
  SIGHT_TONES,
  createStadium,
  creaseMarkings,
  pitchLook,
  pitchParams,
} from '@/render3d/three/stadium';
import { createRig, dressRig, setRigGhost, setRigHeadgear, setRigExpression, setRigShadowPolicy } from '@/render3d/three/players';
import { FP_GLOVE, createFirstPerson } from '@/render3d/three/firstPerson';
import { GLOVE_R } from '@/physics/constants';
import { Group } from 'three';
import { KITS } from '@/ui/avatar/traits';
import { buildPracticeScript } from '@/render3d/practice/script';
import { setCoachDemonstrationGhost } from '@/render3d/three/ThreePracticeStage';
import { fixtureField, fixtureFlight, fixtureResult } from './practiceFixtures';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const box = (g: { computeBoundingBox(): void; boundingBox: Box3 | null }) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe('the bat is the physics bat', () => {
  it('has the physics length, width, edges and face plane, and its sweet spot where the physics has it', () => {
    const b = box(batGeometry());
    near(b.min.y, -(HANDLE_L + BLADE_L), 2e-4);
    near(BAT_TOE_Y, -(HANDLE_L + BLADE_L));
    near(b.max.y, 0, 1e-4);
    // Width: the blade at mid-length is BLADE_W across (edges bulge 0.6 mm at most).
    const mid = batSection(0.5);
    near(mid.hw * 2, BLADE_W, 1e-9);
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(BLADE_W + 0.0015);
    // The edges are EDGE_T thick where the blade is full, and the spine never exceeds the Law's 6.7 cm.
    for (const u of [0.3, 0.5, 0.7]) near(batSection(u).edge, EDGE_T, 1e-9);
    expect(BAT_SPINE_DEPTH).toBeLessThanOrEqual(0.067);
    for (let u = 0; u <= 1; u += 0.05) expect(batSection(u).depth).toBeLessThanOrEqual(BAT_SPINE_DEPTH + 1e-9);
    // The face is the physics collision face, BLADE_T / 2 in front of the bat's axis.
    near(BAT_FACE_Z, BLADE_T / 2);
    expect(b.max.z).toBeLessThanOrEqual(BLADE_T / 2 + 0.0007);
    expect(b.max.z).toBeGreaterThan(BLADE_T / 2 - 0.0002);
    // Sweet spot: SWEET_U of the blade from the toe, on the face.
    near(BAT_SWEET.y, -(HANDLE_L + BLADE_L) + SWEET_U * BLADE_L);
    near(BAT_SWEET.z, BLADE_T / 2);
  });

  it('is one mesh with one material, sharing its geometry (overlays reuse it for ghost bats)', () => {
    const a = createBat();
    const b = createBat();
    expect(a).toBeInstanceOf(Mesh);
    expect(Array.isArray(a.material)).toBe(false);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).not.toBe(b.material);
    expect(a.geometry.attributes.uv).toBeDefined();
    expect(a.geometry.attributes.normal).toBeDefined();
  });
});

describe('the wickets are Law 8 wickets', () => {
  it('stumps: height, radius, spacing and the 9-inch width', () => {
    const b = box(stumpGeometry());
    near(b.max.y, STUMP_H, 1e-6);
    near(b.min.y, 0, 1e-9);
    near(b.max.x, STUMP_R, 1e-6);
    const { stumps } = wicketLayout();
    expect(stumps).toEqual([-STUMP_SPACING, 0, STUMP_SPACING]);
    near(stumps[2] + STUMP_R - (stumps[0] - STUMP_R), STUMPS_W, 1e-9);
    // The groove across the top seats the spigots below the stump's crown.
    expect(STUMP_GROOVE.depth).toBeGreaterThan(0);
  });

  it('bails: two separate turned bails, 10.95 cm, seated in the grooves and rising less than BAIL_RISE', () => {
    // The Law's metric figures (5.40 + 3.50 + 2.06 cm) round to 10.96 against its 10.95 cm overall.
    near(BAIL.barrel + BAIL.longSpigot + BAIL.shortSpigot, BAIL.length, 1.5e-4);
    near(BAIL.length, 0.1095, 1e-9);
    const b = box(bailGeometry());
    near(b.max.x - b.min.x, BAIL.length, 1e-6);
    near((b.max.y - b.min.y) / 2, BAIL.barrelR, 3e-4);
    expect(BAIL_TOP_Y - STUMP_H).toBeLessThanOrEqual(BAIL_RISE);
    expect(BAIL_TOP_Y).toBeGreaterThan(STUMP_H);
    // Spigots rest on the groove floor.
    near(BAIL_AXIS_Y - BAIL.spigotR, STUMP_H - STUMP_GROOVE.depth, 5e-4);
    const { bails } = wicketLayout();
    expect(bails).toHaveLength(2);
    for (const bail of bails) {
      const lo = bail.x - BAIL.length / 2;
      const hi = bail.x + BAIL.length / 2;
      const inner = bail.dir > 0 ? lo : hi;
      const outer = bail.dir > 0 ? hi : lo;
      // The short spigot reaches the middle stump, the long one lies on the outer stump, the barrel spans the gap.
      expect(Math.abs(inner)).toBeLessThan(STUMP_R);
      expect(Math.abs(outer)).toBeGreaterThan(STUMP_SPACING - STUMP_R);
      expect(Math.abs(outer)).toBeLessThan(STUMP_SPACING + STUMP_R);
      const barrelInner = Math.abs(inner) + BAIL.shortSpigot;
      expect(barrelInner).toBeGreaterThan(STUMP_R);
      expect(barrelInner + BAIL.barrel).toBeLessThan(STUMP_SPACING - STUMP_R);
    }
  });

  it('stands both wickets at the creases, then flexes and releases the bails deterministically after a hit', () => {
    const fx = createStumps();
    const meshes = fx.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    const wood = meshes.find((m) => m.count === 6)!;
    const m = new Matrix4();
    const p = new Vector3();
    fx.update(null, 0);
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) {
      wood.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      xs.push(Math.round(p.x * 1e4) / 1e4);
      near(Math.abs(p.z), PITCH_HALF);
    }
    expect(xs.slice(0, 3)).toEqual([-STUMP_SPACING, 0, STUMP_SPACING].map((x) => Math.round(x * 1e4) / 1e4));
    const script = { stumps: { striker: { t: 1000, dir: { x: 0, y: 0, z: 1 }, strength: 1 }, nonStriker: null }, events: [{ t: 1000, kind: 'stumps', intensity: 1, at: { x: 0, y: 0.3, z: PITCH_HALF } }] } as unknown as BallScript;
    const snapshot = (t: number) => {
      fx.update(script, t);
      return meshes.map((mesh) => Array.from(mesh.instanceMatrix.array as Float32Array).map((v) => Math.round(v * 1e6))).join('|');
    };
    const before = snapshot(999);
    const at500 = snapshot(1500);
    const at2000 = snapshot(3000);
    expect(at500).not.toBe(before);
    expect(snapshot(1500)).toBe(at500);
    expect(snapshot(3000)).toBe(at2000);
    // The struck (middle) stump is knocked back; the bails have left the grooves.
    fx.update(script, 1500);
    wood.getMatrixAt(1, m);
    const q = new Quaternion().setFromRotationMatrix(m);
    expect(new Vector3(0, 1, 0).applyQuaternion(q).y).toBeLessThan(0.8);
    fx.setLed(true);
    expect(wood.visible).toBe(false);
    fx.dispose();
  });
});

describe('the creases are Law 7 creases', () => {
  const marks = creaseMarkings();
  it('marks every crease at both ends, with the Law edge on the Law line', () => {
    for (const end of [1, -1] as const) {
      const at = (kind: string) => marks.filter((m) => m.kind === kind && m.end === end);
      const [popping] = at('popping');
      const [bowling] = at('bowling');
      const returns = at('return');
      // Popping crease: its back edge (towards the stumps) is 4 ft in front of the bowling crease, 6 ft either side.
      near(end > 0 ? popping.z1 : popping.z0, end * (PITCH_HALF - POPPING));
      near(popping.z1 - popping.z0, CREASE_LINE_W);
      near(popping.x1, POPPING_CREASE_HALF);
      near(popping.x0, -POPPING_CREASE_HALF);
      // Bowling crease: its back edge is the line of the stumps, between the return creases.
      near(end > 0 ? bowling.z1 : bowling.z0, end * PITCH_HALF);
      near(bowling.x1, RETURN_CREASE_X);
      // Return creases: inside edges 4 ft 4 in either side of middle, from the popping crease to 8 ft behind it.
      expect(returns).toHaveLength(2);
      for (const r of returns) {
        near(Math.min(Math.abs(r.x0), Math.abs(r.x1)), RETURN_CREASE_X);
        near(r.x1 - r.x0, CREASE_LINE_W);
        near(r.z1 - r.z0, RETURN_CREASE_LENGTH);
        near(end > 0 ? r.z0 : r.z1, end * (PITCH_HALF - POPPING));
      }
    }
  });
});

/** WCAG relative luminance and contrast ratio of two sRGB colours. */
const luminance = (hex: string) => {
  const c = new Color(hex); // three converts to linear sRGB
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('sight screens', () => {
  const eye = (hand: 'right' | 'left') => new Vector3(hand === 'right' ? -0.2 : 0.2, 1.68, PITCH_HALF - 1.2);
  it('are real-size behind both ends and the release and early flight are seen against them', () => {
    expect(SIGHT_SCREEN.width).toBe(18);
    expect(SIGHT_SCREEN.height).toBe(7.5);
    near(SIGHT_SCREEN.distance, BOUNDARY_R + 6.5);
    for (const hand of ['right', 'left'] as const) {
      for (const armX of [0.42, -0.42]) {
        for (const h of [2.05, 2.3, 1.8]) {
          const e = eye(hand);
          const release = new Vector3(armX, h, -PITCH_HALF + 1.4);
          // The release, and the ball a third of the way down the pitch (early flight).
          for (const p of [release, release.clone().lerp(new Vector3(0, 0.9, 0), 0.3)]) {
            const d = p.clone().sub(e);
            const k = (-SIGHT_SCREEN.distance - e.z) / d.z;
            const hit = e.clone().addScaledVector(d, k);
            expect(Math.abs(hit.x)).toBeLessThan(SIGHT_SCREEN.width / 2);
            expect(hit.y).toBeGreaterThan(SIGHT_SCREEN.base);
            expect(hit.y).toBeLessThan(SIGHT_SCREEN.base + SIGHT_SCREEN.height);
          }
        }
      }
    }
  });

  it('raise the contrast of the ball: dark behind a white ball, off-white behind a red one', () => {
    const WHITE_BALL = '#f2efe6';
    const RED_BALL = '#9e1b1f';
    expect(contrast(WHITE_BALL, SIGHT_TONES.dark)).toBeGreaterThan(contrast(WHITE_BALL, SIGHT_TONES.white) * 3);
    expect(contrast(WHITE_BALL, SIGHT_TONES.dark)).toBeGreaterThan(7);
    expect(contrast(RED_BALL, SIGHT_TONES.white)).toBeGreaterThan(contrast(RED_BALL, SIGHT_TONES.dark) * 2);
    expect(contrast(RED_BALL, SIGHT_TONES.white)).toBeGreaterThan(4.5);
  });

  it('switch tone on the stadium, matte and without glowing edges', () => {
    const scene = new Scene();
    const st = createStadium(scene, PRACTICE_PROFILES.lite.preset);
    const screens: Mesh[] = [];
    st.group.traverse((o) => {
      if (o.name === 'sight-screen') screens.push(o as Mesh);
    });
    expect(screens).toHaveLength(2);
    for (const s of screens) {
      near(Math.abs(s.position.z), SIGHT_SCREEN.distance);
      const b = box(s.geometry);
      near(b.max.x - b.min.x, SIGHT_SCREEN.width);
      near(b.max.y - b.min.y, SIGHT_SCREEN.height);
    }
    expect(st.inspect().sightScreen.color).toBe(SIGHT_TONES.dark);
    st.setSightScreens('white');
    expect(st.inspect().sightScreen.color).toBe(SIGHT_TONES.white);
    st.setSightScreens('dark');
    expect(st.inspect().sightScreen).toMatchObject({ tone: 'dark', color: SIGHT_TONES.dark });
    st.dispose();
  });
});

describe('pitch surfaces follow the physics', () => {
  const KEYS: Array<PitchCondition | 'dry'> = ['balanced', 'green', 'hard', 'turning', 'dry'];
  const looks = Object.fromEntries(KEYS.map((k) => [k, pitchLook(k)]));
  it('gives every condition a distinct look', () => {
    const sig = (k: string) => {
      const l = looks[k];
      return [l.soilLight, l.grassCover.toFixed(3), l.crack.toFixed(3), l.sheen.toFixed(3), l.dust.toFixed(3)].join('|');
    };
    expect(new Set(KEYS.map(sig)).size).toBe(KEYS.length);
    expect(looks.turning.label).toBe('Dusty');
    expect(looks.hard.label).toBe('Hard & Bouncy');
    expect(pitchLook('no-such-pitch')).toEqual(looks.balanced);
  });

  it('derives every parameter from PITCHES as documented', () => {
    const n = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
    for (const k of KEYS) {
      const p = pitchParams(k);
      const l = looks[k];
      near(l.grassCover, 0.1 + 0.9 * Math.min(1, 0.62 * n(p.swingFactor, 0.8, 1.45) + 0.38 * n(p.seamGrip, 0.012, 0.026)));
      near(l.crack, Math.pow(n(p.turnGrip, 0.45, 0.95), 0.8));
      near(l.dust, n(p.friction, 0.3, 0.4));
      near(l.sheen, n(p.restitution, 0.55, 0.67) * (1 - n(p.friction, 0.25, 0.4)));
    }
    // Green carries the most grass (most seam and swing), Hard the most polish, Dusty the most cracks and dust.
    expect(looks.green.grassCover).toBe(Math.max(...KEYS.map((k) => looks[k].grassCover)));
    expect(looks.hard.sheen).toBe(Math.max(...KEYS.map((k) => looks[k].sheen)));
    expect(looks.turning.crack).toBe(1);
    expect(looks.turning.dust).toBe(1);
    // 'dry' sits between balanced and turning until physics defines it.
    const table = PITCHES as Record<string, unknown>;
    if (!table.dry) near(pitchParams('dry').turnGrip, (PITCHES.balanced.turnGrip + PITCHES.turning.turnGrip) / 2);
    expect(looks.dry.crack).toBeGreaterThan(looks.balanced.crack);
    expect(looks.dry.crack).toBeLessThan(looks.turning.crack);
  });

  it('applies on the stadium (Practice pitch after the match conditions)', () => {
    const st = createStadium(new Scene(), PRACTICE_PROFILES.lite.preset);
    st.setConditions({ pitch: 'hard', weather: 'clear' });
    expect(st.inspect().pitch.key).toBe('hard');
    st.setPracticePitch('turning');
    expect(st.inspect().pitch).toMatchObject({ key: 'turning', label: 'Dusty' });
    st.setPracticePitch('dry');
    expect(st.inspect().pitch.key).toBe('dry');
    st.dispose();
  });
});

describe('Delivery Quiet Mode and the environment', () => {
  it('freezes the boards, the fascia and the decorative clock while quiet, and resumes after', () => {
    const st = createStadium(new Scene(), PRACTICE_PROFILES.standard.preset);
    st.setTime(1000);
    const before = st.inspect();
    st.setQuiet(true);
    st.setTime(5000);
    st.setTime(9000);
    const quiet = st.inspect();
    expect(quiet.quiet).toBe(true);
    expect(quiet.boardOffset).toBe(before.boardOffset);
    expect(quiet.fasciaOffset).toBe(before.fasciaOffset);
    expect(quiet.decorativeTime).toBe(1000);
    st.setQuiet(false);
    st.setTime(9500);
    const after = st.inspect();
    expect(after.boardOffset).not.toBe(before.boardOffset);
    expect(after.decorativeTime).toBe(9500);
    st.dispose();
  });

  it('keeps the crowd still at a hush: every crowd motion is gated on the excitement', () => {
    const st = createStadium(new Scene(), PRACTICE_PROFILES.high.preset);
    let crowd: InstancedMesh | null = null;
    st.group.traverse((o) => {
      if (o.name === 'crowd') crowd = o as InstancedMesh;
    });
    expect(crowd).not.toBeNull();
    const shader = ((crowd as unknown as InstancedMesh).material as ShaderMaterial).vertexShader;
    expect(CROWD_HUSH).toBeCloseTo(0.12);
    expect(shader).toContain(`smoothstep(${CROWD_HUSH.toFixed(2)}, 0.28, max(uExcite, near)) * uAnimate`);
    // Lite: a sparse, static crowd; high: the full count, animated.
    st.setQuality(PRACTICE_PROFILES.lite.preset);
    expect(st.inspect().crowd).toMatchObject({ animated: false });
    expect(st.inspect().crowd.count).toBeLessThanOrEqual(PRACTICE_PROFILES.lite.preset.crowd);
    st.setQuality(PRACTICE_PROFILES.high.preset);
    expect(st.inspect().crowd.animated).toBe(true);
    expect(st.inspect().crowd.count).toBeGreaterThan(PRACTICE_PROFILES.lite.preset.crowd);
    // Banners and flags in the crowd: high tier only, and gated on the excitement like everything else.
    let banners: InstancedMesh | null = null;
    st.group.traverse((o) => {
      if (o.name === 'crowd-banners') banners = o as InstancedMesh;
    });
    const b = banners as unknown as InstancedMesh;
    expect(b.visible).toBe(true);
    expect((b.material as ShaderMaterial).vertexShader).toContain('float e = max(uExcite, near) * uAnimate;');
    st.setQuality(PRACTICE_PROFILES.standard.preset);
    expect(b.visible).toBe(false);
    st.dispose();
  });

  it('lights day, late afternoon and evening, clear or overcast; the sun casts one blob shadow, the towers six', () => {
    const st = createStadium(new Scene(), PRACTICE_PROFILES.standard.preset);
    expect(st.inspect().environment).toEqual({ light: 'evening', sky: 'clear' });
    expect(st.shadowSources()).toHaveLength(6);
    const evening = st.exposure();
    for (const light of ['day', 'late_afternoon', 'evening'] as const) {
      for (const sky of ['clear', 'overcast'] as const) {
        st.setEnvironment({ light, sky });
        expect(st.inspect().environment).toEqual({ light, sky });
        expect(st.exposure()).toBeGreaterThan(0.8);
        expect(st.exposure()).toBeLessThan(1.3);
        expect(st.shadowSources()).toHaveLength(light === 'evening' ? 6 : 1);
        if (ENVIRONMENTS[light][sky].sun) {
          // The key light is the sun, and the blob shadow points away from it.
          const sun = st.shadowSources()[0];
          expect(st.keyLight.position.clone().sub(st.keyLight.target.position).normalize().dot(sun.clone().normalize())).toBeGreaterThan(0.99);
        }
      }
    }
    st.setEnvironment({ light: 'evening', sky: 'clear' });
    expect(st.exposure()).toBe(evening);
    // Without a renderer there is no environment map (it is built in setEnvironment once a renderer is attached).
    expect(st.ballEnvironment()).toBeNull();
    // A low sun throws a long blob shadow, a high one a short one.
    expect(blobLength((15 * Math.PI) / 180, 1)).toBeGreaterThan(blobLength((54 * Math.PI) / 180, 1) * 1.8);
    st.dispose();
  });
});

describe('Practice effects never put particles near the ball', () => {
  it('draws no particles during the delivery and leaves a scuff on the pitch from the bounce on', () => {
    const fx = createEventFx(flatTexture([255, 255, 255, 255]) as unknown as Texture);
    fx.setBounceMark('dust');
    fx.setPractice(true);
    const flight = fixtureFlight({ lengthM: 6 });
    const result = fixtureResult(flight, { kind: 'drive', timingMs: 0, bearing: 20 });
    const setup = { field: fixtureField(), bowler: { family: 'pace' as const, paceBand: 'fast' as const, arm: 'right' as const, lookSeed: 'b1' }, conditions: 'balanced' as const, handedness: 'right' as const };
    const script = buildPracticeScript({ setup, flight, result });
    const bounce = script.events.find((e) => e.kind === 'bounce')!;
    const bat = script.events.find((e) => e.kind === 'bat' || e.kind === 'edge')!;
    expect(bounce).toBeDefined();
    const parts = fx.group.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
    const scuff = fx.group.children.find((c) => c instanceof Mesh && !(c instanceof InstancedMesh) && Math.abs((c as Mesh).scale.z - 1) > 1e-6) as Mesh | undefined;
    const cam = new Vector3(0, 1.7, 9);
    fx.update(script, bounce.t - 5, cam, 1.2, false);
    expect(parts.count).toBe(0);
    for (const t of [bounce.t + 1, bounce.t + 100, bat.t + 1, bat.t + 150]) {
      fx.update(script, t, cam, 1.2, false);
      expect(parts.count).toBe(0);
    }
    // The scuff: at the bounce, about the size of the skid, lying on the pitch, there from the bounce on.
    fx.update(script, bounce.t + 300, cam, 1.2, false);
    const marks = fx.group.children.filter((c) => c.visible && c instanceof Mesh && !(c instanceof InstancedMesh)) as Mesh[];
    expect(marks).toHaveLength(1);
    const mark = scuff ?? marks[0];
    near(mark.position.x, bounce.at!.x, 1e-9);
    near(mark.position.z, bounce.at!.z, 1e-9);
    expect(mark.position.y).toBeLessThan(0.01);
    near(mark.scale.x, SCUFF_SIZE.width, 1e-9);
    near(mark.scale.z, SCUFF_SIZE.length, 1e-9);
    fx.update(script, bounce.t - 1, cam, 1.2, false);
    expect(fx.group.children.filter((c) => c.visible && c instanceof Mesh && !(c instanceof InstancedMesh))).toHaveLength(0);
    fx.dispose();
  });
});

describe('players', () => {
  it('builds two LODs with region, variant and skinning data, and dresses umpires in navy', () => {
    const rig = createRig('umpire', 20);
    expect(rig.meshes).toHaveLength(2);
    const geo = rig.meshes[0].geometry;
    for (const a of ['position', 'normal', 'skinIndex', 'skinWeight', 'region', 'bindPos', 'aVar', 'aBase']) expect(geo.attributes[a]).toBeDefined();
    expect(rig.meshes[1].geometry.attributes.position.count).toBeLessThan(geo.attributes.position.count / 2);
    dressRig(rig, { seed: 'ump-a', team: 0, gear: 'umpire' }, KITS[0]);
    const shirt = rig.uniforms.uPrimary.value;
    expect(luminance('#' + shirt.getHexString())).toBeLessThan(0.05);
    expect(shirt.b).toBeGreaterThan(shirt.r);
  });

  it('switches headgear and expression by uniform, and ghosts without recompiling', () => {
    const keeper = createRig('keeper', 20);
    expect(keeper.headgear).toBe('cap');
    setRigHeadgear(keeper, 'helmet');
    expect(keeper.uniforms.uHeadgear.value).toBe(0);
    setRigHeadgear(keeper, 'cap');
    expect(keeper.uniforms.uHeadgear.value).toBe(1);
    setRigExpression(keeper, 'celebration', 0.5);
    expect(keeper.uniforms.uExpr.value[1]).toBeCloseTo(0.5);
    const version = keeper.material.version;
    setRigGhost(keeper, { color: '#7fe0ff', opacity: 0.4 });
    expect(keeper.meshes.every((m) => m.material === keeper.ghostMaterial)).toBe(true);
    expect(keeper.ghostMaterial.transparent).toBe(true);
    setRigGhost(keeper, null);
    expect(keeper.meshes.every((m) => m.material === keeper.material)).toBe(true);
    expect(keeper.material.version).toBe(version);
    // The ghost material is in the rig's own tree from creation (a hidden twin), so prewarm compiles it.
    let twin = false;
    keeper.root.traverse((o) => {
      if (o.name === 'ghost-warmup') twin = true;
    });
    expect(twin).toBe(true);
  });

  it('uses the complete striker rig only for a Coach demonstration and actively restores it afterwards', () => {
    const striker = createRig('batter', 20);
    const stage = { rigOf: (id: string) => (id === 'striker' ? striker : undefined) };
    expect(setCoachDemonstrationGhost(stage, true)).toBe(true);
    expect(striker.meshes.every((mesh) => mesh.material === striker.ghostMaterial && mesh.renderOrder === 6 && !mesh.castShadow)).toBe(true);
    expect(setCoachDemonstrationGhost(stage, false)).toBe(true);
    expect(striker.meshes.every((mesh) => mesh.material === striker.material && mesh.renderOrder === 0)).toBe(true);
    expect(striker.meshes[0].castShadow).toBe(true);
    expect(striker.meshes[1].castShadow).toBe(false);
    // A shadowless profile stays shadowless: a routine non-demo frame and a completed demo cannot enable it.
    striker.meshes[0].castShadow = false;
    setCoachDemonstrationGhost(stage, false);
    expect(striker.meshes[0].castShadow).toBe(false);
    setCoachDemonstrationGhost(stage, true);
    setCoachDemonstrationGhost(stage, false);
    expect(striker.meshes[0].castShadow).toBe(false);
    // A profile change while the ghost is up changes the eventual solid policy without making the translucent body
    // cast or restoring stale flags when the demonstration finishes.
    setCoachDemonstrationGhost(stage, true);
    setRigShadowPolicy(striker, true);
    expect(striker.meshes.every((mesh) => !mesh.castShadow)).toBe(true);
    setCoachDemonstrationGhost(stage, false);
    expect(striker.meshes[0].castShadow).toBe(true);
    expect(striker.meshes[1].castShadow).toBe(false);
    setCoachDemonstrationGhost(stage, true);
    setRigShadowPolicy(striker, false);
    setCoachDemonstrationGhost(stage, false);
    expect(striker.meshes.every((mesh) => !mesh.castShadow)).toBe(true);
  });
});

describe('first-person gloves', () => {
  it('stay inside the physics glove envelope round the handle (GLOVE_R)', () => {
    const fp = createFirstPerson(new Scene());
    const gloves = fp.group.children.filter((c): c is Group => c instanceof Group);
    expect(gloves).toHaveLength(2);
    const v = new Vector3();
    for (const glove of gloves) {
      let radial = 0;
      let along = [Infinity, -Infinity];
      glove.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p as never, i);
          if (!m.matrixAutoUpdate) v.applyMatrix4(m.matrix);
          radial = Math.max(radial, Math.hypot(v.x, v.z));
          along = [Math.min(along[0], v.y), Math.max(along[1], v.y)];
        }
      });
      expect(radial).toBeLessThanOrEqual(GLOVE_R + 1e-3);
      expect(along[1] - along[0]).toBeLessThanOrEqual(FP_GLOVE.length + 0.01);
    }
    fp.dispose();
  });
});
