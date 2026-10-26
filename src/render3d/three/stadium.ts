/**
 * The night stadium, built procedurally (no external assets): indigo sky with city glow, floodlit grass with
 * mowing stripes and the 30-yard ring, a pitch whose surface reads Green / Hard / Slow, rope and LED boards,
 * tiered stands with a crowd speckle plus an animated instanced crowd, sight screens and six floodlight towers.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Conditions, KitSpec } from '@/contracts';
import {
  BOUNDARY_R,
  PITCH_HALF,
  PITCH_WIDTH,
  POPPING,
  POPPING_CREASE_HALF,
  RETURN_CREASE_LENGTH,
  RETURN_CREASE_X,
  RING_R,
} from '../core/ground';
import { seededStream } from '../core/math';
import type { QualityPreset } from '../core/quality';

export const TOWER_ANGLES = [35, 90, 145, 215, 270, 325].map((d) => (d * Math.PI) / 180);
export const TOWER_R = BOUNDARY_R + 52;
export const TOWER_H = 58;
export const towerPos = (a: number) => new Vector3(Math.sin(a) * TOWER_R, TOWER_H, Math.cos(a) * TOWER_R);

const NOISE_GLSL = `
float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh(i), vh(i + vec2(1.0, 0.0)), u.x), mix(vh(i + vec2(0.0, 1.0)), vh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.13 + 7.1) * 0.3 + vnoise(p * 4.7 + 3.3) * 0.1; }
`;

export interface Stadium {
  group: Group;
  keyLight: DirectionalLight;
  rimLight: DirectionalLight;
  hemi: HemisphereLight;
  setTime(ms: number): void;
  setExcitement(v: number): void;
  /** Boundary / wicket board flash 0..1 and colour. */
  setBoardFlash(v: number, color: 'cyan' | 'amber' | 'wicket'): void;
  setConditions(c: Conditions): void;
  setTeams(home: KitSpec, away: KitSpec): void;
  setQuality(p: QualityPreset): void;
  dispose(): void;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** LED board strip: brand lockup and abstract glyphs (our own brand only). */
function boardTexture(): Texture {
  const t = canvasTexture(2048, 64, (g) => {
    const grd = g.createLinearGradient(0, 0, 2048, 0);
    grd.addColorStop(0, '#0b0930');
    grd.addColorStop(0.5, '#151154');
    grd.addColorStop(1, '#0b0930');
    g.fillStyle = grd;
    g.fillRect(0, 0, 2048, 64);
    g.font = '800 38px "Manrope Variable", Manrope, system-ui, sans-serif';
    g.textBaseline = 'middle';
    const items = ['VANDE CRICKET', 'SEALED SIX', 'LOCK YOUR OVER', 'REVEAL THE RIVALRY'];
    let x = 30;
    items.forEach((s, i) => {
      g.fillStyle = i % 2 ? '#ffb347' : '#5fe3ff';
      g.fillText(s, x, 34);
      x += g.measureText(s).width + 40;
      // Glyph: a small six-pointed seal mark between items.
      g.save();
      g.translate(x, 32);
      g.strokeStyle = '#ffffff';
      g.globalAlpha = 0.65;
      g.lineWidth = 3;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
      }
      g.stroke();
      g.restore();
      x += 50;
    });
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 64; i += 4) g.fillRect(0, i, 2048, 1);
  });
  t.wrapS = RepeatWrapping;
  // Negative repeat mirrors U: the boards are seen from inside the ring, where a cylinder's U runs right to left.
  t.repeat.set(-6, 1);
  return t;
}

export function glowTexture(): Texture {
  return canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,245,220,0.75)');
    grd.addColorStop(0.45, 'rgba(255,214,150,0.22)');
    grd.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
}

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
varying vec3 vDir; uniform float uTime;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith = vec3(0.016, 0.012, 0.075);
  vec3 mid = vec3(0.07, 0.055, 0.24);
  vec3 horizon = vec3(0.11, 0.08, 0.24);
  vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, h));
  col = mix(col, zenith, smoothstep(0.18, 0.75, h));
  float az = atan(d.x, d.z);
  float city = (1.0 - smoothstep(-0.02, 0.1, h)) * (0.55 + 0.45 * vnoise(vec2(az * 6.0, 1.0)));
  col += vec3(1.0, 0.58, 0.26) * city * 0.13;
  // Stars (sparse, only high up).
  vec2 sp = vec2(az * 60.0, h * 90.0);
  float s = step(0.9965, vh(floor(sp))) * smoothstep(0.25, 0.6, h);
  col += vec3(0.8, 0.85, 1.0) * s * 0.7;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}

