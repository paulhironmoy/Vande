/**
 * Versioned rules registry. Every engine version that has ever produced a replay stays here, unchanged, so that a
 * replay is always verified with the rules that produced it. To change an outcome rule: copy v1/ to v2/, change v2,
 * bump ENGINE_VERSION in src/contracts/cricket.ts (root), and register v2 below. Never edit a released version.
 */
import type { SealedSixEngineApi } from '@/contracts';
import { engineV1 } from './v1';

export const ENGINES: Readonly<Record<number, SealedSixEngineApi>> = { 1: engineV1 };

/** The engine for a recorded version, or null when this build does not know it (a newer replay on an old client). */
export function engineFor(version: number): SealedSixEngineApi | null {
  return ENGINES[version] ?? null;
}

export const SUPPORTED_ENGINE_VERSIONS: readonly number[] = Object.keys(ENGINES).map(Number);
