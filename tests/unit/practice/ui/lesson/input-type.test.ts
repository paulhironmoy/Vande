/** Which input the card teaches: the control the player chose, else what the device most likely has; the camera seam. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultLessonInput,
  lessonCameraPort,
  lessonInputOfPointerType,
  setLessonCameraPort,
  setLessonControlProvider,
  subscribeLessonCamera,
  type LessonCameraPort,
} from '@/practice/ui/lesson/inputType';

afterEach(() => {
  setLessonCameraPort(null);
  setLessonControlProvider(null);
});

describe('defaultLessonInput', () => {
  it('follows the device before any choice: a touch screen is touch, a fine pointer is a mouse, nothing known is touch', () => {
    expect(defaultLessonInput({})).toBe('touch');
    expect(defaultLessonInput({ fine: true })).toBe('mouse');
    expect(defaultLessonInput({ coarse: true })).toBe('touch');
    expect(defaultLessonInput({ coarse: true, fine: true })).toBe('touch');
  });

  it('the control the player chose wins over the guess; a camera in use wins over the device', () => {
    expect(defaultLessonInput({ chosen: 'mouse', coarse: true })).toBe('mouse');
    expect(defaultLessonInput({ chosen: 'touch', fine: true })).toBe('touch');
    expect(defaultLessonInput({ chosen: 'camera', fine: true })).toBe('camera');
    expect(defaultLessonInput({ camera: true, fine: true })).toBe('camera');
  });

  it('reads the control provider CONTROLS registers, each time the lesson opens; a failing or empty provider is ignored', () => {
    expect(defaultLessonInput()).toBe('touch');
    let choice: 'mouse' | 'camera' | null = 'mouse';
    setLessonControlProvider(() => choice);
    expect(defaultLessonInput()).toBe('mouse');
    choice = 'camera';
    expect(defaultLessonInput()).toBe('camera');
    choice = null;
    expect(defaultLessonInput()).toBe('touch');
    setLessonControlProvider(() => {
      throw new Error('storage blocked');
    });
    expect(defaultLessonInput()).toBe('touch');
  });

  it('a registered camera that is active makes the camera the card’s input', () => {
    setLessonCameraPort({ active: () => true, tracking: () => true, subscribe: () => () => undefined });
    expect(defaultLessonInput()).toBe('camera');
    setLessonCameraPort({ active: () => false, tracking: () => false, subscribe: () => () => undefined });
    expect(defaultLessonInput()).toBe('touch');
  });
});

describe('the pointer type of an event', () => {
  it('names mouse, pen and touch, and nothing else', () => {
    expect(lessonInputOfPointerType('mouse')).toBe('mouse');
    expect(lessonInputOfPointerType('pen')).toBe('pen');
    expect(lessonInputOfPointerType('touch')).toBe('touch');
    expect(lessonInputOfPointerType('')).toBeNull();
    expect(lessonInputOfPointerType('keyboard')).toBeNull();
  });
});

describe('the camera port', () => {
  it('is none until the camera registers one; subscribers hear of a registration and of the port’s own changes', () => {
    expect(lessonCameraPort()).toBeNull();
    const heard = vi.fn();
    const off = subscribeLessonCamera(heard);
    let portCb: (() => void) | null = null;
    const unsub = vi.fn();
    const port: LessonCameraPort = {
      active: () => true,
      tracking: () => false,
      subscribe: (cb) => {
        portCb = cb;
        return unsub;
      },
    };
    setLessonCameraPort(port);
    expect(lessonCameraPort()).toBe(port);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    setLessonCameraPort(null);
    expect(heard).toHaveBeenCalledTimes(1);
    // A late subscriber on a registered port is told when the port changes, and can let go of it.
    setLessonCameraPort(port);
    const later = vi.fn();
    const offLater = subscribeLessonCamera(later);
    portCb!();
    expect(later).toHaveBeenCalledTimes(1);
    offLater();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
