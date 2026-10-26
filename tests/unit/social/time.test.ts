/**
 * Times in the social screens read the way each language tells time: Hinglish relative times in its own words
 * ("3 ghante mein"), and Hindi clock times with the part of the day ("रात 9:30"), never "pm" inside Devanagari.
 */
import { describe, expect, it } from 'vitest';
import hi from '@/i18n/social/hi';
import hiLatn from '@/i18n/social/hi-Latn';
import { createSocialT } from '@/social/i18n';
import { clockText, deadlineText, postHourText } from '@/social/components/time';

// Device-local times (the screens format in the device's time zone).
const NOW = new Date(2026, 9, 26, 18, 30).getTime();
const NINE_THIRTY_PM = new Date(2026, 9, 26, 21, 30).toISOString();

describe('social times', () => {
  it('Hinglish relative times use the app’s own words, not English', () => {
    const tr = createSocialT('hi-Latn', hiLatn as Record<string, string>);
    expect(tr.relative(3 * 3_600_000)).toBe('3 ghante mein');
    expect(tr.relative(-21 * 3_600_000)).toBe('21 ghante pehle');
    expect(deadlineText(tr, NINE_THIRTY_PM, NOW)).toBe('09:30 pm (3 ghante mein)');
    // English and Hindi keep Intl's own relative wording.
    expect(createSocialT('en', null).relative(3 * 3_600_000)).toBe('in 3 hours');
    expect(createSocialT('hi', hi as Record<string, string>).relative(3 * 3_600_000)).toBe('3 घंटे में');
  });

  it('Hindi clock times name the part of the day; English and Hinglish keep their clock', () => {
    const trHi = createSocialT('hi', hi as Record<string, string>);
    expect(clockText(trHi, NINE_THIRTY_PM, NOW)).toBe('रात 9:30');
    expect(clockText(trHi, NINE_THIRTY_PM, NOW)).not.toMatch(/am|pm/i);
    expect(clockText(createSocialT('en', null), NINE_THIRTY_PM, NOW)).toBe('09:30 pm');
    expect(clockText(createSocialT('hi-Latn', hiLatn as Record<string, string>), NINE_THIRTY_PM, NOW)).toBe('09:30 pm');
  });

  it('room post times too: "Today, रात 9" in Hindi', () => {
    const trHi = createSocialT('hi', hi as Record<string, string>);
    const ninePm = new Date(2026, 9, 26, 21).toISOString();
    expect(postHourText(trHi, ninePm, NOW)).toBe('आज, रात 9');
    expect(postHourText(createSocialT('en', null), ninePm, NOW)).toBe('Today, 9 pm');
    const yesterday = new Date(2026, 9, 25, 21).toISOString();
    expect(postHourText(trHi, yesterday, NOW)).toMatch(/रात 9$/);
    expect(postHourText(trHi, yesterday, NOW)).not.toMatch(/am|pm/i);
  });
});
