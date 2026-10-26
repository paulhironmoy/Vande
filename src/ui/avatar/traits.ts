/**
 * Deterministic, original avatar traits from a seed. The same traits drive the 2D portrait (Avatar) and the 3D
 * player, so a player looks like themselves everywhere. No uploads, no likenesses, no real people.
 */
import type { KitSpec } from '@/contracts';

export interface AvatarTraits {
  skin: string;
  skinShade: string;
  hair: string;
  hairStyle: 'crop' | 'wavy' | 'curly' | 'side_part' | 'tied' | 'shaved';
  beard: 'none' | 'stubble' | 'moustache' | 'short' | 'full';
  brow: 'soft' | 'straight' | 'bold';
  eyes: 'round' | 'almond' | 'narrow';
  face: 'oval' | 'round' | 'square' | 'long';
  headwear: 'none' | 'cap' | 'band' | 'patka';
  expression: 'smile' | 'grin' | 'focused';
  /** Body height scale for the 3D player. */
  height: number;
  /** Background accent angle for the portrait. */
  hue: number;
}

/** A range of Indian skin tones, light to deep. */
const SKINS: Array<[string, string]> = [
  ['#f0caa6', '#d9ab84'],
  ['#e4b58f', '#c89670'],
  ['#d7a07a', '#b9825d'],
  ['#c88a63', '#a96d49'],
  ['#b4764f', '#94593a'],
  ['#9d6340', '#7e4b2e'],
  ['#865436', '#683e25'],
  ['#6f452c', '#52301d'],
];
const HAIR = ['#0f0c0e', '#17110f', '#211712', '#2c1f17', '#3a2a1f', '#58504a'];

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length];
}

export function seededRandom(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, AvatarTraits>();

export function avatarTraits(seed: string): AvatarTraits {
  const hit = cache.get(seed);
  if (hit) return hit;
  const r = seededRandom(`avatar:${seed}`);
  const [skin, skinShade] = pick(SKINS, r());
  const hairStyle = pick(['crop', 'wavy', 'curly', 'side_part', 'tied', 'shaved'] as const, r());
  const traits: AvatarTraits = {
    skin,
    skinShade,
    hair: hairStyle === 'shaved' ? pick(HAIR.slice(0, 3), r()) : r() > 0.93 ? HAIR[5] : pick(HAIR.slice(0, 5), r()),
    hairStyle,
    beard: pick(['none', 'none', 'stubble', 'moustache', 'short', 'full'] as const, r()),
    brow: pick(['soft', 'straight', 'bold'] as const, r()),
    eyes: pick(['round', 'almond', 'narrow'] as const, r()),
    face: pick(['oval', 'round', 'square', 'long'] as const, r()),
    headwear: r() > 0.9 ? 'patka' : pick(['none', 'none', 'cap', 'band'] as const, r()),
    expression: pick(['smile', 'grin', 'focused'] as const, r()),
    height: 0.95 + r() * 0.1,
    hue: Math.floor(r() * 360),
  };
  cache.set(seed, traits);
  return traits;
}

/** A fresh random seed for "New look" (UI only; the result is stored, never re-rolled silently). */
export function newAvatarSeed(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  const buf = new Uint32Array(2);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(buf);
  else {
    buf[0] = Math.floor(Math.random() * 2 ** 32);
    buf[1] = Math.floor(Math.random() * 2 ** 32);
  }
  return `${buf[0].toString(36)}${buf[1].toString(36)}`;
}

/** Original kit palettes (no real team colour schemes). Cosmetic only. */
/**
 * Starter kits: original combinations of the server's starter palette (src/net/shared/kits.ts accepts only id
 * "starter", two different palette colours and a pattern). Cosmetic only, never an outcome input.
 */
export const KITS: readonly KitSpec[] = [
  { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' },
  { id: 'starter', primary: '#FFB020', secondary: '#14161F', pattern: 'sash' },
  { id: 'starter', primary: '#0E7C86', secondary: '#C9A227', pattern: 'hoops' },
  { id: 'starter', primary: '#FF6B9A', secondary: '#1E2A78', pattern: 'stripes' },
  { id: 'starter', primary: '#2EAD5B', secondary: '#F5F5F0', pattern: 'plain' },
  { id: 'starter', primary: '#FF7A1A', secondary: '#14161F', pattern: 'chevron' },
  { id: 'starter', primary: '#7C4DFF', secondary: '#F5F5F0', pattern: 'sash' },
  { id: 'starter', primary: '#E5484D', secondary: '#FFB020', pattern: 'hoops' },
];

export function kitForSeed(seed: string): KitSpec {
  return KITS[hash(`kit:${seed}`) % KITS.length];
}
