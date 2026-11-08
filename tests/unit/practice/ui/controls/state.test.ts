/**
 * The control in force on a device: stored per device in the Practice settings, answered once, switched only between
 * balls, and what depends on it (the first-ball lesson, the haptics, the camera). CTR-01, CTR-02, CTR-06, CTR-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticsEnabled, setHapticsEnabled, setHapticsInputAllowed } from '@/audio/haptics';
import { loadPracticeSettings, memoryStore, updatePracticeSettings, type KeyStore } from '@/practice/store';
import { PRACTICE_KEYS } from '@/practice/store/storage';
import { lockBrowserGestures } from '@/practice/ui/controls/browserGestures';
import { setCameraForTests, type ControlsCameraPort } from '@/practice/ui/controls/cameraPort';
import {
  acceptDefaultControl,
  canSwitchControl,
  controlIsChosen,
  currentControl,
  currentControlFeelsHaptics,
  noCameraDevice,
  setControl,
  setControlGuard,
  startControls,
  storedControl,
  subscribeControl,
} from '@/practice/ui/controls/state';
import { defaultLessonInput } from '@/practice/ui/lesson/inputType';

let store: KeyStore;
const realMatchMedia = window.matchMedia;
/** The shape every script and returning player has on disk: the demonstration seen, nothing about the choice. */
const seeded = (s: KeyStore) => s.setItem(PRACTICE_KEYS.settings, JSON.stringify({ v: 1, demoSeen: true }));

function pointers(q: Record<string, boolean>) {
  window.matchMedia = ((query: string) => ({ matches: q[query] ?? false })) as unknown as typeof window.matchMedia;
}
const touchDevice = () => pointers({ '(pointer: coarse)': true, '(any-pointer: coarse)': true });
function cameraApi(on: boolean) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: on ? { getUserMedia: vi.fn() } : undefined,
  });
}
const fakePort = () => ({ Setup: () => null, stop: vi.fn<() => void>() }) satisfies ControlsCameraPort;

beforeEach(() => {
  store = memoryStore();
  setHapticsEnabled(true);
  setHapticsInputAllowed(true);
  setCameraForTests(undefined);
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  cameraApi(false);
  setControlGuard(null);
  setCameraForTests(undefined);
  setHapticsInputAllowed(true);
});

describe('a device that has not chosen', () => {
  it('has the device default in force and has not answered', () => {
    expect(storedControl(store)).toBeNull();
    expect(controlIsChosen(store)).toBe(false);
    expect(currentControl(store)).toBe('mouse');
  });

  it('a touch device defaults to touch', () => {
    touchDevice();
    expect(currentControl(store)).toBe('touch');
  });

  it('a returning player (the demonstration seen) has answered already and is never asked (R-20)', () => {
    seeded(store);
    expect(controlIsChosen(store)).toBe(true);
    expect(storedControl(store)).toBeNull();
  });
});

describe('the choice is remembered per device (CTR-02)', () => {
  it('is stored with the answer, notified once, and survives a reload', () => {
    const seen = vi.fn();
    const off = subscribeControl(seen);
    expect(setControl('mouse', store)).toBe(true);
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(loadPracticeSettings(store)).toMatchObject({ control: 'mouse', controlChosen: true });
    // A reload reads the same key again.
    expect(storedControl(store)).toBe('mouse');
    expect(controlIsChosen(store)).toBe(true);
  });

  it('is gone when the site data is cleared', () => {
    setControl('mouse', store);
    store.removeItem(PRACTICE_KEYS.settings);
    expect(storedControl(store)).toBeNull();
    expect(controlIsChosen(store)).toBe(false);
  });

  it('changes nothing else the player set', () => {
    updatePracticeSettings({ assist: 'real', handedness: 'left', difficulty: 'expert', lessonSeen: true }, store);
    const before = loadPracticeSettings(store);
    setControl('mouse', store);
    const { control, controlChosen, ...rest } = loadPracticeSettings(store);
    const { control: c0, controlChosen: k0, ...rest0 } = before;
    expect([control, controlChosen]).toEqual(['mouse', true]);
    expect([c0, k0]).toEqual([null, false]);
    expect(rest).toEqual(rest0);
  });

  it('an unreadable or foreign value is read as not chosen, never as a control', () => {
    store.setItem(PRACTICE_KEYS.settings, JSON.stringify({ v: 1, control: 'gamepad' }));
    expect(storedControl(store)).toBeNull();
    expect(controlIsChosen(store)).toBe(false);
    store.setItem(PRACTICE_KEYS.settings, '{not json');
    expect(storedControl(store)).toBeNull();
  });
});

describe('switching happens between balls, never during one', () => {
  it('is refused while a delivery is under way: nothing is stored and nobody is told', () => {
    setControl('mouse', store);
    const seen = vi.fn();
    const off = subscribeControl(seen);
    setControlGuard(() => false);
    expect(canSwitchControl()).toBe(false);
    expect(setControl('mouse', store)).toBe(false);
    cameraApi(true);
    setCameraForTests({ info: { offered: true, packMb: 9.2 }, port: fakePort() });
    touchDevice();
    expect(setControl('touch', store)).toBe(false);
    expect(storedControl(store)).toBe('mouse');
    expect(seen).not.toHaveBeenCalled();
    setControlGuard(() => true);
    expect(setControl('touch', store)).toBe(true);
    expect(storedControl(store)).toBe('touch');
    off();
  });
});

