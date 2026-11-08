#!/usr/bin/env node
/**
 * Contact sheets for VC17 clips (evidence, not certification): side and front stick figures of the DECODED clip,
 * sampled evenly, with the ground line, the contact bits and the planted foot points. Writes one SVG per clip.
 *
 *   node scripts/motion/contact-sheet.mjs <pack.vmp> <out-dir> [clip ...] [--frames 12]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTACT, createPoseOut, parsePack, sampleMotion } from './vmp.ts';
import { B, FOOT_POINTS, PARENT, fkPose } from './metrics.mjs';

const LIMB = { L: '#1f6fd1', R: '#d1531f', C: '#333' };
const SIDE_OF = (i) => ([5, 6, 7, 11, 12, 13].includes(i) ? 'L' : [8, 9, 10, 14, 15, 16].includes(i) ? 'R' : 'C');

function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export function sheet(clip, frames = 12) {
  const pose = createPoseOut();
  const ground = { x: 0, z: 0, yawDeg: 0 };
  const cellW = 150;
  const cellH = 230;
  const scale = 100; // px per metre
  const cols = Math.min(frames, 6);
  const bands = Math.ceil(frames / cols);
  const rows = 2 * bands;
  const W = cols * cellW;
  const H = rows * cellH + 40;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica,Arial,sans-serif">`, `<rect width="${W}" height="${H}" fill="#fafaf7"/>`];
  out.push(`<text x="8" y="22" font-size="13" fill="#111">${clip.name}${clip.mirrored ? ' (mirror)' : ''}: ${clip.duration.toFixed(3)} s, ${clip.rate} Hz, ${clip.loop ? 'loop' : 'one-shot'}. Side view (moving right) above front view. Blue left, orange right, green dots touching.</text>`);
  const span = clip.loop ? clip.duration : clip.duration;
  for (let k = 0; k < frames; k++) {
    const t = clip.loop ? (k / frames) * span : (k / (frames - 1)) * span;
    const r = sampleMotion(clip, t, pose, ground);
    const { P, W: Wq } = fkPose(pose.q, pose.root, ground);
    for (const [row, view] of [
      [0, 'side'],
      [1, 'front'],
    ]) {
      const col = k % cols;
      const band = Math.floor(k / cols);
      const ox = col * cellW + cellW / 2;
      const oy = 40 + (band * 2 + row) * cellH + cellH - 20;
      // Centre on the hips' ground point; side view: +Z to the right; front view: the character faces the viewer, +X to the right.
      const cx = view === 'side' ? P[0][2] : P[0][0];
      const proj = (p) => [ox + (view === 'side' ? p[2] - cx : p[0] - cx) * scale, oy - p[1] * scale];
      out.push(`<line x1="${col * cellW + 4}" y1="${oy}" x2="${(col + 1) * cellW - 4}" y2="${oy}" stroke="#999" stroke-width="1"/>`);
      const order = view === 'side' ? [...Array(17).keys()].sort((a, b) => (SIDE_OF(a) === 'R' ? -1 : 0) - (SIDE_OF(b) === 'R' ? -1 : 0)) : [...Array(17).keys()];
      for (const i of order) {
        if (PARENT[i] < 0) continue;
        const a = proj(P[PARENT[i]]);
        const b = proj(P[i]);
        out.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${LIMB[SIDE_OF(i)]}" stroke-width="3" stroke-linecap="round"/>`);
      }
      // Head and feet.
      const hd = proj([P[B.head][0], P[B.head][1] + 0.1, P[B.head][2]]);
      out.push(`<circle cx="${hd[0].toFixed(1)}" cy="${hd[1].toFixed(1)}" r="9" fill="none" stroke="#333" stroke-width="2"/>`);
      for (const [bone, bit] of [
        [B.footL, CONTACT.footL],
        [B.footR, CONTACT.footR],
      ]) {
        const pts = Object.values(FOOT_POINTS).map((v) => {
          const w = qrot(Wq[bone], v);
          return [P[bone][0] + w[0], P[bone][1] + w[1], P[bone][2] + w[2]];
        });
        const pa = proj(pts[0]);
        const pb = proj(pts[2]);
        out.push(`<line x1="${pa[0].toFixed(1)}" y1="${pa[1].toFixed(1)}" x2="${pb[0].toFixed(1)}" y2="${pb[1].toFixed(1)}" stroke="${LIMB[bone === B.footL ? 'L' : 'R']}" stroke-width="3"/>`);
        if (r.contacts & bit)
          for (const p of pts)
            if (p[1] < 0.012) {
              const q = proj(p);
              out.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="2.5" fill="#0a0"/>`);
            }
      }
      if (row === 1) out.push(`<text x="${col * cellW + 6}" y="${oy + 15}" font-size="11" fill="#444">t=${t.toFixed(3)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

function main(argv) {
  const fi = argv.indexOf('--frames');
  const frames = fi >= 0 ? Number(argv[fi + 1]) : 12;
  const rest = argv.filter((_, i) => fi < 0 || (i !== fi && i !== fi + 1));
  const [file, dir, ...names] = rest;
  const pack = parsePack(readFileSync(file));
  mkdirSync(dir, { recursive: true });
  for (const [name, clip] of pack.clips) {
    if (names.length && !names.includes(name)) continue;
    if (!names.length && clip.mirrored) continue;
    writeFileSync(join(dir, `${name}.svg`), sheet(clip, frames));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
