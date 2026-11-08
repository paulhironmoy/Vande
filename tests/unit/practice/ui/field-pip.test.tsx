/**
 * The field inset on the live screen (MiniRadar.tsx FieldPip, Play.tsx fieldPipPhase): when it is on screen, where,
 * that it is a picture and never a control, the field as set before any stage paints it, and that the compact radar in
 * the conditions control stops repeating the players while the inset shows them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { FieldLayout } from '@/contracts';
import { BOUNDARY_R, PITCH_HALF, RING_R, STRIKER_REF, fielderClass, autoField } from '@/physics';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import { FIELD_PIP_FLOOR, FIELD_PIP_MIN, FIELD_PIP_QUIET_BUDGET, FieldPip, FieldPipShown, MiniRadar, fieldPipSize, quietBudgetOver } from '@/practice/ui/components/MiniRadar';
import { fieldPipPhase } from '@/practice/ui/screens/Play';

const kit = { ground: { boundaryR: BOUNDARY_R, ringR: RING_R, pitchHalf: PITCH_HALF, bladeM: 0.96, striker: { x: STRIKER_REF.x, z: STRIKER_REF.z } }, fielderClass } as unknown as PracticeKit;
const field: FieldLayout = autoField({ family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'b' }, 'balanced');
const withKit = (node: React.ReactNode) => render(<PracticeKitContext.Provider value={kit}>{node}</PracticeKitContext.Provider>);

afterEach(cleanup);

describe('fieldPipPhase', () => {
  const o = { unity: false, replay: false, field: true, stage: '3d' as const };
  it('follows the live screen: calm, quiet in the run-up, live from the release, the dead ball', () => {
    expect(fieldPipPhase('live', 'ready', o)).toBe('calm');
    expect(fieldPipPhase('live', 'runup', o)).toBe('quiet');
    expect(fieldPipPhase('live', 'live', o)).toBe('live');
    expect(fieldPipPhase('live', 'playing', o)).toBe('live');
    expect(fieldPipPhase('live', 'dead', o)).toBe('dead');
  });
  it('is never shown in a replay, a teaching view, the pause, on Unity, without a field, or off the live screen', () => {
    expect(fieldPipPhase('live', 'dead', { ...o, replay: true })).toBeNull();
    expect(fieldPipPhase('live', 'runup', { ...o, unity: true })).toBeNull();
    expect(fieldPipPhase('live', 'runup', { ...o, field: false })).toBeNull();
    for (const phase of ['paused', 'demo', 'closeup', 'replay', 'intro', 'loading', 'idle'] as const) expect(fieldPipPhase('live', phase, o)).toBeNull();
    for (const s of ['coach', 'setup', 'over_summary'] as const) expect(fieldPipPhase(s, 'dead', o)).toBeNull();
  });
  it('steps out at Classic’s dead ball, where the card takes the right half', () => {
    expect(fieldPipPhase('live', 'dead', { ...o, stage: '2d' })).toBeNull();
    expect(fieldPipPhase('live', 'runup', { ...o, stage: '2d' })).toBe('quiet');
  });
});

describe('FieldPip', () => {
  it('is the stage’s target: a picture with a canvas, hidden from assistive technology, never a control', () => {
    withKit(<FieldPip field={field} handedness="right" phase="calm" side="right" />);
    const pip = screen.getByTestId('practice-pip');
    expect(pip.hasAttribute('data-pip')).toBe(true);
    expect(pip.getAttribute('aria-hidden')).toBe('true');
    expect(pip.dataset.side).toBe('right');
    expect(pip.dataset.phase).toBe('calm');
    expect(pip.querySelector('canvas[data-pip-canvas]')).not.toBeNull();
    expect(pip.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });

  it('stands in with the field as set: all eleven fielders, the keeper distinct, and the striker', () => {
    withKit(<FieldPip field={field} handedness="right" phase="quiet" side="right" />);
    const svg = screen.getByTestId('practice-pip-static');
    expect(field.fielders).toHaveLength(11);
    // Eleven fielders (the keeper a square), plus the striker's marker and its ring.
    expect(svg.querySelectorAll('rect[fill="#f2ad41"]')).toHaveLength(1);
    expect(svg.querySelectorAll('circle[stroke="#0b0d12"]')).toHaveLength(10 + 1);
  });

  it('mirrors the stand-in for a left-hander, like the first-person view', () => {
    const { unmount } = withKit(<FieldPip field={field} handedness="right" phase="calm" side="right" />);
    const right = Array.from(screen.getByTestId('practice-pip-static').querySelectorAll('circle[fill="#f3efe7"]')).map((c) => Number(c.getAttribute('cx')));
    unmount();
    withKit(<FieldPip field={field} handedness="left" phase="calm" side="right" />);
    const left = Array.from(screen.getByTestId('practice-pip-static').querySelectorAll('circle[fill="#f3efe7"]')).map((c) => Number(c.getAttribute('cx')));
    expect(left).toEqual(right.map((x) => -x));
  });

  it('holds its place below the tallest the rail has been, so it never jumps when the rail drops its words in the run-up', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-play-root', '');
    root.style.setProperty('--p-rail-bottom', '96px');
    document.body.append(root);
    render(
      <PracticeKitContext.Provider value={kit}>
        <FieldPip field={field} handedness="right" phase="calm" side="right" />
      </PracticeKitContext.Provider>,
      { container: root },
    );
    const pip = screen.getByTestId('practice-pip');
    expect(pip.style.getPropertyValue('--pip-rail')).toBe('96px');
    root.style.setProperty('--p-rail-bottom', '56px');
    await new Promise((r) => setTimeout(r, 0));
    expect(pip.style.getPropertyValue('--pip-rail')).toBe('96px');
    root.style.setProperty('--p-rail-bottom', '120px');
    await new Promise((r) => setTimeout(r, 0));
    expect(pip.style.getPropertyValue('--pip-rail')).toBe('120px');
    root.remove();
  });

  it('is sized in viewport units, never by the text size, takes no pointer events, and has no transition', () => {
    const css = readFileSync('src/practice/ui/components/MiniRadar.module.css', 'utf8');
    const size = /--pip-size:\s*([^;]+);/.exec(css)?.[1] ?? '';
    expect(size).toMatch(/vh/);
    expect(size).not.toMatch(/rem|em\b/);
    expect(css).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/transition:\s*none/);
    expect(css).toMatch(/\[data-pip-moment='hidden'\][\s\S]*?visibility:\s*hidden/);
  });
});

describe('fieldPipSize', () => {
  it('fills the corner below the rail at the default text size on the supported phones', () => {
    expect(fieldPipSize(360, 66)).toBe(104);
    expect(fieldPipSize(390, 94)).toBe(113);
    expect(fieldPipSize(412, 94)).toBe(119);
    expect(fieldPipSize(1080, 120)).toBe(148);
  });
  it('keeps its bottom above the floor, and gives way when that leaves too little room (a tall rail at 200% text)', () => {
    for (const [h, top] of [[360, 120], [390, 140], [412, 150]] as const) {
      const side = fieldPipSize(h, top);
      if (side) expect(top + side).toBeLessThanOrEqual(h * FIELD_PIP_FLOOR);
      if (side) expect(side).toBeGreaterThanOrEqual(FIELD_PIP_MIN);
    }
    expect(fieldPipSize(360, 158)).toBe(0);
    expect(fieldPipSize(412, 200)).toBe(0);
  });
  it('reports whether there is room, once, to the screen that owns the radar', () => {
    const rooms: boolean[] = [];
    const root = document.createElement('div');
    root.setAttribute('data-play-root', '');
    document.body.append(root);
    render(
      <PracticeKitContext.Provider value={kit}>
        <FieldPip field={field} handedness="right" phase="calm" side="right" onRoom={(r) => rooms.push(r)} />
      </PracticeKitContext.Provider>,
      { container: root },
    );
    expect(rooms).toEqual([true]);
    const pip = screen.getByTestId('practice-pip');
    expect(pip.dataset.room).toBe('ok');
    expect(parseFloat(pip.style.width)).toBeGreaterThanOrEqual(FIELD_PIP_MIN);
    root.remove();
  });
});

describe('the run-up budget (owner decision 2026-11-04: rail + inset ≤ 8% of the screen in the run-up)', () => {
  // The quiet rail measured at the default text size (region-grid, run-up): the score corner 147×68, the conditions
  // control 58×50 and pause 48×48, the same at every phone width.
  const rail = 147 * 68 + 58 * 50 + 48 * 48;
  it('steps aside at 640×360 (11.3%) and 844×390 (8.5%), stays at 915×412 (7.8%)', () => {
    expect(FIELD_PIP_QUIET_BUDGET).toBe(0.08);
    expect(quietBudgetOver(rail, fieldPipSize(360, 66), 640, 360)).toBe(true);
    expect(quietBudgetOver(rail, fieldPipSize(390, 94), 844, 390)).toBe(true);
    expect(quietBudgetOver(rail, fieldPipSize(412, 94), 915, 412)).toBe(false);
    expect(quietBudgetOver(rail, 0, 640, 360)).toBe(false);
  });

  it('is measured in the run-up only, on the quiet rail as drawn, and reported to the screen that owns the radar', () => {
    const root = document.createElement('div');
    root.setAttribute('data-play-root', '');
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 640 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 360 });
    const box = (id: string, w: number, h: number) => {
      const el = document.createElement('div');
      el.dataset.testid = id;
      el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
      root.append(el);
    };
    box('practice-status', 147, 68);
    box('practice-conditions', 58, 50);
    box('practice-pause', 48, 48);
    document.body.append(root);
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-pip') ? 104 : 0; } });
    const seen: boolean[] = [];
    const host = document.createElement('div');
    root.append(host);
    try {
      const view = (phase: 'calm' | 'quiet') => (
        <PracticeKitContext.Provider value={kit}>
          <FieldPip field={field} handedness="right" phase={phase} side="right" onQuietOver={(o) => seen.push(o)} />
        </PracticeKitContext.Provider>
      );
      const r = render(view('calm'), { container: host });
      expect(seen).toEqual([]);
      r.rerender(view('quiet'));
      expect(seen).toEqual([true]);
      expect(screen.getByTestId('practice-pip').dataset.quietBudget).toBe('over');
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
      root.remove();
    }
  });

  it('hides the inset in the run-up only, by its own CSS', () => {
    const css = readFileSync('src/practice/ui/components/MiniRadar.module.css', 'utf8');
    expect(css).toMatch(/\[data-quiet-budget='over'\]\[data-pip-moment='quiet'\][\s\S]*?visibility:\s*hidden/);
  });
});

describe('MiniRadar beside the inset', () => {
  it('draws the players when no inset is on screen, and only the ground while the inset shows them', () => {
    const { container, unmount } = withKit(<MiniRadar field={field} handedness="right" />);
    expect(container.querySelectorAll('circle')).toHaveLength(2 + 11);
    unmount();
    const shown = withKit(
      <FieldPipShown.Provider value>
        <MiniRadar field={field} handedness="right" />
      </FieldPipShown.Provider>,
    );
    expect(shown.container.querySelectorAll('circle')).toHaveLength(2);
    expect(shown.container.querySelector('svg')?.getAttribute('data-inset')).toBe('true');
  });
});
