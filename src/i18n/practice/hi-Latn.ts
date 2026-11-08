/**
 * Practice copy, Hinglish (tum register, Latin script), in themed parts under ./hi-Latn/ mirroring ./en/. Complete;
 * written in-house (AI-authored), native review recommended. Fielding terms stay in English, as in the app catalog.
 */
import { coachHiLatn } from './hi-Latn/coach';
import { deliveriesHiLatn } from './hi-Latn/deliveries';
import { fieldHiLatn } from './hi-Latn/field';
import { playHiLatn } from './hi-Latn/play';
import { settingsHiLatn } from './hi-Latn/settings';
import { startHiLatn } from './hi-Latn/start';

export const practiceHiLatn: Record<string, string> = { ...startHiLatn, ...playHiLatn, ...coachHiLatn, ...fieldHiLatn, ...deliveriesHiLatn, ...settingsHiLatn };

export default practiceHiLatn;
