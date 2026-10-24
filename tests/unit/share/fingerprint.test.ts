import { describe, expect, it } from 'vitest';
import { fingerprintAlt, fingerprintSummary, fingerprintToUnicode, isValidFingerprint, parseFingerprint, strategyClass } from '@/share/fingerprint';

describe('fingerprint', () => {
  it('parses, validates and caps the letters', () => {
    expect(parseFingerprint('desx w?')).toEqual(['D', 'E', 'S', 'X', 'W']);
    expect(parseFingerprint('D'.repeat(20))).toHaveLength(12);
    expect(isValidFingerprint('DESPXW')).toBe(true);
    expect(isValidFingerprint('')).toBe(false);
    expect(isValidFingerprint('DQ')).toBe(false);
  });
  it('describes the pattern without any decision text', () => {
    expect(fingerprintToUnicode('DESW')).toBe('◆ ● ■ ○');
    expect(fingerprintSummary('DESW')).toBe('4 decisions: dialogue, evidence, support, waited');
    expect(fingerprintSummary('DESW', true)).toBe('4 moves: talked, checked clues, helped people, waited');
    const alt = fingerprintAlt('DX', 'Free but Fragile', 61);
    expect(alt).toContain('◆ ✕');
    expect(alt).toContain('Free but Fragile');
    expect(alt).toContain('61');
  });
  it('classifies strategies consistently with the backend', () => {
    expect(strategyClass('DESDE')).toBe('restraint');
    expect(strategyClass('DXS')).toBe('force');
    expect(strategyClass('WWD')).toBe('passive');
    expect(strategyClass('DPPE')).toBe('mixed');
    expect(strategyClass('')).toBe('mixed');
  });
});
