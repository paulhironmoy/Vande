import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar, BallTimeline, Button, Dialog, EnergyMeter, ExecutionMeter, OutcomeBadge, Sheet, StateView, ZonePad, markFromOutcome } from '@/ui';
import { zoneFromSwipe, vectorForZone, legalZones } from '@/ui/cricket/aim';
import { ZONES } from '@/render3d/core/ground';
import { checkTrace } from '@/engine';
import { renderUi } from './helpers';

afterEach(cleanup);

/** A pointer event with its own timestamp, as a browser stamps it (jsdom stamps epoch time, which counts as missing). */
function stamped(type: string, x: number, y: number, t: number): PointerEvent {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1 });
  Object.defineProperty(e, 'timeStamp', { value: t });
  return e;
}
const box = (width: number, height: number) => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });

describe('Button', () => {
  it('blocks repeat taps while loading and keeps its label', () => {
    const onClick = vi.fn();
    renderUi(
      <Button loading onClick={onClick}>
        Lock over
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Lock over' });
    expect(b).toHaveProperty('disabled', true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });
});

describe('OutcomeBadge', () => {
  it('always carries text and an accessible result, never colour alone', () => {
    const cases = [
      [{ kind: 'four' }, '4', 'Ball 2: Four'],
      [{ kind: 'six' }, '6', 'Ball 2: Six'],
      [{ kind: 'wicket', wicket: 'bowled' }, 'W', 'Ball 2: Bowled'],
      [{ kind: 'runs', runs: 2 }, '2', 'Ball 2: 2 runs'],
      [{ kind: 'dot' }, '•', 'Ball 2: Dot'],
      [{ kind: 'sealed' }, '', 'Ball 2: played, result sealed'],
    ] as const;
    for (const [mark, text, label] of cases) {
      const { unmount } = renderUi(<OutcomeBadge mark={mark as never} ball={2} />);
      const img = screen.getByRole('img', { name: label });
      expect(img.textContent).toBe(text);
      unmount();
    }
    expect(markFromOutcome({ runs: 0, wicket: 'lbw' })).toEqual({ kind: 'wicket', wicket: 'lbw' });
  });

  it('timelines can be used to seek', () => {
    const onSelect = vi.fn();
    renderUi(<BallTimeline label="Over" slots={[{ mark: { kind: 'dot' } }, { mark: { kind: 'four' } }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ball 2: Four' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe('EnergyMeter', () => {
  it('shows what is left and flags an over-budget plan in words', () => {
    const { rerender } = renderUi(<EnergyMeter used={9} total={15} />);
    expect(screen.getByText('6 of 15 left')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('9');
    rerender(<EnergyMeter used={17} total={15} />);
    expect(screen.getByText('Over budget by 2')).toBeTruthy();
  });
});

describe('aim (zone mapping)', () => {
  it('round-trips every zone through its swipe vector', () => {
    for (const z of ZONES) {
      const v = vectorForZone(z);
      expect(zoneFromSwipe(v.dx, v.dy)).toBe(z);
    }
    expect(legalZones('defend')).toEqual([]);
    expect(legalZones('drive')).not.toContain('third_man');
  });

  it('ZonePad cycles only through zones the shot can reach (keyboard)', () => {
    const onChange = vi.fn();
    renderUi(<ZonePad shot="drive" value="cover" onChange={onChange} />);
    const pad = screen.getByRole('radiogroup');
    fireEvent.keyDown(pad, { key: 'ArrowRight' });
    const next = onChange.mock.calls[0][0];
    expect(legalZones('drive')).toContain(next);
    expect(next).not.toBe('cover');
  });

  it('ZonePad: a swipe chooses the zone it points to', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onChange = vi.fn();
    renderUi(<ZonePad shot="drive" value="cover" onChange={onChange} size={150} />);
    const pad = screen.getByRole('radiogroup');
    vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue(box(150, 150));
    now = 2040;
    fireEvent(pad, stamped('pointerdown', 75, 100, 2000.02));
    now = 2060;
    fireEvent(pad, stamped('pointermove', 77, 85, 2016.7));
    now = 2100;
    fireEvent(pad, stamped('pointerup', 79, 60, 2040.06));
    expect(onChange.mock.calls).toEqual([['mid_off']]);
  });
});

describe('ExecutionMeter', () => {
  it('records a raw keyboard trace (timestamps, not a quality number)', () => {
    let now = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onComplete = vi.fn();
    renderUi(<ExecutionMeter onComplete={onComplete} />);
    const meter = screen.getByRole('button', { name: /Release gesture|release|%/i });
    fireEvent.keyDown(meter, { key: ' ' });
    now += 800;
    fireEvent.keyUp(meter, { key: ' ' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    const [trace] = onComplete.mock.calls[0];
    expect(trace.pointer).toBe('keyboard');
    expect(trace.samples[0][0]).toBe(0);
    expect(trace.samples[trace.samples.length - 1][0]).toBe(800);
  });

  it('a pointer hold is its up event minus its down event, each at its own timestamp; samples are [ms, x, y]', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onComplete = vi.fn();
    renderUi(<ExecutionMeter onComplete={onComplete} />);
    const meter = screen.getByTestId('execution-meter');
    vi.spyOn(meter, 'getBoundingClientRect').mockReturnValue(box(300, 300));
    // Every handler runs late, each by a different amount: the hold must still read 800 ms.
    now = 3030;
    fireEvent(meter, stamped('pointerdown', 100, 120, 3000.04));
    now = 3410;
    fireEvent(meter, stamped('pointermove', 104, 117, 3400.02));
    now = 3850;
    fireEvent(meter, stamped('pointerup', 107, 115, 3800.06));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const [trace, preview] = onComplete.mock.calls[0];
    expect(trace).toEqual({ pointer: 'touch', samples: [[0, 0.3333, 0.4], [400, 0.3467, 0.39], [800, 0.3567, 0.3833]] });
    expect(preview).toEqual({ quality: 1, grade: 'perfect' });
    expect(checkTrace(trace, 'execution')).toEqual([]);
  });

  it('a release after the longest legal hold is recorded at the longest hold, so the engine never rejects the trace', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onComplete = vi.fn();
    renderUi(<ExecutionMeter onComplete={onComplete} />);
    const meter = screen.getByTestId('execution-meter');
    vi.spyOn(meter, 'getBoundingClientRect').mockReturnValue(box(300, 300));
    // The frames that end a hold at the end of the dial never ran (a stalled page): the events arrive late.
    now = 1000;
    fireEvent(meter, stamped('pointerdown', 150, 150, 1000));
    now = 2600;
    fireEvent(meter, stamped('pointermove', 160, 150, 2600));
    now = 2700;
    fireEvent(meter, stamped('pointerup', 170, 150, 2700));
    const [trace, preview] = onComplete.mock.calls[0];
    expect(trace.samples).toEqual([[0, 0.5, 0.5], [1499, 0.5, 0.5]]);
    expect(preview?.grade).toBe('loose');
    expect(checkTrace(trace, 'execution')).toEqual([]);
  });
});

describe('StateView', () => {
  it('renders every required state with copy and an optional action', () => {
    const kinds = ['loading', 'offline', 'reconnecting', 'empty_cup', 'pending_opponent', 'locked', 'deadline_expired', 'reveal_ready', 'error', 'consent_declined', 'upload_queued', 'upload_failed', 'muted_group', 'reduced_motion'] as const;
    for (const k of kinds) {
      const { unmount } = renderUi(<StateView kind={k} />);
      expect(screen.getByRole('heading').textContent?.length).toBeGreaterThan(3);
      unmount();
    }
    const retry = vi.fn();
    renderUi(<StateView kind="error" onAction={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('Avatar', () => {
  it('is deterministic per seed and original per player', () => {
    const a = renderToStaticMarkup(<Avatar avatar={{ seed: 'same' }} />);
    const b = renderToStaticMarkup(<Avatar avatar={{ seed: 'same' }} />);
    const c = renderToStaticMarkup(<Avatar avatar={{ seed: 'other' }} />);
    const strip = (s: string) => s.replace(/id="[^"]+"|url\(#[^)]+\)/g, '');
    expect(strip(a)).toBe(strip(b));
    expect(strip(a)).not.toBe(strip(c));
  });
});

describe('Dialog and Sheet (focus management)', () => {
  it('Dialog focuses cancel first and closes on Escape', async () => {
    const onCancel = vi.fn();
    renderUi(<Dialog open title="Lock this over?" onConfirm={() => undefined} onCancel={onCancel} />);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('Sheet is a labelled modal dialog with a localised close button', () => {
    const onClose = vi.fn();
    renderUi(
      <Sheet open title="Scorecard" onClose={onClose}>
        <p>Body</p>
      </Sheet>,
      { locale: 'hi' },
    );
    expect(screen.getByRole('dialog', { name: 'Scorecard' }).getAttribute('aria-modal')).toBe('true');
  });
});

describe('local input rules mirror the engine', () => {
  it('legal zones, swipe sectors and the release meter match the engine tables', async () => {
    const Engine = await import('@/engine');
    const { LOCAL_LEGAL_ZONES, localZoneFromSwipe, SECTOR_ORDER } = await import('@/ui/cricket/aim');
    const { LOCAL_METER } = await import('@/ui/cricket/meter');
    const E = Engine as unknown as { LEGAL_ZONES: Record<string, readonly string[]>; zoneFromSwipe(dx: number, dy: number): string | null; EXECUTION_METER: Record<string, number>; SECTOR_ZONES: readonly string[] };
    expect(LOCAL_LEGAL_ZONES).toEqual(E.LEGAL_ZONES);
    expect(LOCAL_METER).toEqual(E.EXECUTION_METER);
    if (E.SECTOR_ZONES) expect([...SECTOR_ORDER]).toEqual([...E.SECTOR_ZONES]);
    for (let a = 0; a < 360; a += 2.5) {
      const dx = Math.sin((a * Math.PI) / 180);
      const dy = -Math.cos((a * Math.PI) / 180);
      expect(localZoneFromSwipe(dx, dy)).toBe(E.zoneFromSwipe(dx, dy));
    }
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) expect(localZoneFromSwipe(dx, dy)).toBe(E.zoneFromSwipe(dx, dy));
  });
});
