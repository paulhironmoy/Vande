/**
 * Where translations come from. Two sources are merged per locale, each owned by one workstream:
 *
 *   app      src/i18n/catalogs/<locale>.ts    experience (screens, shell, share cards, highlights)
 *   engine   src/i18n/engine/<locale>.json    gameplay (cricket vocabulary, hints, ghosts, explanations, commentary)
 *
 * The social workstream keeps its own catalogs (src/i18n/social/<locale>.ts, keys `social.*` and `banter.*`) and its
 * own hook built on formatMessage, LOCALES and matchLocale; `loadSource('social', locale)` code-splits them for it
 * (its English is bundled by that hook). Those prefixes are reserved for it and never merged into the app translator.
 *
 * A key belongs to exactly one source (tests/unit/ui/i18n-sources.test.ts fails on duplicates and on keys outside a
 * source's reserved prefixes). Everything except the English app catalog is code-split and loaded on demand; a key
 * missing in a locale falls back to that source's English, so an incomplete translation never shows a raw key.
 */
import type { LocaleId } from '@/contracts';
import { en } from './catalogs/en';

export type FlatCatalog = Record<string, string>;
/** `social` is only loaded on request (the social workstream's own hook); the app translator merges app + engine. */
export type SourceId = 'app' | 'engine' | 'social';

type Loader = () => Promise<unknown>;

const appLoaders = import.meta.glob(['./catalogs/*.ts', '!./catalogs/en.ts']) as Record<string, Loader>;
const engineLoaders = import.meta.glob('./engine/*.json') as Record<string, Loader>;
const socialLoaders = import.meta.glob(['./social/*.ts', '!./social/en.ts']) as Record<string, Loader>;

const LOADERS: Record<SourceId, Record<string, Loader>> = { app: appLoaders, engine: engineLoaders, social: socialLoaders };

/** Prefixes reserved for the social workstream's own catalogs (gameplay's are whatever its English JSON uses). */
export const SOCIAL_PREFIXES = ['social', 'banter'] as const;

function localeOf(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.(ts|json)$/, '');
}

/** Locales a source has a file for. */
export function sourceLocales(source: SourceId): string[] {
  const list = Object.keys(LOADERS[source]).map(localeOf);
  return source === 'app' ? ['en', ...list] : list;
}

/** A module's catalog: its default export (or, failing that, its first plain-object export). */
export function catalogFromModule(mod: unknown): FlatCatalog | null {
  if (!mod || typeof mod !== 'object') return null;
  const m = mod as Record<string, unknown>;
  const pick = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as FlatCatalog) : null);
  const def = pick(m.default);
  if (def) return def;
  for (const v of Object.values(m)) {
    const c = pick(v);
    if (c) return c;
  }
  return null;
}

const cache = new Map<string, Promise<FlatCatalog | null>>();
/** Settled loads: catalog, or null when the source has no file for the locale. */
const settled = new Map<string, FlatCatalog | null>([['app:en', en as unknown as FlatCatalog]]);
const listeners = new Set<() => void>();

/** Called whenever another source catalog finishes loading (the provider re-renders with it). */
export function onSourceLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** A source catalog if it has already loaded: the catalog, null (no file), or undefined (not loaded yet). */
export function loadedSource(source: SourceId, locale: string): FlatCatalog | null | undefined {
  return settled.get(`${source}:${locale}`);
}

/** One source's catalog for one locale (null when that source has no file for it). */
export function loadSource(source: SourceId, locale: string): Promise<FlatCatalog | null> {
  const id = `${source}:${locale}`;
  const done = settled.get(id);
  if (done !== undefined) return Promise.resolve(done);
  let hit = cache.get(id);
  if (!hit) {
    const entry = Object.entries(LOADERS[source]).find(([path]) => localeOf(path) === locale);
    hit = (entry ? entry[1]().then(catalogFromModule) : Promise.resolve(null)).then(
      (c) => {
        settled.set(id, c);
        for (const l of listeners) l();
        return c;
      },
      () => {
        cache.delete(id);
        return null;
      },
    );
    cache.set(id, hit);
  }
  return hit;
}

/** Merges sources; a duplicate (a test failure) resolves in favour of the source listed first. */
export function mergeCatalogs(parts: Array<FlatCatalog | null | undefined>): FlatCatalog {
  const out: FlatCatalog = {};
  for (let i = parts.length - 1; i >= 0; i--) Object.assign(out, parts[i] ?? {});
  return out;
}

/** What is loaded right now for a locale (app + engine), and the merged English fallback. Synchronous. */
export function currentCatalogs(locale: LocaleId): { catalog: FlatCatalog; english: FlatCatalog; app: boolean } {
  const english = mergeCatalogs([loadedSource('app', 'en'), loadedSource('engine', 'en')]);
  const app = loadedSource('app', locale);
  return {
    catalog: locale === 'en' ? english : mergeCatalogs([app, loadedSource('engine', locale)]),
    english,
    app: app !== undefined,
  };
}

/** Both sources of a locale, merged (app wins any accidental duplicate). */
export async function loadLocale(locale: LocaleId): Promise<FlatCatalog> {
  const [app, eng] = await Promise.all([loadSource('app', locale), loadSource('engine', locale)]);
  return mergeCatalogs([app, eng]);
}

/** Loads the English sources (the fallback for every locale) and the given locale. */
export async function ensureI18n(locale: LocaleId, opts: { engine?: boolean } = {}): Promise<{ english: FlatCatalog; catalog: FlatCatalog }> {
  const wantEngine = opts.engine !== false;
  await Promise.all([loadSource('app', locale), ...(wantEngine ? [loadSource('engine', locale), loadSource('engine', 'en')] : [])]);
  const c = currentCatalogs(locale);
  return { english: c.english, catalog: c.catalog };
}
