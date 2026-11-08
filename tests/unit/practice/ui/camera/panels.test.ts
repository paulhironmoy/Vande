/**
 * Which screen the camera shows for each state of the store: one screen, one purpose, and a failure always outranks the
 * rest. The same function serves the setup dialog and the card before a ball.
 */
import { describe, expect, it } from 'vitest';
import { downloadOf, panelFor } from '@/practice/ui/camera/panels';
import { INITIAL_UI, type CameraUi } from '@/practice/ui/camera/store';
import { NO_PACK, type PackStatus } from '@/practice/ui/camera/ports';
import { SEEN } from './fakeSession';

const ui = (patch: Partial<CameraUi> = {}): CameraUi => ({ ...INITIAL_UI, ...patch });
const downloading = (done: number, state: PackStatus['state'] = 'downloading'): PackStatus => ({
  state,
  bytesDone: done,
  bytesTotal: 9_200_000,
  attempt: 1,
  maxAttempts: 2,
});

describe('before the player taps "Use camera"', () => {
  it('shows the consent in setup (the short form when this device has seen it) and the start button on the card', () => {
    expect(panelFor(ui(), 'setup')).toEqual({ kind: 'consent', short: false });
    expect(panelFor(ui({ consentSeen: true }), 'setup')).toEqual({ kind: 'consent', short: true });
    // The card on a device that has seen the consent is one tap; on a device that has not, it is the consent itself.
    expect(panelFor(ui({ consentSeen: true }), 'card')).toEqual({ kind: 'start' });
    expect(panelFor(ui(), 'card')).toEqual({ kind: 'consent', short: false });
  });
});

describe('after the tap', () => {
  it('waits for the system prompt while the camera is opening', () => {
    expect(panelFor(ui({ started: true, stage: 'idle' }), 'setup')).toEqual({ kind: 'permission' });
    expect(panelFor(ui({ started: true, stage: 'opening' }), 'card')).toEqual({ kind: 'permission' });
  });

  it('shows the picture with the download behind it while the pack comes', () => {
    const panel = panelFor(ui({ started: true, stage: 'loading', pack: downloading(2_300_000) }), 'setup');
    expect(panel).toMatchObject({
      kind: 'view',
      starting: true,
      canStart: false,
      hint: 'finding',
      badge: 'finding',
      download: { state: 'downloading', pct: 25, attempt: 1, maxAttempts: 2, failure: null },
    });
  });

  it('shows the live hint and badge once running, and "Start batting" only for a steady person', () => {
    const running = ui({ started: true, stage: 'running', pack: { ...NO_PACK, state: 'cached' } });
    expect(
      panelFor({ ...running, readiness: { ...SEEN, ready: false, handsReadyZone: false } }, 'setup'),
    ).toMatchObject({
      kind: 'view',
      hint: 'hands',
      badge: 'yes',
      canStart: false,
      download: null,
    });
    expect(panelFor({ ...running, readiness: SEEN }, 'setup')).toMatchObject({
      hint: 'ok',
      badge: 'yes',
      canStart: true,
    });
    // Lost, or a picture that went wrong, is never "ready to bat".
    expect(panelFor({ ...running, readiness: SEEN, lost: true }, 'setup')).toMatchObject({
      canStart: false,
      badge: 'no',
    });
  });
});

describe('failures', () => {
  it('shows a troubleshooting panel for a cause, even before the tap (an in-app browser, a camera that cannot work here)', () => {
    expect(panelFor(ui({ problem: 'in_app_browser' }), 'setup')).toEqual({ kind: 'trouble', case: 'inapp' });
    expect(panelFor(ui({ problem: 'unsupported' }), 'card')).toEqual({ kind: 'trouble', case: 'unsupported' });
    expect(panelFor(ui({ started: true, stage: 'failed', problem: 'blocked' }), 'setup')).toEqual({
      kind: 'trouble',
      case: 'blocked',
    });
    expect(panelFor(ui({ started: true, stage: 'running', problem: 'black' }), 'card')).toEqual({
      kind: 'trouble',
      case: 'black',
    });
  });

  it('keeps a download failure on the picture, with the reason and room to try again', () => {
    const panel = panelFor(
      ui({ started: true, stage: 'failed', problem: 'offline', pack: downloading(0, 'downloading') }),
      'setup',
    );
    expect(panel).toMatchObject({ kind: 'view', download: { state: 'failed', failure: 'offline' } });
  });

  it('calls a failed session that names no cause "not available here"', () => {
    expect(panelFor(ui({ started: true, stage: 'failed' }), 'setup')).toEqual({ kind: 'trouble', case: 'unsupported' });
  });

  it('offers the light panel only while running and still not seen', () => {
    const base = ui({ started: true, stage: 'running', lightHelp: true });
    expect(panelFor({ ...base, readiness: { ...SEEN, ready: false, poorLight: true } }, 'card')).toEqual({
      kind: 'trouble',
      case: 'light',
    });
    expect(panelFor({ ...base, readiness: SEEN }, 'card')).toMatchObject({ kind: 'view' });
  });
});

describe('downloadOf', () => {
  it('has nothing to show when nothing is downloading or it is stored already', () => {
    expect(downloadOf(NO_PACK, null)).toBeNull();
    expect(downloadOf({ ...NO_PACK, state: 'cached' }, null)).toBeNull();
    expect(downloadOf({ ...NO_PACK, state: 'checking' }, null)).toBeNull();
  });

  it('reports whole percent, megabytes and the attempt', () => {
    expect(downloadOf(downloading(4_600_000, 'stalled'), null)).toMatchObject({
      state: 'stalled',
      pct: 50,
      doneMb: 4.6,
      totalMb: 9.2,
      attempt: 1,
      maxAttempts: 2,
    });
    expect(downloadOf(downloading(9_200_000, 'verifying'), null)?.pct).toBe(100);
    expect(downloadOf({ ...downloading(0), bytesTotal: 0 }, null)?.pct).toBe(0);
    expect(downloadOf(downloading(99_000_000), null)?.pct).toBe(100);
  });

  it('marks a failure with its reason whatever the pack said', () => {
    expect(downloadOf(NO_PACK, 'space')).toMatchObject({ state: 'failed', failure: 'space' });
  });
});
