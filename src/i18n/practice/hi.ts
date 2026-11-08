/**
 * Practice copy, Hindi (आप register), in themed parts under ./hi/ mirroring ./en/. Complete; written in-house
 * (AI-authored), native-speaker review recommended. Cricket words keep the forms the app already uses (कवर, बोल्ड,
 * एलबीडब्ल्यू, चौका, छक्का).
 */
import { cameraHi } from './hi/camera';
import { chaseHi } from './hi/chase';
import { coachHi } from './hi/coach';
import { controlsHi } from './hi/controls';
import { deliveriesHi } from './hi/deliveries';
import { fieldHi } from './hi/field';
import { lessonHi } from './hi/lesson';
import { playHi } from './hi/play';
import { settingsHi } from './hi/settings';
import { startHi } from './hi/start';

export const practiceHi: Record<string, string> = {
  ...startHi,
  ...playHi,
  ...coachHi,
  ...fieldHi,
  ...deliveriesHi,
  ...settingsHi,
  ...chaseHi,
  ...lessonHi,
  ...cameraHi,
  ...controlsHi,
};

export default practiceHi;
