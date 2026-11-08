/**
 * Root app store — ROOT-OWNED (Zustand). Settings and the local player persist in localStorage; everything else is
 * in-memory.
 */
import { create } from 'zustand';
import type { LocaleId } from '@/contracts';
import { localeInfo, matchLocale } from '@/i18n/locales';
import { DEFAULT_SETTINGS, TEXT_SCALES, type AppState, type LocalPlayer, type Settings } from './storeTypes';

const SETTINGS_KEY = 'vc:settings';
const PLAYER_KEY = 'vc:player';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function systemPrefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

function resolveReducedMotion(settings: Settings, systemReduced = systemPrefersReducedMotion()): boolean {
  if (settings.reducedMotion === 'on') return true;
  if (settings.reducedMotion === 'off') return false;
  return systemReduced;
}

/**
 * First-run language from the device: a production-quality locale the device prefers (Hindi phones start in Hindi);
 * machine-drafted locales are offered in the picker but never chosen automatically.
 */
export function deviceLocale(preferred: readonly string[] | undefined = typeof navigator === 'undefined' ? undefined : navigator.languages): LocaleId {
  const list = preferred && preferred.length ? preferred : typeof navigator !== 'undefined' && navigator.language ? [navigator.language] : [];
  const match = matchLocale(list);
  return localeInfo(match).status === 'machine_draft' ? 'en' : match;
}

/** Keeps supported persisted settings while migrating unknown/legacy text-size values to the safe default. */
export function normalizeSettings(value: unknown): Settings {
  const saved = typeof value === 'object' && value !== null ? value as Partial<Settings> : {};
  const textScale = TEXT_SCALES.some((choice) => choice === saved.textScale)
    ? saved.textScale as Settings['textScale']
    : DEFAULT_SETTINGS.textScale;
  return { ...DEFAULT_SETTINGS, ...saved, textScale };
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return { ...DEFAULT_SETTINGS, locale: deviceLocale() };
}

function loadPlayer(): LocalPlayer | null {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LocalPlayer>;
    if (typeof p.alias !== 'string' || !p.avatar || !p.kit) return null;
    return { id: typeof p.id === 'string' ? p.id : null, alias: p.alias, avatar: p.avatar, kit: p.kit };
  } catch {
    return null;
  }
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => {
  const settings = loadSettings();
  return {
    settings,
    player: loadPlayer(),
    reducedMotion: resolveReducedMotion(settings),
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    inPlay: false,
    toasts: [],
    updateSettings(patch) {
      const next = { ...get().settings, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      set({ settings: next, reducedMotion: resolveReducedMotion(next) });
    },
    setPlayer(player) {
      try {
        if (player) localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
        else localStorage.removeItem(PLAYER_KEY);
      } catch {
        /* ignore */
      }
      set({ player });
    },
    setOnline(online) {
      set({ online });
    },
    setInPlay(inPlay) {
      if (get().inPlay !== inPlay) set({ inPlay });
    },
    toast(t) {
      const id = `t${++toastSeq}`;
      set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
      return id;
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((x) => x.id !== id) });
    },
  };
});
