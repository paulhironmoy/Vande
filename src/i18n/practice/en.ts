/**
 * Practice copy, English source (Practice UX workstream), in themed parts under ./en/. Keys start with `practice.`.
 * Other locales are partials of this object; a missing key falls back to English. Status per locale: ./STATUS.md.
 * Copy rules: plain cricket words, one idea per line, honest numbers, never blame the player.
 */
import { cameraEn } from './en/camera';
import { chaseEn } from './en/chase';
import { coachEn } from './en/coach';
import { controlsEn } from './en/controls';
import { deliveriesEn } from './en/deliveries';
import { fieldEn } from './en/field';
import { lessonEn } from './en/lesson';
import { playEn } from './en/play';
import { settingsEn } from './en/settings';
import { startEn } from './en/start';

export const practiceEn = {
  ...startEn,
  ...playEn,
  ...coachEn,
  ...fieldEn,
  ...deliveriesEn,
  ...settingsEn,
  ...chaseEn,
  ...lessonEn,
  ...cameraEn,
  ...controlsEn,
} as const;

export type PracticeKey = keyof typeof practiceEn;
