#!/usr/bin/env node
/**
 * Generates every VANDE brand asset from scripts/brand.mjs:
 *  - public/brand/logo-{dark,light,mono}.svg, lockup-social.svg
 *  - public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon,favicon-32}.png, favicon.svg
 *  - public/og/og-card.png (1200x630)
 *  - resources/{icon-only,icon-foreground,icon-background,splash,splash-dark}.png for @capacitor/assets
 * Usage: node scripts/generate-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PALETTE, VIEW, markInner, markSvg, wordmarkPath } from './brand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => join(root, ...p);

const FONT_STACK = `'Manrope Variable','Manrope','Avenir Next','Helvetica Neue',Arial,sans-serif`;

function bgDefs(id, w, h) {
  return (
    `<defs>` +
    `<radialGradient id="${id}-bg" cx="50%" cy="-10%" r="120%" gradientUnits="objectBoundingBox">` +
    `<stop offset="0" stop-color="#122B52"/><stop offset="0.38" stop-color="${PALETTE.navy}"/><stop offset="1" stop-color="${PALETTE.midnight}"/>` +
    `</radialGradient>` +
    `<pattern id="${id}-grid" width="${Math.round(w / 24)}" height="${Math.round(w / 24)}" patternUnits="userSpaceOnUse">` +
    `<path d="M ${Math.round(w / 24)} 0 L 0 0 0 ${Math.round(w / 24)}" fill="none" stroke="${PALETTE.cyan}" stroke-opacity="0.045" stroke-width="1"/>` +
    `</pattern>` +
    `<radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${PALETTE.electric}" stop-opacity="0.28"/><stop offset="1" stop-color="${PALETTE.electric}" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${id}-bg)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#${id}-grid)"/>`
  );
}

/** Square canvas with midnight gradient and the mark centred at `scale` of the canvas. */
function squareSvg(size, scale, { transparent = false, ticks = true, radius = 0, glow = true } = {}) {
  const m = size * scale;
  const off = (size - m) / 2;
  const id = `sq${size}`;
  const bg = transparent
    ? ''
    : bgDefs(id, size, size) +
      (glow ? `<circle cx="${size / 2}" cy="${size * 0.5}" r="${size * 0.42}" fill="url(#${id}-glow)"/>` : '');
  const clip =
    radius > 0
      ? `<clipPath id="${id}-clip"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></clipPath>`
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs>${clip}</defs>` +
    `<g ${radius > 0 ? `clip-path="url(#${id}-clip)"` : ''}>${bg}` +
    `<g transform="translate(${off} ${off}) scale(${m / VIEW})">${markInner('dark', { id: `${id}-m`, ticks })}</g>` +
    `</g></svg>`
  );
}

function lockupSvg() {
  const w = 1200;
  const h = 630;
  const id = 'lockup';
  const mark = 380;
  const markX = 110;
  const markY = (h - mark) / 2;
  const { d, width } = wordmarkPath();
  const wmScale = 1.08;
  const wmX = 560;
  const wmY = 196;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="lk-t">` +
    `<title id="lk-t">VANDE — Republic Under Pressure. Freedom. Order. Your Move.</title>` +
    bgDefs(id, w, h) +
    `<circle cx="${markX + mark / 2}" cy="${markY + mark / 2}" r="${mark * 0.62}" fill="url(#${id}-glow)"/>` +
    `<g transform="translate(${markX} ${markY}) scale(${mark / VIEW})">${markInner('dark', { id: 'lk-m' })}</g>` +
    `<g transform="translate(${wmX} ${wmY}) scale(${wmScale})"><path d="${d}" fill="none" stroke="${PALETTE.paper}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    `<text x="${wmX + 2}" y="${wmY + 100 * wmScale + 62}" font-family="${FONT_STACK}" font-weight="700" font-size="30" letter-spacing="7" fill="${PALETTE.cyan}">REPUBLIC UNDER PRESSURE</text>` +
    `<path d="M${wmX + 2} ${wmY + 100 * wmScale + 108}H${wmX + 2 + width * wmScale}" stroke="${PALETTE.steel}" stroke-opacity="0.28" stroke-width="2"/>` +
    `<text x="${wmX + 2}" y="${wmY + 100 * wmScale + 168}" font-family="${FONT_STACK}" font-weight="500" font-size="40" fill="${PALETTE.paper}">Freedom. Order. Your Move.</text>` +
    `<text x="${wmX + 2}" y="${wmY + 100 * wmScale + 216}" font-family="${FONT_STACK}" font-weight="500" font-size="22" fill="${PALETTE.steel}">An independent civic-strategy game · Play free · Works offline</text>` +
    `</svg>`
  );
}

function faviconSvg() {
  // Simplified mark (no ticks) on a rounded midnight tile — legible at 16–32 px.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 256 256">` +
    `<rect width="256" height="256" rx="56" fill="${PALETTE.midnight}"/>` +
    `<g transform="translate(20 20) scale(0.84375)">${markInner('dark', { id: 'fav', ticks: false })}</g>` +
    `</svg>`
  );
}

async function png(svg, file, opts = {}) {
  await mkdir(dirname(file), { recursive: true });
  const buf = await sharp(Buffer.from(svg), { density: opts.density ?? 144 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(file, buf);
  const kb = (buf.length / 1024).toFixed(1);
  console.log(`✓ ${file.replace(root + '/', '')} (${kb} kB)`);
}

async function svgFile(svg, file) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, svg + '\n');
  console.log(`✓ ${file.replace(root + '/', '')}`);
}

async function main() {
  // Vector brand files
  await svgFile(markSvg('dark'), out('public/brand/logo-dark.svg'));
  await svgFile(markSvg('light'), out('public/brand/logo-light.svg'));
  await svgFile(markSvg('mono'), out('public/brand/logo-mono.svg'));
  await svgFile(lockupSvg(), out('public/brand/lockup-social.svg'));
  await svgFile(faviconSvg(), out('public/icons/favicon.svg'));

  // PWA / web icons
  await png(squareSvg(192, 0.72), out('public/icons/icon-192.png'));
  await png(squareSvg(512, 0.72), out('public/icons/icon-512.png'));
  await png(squareSvg(512, 0.58), out('public/icons/maskable-512.png')); // safe zone: mark stays inside the central 80%
  await png(squareSvg(180, 0.72), out('public/icons/apple-touch-icon.png'));
  await png(squareSvg(32, 0.84, { ticks: false, radius: 7, glow: false }), out('public/icons/favicon-32.png'));

  // Social card
  await png(lockupSvg(), out('public/og/og-card.png'));

  // Capacitor assets sources (resources/)
  await png(squareSvg(1024, 0.72), out('resources/icon-only.png'));
  await png(squareSvg(1024, 0.56, { transparent: true }), out('resources/icon-foreground.png')); // inside the 66% adaptive safe zone
  await png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bgDefs('ibg', 1024, 1024)}</svg>`,
    out('resources/icon-background.png'),
  );
  const splash =
    `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">` +
    bgDefs('spl', 2732, 2732) +
    `<circle cx="1366" cy="1366" r="620" fill="url(#spl-glow)"/>` +
    `<g transform="translate(${(2732 - 520) / 2} ${(2732 - 520) / 2}) scale(${520 / VIEW})">${markInner('dark', { id: 'spl-m' })}</g>` +
    `</svg>`;
  await png(splash, out('resources/splash.png'));
  await png(splash, out('resources/splash-dark.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
