/**
 * Starter kits and generated avatars. Cosmetic only (never an outcome input). Original colours and patterns, no
 * real team kit. Paid or unlocked kits will use other ids and be validated against the player's inventory.
 */
import type { KitSpec } from '@/contracts';

export const KIT_PALETTE = ['#1E2A78', '#00B8D9', '#FFB020', '#E5484D', '#2EAD5B', '#7C4DFF', '#FF6B9A', '#F5F5F0', '#14161F', '#FF7A1A', '#0E7C86', '#C9A227'] as const;
export const KIT_PATTERNS: readonly KitSpec['pattern'][] = ['plain', 'stripes', 'hoops', 'chevron', 'sash'];
export const STARTER_KIT_ID = 'starter';

/** Avatar seeds: 8–32 lowercase letters and digits (the renderer derives an original face and colours from it). */
export const AVATAR_SEED_RE = /^[a-z0-9]{8,32}$/;

/** A starter kit chosen by the given random bytes (two different palette colours and a pattern). */
export function starterKit(random: Uint8Array): KitSpec {
  const primary = KIT_PALETTE[random[0] % KIT_PALETTE.length];
  let secondary = KIT_PALETTE[random[1] % KIT_PALETTE.length];
  if (secondary === primary) secondary = KIT_PALETTE[(random[1] + 1) % KIT_PALETTE.length];
  return { id: STARTER_KIT_ID, primary, secondary, pattern: KIT_PATTERNS[random[2] % KIT_PATTERNS.length] };
}

export function isValidKit(kit: unknown): kit is KitSpec {
  if (!kit || typeof kit !== 'object') return false;
  const k = kit as Record<string, unknown>;
  const keys = Object.keys(k).sort().join(',');
  if (keys !== 'id,pattern,primary,secondary') return false;
  if (k.id !== STARTER_KIT_ID) return false;
  const palette = KIT_PALETTE as readonly string[];
  if (typeof k.primary !== 'string' || typeof k.secondary !== 'string' || !palette.includes(k.primary) || !palette.includes(k.secondary)) return false;
  if (k.primary === k.secondary) return false;
  return KIT_PATTERNS.includes(k.pattern as KitSpec['pattern']);
}