describe('Start keeps the default (CTR-01)', () => {
  it('batting the first ball with the row untouched stores the default once', () => {
    expect(acceptDefaultControl(store)).toBe(true);
    expect(loadPracticeSettings(store)).toMatchObject({ control: 'mouse', controlChosen: true });
    expect(acceptDefaultControl(store)).toBe(false);
  });

  it('on a touch device the default it keeps is touch', () => {
    touchDevice();
    acceptDefaultControl(store);
    expect(storedControl(store)).toBe('touch');
  });

  it('never overwrites an answer, and never asks a player who has already answered', () => {
    setControl('mouse', store);
    touchDevice();
    expect(acceptDefaultControl(store)).toBe(false);
    expect(storedControl(store)).toBe('mouse');
    const returning = memoryStore();
    seeded(returning);
    expect(acceptDefaultControl(returning)).toBe(false);
    expect(storedControl(returning)).toBeNull();
  });
});

describe('haptics are for the finger only (CTR-06)', () => {
  it('touch feels them; mouse and camera do not', () => {
    touchDevice();
    setControl('touch', store);
    expect(hapticsEnabled()).toBe(true);
    expect(currentControlFeelsHaptics(store)).toBe(true);
    cameraApi(true);
    setCameraForTests({ info: { offered: true, packMb: 9.2 }, port: fakePort() });
    setControl('camera', store);
    expect(currentControl(store)).toBe('camera');
    expect(hapticsEnabled()).toBe(false);
    expect(currentControlFeelsHaptics(store)).toBe(false);
  });

  it('a mouse on the web feels none, and the Vibration switch in Settings still decides for touch', () => {
    setControl('mouse', store);
    expect(hapticsEnabled()).toBe(false);
    touchDevice();
    setControl('touch', store);
    expect(hapticsEnabled()).toBe(true);
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
  });
});

describe('the camera runs only while it is the control', () => {
  it('moving away from it stops it at once; choosing it does not', () => {
    const port = fakePort();
    cameraApi(true);
    setCameraForTests({ info: { offered: true, packMb: 9.2 }, port });
    setControl('camera', store);
    expect(port.stop).not.toHaveBeenCalled();
    setControl('mouse', store);
    expect(port.stop).toHaveBeenCalledTimes(1);
  });

  it('a stored camera is not in force where the browser has no camera API, and the choice is kept for when it has', () => {
    cameraApi(true);
    setCameraForTests({ info: { offered: true, packMb: 9.2 }, port: fakePort() });
    setControl('camera', store);
    cameraApi(false);
    expect(storedControl(store)).toBe('camera');
    expect(currentControl(store)).toBe('mouse');
    cameraApi(true);
    expect(currentControl(store)).toBe('camera');
  });
});

describe('what the rest of Practice reads', () => {
  it('the first-ball lesson teaches the control the player chose, and the guess before that', () => {
    const stop = startControls(() => true, store);
    // Not chosen yet: the lesson falls back to what the device most likely has (jsdom reports nothing: touch).
    expect(defaultLessonInput()).toBe('touch');
    setControl('mouse', store);
    expect(defaultLessonInput()).toBe('mouse');
    stop();
    expect(defaultLessonInput()).toBe('touch');
  });

  it('starting binds the guard to the flow, and stopping undoes everything it did', () => {
    const port = fakePort();
    cameraApi(true);
    setCameraForTests({ info: { offered: true, packMb: 9.2 }, port });
    setControl('mouse', store);
    let live = false;
    const stop = startControls(() => !live, store);
    expect(hapticsEnabled()).toBe(false);
    live = true;
    expect(canSwitchControl()).toBe(false);
    live = false;
    expect(canSwitchControl()).toBe(true);
    stop();
    expect(hapticsEnabled()).toBe(true);
    expect(canSwitchControl()).toBe(true);
    expect(port.stop).toHaveBeenCalled();
  });
});

describe('knowing that there is no camera', () => {
  const kinds = (...k: string[]) => ({ enumerateDevices: async () => k.map((kind) => ({ kind })) });

  it('only a list that has devices and no camera proves it', async () => {
    expect(await noCameraDevice(kinds('audioinput', 'audiooutput'))).toBe(true);
    expect(await noCameraDevice(kinds('audioinput', 'videoinput'))).toBe(false);
  });

  it('an empty list, a failure or a missing API proves nothing', async () => {
    expect(await noCameraDevice(kinds())).toBe(false);
    expect(await noCameraDevice({ enumerateDevices: () => Promise.reject(new Error('blocked')) })).toBe(false);
    expect(await noCameraDevice({})).toBe(false);
    expect(await noCameraDevice(undefined)).toBe(false);
  });
});

describe('browser gestures while Practice is open', () => {
  it("the page refuses the browser's sideways swipes only while Practice is open", () => {
    const el = (value: string) => ({ style: { overscrollBehavior: value } }) as unknown as HTMLElement;
    const doc = { documentElement: el('auto'), body: el('') };
    const unlock = lockBrowserGestures(doc);
    expect([doc.documentElement.style.overscrollBehavior, doc.body.style.overscrollBehavior]).toEqual(['none', 'none']);
    unlock();
    expect([doc.documentElement.style.overscrollBehavior, doc.body.style.overscrollBehavior]).toEqual(['auto', '']);
  });

  it('starting Practice locks the real page and stopping it puts the page back', () => {
    const before = document.documentElement.style.overscrollBehavior;
    const stop = startControls(() => true, store);
    // jsdom keeps what was assigned, whether or not its CSS engine knows the property.
    expect(document.documentElement.style.overscrollBehavior).toBe('none');
    stop();
    expect(document.documentElement.style.overscrollBehavior).toBe(before);
  });
});