function patchGround(mat: MeshStandardMaterial, uniforms: Record<string, { value: unknown }>, low: boolean) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldG;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldG = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldG;
uniform vec3 uGrassA, uGrassB;
uniform float uWet;
${NOISE_GLSL}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 p = vWorldG.xz;
float r = length(p);
float stripe = step(0.5, fract(p.x / 7.0));
float ringStripe = step(0.5, fract(r / 9.0));
float s = mix(stripe, ringStripe, smoothstep(${(RING_R + 2).toFixed(1)}, ${(RING_R + 8).toFixed(1)}, r));
vec3 grass = mix(uGrassA, uGrassB, s * 0.55 + 0.2);
${low ? '' : 'float n = fbm(p * 0.9); grass *= 0.86 + 0.24 * n; grass *= 0.95 + 0.08 * vnoise(p * 9.0);'}
// Floodlit centre, darker towards the rope.
grass *= mix(1.12, 0.82, smoothstep(12.0, ${(BOUNDARY_R + 4).toFixed(1)}, r));
// 30-yard circle: white dashes.
float ang = atan(p.y, p.x);
float dash = step(0.5, fract(ang * 38.0 / 6.2831853));
float ring = (1.0 - smoothstep(0.05, 0.11, abs(r - ${RING_R.toFixed(1)}))) * dash;
grass = mix(grass, vec3(0.86, 0.9, 0.86), ring * 0.85);
diffuseColor.rgb = grass;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.92, 0.55, uWet);');
  };
  mat.customProgramCacheKey = () => `vande-grass-${low ? 'low' : 'std'}`;
}

function patchPitch(mat: MeshStandardMaterial, uniforms: Record<string, { value: unknown }>) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldP;
uniform float uPitch; // 0 green, 1 hard, 2 slow
${NOISE_GLSL}
float line(float d, float w) { return 1.0 - smoothstep(w, w + 0.012, abs(d)); }
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 p = vWorldP.xz;
float n = fbm(p * vec2(4.0, 1.6));
float fine = vnoise(p * 34.0);
vec3 clayA = vec3(0.72, 0.58, 0.38);
vec3 clayB = vec3(0.55, 0.43, 0.27);
vec3 col = mix(clayB, clayA, n);
col *= 0.92 + 0.14 * fine;
float green = step(uPitch, 0.5);
float slow = step(1.5, uPitch);
float hard = 1.0 - green - slow;
col = mix(col, vec3(0.36, 0.5, 0.25) * (0.8 + 0.4 * n), green * (0.42 + 0.25 * vnoise(p * 3.0)));
col = mix(col, col * 1.12 + vec3(0.04, 0.03, 0.0), hard);
// Slow pitch: dry, cracked, roughed-up footmarks.
float crack = 1.0 - smoothstep(0.0, 0.035, abs(vnoise(p * vec2(3.0, 9.0)) - 0.5));
col = mix(col, col * 0.62, slow * crack * 0.7);
float foot = smoothstep(0.55, 0.0, length((p - vec2(0.55, ${(PITCH_HALF - 2.4).toFixed(2)})) * vec2(1.3, 0.55)));
foot += smoothstep(0.55, 0.0, length((p - vec2(-0.5, ${(-PITCH_HALF + 2.4).toFixed(2)})) * vec2(1.3, 0.55)));
col = mix(col, col * 0.7, foot * (0.3 + slow * 0.4));
// Edge blend into the outfield.
float edge = smoothstep(${(PITCH_WIDTH / 2 - 0.25).toFixed(2)}, ${(PITCH_WIDTH / 2).toFixed(2)}, abs(p.x));
col = mix(col, vec3(0.16, 0.32, 0.15), edge * 0.6);
// Creases (white): popping, bowling and return creases at both ends.
float z = abs(p.y);
float w = 0.025;
float cr = line(z - ${(PITCH_HALF - POPPING).toFixed(3)}, w) * step(abs(p.x), ${POPPING_CREASE_HALF.toFixed(3)});
cr += line(z - ${PITCH_HALF.toFixed(3)}, w) * step(abs(p.x), ${RETURN_CREASE_X.toFixed(3)});
cr += line(abs(p.x) - ${RETURN_CREASE_X.toFixed(3)}, w) * step(${(PITCH_HALF - POPPING).toFixed(3)}, z) * step(z, ${(PITCH_HALF - POPPING + RETURN_CREASE_LENGTH).toFixed(3)});
col = mix(col, vec3(0.97, 0.97, 0.95), clamp(cr, 0.0, 1.0));
diffuseColor.rgb = col;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.85, 0.45, step(0.5, uPitch) * (1.0 - step(1.5, uPitch)));');
  };
  mat.customProgramCacheKey = () => 'vande-pitch-v1';
}

