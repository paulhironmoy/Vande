/**
 * Changing how you bat after the first time (Settings, and the quiet chip in the over's setup, which is only reachable
 * between balls): applied at once for the pointer controls, behind its own button for the camera, refused mid-ball,
 * and fully usable from the keyboard (CTR-01, CTR-07, CTR-08, CTR-09).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { loadPracticeSettings, updatePracticeSettings } from '@/practice/store';
import { setCameraForTests, type ControlsCameraPort } from '@/practice/ui/controls/cameraPort';
import { setControlGuard } from '@/practice/ui/controls/state';
import { ControlChip, ControlSetting } from '@/practice/ui/controls';
import { w } from './words';

const realMatchMedia = window.matchMedia;
const pointers = (q: Record<string, boolean>) => {
  window.matchMedia = ((query: string) => ({ matches: q[query] ?? false })) as unknown as typeof window.matchMedia;
};
const HYBRID = { '(any-pointer: coarse)': true, '(any-pointer: fine)': true };
const cameraApi = (on: boolean) =>
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: on ? { getUserMedia: vi.fn() } : undefined,
  });
const Setup: ControlsCameraPort['Setup'] = ({ onDone }) => (
  <div data-testid="fake-setup">
    <button onClick={() => onDone({ kind: 'ready' })}>ready</button>
    <button onClick={() => onDone({ kind: 'cancelled' })}>cancel</button>
  </div>
);
const stop = vi.fn();
const withCamera = () => setCameraForTests({ info: { offered: true, packMb: 9.2 }, port: { Setup, stop } });
const radio = (id: string) => screen.getByTestId(`practice-settings-control-${id}`);
const stored = () => loadPracticeSettings();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vc:practice:settings', JSON.stringify({ v: 1, demoSeen: true }));
  cameraApi(true);
  stop.mockClear();
});
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  cameraApi(false);
  setCameraForTests(undefined);
  setControlGuard(null);
});

describe('the Settings row', () => {
  it('is a radio group named by the question, with the control in force checked', () => {
    withCamera();
    render(<ControlSetting />);
    expect(screen.getByRole('heading', { name: w('practice.controls.setting.title') })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: w('practice.controls.title') })).toBeTruthy();
    expect(radio('mouse').getAttribute('aria-checked')).toBe('true');
    expect(radio('camera').getAttribute('aria-checked')).toBe('false');
  });

  it('applies Touch or Mouse at once, says so politely, and tells the flow', () => {
    pointers(HYBRID);
    withCamera();
    const onChanged = vi.fn();
    render(<ControlSetting onChanged={onChanged} />);
    fireEvent.click(radio('touch'));
    expect(stored().control).toBe('touch');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('practice-settings-control-status').textContent).toBe(
      w('practice.controls.switched', { control: 'Touch' }),
    );
    fireEvent.click(radio('mouse'));
    expect(stored().control).toBe('mouse');
  });

  it('shows the camera behind its own button: picking it changes nothing until its screens say ready', async () => {
    withCamera();
    render(<ControlSetting />);
    fireEvent.click(radio('camera'));
    expect(radio('camera').getAttribute('aria-checked')).toBe('true');
    expect(stored().control).toBeNull();
    expect(screen.queryByTestId('fake-setup')).toBeNull();
    fireEvent.click(screen.getByTestId('practice-settings-control-use-camera'));
    fireEvent.click(await screen.findByText('ready'));
    expect(stored().control).toBe('camera');
    expect(screen.queryByTestId('practice-settings-control-use-camera')).toBeNull();
  });

  it('backing out of the camera keeps what the player had, and the button stays for another try', async () => {
    withCamera();
    updatePracticeSettings({ control: 'mouse' });
    render(<ControlSetting />);
    fireEvent.click(radio('camera'));
    fireEvent.click(screen.getByTestId('practice-settings-control-use-camera'));
    fireEvent.click(await screen.findByText('cancel'));
    expect(stored().control).toBe('mouse');
    expect(screen.getByTestId('practice-settings-control-use-camera')).toBeTruthy();
    // Choosing the mouse again drops the pending camera.
    fireEvent.click(radio('mouse'));
    expect(screen.queryByTestId('practice-settings-control-use-camera')).toBeNull();
    expect(radio('mouse').getAttribute('aria-checked')).toBe('true');
  });

  it('is refused while a delivery is under way, in plain words, and nothing is stored', () => {
    pointers(HYBRID);
    withCamera();
    updatePracticeSettings({ control: 'mouse' });
    setControlGuard(() => false);
    render(<ControlSetting />);
    fireEvent.click(radio('touch'));
    expect(stored().control).toBe('mouse');
    expect(screen.getByTestId('practice-settings-control-status').textContent).toBe(
      w('practice.controls.between_balls'),
    );
  });

  it('moving from the camera to the mouse stops the camera', () => {
    withCamera();
    updatePracticeSettings({ control: 'camera' });
    render(<ControlSetting />);
    expect(radio('camera').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('mouse'));
    expect(stored().control).toBe('mouse');
    expect(stop).toHaveBeenCalled();
  });
});

describe('from the keyboard (CTR-07)', () => {
  it('arrows move through the available choices and skip the one that is switched off', () => {
    pointers(HYBRID);
    cameraApi(false);
    withCamera();
    updatePracticeSettings({ control: 'mouse' });
    render(<ControlSetting />);
    expect(radio('camera').getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(radio('mouse'), { key: 'ArrowDown' });
    expect(stored().control).toBe('touch');
    // The camera is switched off here, so the next arrow wraps round to the mouse.
    fireEvent.keyDown(radio('touch'), { key: 'ArrowDown' });
    expect(stored().control).toBe('mouse');
    fireEvent.keyDown(radio('mouse'), { key: 'End' });
    expect(stored().control).toBe('touch');
    fireEvent.keyDown(radio('touch'), { key: 'Home' });
    expect(stored().control).toBe('mouse');
  });

  it('only the checked choice is in the tab order (a radio group)', () => {
    pointers(HYBRID);
    withCamera();
    render(<ControlSetting />);
    expect(radio('mouse').tabIndex).toBe(0);
    expect(radio('touch').tabIndex).toBe(-1);
    expect(radio('camera').tabIndex).toBe(-1);
  });

  it('a switched-off choice is still read out with its reason (described by it) and does nothing when pressed', () => {
    cameraApi(false);
    withCamera();
    render(<ControlSetting />);
    const camera = radio('camera');
    const described = camera.getAttribute('aria-describedby')!.split(' ');
    const text = described.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(text).toContain(w('practice.controls.unavailable.api'));
    fireEvent.click(camera);
    expect(screen.queryByTestId('practice-settings-control-use-camera')).toBeNull();
  });
});

describe('the quiet chip in the over setup', () => {
  it('names the control in force, reads as one name for a screen reader, and opens the picker only when asked', () => {
    withCamera();
    updatePracticeSettings({ control: 'mouse' });
    render(<ControlChip />);
    const toggle = screen.getByTestId('practice-control-chip-toggle');
    expect(toggle.textContent).toBe(
      `${w('practice.controls.chip', { control: 'Mouse' })}. ${w('practice.controls.change')}`,
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('practice-control-chip-group')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('practice-control-chip-group')).toBeTruthy();
    expect(screen.getByText(w('practice.controls.between_balls'))).toBeTruthy();
    expect(screen.getByText(w('practice.controls.safe'))).toBeTruthy();
  });

  it('follows a switch made inside it', () => {
    pointers(HYBRID);
    withCamera();
    updatePracticeSettings({ control: 'mouse' });
    render(<ControlChip />);
    fireEvent.click(screen.getByTestId('practice-control-chip-toggle'));
    fireEvent.click(screen.getByTestId('practice-control-chip-group-touch'));
    expect(stored().control).toBe('touch');
    expect(screen.getByTestId('practice-control-chip-toggle').textContent).toBe(
      `${w('practice.controls.chip', { control: 'Touch' })}. ${w('practice.controls.change')}`,
    );
  });
});

describe('what the Settings row says about the camera and about vibration', () => {
  it('under the camera it repeats, in one quiet line, that pictures stay on the device', () => {
    withCamera();
    updatePracticeSettings({ control: 'camera' });
    render(<ControlSetting />);
    expect(screen.getByTestId('practice-settings-control-privacy').textContent).toBe(w('practice.camera.privacy.line'));
  });

  it('says why a mouse or camera player feels no vibration, and says nothing to a touch player', () => {
    pointers(HYBRID);
    withCamera();
    updatePracticeSettings({ control: 'mouse' });
    render(<ControlSetting />);
    expect(screen.getByTestId('practice-settings-control-no-vibrate')).toBeTruthy();
    expect(screen.queryByTestId('practice-settings-control-privacy')).toBeNull();
    fireEvent.click(radio('touch'));
    expect(screen.queryByTestId('practice-settings-control-no-vibrate')).toBeNull();
  });
});
