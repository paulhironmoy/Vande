/**
 * VANDE Cricket brand asset generator. Every brand file is drawn from code, so nothing here is traced, licensed or
 * downloaded artwork:
 *   - the mark (hexagon seal around a ball whose seam forms a V) comes from src/ui/brand/mark.ts, the same geometry
 *     the app, the share cards and the highlight overlays draw;
 *   - the wordmark is outlined from Manrope (SIL Open Font License 1.1, the static 700 and 800 weights from the
 *     @fontsource/manrope dev dependency) with fontkit, so the SVGs need no font at runtime;
 *   - the stadium photography in the Open Graph card and the Play feature graphic is a frame from the game's own 3D
 *     renderer (the dev harness replay), composed with the lockup and tagline in Chromium.
 *
 * Run from anywhere in the repo:   npm run assets
 * Needs the Playwright Chromium build (npx playwright install chromium) for the two photographic files. It starts its
 * own Vite dev server on a free local port (to load mark.ts and to serve the harness) and stops it when done.
 *
 * Writes, relative to the repo root:
 *   public/brand        logo, logo-dark, logo-light, logo-mono, lockup, lockup-on-light, lockup-social (SVG)
 *   store-assets        icon-1024.png (Play listing icon), feature-graphic.png (1024 x 500): outside public/, so
 *                       they never ship in the APK or the service-worker precache
 *   public/icons        favicon.svg, favicon-32, icon-192, icon-512, maskable-512, apple-touch-icon (PNG)
 *   public/og           og-card.png (1200 x 630)
 *   android/app/src/main/res
 *                       launcher icons in every mipmap density (legacy, round, adaptive foreground, background and
 *                       monochrome layers), the two adaptive-icon XML files in mipmap-anydpi-v26, and the splash.png
 *                       in every drawable density and orientation (night variants match: the app is always dark)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const FONT_800 = require.resolve('@fontsource/manrope/files/manrope-latin-800-normal.woff2');
const FONT_700 = require.resolve('@fontsource/manrope/files/manrope-latin-700-normal.woff2');

let written = 0;
function write(rel, data) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  written += 1;
}

// ---- wordmark outlines ------------------------------------------------------------------------------------------
const f800 = fontkit.openSync(FONT_800);
const f700 = fontkit.openSync(FONT_700);

/** Outlines `text` set in `font` at `size` px from (x, baseline), with extra `tracking` px between glyphs. */
function textPath(font, text, size, x, baseline, tracking = 0) {
  const s = size / font.unitsPerEm;
  const run = font.layout(text);
  let pen = 0;
  const parts = [];
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    parts.push(g.path.scale(s, -s).translate(x + pen + pos.xOffset * s, baseline - pos.yOffset * s).toSVG());
    pen += pos.xAdvance * s + (i < run.glyphs.length - 1 ? tracking : 0);
  });
  return { d: parts.join(''), width: pen };
}

