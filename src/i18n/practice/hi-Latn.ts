/**
 * Practice copy, Hinglish (tum register, Latin script), in themed parts under ./hi-Latn/ mirroring ./en/. Complete;
 * written in-house (AI-authored), native review recommended. Fielding terms stay in English, as in the app catalog.
 */
import { cameraHiLatn } from './hi-Latn/camera';
import { chaseHiLatn } from './hi-Latn/chase';
import { coachHiLatn } from './hi-Latn/coach';
import { controlsHiLatn } from './hi-Latn/controls';
import { deliveriesHiLatn } from './hi-Latn/deliveries';
import { fieldHiLatn } from './hi-Latn/field';
import { lessonHiLatn } from './hi-Latn/lesson';
import { playHiLatn } from './hi-Latn/play';
import { settingsHiLatn } from './hi-Latn/settings';
import { startHiLatn } from './hi-Latn/start';

export const practiceHiLatn: Record<string, string> = {
  ...startHiLatn,
  ...playHiLatn,
  ...coachHiLatn,
  ...fieldHiLatn,
  ...deliveriesHiLatn,
  ...settingsHiLatn,
  ...chaseHiLatn,
  ...lessonHiLatn,
  ...cameraHiLatn,
  ...controlsHiLatn,
};

export default practiceHiLatn;
