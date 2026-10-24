/**
 * VANDE brand geometry — single source of truth for every logo variant.
 * Used by scripts/generate-assets.mjs (SVG + raster output) and mirrored by src/components/brand/Logo.tsx.
 *
 * Mark: two opposing arcs held in balance (a "V" silhouette), a dynamic equilibrium beam resting across them,
 * a fulcrum point, and a quiet 24-point rhythm of short ticks on the outer rim (ticks, not spokes — this is not a wheel).
 * ViewBox 0 0 256 256. Centre (128,128).
 */

export const VIEW = 256;
export const ARM_LEFT = 'M62 78C70 128 92 164 128 190';
export const ARM_RIGHT = 'M194 78C186 128 164 164 128 190';
export const BEAM = 'M46 108H210';
export const FULCRUM = { cx: 128, cy: 108, r: 7.5 };
export const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = ((i * 15 - 90) * Math.PI) / 180;
  const r1 = 110;
  const r2 = 118;
  return {
    x1: +(128 + r1 * Math.cos(a)).toFixed(2),
    y1: +(128 + r1 * Math.sin(a)).toFixed(2),
    x2: +(128 + r2 * Math.cos(a)).toFixed(2),
    y2: +(128 + r2 * Math.sin(a)).toFixed(2),
  };
});

export const PALETTE = {
  midnight: '#07111F',
  navy: '#0B1D36',
  graphite: '#111820',
  blue: '#136EF6',
  electric: '#38A0FF',
  cyan: '#62D6FF',
  paper: '#F7F9FC',
  steel: '#AAB6C8',
};

/**
 * Returns the inner markup of the mark (no <svg> wrapper).
 * @param {'dark'|'light'|'mono'} variant
 * @param {{ id?: string, ticks?: boolean }} opts
 */
export function markInner(variant = 'dark', opts = {}) {
  const id = opts.id ?? 'vande';
  const ticks = opts.ticks ?? true;
  let defs = '';
  let armStroke;
  let beamStroke;
  let fulcrumFill;
  let tickStroke;
  let tickOpacity = 0.32;
  if (variant === 'dark') {
    defs = `<defs><linearGradient id="${id}-g" x1="46" y1="78" x2="210" y2="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${PALETTE.cyan}"/><stop offset="0.55" stop-color="${PALETTE.electric}"/><stop offset="1" stop-color="${PALETTE.blue}"/></linearGradient></defs>`;
    armStroke = `url(#${id}-g)`;
    beamStroke = PALETTE.cyan;
    fulcrumFill = PALETTE.paper;
    tickStroke = PALETTE.steel;
  } else if (variant === 'light') {
    armStroke = PALETTE.navy;
    beamStroke = PALETTE.blue;
    fulcrumFill = PALETTE.blue;
    tickStroke = PALETTE.navy;
    tickOpacity = 0.3;
  } else {
    armStroke = 'currentColor';
    beamStroke = 'currentColor';
    fulcrumFill = 'currentColor';
    tickStroke = 'currentColor';
    tickOpacity = 0.35;
  }
  const tickMarkup = ticks
    ? `<g class="ticks" stroke="${tickStroke}" stroke-width="3.5" stroke-linecap="round" opacity="${tickOpacity}">${TICKS.map(
        (t) => `<line x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"/>`,
      ).join('')}</g>`
    : '';
  return (
    defs +
    tickMarkup +
    `<g class="arms" fill="none" stroke="${armStroke}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">` +
    `<path class="armLeft" d="${ARM_LEFT}"/><path class="armRight" d="${ARM_RIGHT}"/></g>` +
    `<path class="beam" d="${BEAM}" fill="none" stroke="${beamStroke}" stroke-width="12" stroke-linecap="round"/>` +
    `<circle class="fulcrum" cx="${FULCRUM.cx}" cy="${FULCRUM.cy}" r="${FULCRUM.r}" fill="${fulcrumFill}"/>`
  );
}

/** Standalone SVG document for a variant. */
export function markSvg(variant, size = VIEW, opts = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${size}" height="${size}" role="img" aria-labelledby="vande-title">` +
    `<title id="vande-title">VANDE</title>` +
    markInner(variant, { id: `vande-${variant}`, ...opts }) +
    `</svg>`
  );
}

/**
 * Monoline "VANDE" wordmark drawn as strokes (font independent). Cap height 100, stroke 16, round caps.
 * Returns { d, width } where d is a path string at origin (0,0)->(width,100).
 */
export function wordmarkPath() {
  const gap = 30;
  const letters = [];
  let x = 0;
  // V
  letters.push(`M${x} 0L${x + 42} 100L${x + 84} 0`);
  x += 84 + gap;
  // A
  letters.push(`M${x} 100L${x + 42} 0L${x + 84} 100M${x + 18} 62H${x + 66}`);
  x += 84 + gap;
  // N
  letters.push(`M${x} 100V0L${x + 80} 100V0`);
  x += 80 + gap;
  // D
  letters.push(`M${x} 0V100M${x} 0H${x + 28}A50 50 0 0 1 ${x + 28} 100H${x}`);
  x += 78 + gap;
  // E
  letters.push(`M${x + 66} 0H${x}V100H${x + 66}M${x} 50H${x + 56}`);
  x += 66;
  return { d: letters.join(''), width: x, height: 100 };
}
