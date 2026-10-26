/**
 * Root app store types — ROOT-OWNED. Only cross-cutting UI state lives here (settings, the player on this device,
 * toasts, connectivity). Workstream state lives in each workstream's own store (session/sync in src/net, screens in
 * src/screens).
 */
import type { AvatarSpec, KitSpec, LocaleId, PlayerRef } from '@/contracts';

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';
export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface Settings {
  locale: LocaleId;
  reducedMotion: 'system' | 'on' | 'off';
  sound: boolean;
  haptics: boolean;
  /** 3D quality; 'auto' lets the renderer pick from device capability and measured frame time. */
  quality: 'auto' | 'low' | 'standard' | 'high';
  textScale: 1 | 1.15 | 1.3;
  highContrast: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: 'en',
  reducedMotion: 'system',
  sound: true,
  haptics: true,
  quality: 'auto',
  textScale: 1,
  highContrast: false,
};

/**
 * The player on this device, chosen at onboarding. Local modes work with it offline; `id` is the server player id
 * once the guest account exists (null before that, or in offline-only builds).
 */
export interface LocalPlayer {
  id: string | null;
  alias: string;
  avatar: AvatarSpec;
  kit: KitSpec;
}

export interface AppState {
  settings: Settings;
  player: LocalPlayer | null;
  /** Effective reduced motion (settings resolved against the system preference). */
  reducedMotion: boolean;
  online: boolean;
  /**
   * True while an innings or the planner is on screen. Nothing may interrupt then: no update prompt, no permission
   * request, no promotion (and never an ad).
   */
  inPlay: boolean;
  toasts: Toast[];
  updateSettings(patch: Partial<Settings>): void;
  /** Sets or updates the local player (null forgets it, e.g. after deleting the account). */
  setPlayer(player: LocalPlayer | null): void;
  setOnline(online: boolean): void;
  setInPlay(inPlay: boolean): void;
  toast(t: Omit<Toast, 'id'>): string;
  dismissToast(id: string): void;
}

/** The local player as a PlayerRef for local matches (Training, Practice Ghosts) and previews. */
export function localPlayerRef(p: LocalPlayer): PlayerRef {
  return { id: p.id ?? 'local', alias: p.alias, avatar: p.avatar, kit: p.kit, kind: 'human' };
}
