/**
 * Practice copy, English source (Practice UX workstream), in themed parts under ./en/. Keys start with `practice.`.
 * Other locales are partials of this object; a missing key falls back to English. Status per locale: ./STATUS.md.
 * Copy rules: plain cricket words, one idea per line, honest numbers, never blame the player.
 */
import { coachEn } from './en/coach';
import { deliveriesEn } from './en/deliveries';
import { fieldEn } from './en/field';
import { playEn } from './en/play';
import { settingsEn } from './en/settings';
import { startEn } from './en/start';

export const practiceEn = { ...startEn, ...playEn, ...coachEn, ...fieldEn, ...deliveriesEn, ...settingsEn } as const;

export type PracticeKey = keyof typeof practiceEn;
