/**
 * The 3D scene, measured: cricket objects against the Laws (stumps, bails, pitch, creases, ball, bat), the players'
 * heights and count, mesh/triangle/material/texture budgets, and close-up renders of each major asset for the asset
 * acceptance tests (constitution §32). Close-ups are one-off renders through a cloned camera between balls, read back
 * in the same task (the stage keeps drawing its own camera): no product code is touched.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bulkDir, context, log, newPage, queue, sleep, waitFor, writeJson } from '../lib/env.mjs';
import { find, press } from '../lib/driver.mjs';
import { tryPress } from './capture.mjs';

/** In the page: every mesh with its geometry, world size and material facts. */
const AUDIT = () => {
  const stage = window.__eval.stage();
  const s3 = stage && (stage.stage?.camera ? stage.stage : Object.values(stage).find((v) => v && v.camera && v.camera.isPerspectiveCamera && v.scene));
  if (!s3) return null;
  const V = s3.camera.position.clone();
  const meshes = [];
  s3.scene.updateMatrixWorld(true);
  s3.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const xs = [];
    const ys = [];
    const zs = [];
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      V.set(x, y, z).applyMatrix4(o.matrixWorld);
      xs.push(V.x);
      ys.push(V.y);
      zs.push(V.z);
    }
    let visible = true;
    for (let n = o; n; n = n.parent) if (n.visible === false) visible = false;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    meshes.push({
      name: o.name || null,
      parent: o.parent?.name || null,
      type: o.isInstancedMesh ? 'instanced' : o.isSkinnedMesh ? 'skinned' : 'mesh',
      count: o.isInstancedMesh ? o.count : 1,
      geo: g.type,
      params: g.parameters ? Object.fromEntries(Object.entries(g.parameters).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, r3(v)])) : null,
      tris: Math.round((g.index ? g.index.count : g.attributes.position?.count || 0) / 3),
      size: [r3(Math.max(...xs) - Math.min(...xs)), r3(Math.max(...ys) - Math.min(...ys)), r3(Math.max(...zs) - Math.min(...zs))],
      at: [r3((Math.max(...xs) + Math.min(...xs)) / 2), r3(Math.min(...ys)), r3((Math.max(...zs) + Math.min(...zs)) / 2)],
      visible,
      mat: mats.map((m) => ({ type: m.type, maps: ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'emissiveMap'].filter((k) => m[k]).map((k) => `${k}:${m[k].image?.width || '?'}x${m[k].image?.height || '?'}`), color: m.color ? m.color.getHexString() : null, rough: m.roughness ?? null })),
    });
  });
  const rigs = {};
  if (s3.rigs?.forEach)
    s3.rigs.forEach((rig, id) => {
      if (!rig.bones) return;
      const pts = rig.bones.map((b) => [b.matrixWorld.elements[12], b.matrixWorld.elements[13], b.matrixWorld.elements[14]]);
      const ys = pts.map((p) => p[1]);
      const names = rig.bones.map((b) => b.name);
      rigs[id] = { bones: rig.bones.length, boneNames: names.slice(0, 40), minY: Math.round(Math.min(...ys) * 1000) / 1000, maxY: Math.round(Math.max(...ys) * 1000) / 1000, at: pts[0].map((v) => Math.round(v * 100) / 100), visible: rig.root?.visible !== false };
    });
  const info = s3.renderer?.info;
  return { meshes, rigs, renderer: info ? { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null } : null, fog: s3.scene.fog ? { type: s3.scene.fog.type, near: s3.scene.fog.near, far: s3.scene.fog.far } : null, lights: (() => { const l = []; s3.scene.traverse((o) => o.isLight && l.push({ type: o.type, intensity: o.intensity, castShadow: Boolean(o.castShadow), pos: o.position ? [o.position.x, o.position.y, o.position.z].map((v) => Math.round(v * 10) / 10) : null })); return l; })() };
};

