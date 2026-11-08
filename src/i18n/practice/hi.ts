/**
 * Practice copy, Hindi (आप register), in themed parts under ./hi/ mirroring ./en/. Complete; written in-house
 * (AI-authored), native-speaker review recommended. Cricket words keep the forms the app already uses (कवर, बोल्ड,
 * एलबीडब्ल्यू, चौका, छक्का).
 */
import { coachHi } from './hi/coach';
import { deliveriesHi } from './hi/deliveries';
import { fieldHi } from './hi/field';
import { playHi } from './hi/play';
import { settingsHi } from './hi/settings';
import { startHi } from './hi/start';

export const practiceHi: Record<string, string> = { ...startHi, ...playHi, ...coachHi, ...fieldHi, ...deliveriesHi, ...settingsHi };

export default practiceHi;
