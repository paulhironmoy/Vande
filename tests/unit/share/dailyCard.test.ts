import { describe, expect, it, vi } from 'vitest';
import type { DailyAttemptResult } from '@/engine/types';
import { buildDailyCardModel, dailyDateLabel, dailyShareText, renderDailyCard, scoreBandOf, DAILY_INVITATION } from '@/share/dailyCard';
import { encodeDailyChallenge } from '@/engine/challenge';

const result: DailyAttemptResult = {
  score: 78,
  outcome: 'resilient',
  fingerprint: 'DESDE',
  completedAt: '2026-10-26T06:00:00.000Z',
  contentVersion: 'daily-1',
  mode: 'simple',
  scores: { freedom: 80, grievance: 76, safety: 79, evidence: 85, trust: 74, economy: 70 },
};

describe('daily share card model', () => {
  const code = encodeDailyChallenge({ dailyId: '2026-10-26', score: 78, fingerprint: 'DESDE', outcome: 'resilient' });

  it('is spoiler-free and carries the invitation, pattern, outcome and link', () => {
    const model = buildDailyCardModel({ dailyId: '2026-10-26', result, official: true, code, origin: 'https://vande.play', base: '/Vande/' });
    expect(model.invitation).toBe(DAILY_INVITATION);
    expect(model.codes).toEqual(['D', 'E', 'S', 'D', 'E']);
    expect(model.outcomeLabel).toBe('Resilient Republic');
    expect(model.score).toBe(78);
    expect(model.url).toBe(`https://vande.play/Vande/?c=${encodeURIComponent(code)}`);
    expect(model.alt).toContain('◆ ● ■ ◆ ●');
    const text = dailyShareText(model);
    expect(text).toContain(DAILY_INVITATION);
    expect(text).toContain('26 Oct 2026');
    expect(text).toContain('78/100');
    expect(text).not.toMatch(/decision|option|student|exam/i);
  });

  it('uses the Simple outcome label and a band instead of a score for practice runs', () => {
    const model = buildDailyCardModel({ dailyId: '2026-10-26', result, official: false, code, origin: 'https://vande.example', simple: true });
    expect(model.outcomeLabel).toBe('Strong and Fair City');
    expect(model.attemptLabel).toBe('Practice');
    expect(dailyShareText(model)).toContain('practice 70-84');
    expect(scoreBandOf(39)).toBe('0-39');
    expect(scoreBandOf(85)).toBe('85-100');
    expect(dailyDateLabel('not-a-date')).toBe('not-a-date');
  });

  it('fails cleanly without a canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const model = buildDailyCardModel({ dailyId: '2026-10-26', result, official: true, code, origin: 'https://vande.example' });
    await expect(renderDailyCard(model)).rejects.toThrow(/Canvas 2D/);
  });
});
