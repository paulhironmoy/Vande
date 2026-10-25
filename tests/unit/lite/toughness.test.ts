import { describe, expect, it } from 'vitest';
import committed from '@/content/lite/toughness.json';
import { getScenario } from '@/engine';
import type { ToughnessManifest } from '@/lite/contracts';
import { TOUGHNESS, TOUGHNESS_CONFIG, closeCallMargin, computeToughness, tierFromSignals, tierOf, toughnessContentHash } from '@/lite/toughness';

describe('Lite toughness tiers', () => {
  it('matches the committed manifest (run node scripts/lite-toughness.mjs when this fails)', () => {
    const { manifest } = computeToughness();
    const fresh = JSON.stringify(manifest, null, 2);
    const current = JSON.stringify(committed, null, 2);
    if (fresh !== current) throw new Error('src/content/lite/toughness.json is stale: run node scripts/lite-toughness.mjs');
    expect(fresh).toBe(current);
  }, 60_000);

  it('has at least one Boss and at most a third Boss in Chapter 1', () => {
    const tiers = Object.values((committed as ToughnessManifest).decisions).map((e) => e.tier);
    const boss = tiers.filter((t) => t === 'boss').length;
    expect(boss).toBeGreaterThanOrEqual(1);
    expect(boss).toBeLessThanOrEqual(Math.floor(tiers.length / 3));
  });

  it('covers every decision and fair-play moment, and fair play defaults to Tricky', () => {
    const sc = getScenario('examination-crisis');
    expect(Object.keys(TOUGHNESS.decisions).sort()).toEqual(sc.decisions.map((d) => d.id).sort());
    expect(Object.keys(TOUGHNESS.rights).sort()).toEqual(sc.rightsMoments.map((r) => r.id).sort());
    for (const r of sc.rightsMoments) expect(tierOf(r.id)).toBe(TOUGHNESS_CONFIG.rightsOverrides[r.id] ?? 'tricky');
    for (const d of sc.decisions) expect(tierOf(d.id)).toBe(TOUGHNESS.decisions[d.id].tier);
    expect(tierOf('nope')).toBe('tricky');
    expect(closeCallMargin()).toBe(TOUGHNESS_CONFIG.thresholds.closeCallMargin);
    expect(TOUGHNESS.thresholds).toEqual(TOUGHNESS_CONFIG.thresholds);
    expect(TOUGHNESS.seeds).toEqual(TOUGHNESS_CONFIG.seeds);
  });

  it('maps signals to tiers: none Tricky, one Tough, two or more Boss', () => {
    expect(tierFromSignals({ closeCall: false, trap: false, clueNeeded: false })).toBe('tricky');
    expect(tierFromSignals({ closeCall: false, trap: true, clueNeeded: false })).toBe('tough');
    expect(tierFromSignals({ closeCall: true, trap: true, clueNeeded: false })).toBe('boss');
    expect(tierFromSignals({ closeCall: true, trap: true, clueNeeded: true })).toBe('boss');
    for (const e of Object.values(TOUGHNESS.decisions)) expect(e.tier).toBe(tierFromSignals(e.signals));
  });

  it('hashes the inputs: copy layers do not matter, effects and thresholds do', () => {
    const sc = getScenario('examination-crisis');
    const h = toughnessContentHash(sc);
    const copy = structuredClone(sc);
    copy.decisions[0].simple!.title = 'Something else entirely';
    expect(toughnessContentHash(copy)).toBe(h);
    const effects = structuredClone(sc);
    effects.decisions[0].options[0].effects = { ...effects.decisions[0].options[0].effects, trust: 99 };
    expect(toughnessContentHash(effects)).not.toBe(h);
    expect(toughnessContentHash(sc, { ...TOUGHNESS_CONFIG, thresholds: { closeCallMargin: 1, trapMargin: 1 } })).not.toBe(h);
    expect(h).toBe((committed as ToughnessManifest).contentHash);
  });

  it('validates fair-play overrides', () => {
    expect(() => computeToughness({ ...TOUGHNESS_CONFIG, seeds: TOUGHNESS_CONFIG.seeds.slice(0, 1), rightsOverrides: { 'rm-assembly': 'legendary' as never } })).toThrow(/not a tier/);
    expect(() => computeToughness({ ...TOUGHNESS_CONFIG, seeds: TOUGHNESS_CONFIG.seeds.slice(0, 1), rightsOverrides: { 'rm-missing': 'boss' } })).toThrow(/no such fair-play moment/);
    const { manifest } = computeToughness({ ...TOUGHNESS_CONFIG, seeds: TOUGHNESS_CONFIG.seeds.slice(0, 1), rightsOverrides: { 'rm-assembly': 'tough' } });
    expect(manifest.rights['rm-assembly'].tier).toBe('tough');
  });
});
