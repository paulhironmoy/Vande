import { describe, expect, it } from 'vitest';
import { startConnectivity } from '@/net/connectivity';

function fakeTarget() {
  const l = new Map<string, Set<() => void>>();
  return {
    addEventListener: (t: string, cb: () => void) => void (l.get(t) ?? l.set(t, new Set()).get(t)!).add(cb),
    removeEventListener: (t: string, cb: () => void) => void l.get(t)?.delete(cb),
    fire: (t: string) => l.get(t)?.forEach((cb) => cb()),
    count: (t: string) => l.get(t)?.size ?? 0,
  };
}

describe('connectivity', () => {
  it('follows browser events and real request outcomes into the root store', () => {
    const target = fakeTarget();
    const doc = Object.assign(fakeTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const states: boolean[] = [];
    let flushes = 0;
    let resumes = 0;
    const c = startConnectivity({ setOnline: (v) => states.push(v), onOnline: () => flushes++, onResume: () => resumes++, target, nav: { onLine: true }, doc });
    expect(states).toEqual([true]);
    target.fire('offline');
    expect(c.online()).toBe(false);
    target.fire('online');
    expect(flushes).toBeGreaterThan(0);
    c.report(false);
    expect(c.online()).toBe(true);
    c.report(false);
    expect(c.online()).toBe(false);
    c.report(true);
    expect(c.online()).toBe(true);
    doc.fire('visibilitychange');
    expect(resumes).toBe(1);
    expect(states).toEqual([true, false, true, false, true]);
    c.stop();
    expect(target.count('online')).toBe(0);
    expect(doc.count('visibilitychange')).toBe(0);
  });

  it('starts offline when the browser says so', () => {
    const states: boolean[] = [];
    startConnectivity({ setOnline: (v) => states.push(v), target: fakeTarget(), nav: { onLine: false }, doc: Object.assign(fakeTarget(), { visibilityState: 'hidden' as DocumentVisibilityState }) }).stop();
    expect(states).toEqual([false]);
  });
});