/** In the page: render the scene once through a cloned camera at `pos` looking at `at` (fov), read it back. */
const CLOSEUP = ([pos, at, fov]) => {
  const stage = window.__eval.stage();
  const s3 = stage && (stage.stage?.camera ? stage.stage : Object.values(stage).find((v) => v && v.camera && v.camera.isPerspectiveCamera && v.scene));
  if (!s3) return null;
  const cam = s3.camera.clone();
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.fov = fov;
  cam.near = 0.02;
  cam.lookAt(at[0], at[1], at[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  s3.renderer.render(s3.scene, cam);
  return s3.renderer.domElement.toDataURL('image/png');
};

const rigCentre = (rig) => (rig ? [rig.at[0], (rig.minY + rig.maxY) / 2, rig.at[2]] : null);

export async function runScene(browser, args) {
  const vp = '1280x800';
  const out = { audit: null, closeups: [], errors: [] };
  const dir = bulkDir(args, 'closeups');
  for (const quality of ['standard', 'lite', 'high', 'premium', 'balanced']) {
    const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 0.25, seed: 'eval-scene' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true, quality } } });
    const page = await newPage(ctx, out.errors);
    try {
      await page.goto(args.base + '/practice');
      await sleep(1500);
      await queue(page, 'leave');
      const q = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
      if (q) await press(page, q, false);
      for (let i = 0; i < 6; i++) if (!(await tryPress(page, false, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) break;
      if (!(await waitFor(page, ['runup'], 40_000))) {
        out.errors.push(`${quality}: no run-up`);
        continue;
      }
      await sleep(2600);
      const audit = await page.evaluate(AUDIT);
      const profile = await page.evaluate(() => window.__eval.stage()?.stats?.().profile ?? null);
      if (!audit) {
        out.errors.push(`${quality}: no 3D scene`);
        continue;
      }
      if (!out.audit) out.audit = { quality, profile, ...audit };
      const R = audit.rigs;
      const ids = Object.keys(R);
      const pick = (re) => ids.find((k) => re.test(k));
      const shots = [
        ['bowler', rigCentre(R[pick(/^bowler$/) || pick(/bowl/)]), [2.4, 0.2, 3.2], 32],
        ['non-striker-batter', rigCentre(R[pick(/non|partner/)]), [1.8, 0.1, 2.6], 30],
        ['keeper', rigCentre(R[pick(/keep/)]), [1.6, 0.1, -2.4], 34],
        ['umpire', rigCentre(R[pick(/umpire/)]), [2.0, 0.1, 2.6], 32],
        ['fielder', rigCentre(R[ids.find((k) => !/bowl|strik|non|partner|keep|umpire/.test(k))]), [2.2, 0.1, 2.8], 32],
        ['stumps-crease', [0, 0.35, 10.06], [1.3, 0.25, -1.6], 40],
        ['pitch-surface', [0, 0, 1], [0.6, 2.2, 6.5], 50],
        ['stadium-wide', [0, 0, 0], [0, 28, 78], 55],
      ];
      for (const [name, c, off, fov] of shots) {
        if (!c) {
          out.closeups.push({ quality, name, missing: 'no such actor in the scene' });
          continue;
        }
        const pos = [c[0] + off[0], c[1] + off[1], c[2] + off[2]];
        const url = await page.evaluate(CLOSEUP, [pos, c, fov]).catch((e) => (out.errors.push(String(e)), null));
        if (!url) continue;
        const file = join(dir, `${quality}-${name}.png`);
        writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
        out.closeups.push({ quality, profile, name, file });
      }
    } catch (e) {
      out.errors.push(`${quality}: ${String(e).slice(0, 200)}`);
    } finally {
      await ctx.close();
    }
  }
  const file = writeJson(args, 'scene', out);
  log(args, `scene: ${out.closeups.length} close-ups → ${file}`);
  return { closeups: out.closeups.length, errors: out.errors.slice(0, 10) };
}
