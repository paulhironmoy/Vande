import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexSync, submissionIdFor } from '@/community/hash';

describe('sha256', () => {
  it('matches the known digest of "abc" in both implementations', async () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256HexSync('abc')).toBe(expected);
    expect(await sha256Hex('abc')).toBe(expected);
    expect(sha256HexSync('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256HexSync('a'.repeat(200))).toHaveLength(64);
  });
  it('derives a per-day submission id that differs between days and installs', async () => {
    const a = await submissionIdFor('install-A', '2026-10-26');
    const b = await submissionIdFor('install-A', '2026-10-27');
    const c = await submissionIdFor('install-B', '2026-10-26');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain('install');
  });
});