/** One tier of stands: stepped rows (riser + tread) facing the field. The crowd itself is painted by a shader. */
function tierGeometry(r0: number, r1: number, y0: number, y1: number, rows: number, gaps: Array<[number, number]>, segments: number): BufferGeometry {
  const pos: number[] = [];
  const step = (Math.PI * 2) / segments;
  const inGap = (mid: number) =>
    gaps.some(([g0, g1]) => {
      const d = Math.atan2(Math.sin(mid - g0), Math.cos(mid - g0));
      return d >= 0 && d <= g1 - g0;
    });
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let row = 0; row < rows; row++) {
    const ra = r0 + ((r1 - r0) * row) / rows;
    const rb = r0 + ((r1 - r0) * (row + 1)) / rows;
    const ya = y0 + ((y1 - y0) * row) / rows;
    const yb = y0 + ((y1 - y0) * (row + 1)) / rows;
    for (let i = 0; i < segments; i++) {
      const a0 = i * step;
      const a1 = a0 + step;
      if (inGap(a0 + step / 2)) continue;
      const P = (a: number, r: number, y: number) => [Math.sin(a) * r, y, Math.cos(a) * r];
      quad(P(a0, ra, ya), P(a1, ra, ya), P(a1, ra, yb), P(a0, ra, yb));
      quad(P(a0, ra, yb), P(a1, ra, yb), P(a1, rb, yb), P(a0, rb, yb));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/** Crowd painted per seat cell: shirts, heads, empty seats and phone lights; filtered to an average at distance. */
function patchStands(mat: MeshBasicMaterial, uniforms: Record<string, { value: unknown }>) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldS;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldS = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldS;
uniform float uTime, uExcite;
uniform vec3 uTeamA, uTeamB;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
vec3 shirt(float h) {
  if (h < 0.22) return uTeamA;
  if (h < 0.42) return uTeamB;
  if (h < 0.52) return vec3(0.95, 0.95, 0.93);
  if (h < 0.62) return vec3(1.0, 0.7, 0.28);
  if (h < 0.7) return vec3(0.37, 0.89, 1.0);
  if (h < 0.78) return vec3(1.0, 0.36, 0.56);
  if (h < 0.86) return vec3(1.0, 0.83, 0.43);
  return vec3(0.49, 0.94, 0.77);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float ang = atan(vWorldS.x, vWorldS.z);
float rr = length(vWorldS.xz);
vec2 cc = vec2(ang * rr / 0.62, vWorldS.y / 0.62);
vec2 cell = floor(cc);
vec2 f = fract(cc);
float h = h21(cell);
float occ = step(0.14, h);
vec3 seat = vec3(0.035, 0.03, 0.11);
// Floodlight spill: front rows brighter, back rows fall into the night.
float spill = mix(0.62, 0.22, smoothstep(2.0, 27.0, vWorldS.y));
vec3 sh = shirt(fract(h * 7.31)) * (0.45 + 0.35 * fract(h * 3.7)) * spill;
float body = step(0.2, f.x) * step(f.x, 0.8) * step(f.y, 0.6);
float head = 1.0 - step(0.15, length((f - vec2(0.5, 0.76)) * vec2(1.0, 1.2)));
vec3 detail = mix(seat, sh, occ * body);
detail = mix(detail, vec3(0.5, 0.35, 0.25) * spill, occ * head);
vec3 avg = mix(seat, sh, occ * 0.5);
float px = max(length(fwidth(cc)), 1e-4);
vec3 col = mix(detail, avg, smoothstep(0.35, 0.9, px));
// Phone lights: more of them as the crowd gets louder.
float tw = step(0.9975 - uExcite * 0.006, h21(cell + floor(uTime * 0.0021)));
col += vec3(1.0, 0.98, 0.92) * tw * occ * 1.6;
diffuseColor.rgb = col;
`,
      );
  };
  mat.customProgramCacheKey = () => 'vande-stands-v1';
}

function crowdMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uExcite: { value: 0.3 },
      uAnimate: { value: 1 },
      fogColor: { value: new Color('#1a1546') },
      fogNear: { value: 120 },
      fogFar: { value: 560 },
    },
    vertexShader: `
attribute float aArm;
attribute float aPhase;
uniform float uTime; uniform float uExcite; uniform float uAnimate;
varying vec3 vColor; varying float vShade; varying float vDepth;
void main() {
  vec3 p = position;
  float e = clamp(uExcite * (0.6 + 0.4 * fract(aPhase * 7.13)), 0.0, 1.0) * uAnimate;
  float bob = sin(uTime * 0.009 + aPhase * 6.2831) * 0.07 * e + max(0.0, sin(uTime * 0.013 + aPhase * 12.0)) * 0.12 * e * e;
  p.y += bob;
  if (abs(aArm) > 0.5) {
    float raise = smoothstep(0.35, 0.85, e) * (2.4 + 0.4 * sin(uTime * 0.011 + aPhase * 9.0));
    vec3 pivot = vec3(0.21 * aArm, 0.42, 0.0);
    vec3 q = p - pivot - vec3(0.0, bob, 0.0);
    float c = cos(raise * aArm), s = sin(raise * aArm);
    q = vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z);
    p = q + pivot + vec3(0.0, bob, 0.0);
  }
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vColor = instanceColor;
  vShade = 0.55 + 0.45 * clamp(normal.y * 0.5 + 0.6, 0.0, 1.0);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
varying vec3 vColor; varying float vShade; varying float vDepth;
void main() {
  vec3 c = vColor * vShade;
  float f = smoothstep(fogNear, fogFar, vDepth);
  gl_FragColor = vec4(mix(c, fogColor, f * 0.85), 1.0);
}`,
  });
}

function spectatorGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const body = new BoxGeometry(0.4, 0.5, 0.26);
  body.translate(0, 0.25, 0);
  const head = new SphereGeometry(0.12, 6, 4);
  head.translate(0, 0.64, 0);
  const armL = new BoxGeometry(0.1, 0.42, 0.1);
  armL.translate(0.25, 0.22, 0);
  const armR = armL.clone();
  armR.translate(-0.5, 0, 0);
  const tag = (g: BufferGeometry, v: number) => {
    const n = g.attributes.position.count;
    g.setAttribute('aArm', new BufferAttribute(new Float32Array(n).fill(v), 1));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  parts.push(tag(body, 0), tag(head, 0), tag(armL, 1), tag(armR, -1));
  return mergeGeometries(parts)!;
}

export function createStadium(scene: Scene, preset: QualityPreset): Stadium {
  const group = new Group();
  group.name = 'stadium';
  scene.add(group);
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  scene.fog = new Fog('#1a1546', 120, 560);
  scene.background = new Color('#0a0828');

  // Sky
  const skyMat = track(skyMaterial());
  const sky = new Mesh(track(new SphereGeometry(470, 32, 16)), skyMat);
  sky.renderOrder = -10;
  group.add(sky);

  // Lights: key from one tower (shadows), cool rim from the opposite tower, hemisphere fill.
  const hemi = new HemisphereLight('#4b45a8', '#0b2414', 0.62);
  group.add(hemi);
  const keyLight = new DirectionalLight('#ffe6c4', 2.35);
  keyLight.position.copy(towerPos(TOWER_ANGLES[2])).multiplyScalar(0.6);
  keyLight.target.position.set(0, 0, 2);
  group.add(keyLight, keyLight.target);
  const rimLight = new DirectionalLight('#9fd6ff', 0.85);
  rimLight.position.copy(towerPos(TOWER_ANGLES[5])).multiplyScalar(0.6);
  group.add(rimLight);
  keyLight.shadow.camera.left = -16;
  keyLight.shadow.camera.right = 16;
  keyLight.shadow.camera.top = 18;
  keyLight.shadow.camera.bottom = -18;
  keyLight.shadow.camera.near = 20;
  keyLight.shadow.camera.far = 160;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.02;

  // Grass
  const grassUniforms = { uGrassA: { value: new Color('#0f4a2a') }, uGrassB: { value: new Color('#1f7a43') }, uWet: { value: 0 } };
  const grassMat = track(new MeshStandardMaterial({ color: '#1f7a43', roughness: 0.9 }));
  patchGround(grassMat, grassUniforms, preset.quality === 'low');
  const ground = new Mesh(track(new CircleGeometry(BOUNDARY_R + 6, 96)), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const apron = new Mesh(track(new RingGeometry(BOUNDARY_R + 6, BOUNDARY_R + 9, 96)), track(new MeshLambertMaterial({ color: '#141033' })));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.01;
  group.add(apron);

  // Pitch
  const pitchUniforms = { uPitch: { value: 1 } };
  const pitchMat = track(new MeshStandardMaterial({ color: '#c9a574', roughness: 0.8 }));
  patchPitch(pitchMat, pitchUniforms);
  const pitch = new Mesh(track(new PlaneGeometry(PITCH_WIDTH + 1.2, PITCH_HALF * 2 + 4, 1, 1)), pitchMat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.012;
  pitch.receiveShadow = true;
  group.add(pitch);

  // Rope and LED boards
  const rope = new Mesh(track(new TorusGeometry(BOUNDARY_R, 0.13, 6, 220)), track(new MeshStandardMaterial({ color: '#1d1a5e', roughness: 0.5, emissive: '#0a5a7a', emissiveIntensity: 0.5 })));
  rope.rotation.x = Math.PI / 2;
  rope.position.y = 0.1;
  group.add(rope);
  const boardTex = track(boardTexture());
  const boardMat = track(new MeshBasicMaterial({ map: boardTex, side: DoubleSide, fog: true }));
  const boards = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 2.6, BOUNDARY_R + 2.6, 0.9, 200, 1, true)), boardMat);
  boards.position.y = 0.45;
  group.add(boards);

  // Stands (two tiers), with gaps behind both ends for the sight screens.
  const gapHalf = 0.1;
  const gaps: Array<[number, number]> = [
    [-gapHalf, gapHalf],
    [Math.PI - gapHalf, Math.PI + gapHalf],
  ];
  const standUniforms = { uTime: { value: 0 }, uExcite: { value: 0.3 }, uTeamA: { value: new Color('#3b2fc9') }, uTeamB: { value: new Color('#e8901a') } };
  const standMat = track(new MeshBasicMaterial({ color: '#ffffff', fog: true }));
  patchStands(standMat, standUniforms);
  const segs = preset.quality === 'low' ? 96 : 160;
  const lower = new Mesh(track(tierGeometry(BOUNDARY_R + 8, BOUNDARY_R + 27, 1.2, 10.5, preset.quality === 'low' ? 8 : 14, gaps, segs)), standMat);
  const upper = new Mesh(track(tierGeometry(BOUNDARY_R + 30, BOUNDARY_R + 47, 13.5, 27, preset.quality === 'low' ? 8 : 13, gaps, segs)), standMat);
  group.add(lower, upper);
  const wallMat = track(new MeshLambertMaterial({ color: '#0d0b2c' }));
  const wall = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 7.5, BOUNDARY_R + 7.5, 1.6, 160, 1, true)), wallMat);
  wall.position.y = 0.8;
  group.add(wall);
  // LED fascia ribbon between the tiers.
  const fasciaTex = track(boardTexture());
  fasciaTex.repeat.set(-9, 1);
  const fasciaMat = track(new MeshBasicMaterial({ map: fasciaTex, side: DoubleSide, color: '#8f98d8', fog: true }));
  const fascia = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 28.5, BOUNDARY_R + 28.5, 1.6, 200, 1, true)), fasciaMat);
  fascia.position.y = 12.4;
  group.add(fascia);
  // Cantilever roof (sloped) with a cyan light line along its leading edge.
  const roof = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 40, BOUNDARY_R + 52, 5, 160, 1, true)), track(new MeshLambertMaterial({ color: '#211b63', side: DoubleSide })));
  roof.position.y = 32;
  const roofLine = new Mesh(track(new TorusGeometry(BOUNDARY_R + 40, 0.22, 4, 180)), track(new MeshBasicMaterial({ color: '#4fe3ff', fog: true })));
  roofLine.rotation.x = Math.PI / 2;
  roofLine.position.y = 29.5;
  group.add(roof, roofLine);

  // Sight screens behind both ends (dark, for the white ball).
  const screenMat = track(new MeshLambertMaterial({ color: '#07061c' }));
  const screenEdge = track(new MeshBasicMaterial({ color: '#2fd6ff', fog: true }));
  for (const z of [1, -1]) {
    const s = new Mesh(track(new BoxGeometry(11, 6.5, 0.6)), screenMat);
    s.position.set(0, 3.25, z * (BOUNDARY_R + 6.5));
    const edge = new Mesh(track(new BoxGeometry(11, 0.12, 0.64)), screenEdge);
    edge.position.set(0, 6.5, z * (BOUNDARY_R + 6.5));
    group.add(s, edge);
  }

  // Pavilions at both ends, behind the sight screens: dark blocks with lit windows (closes the horizon gap).
  const windows = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#0c0a2a';
    g.fillRect(0, 0, 256, 256);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 18; y < 240; y += 26) {
      for (let x = 10; x < 246; x += 20) {
        const lit = rnd();
        g.fillStyle = lit > 0.55 ? `rgba(255,${190 + Math.floor(rnd() * 50)},${110 + Math.floor(rnd() * 60)},${0.5 + rnd() * 0.5})` : 'rgba(40,36,90,0.8)';
        g.fillRect(x, y, 12, 14);
      }
    }
    g.fillStyle = '#2fd6ff';
    g.fillRect(0, 0, 256, 4);
  });
  windows.wrapS = RepeatWrapping;
  windows.repeat.set(2, 1);
  const pavMat = track(new MeshBasicMaterial({ map: windows, fog: true }));
  const pavRoof = track(new MeshLambertMaterial({ color: '#16124a' }));
  for (const z of [1, -1]) {
    const pav = new Mesh(track(new BoxGeometry(46, 22, 14)), [pavRoof, pavRoof, pavRoof, pavRoof, pavMat, pavMat]);
    pav.position.set(0, 11, z * (BOUNDARY_R + 22));
    group.add(pav);
  }

  // Floodlight towers: pylons, light banks, glow sprites and (standard+) soft light shafts.
  const towerGeo: BufferGeometry[] = [];
  const bankGeo: BufferGeometry[] = [];
  const glowTex = track(glowTexture());
  const glows: Mesh[] = [];
  const shafts: Mesh[] = [];
  const shaftMat = track(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uOpacity: { value: 0.05 } },
      vertexShader: `varying float vV; void main() { vV = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vV; uniform float uOpacity; void main() { gl_FragColor = vec4(1.0, 0.92, 0.78, uOpacity * vV * vV); }`,
    }),
  );
  for (const a of TOWER_ANGLES) {
    const base = new Vector3(Math.sin(a) * TOWER_R, 0, Math.cos(a) * TOWER_R);
    const pylon = new CylinderGeometry(0.7, 1.6, TOWER_H, 6);
    pylon.translate(base.x, TOWER_H / 2, base.z);
    towerGeo.push(pylon);
    const bank = new BoxGeometry(11, 6.5, 0.8, 6, 4, 1);
    const holder = new Object3D();
    holder.position.set(base.x, TOWER_H + 2, base.z);
    holder.lookAt(0, 0, 0);
    holder.updateMatrix();
    bank.applyMatrix4(holder.matrix);
    bankGeo.push(bank);
    const glow = new Mesh(track(new PlaneGeometry(1, 1)), track(new MeshBasicMaterial({ map: glowTex, transparent: true, blending: AdditiveBlending, depthWrite: false, color: '#ffe7c4', fog: false })));
    glow.position.set(base.x * 0.985, TOWER_H + 2, base.z * 0.985);
    glow.scale.setScalar(34);
    glows.push(glow);
    group.add(glow);
    const shaft = new Mesh(track(new CylinderGeometry(9, 0.6, 1, 16, 1, true)), shaftMat);
    const top = new Vector3(base.x, TOWER_H + 1, base.z);
    const to = new Vector3(0, 0, 0).sub(top);
    const len = to.length() * 0.92;
    shaft.scale.set(1, len, 1);
    shaft.position.copy(top).add(to.clone().multiplyScalar(0.46));
    shaft.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), to.clone().normalize());
    shafts.push(shaft);
    group.add(shaft);
  }
  const towers = new Mesh(track(mergeGeometries(towerGeo)!), track(new MeshLambertMaterial({ color: '#121032' })));
  const banksMat = track(new MeshBasicMaterial({ color: '#fff3dc', fog: false }));
  const banks = new Mesh(track(mergeGeometries(bankGeo)!), banksMat);
  group.add(towers, banks);

  // Animated crowd (instanced) in the lower tier.
  const crowdGeo = track(spectatorGeometry());
  const crowdMat = track(crowdMaterial());
  const maxCrowd = 6500;
  const crowd = new InstancedMesh(crowdGeo, crowdMat, maxCrowd);
  const phases = new Float32Array(maxCrowd);
  const rand = seededStream(77);
  const m = new Matrix4();
  const q = new Object3D();
  const palette = ['#f4f4f4', '#ffb347', '#5fe3ff', '#ff5d8f', '#ffd36e', '#7ef0c5', '#b38cff', '#ff7a4d', '#e9edf5', '#3b2fc9'].map((c) => new Color(c));
  let placed = 0;
  let guard = 0;
  while (placed < maxCrowd && guard++ < maxCrowd * 4) {
    const a = rand() * Math.PI * 2;
    const d = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(d) < gapHalf + 0.02 || Math.abs(Math.abs(d) - Math.PI) < gapHalf + 0.02) continue;
    const row = Math.floor(Math.pow(rand(), 1.4) * 15);
    const r = BOUNDARY_R + 8 + (row + 0.5) * (19 / 16);
    const y = 1.2 + (row + 1) * (9.3 / 16);
    q.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    q.lookAt(0, y, 0);
    q.scale.setScalar(0.9 + rand() * 0.25);
    q.updateMatrix();
    m.copy(q.matrix);
    crowd.setMatrixAt(placed, m);
    crowd.setColorAt(placed, palette[Math.floor(rand() * palette.length)].clone().multiplyScalar(0.7 + rand() * 0.35));
    phases[placed] = rand();
    placed++;
  }
  crowd.geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));
  crowd.count = Math.min(preset.crowd, placed);
  crowd.frustumCulled = false;
  group.add(crowd);

  let boardFlash = 0;
  let flashColor = new Color('#5fe3ff');
  const baseBoard = new Color('#ffffff');

  const stadium: Stadium = {
    group,
    keyLight,
    rimLight,
    hemi,
    setTime(ms) {
      skyMat.uniforms.uTime.value = ms;
      crowdMat.uniforms.uTime.value = ms;
      standUniforms.uTime.value = ms;
      boardTex.offset.x = (ms * 0.00002) % 1;
      fasciaTex.offset.x = (-ms * 0.000012) % 1;
      const pulse = boardFlash > 0 ? 0.5 + 0.5 * Math.sin(ms * 0.02) : 0;
      boardMat.color.copy(baseBoard).lerp(flashColor, boardFlash * (0.5 + 0.5 * pulse));
      fasciaMat.color.set('#8f98d8').lerp(flashColor, boardFlash * 0.8);
    },
    setExcitement(v) {
      crowdMat.uniforms.uExcite.value = v;
      standUniforms.uExcite.value = v;
    },
    setBoardFlash(v, color) {
      boardFlash = v;
      flashColor = new Color(color === 'amber' ? '#ffb347' : color === 'wicket' ? '#ff4d6a' : '#5fe3ff');
    },
    setConditions(c) {
      pitchUniforms.uPitch.value = c.pitch === 'green' ? 0 : c.pitch === 'hard' ? 1 : 2;
      grassUniforms.uWet.value = c.weather === 'dew' ? 0.65 : c.weather === 'humid' ? 0.25 : 0;
      (scene.fog as Fog).near = c.weather === 'humid' ? 80 : 120;
      (scene.fog as Fog).far = c.weather === 'humid' ? 380 : 560;
    },
    setTeams(home, away) {
      // Tint a share of the crowd with the two teams' colours.
      const a = new Color(home.primary);
      const b = new Color(away.primary);
      standUniforms.uTeamA.value.copy(a);
      standUniforms.uTeamB.value.copy(b);
      for (let i = 0; i < placed; i += 3) crowd.setColorAt(i, (i % 2 ? a : b).clone().multiplyScalar(0.75 + phases[i] * 0.3));
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    },
    setQuality(p) {
      crowd.count = Math.min(p.crowd, placed);
      crowdMat.uniforms.uAnimate.value = p.crowdAnimated ? 1 : 0;
      for (const s of shafts) s.visible = p.lightShafts;
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      crowd.dispose();
    },
  };
  stadium.setQuality(preset);
  for (const g of glows) g.userData.billboard = true;
  group.userData.glows = glows;
  return stadium;
}