/** The SVG builders, bound to the mark geometry and brand colours loaded from src/ui/brand/mark.ts. */
function artwork(MARK, C) {
  function markDefs(id) {
    return `<radialGradient id="${id}b" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="${C.indigo}"/><stop offset="0.6" stop-color="${C.night2}"/><stop offset="1" stop-color="${C.night}"/></radialGradient><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.amberLight}"/><stop offset="0.45" stop-color="${C.amber}"/><stop offset="1" stop-color="${C.amberDeep}"/></linearGradient><radialGradient id="${id}w" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#e9e7fb"/><stop offset="1" stop-color="#a9a3e6"/></radialGradient>`;
  }
  function markBody(id, opts = {}) {
    return `<path d="${MARK.hex}" fill="url(#${id}b)" stroke="url(#${id}g)" stroke-width="6" stroke-linejoin="round"/><circle cx="${MARK.ball.cx}" cy="${MARK.ball.cy}" r="${MARK.ball.r}" fill="url(#${id}w)"/><path d="M84 40A33 33 0 0 1 81 86" fill="none" stroke="${C.cyan}" stroke-opacity="0.55" stroke-width="2.2" stroke-linecap="round"/><path d="${MARK.seam}" fill="none" stroke="${C.seam}" stroke-width="6.5" stroke-linecap="round"/>${opts.stitches === false ? '' : `<path d="${MARK.stitches}" fill="none" stroke="${C.seam}" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>`}`;
  }
  /** The mark (120 units) placed at x, y and scaled to `size`. */
  function markAt(id, x, y, size, opts = {}) {
    return `<g transform="translate(${x} ${y}) scale(${size / 120})">${markBody(id, opts)}</g>`;
  }
  /** Closes <defs> and paints the night tile with its amber floodlight glow. */
  function tileBg(id, w, h, rx = 0, glow = true) {
    return `<radialGradient id="${id}t" cx="50%" cy="8%" r="105%"><stop offset="0" stop-color="#372d8f"/><stop offset="0.55" stop-color="${C.night2}"/><stop offset="1" stop-color="${C.night}"/></radialGradient><radialGradient id="${id}f" cx="50%" cy="0%" r="70%"><stop offset="0" stop-color="${C.amber}" stop-opacity="${glow ? 0.42 : 0}"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" rx="${rx}" fill="url(#${id}t)"/><rect width="${w}" height="${h}" rx="${rx}" fill="url(#${id}f)"/>`;
  }
  /** Square icon: the tile (optionally rounded, round or transparent) with the mark at `scale` of the side. */
  function iconSvg(size, scale, o = {}) {
    const id = `i${size}`;
    const m = size * scale;
    const off = (size - m) / 2;
    let bg;
    if (o.transparent) bg = '</defs>';
    else if (o.circle) bg = tileBg(id, size, size, 0).replace(/<rect width="(\d+)" height="(\d+)" rx="0" fill="url\(#(\w+)\)"\/>/g, `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#$3)"/>`);
    else bg = tileBg(id, size, size, o.rx ?? 0);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${markDefs(id)}${bg}${markAt(id, off, off + m * 0.01, m, { stitches: o.stitches })}</svg>`;
  }
  /** The mark alone in its 120-unit box. */
  function logoSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120" role="img" aria-labelledby="t"><title id="t">VANDE Cricket</title><defs>${markDefs('m')}</defs>${markBody('m')}</svg>`;
  }
  /** Horizontal lockup: mark, VANDE (Manrope 800) and CRICKET (Manrope 700, tracked out). */
  function lockupSvg(onLight = false) {
    const vande = textPath(f800, 'VANDE', 100, 150, 86, 6);
    const cricket = textPath(f700, 'CRICKET', 34, 153, 128, 15.5);
    const w = Math.ceil(150 + Math.max(vande.width, cricket.width) + 6);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="140" viewBox="0 0 ${w} 140" role="img" aria-labelledby="t"><title id="t">VANDE Cricket</title><defs>${markDefs('l')}</defs>${markAt('l', 0, 10, 120)}<path d="${vande.d}" fill="${onLight ? C.night : C.chalk}"/><path d="${cricket.d}" fill="${onLight ? C.amberDeep : C.amber}"/></svg>`;
  }
  /** One colour (white) for monochrome uses: the seal outline and the ball, with the seam cut out. */
  function monoSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120" role="img" aria-labelledby="t"><title id="t">VANDE Cricket</title><defs><mask id="m"><rect width="120" height="120" fill="#fff"/><path d="${MARK.seam}" fill="none" stroke="#000" stroke-width="6.5" stroke-linecap="round"/></mask></defs><path d="${MARK.hex}" fill="none" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/><circle cx="${MARK.ball.cx}" cy="${MARK.ball.cy}" r="${MARK.ball.r}" fill="#ffffff" mask="url(#m)"/></svg>`;
  }
  /** 1200 x 630 vector social card (lockup and tagline over the floodlit night). */
  function socialSvg() {
    const W = 1200;
    const H = 630;
    const vande = textPath(f800, 'VANDE', 150, 0, 0, 10);
    const tag = textPath(f700, 'Lock your over. Reveal the rivalry.', 44, 0, 0, 0);
    const left = (W - (200 + 40 + vande.width)) / 2;
    const tv = textPath(f800, 'VANDE', 150, left + 240, 300, 10);
    const tc = textPath(f700, 'CRICKET', 50, left + 245, 372, 23);
    const tt = textPath(f700, 'Lock your over. Reveal the rivalry.', 44, (W - tag.width) / 2, 520, 0);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t"><title id="t">VANDE Cricket. Lock your over. Reveal the rivalry.</title><defs>${markDefs('s')}<radialGradient id="sbg" cx="50%" cy="0%" r="120%"><stop offset="0" stop-color="#2b2378"/><stop offset="0.45" stop-color="#100d36"/><stop offset="1" stop-color="${C.night}"/></radialGradient><radialGradient id="sfl" cx="12%" cy="0%" r="55%"><stop offset="0" stop-color="${C.amber}" stop-opacity="0.38"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient><radialGradient id="sfr" cx="88%" cy="0%" r="55%"><stop offset="0" stop-color="${C.amber}" stop-opacity="0.38"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#sbg)"/><rect width="${W}" height="${H}" fill="url(#sfl)"/><rect width="${W}" height="${H}" fill="url(#sfr)"/><ellipse cx="600" cy="${H + 260}" rx="760" ry="420" fill="#0d3b2c" opacity="0.85"/><ellipse cx="600" cy="${H + 260}" rx="760" ry="420" fill="none" stroke="#3a9a5c" stroke-opacity="0.35" stroke-width="3"/>${markAt('s', left, 175, 200)}<path d="${tv.d}" fill="${C.chalk}"/><path d="${tc.d}" fill="${C.amber}"/><path d="${tt.d}" fill="#cac7ee"/></svg>`;
  }
  /** Android splash: the mark above the stacked wordmark, centred on the floodlit night. */
  function splashSvg(w, h) {
    const s = Math.min(w, h);
    const mark = s * 0.3;
    const vande = textPath(f800, 'VANDE', s * 0.11, 0, 0, s * 0.008);
    const tv = textPath(f800, 'VANDE', s * 0.11, (w - vande.width) / 2, h / 2 + mark * 0.5 + s * 0.12, s * 0.008);
    const cricket = textPath(f700, 'CRICKET', s * 0.04, 0, 0, s * 0.02);
    const tc = textPath(f700, 'CRICKET', s * 0.04, (w - cricket.width) / 2, h / 2 + mark * 0.5 + s * 0.18, s * 0.02);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${markDefs('p')}<radialGradient id="g" cx="50%" cy="0%" r="110%"><stop offset="0" stop-color="#28216f"/><stop offset="0.5" stop-color="#0f0c33"/><stop offset="1" stop-color="${C.night}"/></radialGradient><radialGradient id="f" cx="50%" cy="38%" r="40%"><stop offset="0" stop-color="${C.amber}" stop-opacity="0.18"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#f)"/>${markAt('p', (w - mark) / 2, h / 2 - mark * 0.62, mark)}<path d="${tv.d}" fill="${C.chalk}"/><path d="${tc.d}" fill="${C.amber}"/></svg>`;
  }
  /** Adaptive-icon layers at `L` px: the night tile alone, and the monochrome mark inside the 66dp safe zone. */
  function layerBackgroundSvg(L) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${L}" viewBox="0 0 ${L} ${L}"><defs>${tileBg('bg', L, L)}</svg>`;
  }
  function layerMonochromeSvg(L) {
    const inner = monoSvg().replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/<title[^<]*<\/title>/, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${L}" viewBox="0 0 ${L} ${L}"><g transform="translate(${L * 0.22} ${L * 0.22}) scale(${(L * 0.56) / 120})">${inner}</g></svg>`;
  }
  return { iconSvg, logoSvg, lockupSvg, monoSvg, socialSvg, splashSvg, layerBackgroundSvg, layerMonochromeSvg };
}

