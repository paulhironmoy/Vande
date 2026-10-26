/**
 * The neutral age screen (VANDE Cricket is for players aged 18 and over: docs/PRIVACY_AND_CONSENT.md, age policy).
 * Asked once at first run, with no default and no hint at the threshold. Only the outcome is stored on this device
 * (`vc:age` = 'adult' | 'under'), never the year: the sign-up sends `adultConfirmed` from it (root wires
 * isAdultConfirmed into the session), and an 'under' answer keeps the stop screen up
 * until this device's data is deleted. No imports, so anything may read it.
 */
export const AGE_KEY = 'vc:age';
export const ADULT_AGE = 18;

export type AgeAnswer = 'adult' | 'under';

export function ageAnswer(): AgeAnswer | null {
  try {
    const v = localStorage.getItem(AGE_KEY);
    return v === 'adult' || v === 'under' ? v : null;
  } catch {
    return null;
  }
}

export function isAdultConfirmed(): boolean {
  return ageAnswer() === 'adult';
}

export function recordAge(answer: AgeAnswer): void {
  try {
    localStorage.setItem(AGE_KEY, answer);
  } catch {
    /* storage unavailable: the question is asked again next time */
  }
}

export interface AgeInput {
  year: number | null;
  /** 1–12 */
  month: number | null;
  day: number | null;
}

/** The next thing the screen needs, or the answer. Only the year at first; the birthday only for the year that decides. */
export type AgeStep = { kind: 'answer'; answer: AgeAnswer } | { kind: 'need'; field: 'year' | 'month' | 'day'; invalid: boolean };

export function ageStep(input: AgeInput, today: Date): AgeStep {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  const { year, month, day } = input;
  if (year === null) return { kind: 'need', field: 'year', invalid: false };
  if (!Number.isInteger(year) || year > y || year < y - 120) return { kind: 'need', field: 'year', invalid: true };
  const turns = y - year;
  if (turns > ADULT_AGE) return { kind: 'answer', answer: 'adult' };
  if (turns < ADULT_AGE) return { kind: 'answer', answer: 'under' };
  // This is the year they turn 18: the birthday decides.
  if (month === null) return { kind: 'need', field: 'month', invalid: false };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { kind: 'need', field: 'month', invalid: true };
  if (month !== m) return { kind: 'answer', answer: month < m ? 'adult' : 'under' };
  if (day === null) return { kind: 'need', field: 'day', invalid: false };
  if (!Number.isInteger(day) || day < 1 || day > new Date(year, month, 0).getDate()) return { kind: 'need', field: 'day', invalid: true };
  return { kind: 'answer', answer: day <= d ? 'adult' : 'under' };
}

const ZEROS = [0x30, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xff10];

/** Digits typed on any Indian keyboard (०१२, ১২৩, ௧௨…) as ASCII; anything else is dropped. */
export function asciiDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const z = ZEROS.find((zero) => cp >= zero && cp <= zero + 9);
    if (z !== undefined) out += String(cp - z);
  }
  return out;
}
