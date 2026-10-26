/**
 * Message key types for the two translation sources (see sources.ts). Engine keys are typed from gameplay's
 * English JSON, so a renamed engine key is a type error in the screens that use it.
 */
import type { en } from './catalogs/en';
import type engineEn from './engine/en.json';

export type AppKey = keyof typeof en;
export type EngineKey = keyof typeof engineEn;
export type MessageKey = AppKey | EngineKey;
