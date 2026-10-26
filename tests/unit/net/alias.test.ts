import { describe, expect, it } from 'vitest';
import { checkAlias, checkGroupName, generatedAlias } from '@/net/shared/alias';

const reason = (s: string) => {
  const r = checkAlias(s);
  return r.ok ? 'ok' : r.reason;
};

describe('alias moderation', () => {
  it('accepts ordinary Indian names, cricket words and other scripts', () => {
    for (const ok of [
      'Gandhi Fan',
      'Nazim',
      'Ashit Kumar',
      'Kamini',
      'Pornima',
      'Rupinder',
      'Sonu Nigam',
      'Kuttappan',
      'Kutti',
      'Therapist Ravi',
      'Scunthorpe',
      'Chakka King',
      'Chhakka 6',
      'Badminton Ace',
      'RCB Supporter',
      'Vandana',
      'Kohli18',
      'विराट',
      'লক্ষ্মী',
      'சச்சின்',
      'Mr.India',
      "D'Souza",
      'Swift Yorker 27',
    ]) {
      expect(reason(ok), ok).toBe('ok');
    }
  });

  it('refuses English, Hinglish and Devanagari abuse, including common disguises', () => {
    for (const bad of [
      'fuck',
      'FuUuCk you',
      'F u c k',
      'B1tch',
      'mc king',
      'MC Bro',
      'bsdk',
      'Bhenchod',
      'behen_chod',
      'madar.chod99',
      'Chutiya',
      'Chuuutiya',
      'chootiya',
      'Gaandu',
      'Gand Master',
      'Lund',
      'Lauda',
      'Randi',
      'Harami',
      'KuttaKing',
      'Tatti',
      'Niiigga',
      'nigger',
      'рorn',
      'Kamina',
      'Bhosdike',
      'मादरचोद',
      'भोसड़ी',
      'चूतिया',
      'लंड',
      'हरामी',
      'rapist',
      'nazi',
      'Chamar',
      'Katua',
    ]) {
      expect(reason(bad), bad).toBe('offensive');
    }
  });

  it('refuses impersonation and contact details', () => {
    expect(reason('VANDE Official')).toBe('reserved');
    expect(reason('Admin')).toBe('reserved');
    expect(reason('bcci')).toBe('reserved');
    expect(reason('YouTube Team')).toBe('reserved');
    expect(reason('Call 98765 43210')).toBe('contact');
    expect(reason('wa.me fan')).toBe('contact');
    expect(reason('insta')).toBe('ok');
    expect(reason('my instagram')).toBe('contact');
  });

  it('checks length and characters', () => {
    expect(reason('ab')).toBe('length');
    expect(reason('a'.repeat(21))).toBe('length');
    expect(reason('😀😀😀')).toBe('characters');
    expect(reason('12345')).toBe('characters');
    expect(reason('<script>')).toBe('characters');
    expect(checkAlias(42).ok).toBe(false);
    expect(checkAlias('  Swift   Tiger  ')).toEqual({ ok: true, value: 'Swift Tiger' });
  });

  it('moderates group names the same way, with a few more characters', () => {
    expect(checkGroupName('IIT Bombay (2027)').ok).toBe(true);
    expect(checkGroupName('Tata & Sons, Pune').ok).toBe(true);
    expect(checkGroupName('Chutiya Club').ok).toBe(false);
    expect(checkGroupName('ab').ok).toBe(false);
  });

  it('generates acceptable aliases', () => {
    for (let i = 0; i < 300; i++) {
      const a = generatedAlias(Uint8Array.of(i % 256, (i * 7) % 256, (i * 13) % 256));
      expect(checkAlias(a).ok, a).toBe(true);
    }
  });
});
