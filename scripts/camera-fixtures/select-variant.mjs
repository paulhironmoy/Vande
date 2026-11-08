/**
 * Picks the kit and skin variant the whole fixture set is rendered with, from a detection run over the same drive in four looks
 * (scripts/camera-fixtures/measure-detection.mjs -> detection-summary.json). The rule is written down so the choice is not a taste:
 * the best score is the share of frames with a valid pose minus a fifth of the mean wrist error in shoulder widths; a look within
 * 0.02 of the best that wears the hero's own skin (young_african_male) wins, because it keeps the fixtures closest to the game's
 * character; otherwise the best score wins.
 *
 *   node scripts/camera-fixtures/select-variant.mjs <detection-summary.json>     prints "<suit> <skin> <name>"
 */
import { readFileSync } from 'node:fs';

export const VARIANTS = {
  navy_dark: { suit: 'male_casualsuit02', skin: 'young_african_male', hero: true },
  navy_mid: { suit: 'male_casualsuit02', skin: 'young_asian_male', hero: false },
  tee_dark: { suit: 'male_worksuit01', skin: 'young_african_male', hero: true },
  tee_mid: { suit: 'male_worksuit01', skin: 'young_asian_male', hero: false },
};

export function score(m) {
  const wrists = ['wristL', 'wristR'].map((k) => m.landmarks?.[k]?.rmsU).filter((v) => Number.isFinite(v));
  const err = wrists.length ? wrists.reduce((a, b) => a + b, 0) / wrists.length : 1;
  return (m.validRate ?? 0) - 0.2 * err;
}

export function select(summary) {
  const rows = Object.entries(VARIANTS)
    .filter(([name]) => summary.clips?.[name])
    .map(([name, v]) => ({ name, ...v, score: score(summary.clips[name]) }));
  if (!rows.length) throw new Error('no variant was measured');
  const best = Math.max(...rows.map((r) => r.score));
  const hero = rows.filter((r) => r.hero && best - r.score <= 0.02).sort((a, b) => b.score - a.score)[0];
  return hero ?? rows.sort((a, b) => b.score - a.score)[0];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const w = select(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log(`${w.suit} ${w.skin} ${w.name}`);
}
