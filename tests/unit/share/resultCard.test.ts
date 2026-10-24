import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCardModel, challengeCodeFromUrl, challengeUrl, renderCard, shareText, TAGLINE, CARD_DIMENSIONS } from '@/share/resultCard';
import { campaignResult } from './fixtures';

describe('challenge URLs', () => {
  it('builds a URL with the code as a query parameter under the base path', () => {
    expect(challengeUrl('VND1-EX-abc', 'https://example.org', '/')).toBe('https://example.org/?c=VND1-EX-abc');
    expect(challengeUrl('VND1-EX-abc', 'https://example.org/', '/Vande/')).toBe('https://example.org/Vande/?c=VND1-EX-abc');
    expect(challengeUrl('VND1-EX-abc', 'https://example.org', 'Vande')).toBe('https://example.org/Vande/?c=VND1-EX-abc');
  });

  it('round-trips codes through the URL in both accepted forms', () => {
    const code = 'VND1-CAMP-k3j9z-S-11-78';
    expect(challengeCodeFromUrl(challengeUrl(code, 'https://example.org', '/Vande/'))).toBe(code);
    expect(challengeCodeFromUrl('https://example.org/c/' + code)).toBe(code);
    expect(challengeCodeFromUrl('/Vande/?c=' + encodeURIComponent('A+B'))).toBe('A+B');
  });

  it('returns null for inputs without a code', () => {
    expect(challengeCodeFromUrl('https://example.org/')).toBeNull();
    expect(challengeCodeFromUrl('')).toBeNull();
    expect(challengeCodeFromUrl('not a url at all')).toBeNull();
  });
});

describe('buildCardModel', () => {
  const result = campaignResult();
  const model = buildCardModel(result, { origin: 'https://vande.example', base: '/Vande/' });

  it('carries identity, outcome, rounded score and the exact tagline', () => {
    expect(model.wordmark).toBe('VANDE//REPUBLIC');
    expect(model.appName).toContain('VANDE');
    expect(model.outcomeLabel).toBe('Resilient Republic');
    expect(model.score).toBe(68);
    expect(model.tagline).toBe('I held the Republic together. Can you?');
    expect(TAGLINE).toBe(model.tagline);
  });

  it('includes the hardest decision, up to four values protected, the code and a reproducible URL', () => {
    expect(model.hardestDecision).toBe('Keep the square open while the fabricated leak spread');
    expect(model.values).toHaveLength(4);
    expect(model.values).not.toContain('Extra value that should be dropped');
    expect(model.code).toBe(result.challengeCode);
    expect(model.url).toBe('https://vande.example/Vande/?c=' + encodeURIComponent(result.challengeCode));
    expect(challengeCodeFromUrl(model.url)).toBe(result.challengeCode);
  });

  it('falls back sensibly when optional fields are missing', () => {
    const sparse = buildCardModel(campaignResult({ hardestDecision: undefined, valuesProtected: [], score: 143, outcome: 'manipulated' }), { origin: 'https://x.test' });
    expect(sparse.hardestDecision).toBe('Order an independent review');
    expect(sparse.values.length).toBeGreaterThan(0);
    expect(sparse.score).toBe(100);
    expect(sparse.outcomeLabel).toBe('Manipulated Republic');
    expect(sparse.url).toBe('https://x.test/?c=' + encodeURIComponent(sparse.code));
  });

  it('lists all six dimensions with clamped values', () => {
    expect(model.dims.map((d) => d.dim)).toEqual(['freedom', 'grievance', 'safety', 'evidence', 'trust', 'economy']);
    for (const d of model.dims) {
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThanOrEqual(100);
    }
  });

  it('produces share text with the tagline, outcome, score, code and URL', () => {
    const text = shareText(model);
    expect(text).toContain(TAGLINE);
    expect(text).toContain('Resilient Republic');
    expect(text).toContain('68/100');
    expect(text).toContain(model.code);
    expect(text).toContain(model.url);
  });
});

describe('renderCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exposes the two card sizes', () => {
    expect(CARD_DIMENSIONS.landscape).toEqual({ width: 1200, height: 630 });
    expect(CARD_DIMENSIONS.portrait).toEqual({ width: 1080, height: 1350 });
  });

  it('rejects with a clear error when Canvas 2D is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const model = buildCardModel(campaignResult(), { origin: 'https://vande.example' });
    await expect(renderCard(model)).rejects.toThrow(/Canvas 2D is not available/);
    await expect(renderCard(model, 'portrait')).rejects.toThrow(/Canvas 2D is not available/);
  });
});
