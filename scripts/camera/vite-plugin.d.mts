import type { Plugin } from 'vite';

/** The camera pack plugin (scripts/camera/vite-plugin.mjs). */
export function cameraPack(o?: { android?: boolean; env?: Record<string, string | undefined> }): Plugin;