// ---- photographic compositions (3D frames + typography, rendered by Chromium) ------------------------------------
const HARNESS_FRAME_MS = 43633; // a floodlit moment of the harness replay: ball in flight, crowd and LED boards lit

async function frame(page, origin, w, h, t) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${origin}/src/screens/dev/harness.html?mode=replay&rmode=full&q=high`);
  await page.waitForFunction(() => window.__h?.ready === true, null, { timeout: 120000 });
  await page.evaluate((ms) => window.__h.renderAt(ms), t);
  await page.waitForTimeout(120);
  const png = await page.screenshot();
  return `data:image/png;base64,${png.toString('base64')}`;
}

function composeHtml(o) {
  const manrope800 = `data:font/woff2;base64,${readFileSync(FONT_800).toString('base64')}`;
  const manrope700 = `data:font/woff2;base64,${readFileSync(FONT_700).toString('base64')}`;
  const grad = o.side === 'right' ? 'linear-gradient(270deg, rgba(6,5,31,0.94) 0%, rgba(6,5,31,0.78) 38%, rgba(6,5,31,0) 72%)' : 'linear-gradient(90deg, rgba(6,5,31,0.94) 0%, rgba(6,5,31,0.78) 38%, rgba(6,5,31,0) 72%)';
  return `<!doctype html><html><head><style>
