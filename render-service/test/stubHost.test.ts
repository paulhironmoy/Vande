// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('stub highlight host (test fixture for HighlightRenderHost)', () => {
  it('loads an input into a 30–60 s cut at 30 fps and draws any frame deterministically', async () => {
    // jsdom gives modules a non-file import.meta.url: find the fixture from the working directory.
    const file = [join(process.cwd(), 'render-service/test/fixtures/stub-host.html'), join(process.cwd(), 'test/fixtures/stub-host.html')].find((f) => existsSync(f)) as string;
    const html = readFileSync(file, 'utf8');
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' && /^fill/.test(prop) ? (...args: unknown[]) => calls.push(`${prop}:${JSON.stringify(args)}`) : undefined), set: () => true });
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const script = document.querySelector('script')?.textContent ?? '';
    new Function(script)();
    const host = (window as unknown as { __vcHighlight: { load(i: unknown): Promise<{ durationMs: number; fps: number }>; frame(t: number): Promise<void> } }).__vcHighlight;
    const input = {
      jobId: 'j1',
      log: { players: [{ alias: 'Swift Tiger' }, { alias: 'Calm Cobra' }], events: Array.from({ length: 13 }, (_, k) => ({ t: 'ball', ball: k % 7, outcome: { runs: k % 5 } })) },
      fixtureLabel: 'Friend Duel',
      cta: { url: 'https://vande.example/h/k7q2m9xa' },
    };
    const loaded = await host.load(input);
    expect(loaded).toEqual({ durationMs: 49_500, fps: 30 });
    await host.frame(1000);
    const first = calls.splice(0);
    await host.frame(1000);
    expect(calls).toEqual(first);
    expect(first.some((c) => c.includes('Swift Tiger vs Calm Cobra'))).toBe(true);
  });
});
