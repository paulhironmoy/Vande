/**
 * The compact "How do you want to bat?" row on the setup screen (R-20; CTR-01, CTR-03, CTR-08): the default preselected,
 * answered by a tap or by batting on, the camera only after its own tap, a returning player never asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { loadPracticeSettings } from '@/practice/store';
import { setCameraForTests, type ControlsCameraPort } from '@/practice/ui/controls/cameraPort';
import { setControlGuard } from '@/practice/ui/controls/state';
import { ControlRow } from '@/practice/ui/controls';
import { w } from './words';

const realMatchMedia = window.matchMedia;
const pointers = (q: Record<string, boolean>) => {
  window.matchMedia = ((query: string) => ({ matches: q[query] ?? false })) as unknown as typeof window.matchMedia;
};
const cameraApi = (on: boolean) =>
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: on ? { getUserMedia: vi.fn() } : undefined,
  });

/** Stands in for CAMERA-UX's screens: three buttons, one per way they can end. */
const Setup: ControlsCameraPort['Setup'] = ({ onDone, fallback }) => (
  <div data-testid="fake-setup">
    <button onClick={() => onDone({ kind: 'ready' })}>ready</button>
    <button onClick={() => onDone({ kind: 'fallback', to: fallback })}>fallback</button>
    <button onClick={() => onDone({ kind: 'cancelled' })}>cancel</button>
  </div>
);
const withCamera = (packMb: number | null = 9.2) =>
  setCameraForTests({ info: { offered: true, packMb }, port: { Setup, stop: vi.fn() } });

const stored = () => loadPracticeSettings();
const chip = (id: string) => screen.getByTestId(`practice-control-row-${id}`);

beforeEach(() => {
  localStorage.clear();
  cameraApi(true);
});
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  cameraApi(false);
  setCameraForTests(undefined);
  setControlGuard(null);
});

describe('a fresh device', () => {
  it('asks in one compact row, with the web default already selected and the keyboard mentioned', () => {
    withCamera();
    render(<ControlRow />);
    const group = screen.getByRole('group', { name: w('practice.controls.title') });
    expect(group).toBeTruthy();
    expect(chip('mouse').getAttribute('aria-pressed')).toBe('true');
    expect(chip('camera').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('practice-control-row-touch')).toBeNull();
    expect(group.textContent).toContain(w('practice.controls.keyboard'));
    expect(group.textContent).toContain(w('practice.controls.remembered'));
  });

  it('a touch device has Touch selected, and no Mouse', () => {
    pointers({ '(pointer: coarse)': true, '(any-pointer: coarse)': true });
    withCamera();
    render(<ControlRow />);
    expect(chip('touch').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('practice-control-row-mouse')).toBeNull();
  });

  it('a build without the camera module shows the pointer control alone', () => {
    setCameraForTests({ info: null, port: null });
    render(<ControlRow />);
    expect(screen.queryByTestId('practice-control-row-camera')).toBeNull();
    expect(screen.queryByTestId('practice-control-row-note')).toBeNull();
    expect(chip('mouse').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows nothing until the player taps: the row alone stores nothing', () => {
    withCamera();
    render(<ControlRow />);
    expect(stored()).toMatchObject({ control: null, controlChosen: false });
  });
});

describe('a returning player, or any script that seeds the demonstration as seen', () => {
  it('never meets the row', () => {
    localStorage.setItem('vc:practice:settings', JSON.stringify({ v: 1, demoSeen: true }));
    withCamera();
    const { container } = render(<ControlRow />);
    expect(container.innerHTML).toBe('');
  });
});

describe('answering', () => {
  it('a tap on the default stores it and says so; the row stays for the visit', () => {
    withCamera();
    render(<ControlRow />);
    fireEvent.click(chip('mouse'));
    expect(stored()).toMatchObject({ control: 'mouse', controlChosen: true });
    expect(screen.getByTestId('practice-control-row-status').textContent).toBe(
      w('practice.controls.switched', { control: 'Mouse' }),
    );
    expect(screen.getByTestId('practice-control-row')).toBeTruthy();
  });

  it('a device with a finger and a mouse can answer with either', () => {
    pointers({ '(any-pointer: coarse)': true, '(any-pointer: fine)': true });
    withCamera();
    render(<ControlRow />);
    expect(chip('mouse').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip('touch'));
    expect(stored().control).toBe('touch');
    expect(chip('touch').getAttribute('aria-pressed')).toBe('true');
    expect(chip('mouse').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the camera (CTR-01, CTR-03)', () => {
  it('says in one honest line what it needs, with the download size as built', () => {
    withCamera(9.2);
    render(<ControlRow />);
    expect(screen.getByTestId('practice-control-row-note').textContent).toBe(
      w('practice.controls.camera.needs', { mb: '9.2' }),
    );
  });

  it('opens nothing and asks for nothing until it is tapped', () => {
    withCamera();
    render(<ControlRow />);
    expect(screen.queryByTestId('fake-setup')).toBeNull();
    expect(stored().control).toBeNull();
  });

  it('tapping it opens its own screens; "ready" makes it the control', async () => {
    withCamera();
    render(<ControlRow />);
    fireEvent.click(chip('camera'));
    expect(await screen.findByTestId('fake-setup')).toBeTruthy();
    expect(stored().control).toBeNull();
    fireEvent.click(screen.getByText('ready'));
    expect(stored()).toMatchObject({ control: 'camera', controlChosen: true });
    expect(screen.queryByTestId('fake-setup')).toBeNull();
    expect(chip('camera').getAttribute('aria-pressed')).toBe('true');
  });

  it('"Bat with mouse" inside the camera screens makes the mouse the control, in one tap', async () => {
    withCamera();
    render(<ControlRow />);
    fireEvent.click(chip('camera'));
    fireEvent.click(await screen.findByText('fallback'));
    expect(stored()).toMatchObject({ control: 'mouse', controlChosen: true });
    expect(chip('mouse').getAttribute('aria-pressed')).toBe('true');
  });

  it('backing out changes nothing and leaves the default selected', async () => {
    withCamera();
    render(<ControlRow />);
    fireEvent.click(chip('camera'));
    fireEvent.click(await screen.findByText('cancel'));
    expect(stored()).toMatchObject({ control: null, controlChosen: false });
    expect(chip('mouse').getAttribute('aria-pressed')).toBe('true');
  });

  it('is switched off with the plain reason where the browser has no camera API, and never opens', () => {
    cameraApi(false);
    withCamera();
    render(<ControlRow />);
    expect(chip('camera').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('practice-control-row-note').textContent).toBe(w('practice.controls.unavailable.api'));
    fireEvent.click(chip('camera'));
    expect(screen.queryByTestId('fake-setup')).toBeNull();
    expect(stored().control).toBeNull();
  });

  it('is switched off on an insecure page, saying so (a LAN address, say)', () => {
    cameraApi(false);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    withCamera();
    render(<ControlRow />);
    expect(screen.getByTestId('practice-control-row-note').textContent).toBe(w('practice.controls.unavailable.secure'));
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: undefined });
  });

  it('never the default: the mouse stays selected while the camera is offered', () => {
    withCamera();
    render(<ControlRow />);
    expect(chip('camera').getAttribute('aria-pressed')).toBe('false');
  });
});