@font-face{font-family:M;font-weight:800;src:url('${manrope800}')}@font-face{font-family:M;font-weight:700;src:url('${manrope700}')}
html,body{margin:0;width:${o.w}px;height:${o.h}px;overflow:hidden;background:#06051f}
.bg{position:absolute;inset:0;background:url('${o.bg}') center/cover no-repeat}
.shade{position:absolute;inset:0;background:${grad}}
.vig{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(3,2,26,0.55) 100%)}
.copy{position:absolute;top:0;bottom:0;${o.side}:${o.pad}px;width:46%;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(o.h * 0.035)}px;font-family:M,sans-serif}
.lockup{width:100%}
.lockup svg{width:100%;height:auto;display:block}
h1{margin:0;color:#fff;font-weight:800;font-size:${Math.round(o.h * 0.084)}px;line-height:1.08;letter-spacing:-0.01em}
p{margin:0;color:#ffc266;font-weight:700;font-size:${Math.round(o.h * 0.046)}px;letter-spacing:0.02em}
</style></head><body><div class="bg"></div><div class="shade"></div><div class="vig"></div><div class="copy"><div class="lockup">${o.lockup}</div><h1>${o.title}</h1><p>${o.sub}</p></div></body></html>`;
}

/** Renders a harness frame at w x h, lays the lockup and copy over it and returns the screenshot. */
async function photo(page, origin, o) {
  const bg = await frame(page, origin, o.w, o.h, HARNESS_FRAME_MS);
  await page.setViewportSize({ width: o.w, height: o.h });
  await page.setContent(composeHtml({ ...o, bg, side: 'right', title: 'Lock your over.<br/>Reveal the rivalry.' }), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot();
}

// ---- outputs ----------------------------------------------------------------------------------------------------
const png = (svg, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

async function writeVectorAndIcons(art) {
  write('public/brand/logo.svg', art.logoSvg());
  write('public/brand/logo-dark.svg', art.iconSvg(512, 0.8, { rx: 112 }));
  write('public/brand/logo-light.svg', art.logoSvg());
  write('public/brand/logo-mono.svg', art.monoSvg());
  write('public/brand/lockup.svg', art.lockupSvg(false));
  write('public/brand/lockup-on-light.svg', art.lockupSvg(true));
  write('public/brand/lockup-social.svg', art.socialSvg());
  write('public/icons/favicon.svg', art.iconSvg(64, 0.84, { rx: 14, stitches: false }));

  // PWA and browser icons (drawn large, then downsampled).
  write('public/icons/favicon-32.png', await png(art.iconSvg(256, 0.86, { rx: 56, stitches: false }), 32));
  write('public/icons/icon-192.png', await png(art.iconSvg(512, 0.78, { rx: 112 }), 192));
  write('public/icons/icon-512.png', await png(art.iconSvg(1024, 0.78, { rx: 224 }), 512));
  write('public/icons/maskable-512.png', await png(art.iconSvg(1024, 0.6), 512));
  write('public/icons/apple-touch-icon.png', await png(art.iconSvg(1024, 0.72), 180));
  // Play listing icon: a store asset, never shipped in the app.
  write('store-assets/icon-1024.png', await png(art.iconSvg(1024, 0.72), 1024));
}

async function writeAndroid(art) {
  const res = 'android/app/src/main/res';
  // Launcher icons: legacy (48dp), round, and adaptive layers (108dp, the mark inside the 66dp safe zone).
  const legacy = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, px] of Object.entries(legacy)) {
    const big = px * 4;
    write(`${res}/mipmap-${d}/ic_launcher.png`, await png(art.iconSvg(big, 0.78, { rx: big * 0.2 }), px));
    write(`${res}/mipmap-${d}/ic_launcher_round.png`, await png(art.iconSvg(big, 0.72, { circle: true }), px));
    const layer = Math.round((px * 108) / 48);
    const L = layer * 4;
    write(`${res}/mipmap-${d}/ic_launcher_foreground.png`, await png(art.iconSvg(L, 0.56, { transparent: true }), layer));
    write(`${res}/mipmap-${d}/ic_launcher_background.png`, await png(art.layerBackgroundSvg(L), layer));
    write(`${res}/mipmap-${d}/ic_launcher_monochrome.png`, await png(art.layerMonochromeSvg(L), layer));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- VANDE Cricket launcher icon: night tile, the seal mark inside the 66dp safe zone, and a monochrome layer for themed icons. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
  write(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
  write(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);

  // Splash screens in every density and orientation.
  const splashes = [];
  const port = { ldpi: [240, 320], mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  for (const [d, [w, h]] of Object.entries(port)) {
    for (const night of ['', '-night']) {
      splashes.push([`drawable-port${night}-${d}`, w, h]);
      splashes.push([`drawable-land${night}-${d}`, h, w]);
    }
  }
  splashes.push(['drawable', 320, 480], ['drawable-night', 320, 240]);
  for (const [dir, w, h] of splashes) {
    write(`${res}/${dir}/splash.png`, await sharp(Buffer.from(art.splashSvg(w, h))).png({ compressionLevel: 9 }).toBuffer());
  }
}

async function writePhotographic(art, origin) {
  // Chromium needs real WebGL for the stadium: Metal on macOS, SwiftShader elsewhere.
  const args = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ args });
  try {
    const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
    const lockup = art.lockupSvg(false);
    // Play feature graphic: drawn at 2x, delivered at 1024 x 500.
    const feature = await photo(page, origin, { w: 2048, h: 1000, lockup, sub: 'One-over cricket duels with friends', pad: 150 });
    write('store-assets/feature-graphic.png', await sharp(feature).resize(1024, 500).png({ compressionLevel: 9 }).toBuffer());
    // Open Graph card: drawn at 2x, quantised (dithered) so link previews load fast on mobile data.
    const og = await photo(page, origin, { w: 2400, h: 1260, lockup, sub: 'Sealed Six · play in your browser', pad: 170 });
    write('public/og/og-card.png', await sharp(og).resize(1200, 630).png({ palette: true, quality: 95, effort: 10, dither: 0.8, compressionLevel: 9 }).toBuffer());
  } finally {
    await browser.close();
  }
}

async function main() {
  const started = Date.now();
  // One Vite dev server loads the TypeScript mark and serves the 3D harness; no watcher, no HMR, its own cache.
  const server = await createServer({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    cacheDir: join(ROOT, 'node_modules/.vite-brand'),
    logLevel: 'warn',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  });
  try {
    const { MARK, BRAND_COLORS } = await server.ssrLoadModule('/src/ui/brand/mark.ts');
    const art = artwork(MARK, BRAND_COLORS);
    await writeVectorAndIcons(art);
    await writeAndroid(art);
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('The Vite dev server did not report a port');
    await writePhotographic(art, `http://127.0.0.1:${address.port}`);
  } finally {
    await server.close();
  }
  console.log(`brand assets written: ${written} files in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
