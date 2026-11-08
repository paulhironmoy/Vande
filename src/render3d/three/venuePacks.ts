/**
 * The venue packs' URLs: the only module that names the files, imported only by the lazy venue chunk. Vite hashes the
 * names (`assets/venue-p-<hash>.glb`), so the existing one-year immutable header for `/assets/*` caches them, and a build
 * that never reaches this module (the default Android build, see venue.ts) emits neither file.
 */
import premium from './venue/pack/venue-p.glb?url';
import balanced from './venue/pack/venue-b.glb?url';

export const PACK_URLS = { premium, balanced } as const;
