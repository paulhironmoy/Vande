import { describe, expect, it } from 'vitest';
import { decodeChallenge, encodeChallenge } from '../../../src/engine/challenge';
import type { ChallengeSpec } from '../../../src/engine/types';

const specs: ChallengeSpec[] = [
  { v: 1, scenario: 'campaign', seed: 123456789, difficulty: 'standard', opponents: ['exploiter', 'disinfo'], score: 78 },
  { v: 1, scenario: 'examination-crisis', seed: 0, difficulty: 'measured', opponents: ['overreaction'] },
  { v: 1, scenario: 'electoral-dispute', seed: 0xffffffff, difficulty: 'severe', opponents: ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'], score: 0 },
  { v: 1, scenario: 'information-storm', seed: 42, difficulty: 'standard', opponents: ['sabotage', 'provocateur'], score: 100 },
];

describe('challenge codec', () => {
  it('round-trips every spec', () => {
    for (const spec of specs) {
      const code = encodeChallenge(spec);
      expect(code).toMatch(/^V1-[A-Z]{2}-[0-9a-z]+-[MSV]-[0-9a-z]+(-[0-9a-z]+)?-[0-9a-z]$/);
      const decoded = decodeChallenge(code);
      expect(decoded).toEqual({ ...spec, opponents: [...spec.opponents].sort((a, b) => order(a) - order(b)) });
    }
  });

  it('is URL friendly and tolerant of surrounding URL text', () => {
    const code = encodeChallenge(specs[0]);
    expect(encodeURIComponent(code)).toBe(code);
    expect(decodeChallenge(`https://example.test/Vande/?c=${code}`)).toEqual(decodeChallenge(code));
    expect(decodeChallenge(`  ${code}  `)).toEqual(decodeChallenge(code));
    expect(decodeChallenge(code.toUpperCase())).toEqual(decodeChallenge(code));
  });

  it('rejects tampered or malformed codes', () => {
    const code = encodeChallenge(specs[0]);
    const parts = code.split('-');
    parts[2] = parts[2] === 'zzzz' ? 'zzzy' : 'zzzz';
    expect(decodeChallenge(parts.join('-'))).toBeNull();
    const mask = code.split('-');
    mask[4] = mask[4] === '1' ? '2' : '1';
    expect(decodeChallenge(mask.join('-'))).toBeNull();
    expect(decodeChallenge('')).toBeNull();
    expect(decodeChallenge('hello')).toBeNull();
    expect(decodeChallenge('V1-XX-1-S-3-a')).toBeNull();
    expect(decodeChallenge('V1-EX-1-S-0-a')).toBeNull();
    expect(decodeChallenge(code + '-x')).toBeNull();
  });
});

function order(id: string): number {
  return ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'].indexOf(id);
}
