import { describe, expect, it, vi } from 'vitest';
import { createAttributionReporter } from '@/net/attribution';
import { createMemorySecureStore } from '@/platform/secureStore';
import { buildShareMessage, canShare, memoryShareLedger, shareMoment } from '@/platform/shareMoments';
import { INSTALL_CODE_KEY } from '@/platform/installReferrer';

describe('highlight attribution', () => {
  it('reports anonymously, one landing open per code per session, and never throws', async () => {
    const call = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    const r = createAttributionReporter({ call } as never, null);
    expect(await r.report('k7q2m9xa', 'landing_open')).toBe(true);
    expect(await r.report('k7q2m9xa', 'landing_open')).toBe(false);
    expect(await r.report('k7q2m9xa', 'share')).toBe(true);
    expect(await r.report('NOT A CODE', 'share')).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]).toEqual(['POST /v1/attribution', { body: { code: 'k7q2m9xa', event: 'landing_open' } }, { anonymous: true }]);
    const failing = createAttributionReporter({ call: vi.fn(async () => Promise.reject(new Error('offline'))) } as never, null);
    expect(await failing.report('k7q2m9xa', 'share')).toBe(false);
  });

  it('reports an attributed install once, even across restarts', async () => {
    const store = createMemorySecureStore();
    await store.set(INSTALL_CODE_KEY, 'k7q2m9xa');
    const call = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    expect(await createAttributionReporter({ call } as never, store).flushInstall()).toBe(true);
    expect(await createAttributionReporter({ call } as never, store).flushInstall()).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1]).toEqual({ body: { code: 'k7q2m9xa', event: 'install' } });
  });
});

describe('highlight share moment', () => {
  const ctx = { kind: 'duel' as const, id: `m${'a'.repeat(26)}`, url: 'https://vande.example/m/x', players: ['Swift Tiger', 'Calm Cobra'] as [string, string], highlight: { code: 'k7q2m9xa', url: 'https://vande.example/h/k7q2m9xa' } };

  it('is the final moment of the match: the landing link instead of the reveal, once', async () => {
    const msg = buildShareMessage('final', ctx);
    expect(msg.url).toBe('https://vande.example/h/k7q2m9xa');
    expect(msg.text).toBe('Swift Tiger vs Calm Cobra made the VANDE Cricket Daily Top 100. Watch the highlight, then try to beat them.');
    expect(buildShareMessage('final', { ...ctx, locale: 'hi-Latn' }).text).toContain('Daily Top 100');
    const ledger = memoryShareLedger();
    expect(canShare(ledger, 'final', ctx)).toBe(true);
    const onShared = vi.fn();
    const adapter = { share: vi.fn(async () => 'shared' as const), whatsappUrl: () => '' };
    expect(await shareMoment(adapter, ledger, 'final', ctx, { onShared })).toBe('shared');
    expect(onShared).toHaveBeenCalledWith('final', ctx);
    // One final message per match: the reveal can no longer be shared separately.
    expect(canShare(ledger, 'final', { ...ctx, highlight: undefined, revealed: true })).toBe(false);
  });
});
