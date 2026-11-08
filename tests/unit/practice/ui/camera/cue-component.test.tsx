/**
 * The silhouette the first-ball lesson embeds: a body and two hands that move only when asked to, a still pair of
 * numbered pictures with arrows for Reduced Motion, hidden from screen readers (the lesson's words say the same), and
 * the lesson's own wrapper labelling the still. It is registered through the lesson's seam, never reaching around it.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/app/store';
import { createPracticeT } from '@/i18n/practice';
import { updatePracticeSettings } from '@/practice/store';
import { CameraCue } from '@/practice/ui/camera/CameraCue';
import { CUE_TIMELINE } from '@/practice/ui/camera/cue';
import { registerLessonPort } from '@/practice/ui/camera/lessonPort';
import { resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { publishCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { Ghost } from '@/practice/ui/lesson/Ghost';
import { lessonCameraPort, setLessonCameraPort } from '@/practice/ui/lesson/inputType';
import { createFakeSession, SEEN } from './fakeSession';

const en = createPracticeT('en', null);

beforeEach(() => {
  localStorage.clear();
  resetCameraUi(false);
  useApp.setState({ reducedMotion: false });
});
afterEach(() => {
  cleanup();
  resetCameraController();
  setCameraSessionFactory(null);
  setLessonCameraPort(null);
  resetCameraUi(false);
  vi.restoreAllMocks();
});

describe('the silhouette', () => {
  it('moves when asked to: a body, two hands, and an animation frame loop that stops when it goes', () => {
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const view = render(<CameraCue play label="x" handedness="right" />);
    const svg = screen.getByTestId('camera-cue');
    expect(svg.dataset.motion).toBe('loop');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.querySelectorAll('g')).toHaveLength(2);
    expect(request).toHaveBeenCalled();
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('redraws the arms and hands at each frame from the real move, with bone lengths intact', () => {
    let frame: ((t: number) => void) | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb;
      return 1;
    });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    render(<CameraCue play label="x" handedness="right" />);
    const svg = screen.getByTestId('camera-cue');
    const before = Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d'));
    act(() => frame?.(1000 + CUE_TIMELINE.holdEnd - 100));
    const after = Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d'));
    expect(after).not.toEqual(before);
    expect(after.every((d) => /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/.test(d ?? ''))).toBe(true);
    const hands = Array.from(svg.querySelectorAll('g')).map((g) => g.getAttribute('transform'));
    expect(hands.every((t) => /^translate\([\d.]+ [\d.]+\)$/.test(t ?? ''))).toBe(true);
  });

  it('stands still for Reduced Motion: no animation frame, two numbered pictures and two arrows', () => {
    const request = vi.spyOn(window, 'requestAnimationFrame');
    render(<CameraCue play={false} label="x" handedness="left" />);
    const svg = screen.getByTestId('camera-cue');
    expect(svg.dataset.motion).toBe('still');
    expect(svg.dataset.hand).toBe('left');
    expect(request).not.toHaveBeenCalled();
    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toEqual(['1', '2']);
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(6);
  });

  it("follows the player's hand setting when none is given", () => {
    updatePracticeSettings({ handedness: 'left' });
    render(<CameraCue play={false} />);
    expect(screen.getByTestId('camera-cue').dataset.hand).toBe('left');
  });
});

describe("through the lesson's seam", () => {
  it("registers the port with the camera's state and the silhouette, and gives it back on release", () => {
    setCameraSessionFactory(() => Promise.resolve(createFakeSession()));
    resetCameraController();
    expect(lessonCameraPort()).toBeNull();
    const release = registerLessonPort();
    const port = lessonCameraPort()!;
    expect(port.Cue).toBe(CameraCue);
    expect(port.active()).toBe(false);
    expect(port.tracking()).toBe(false);
    publishCameraUi({ started: true, stage: 'running', readiness: SEEN });
    expect(port.active()).toBe(true);
    expect(port.tracking()).toBe(true);
    publishCameraUi({ lost: true });
    expect(port.tracking()).toBe(false);
    const cb = vi.fn();
    const off = port.subscribe(cb);
    publishCameraUi({ lost: false });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    release();
    expect(lessonCameraPort()).toBeNull();
  });

  it('keeps the port while anyone holds it, and does not take back one that someone replaced', () => {
    const a = registerLessonPort();
    const b = registerLessonPort();
    a();
    expect(lessonCameraPort()).not.toBeNull();
    b();
    expect(lessonCameraPort()).toBeNull();
    const c = registerLessonPort();
    const mine = lessonCameraPort()!;
    setLessonCameraPort({ ...mine, active: () => true });
    c();
    expect(lessonCameraPort()).not.toBeNull();
  });

  it('is what the lesson draws for the camera: the silhouette in its picture box, labelled when still', () => {
    const release = registerLessonPort();
    const label = en.tk('practice.lesson.ghost.camera');
    const view = render(<Ghost input="camera" handedness="right" play label={label} />);
    expect(screen.getByTestId('camera-cue').dataset.motion).toBe('loop');
    expect(screen.queryByTestId('lesson-ghost')).toBeNull();
    view.unmount();
    render(<Ghost input="camera" handedness="right" play={false} label={label} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(label);
    expect(screen.getByTestId('camera-cue').dataset.motion).toBe('still');
    release();
  });

  it("hands the lesson the camera's own dry swing and nothing else", async () => {
    const session = createFakeSession();
    setCameraSessionFactory(() => Promise.resolve(session));
    resetCameraController();
    const release = registerLessonPort();
    const got: unknown[] = [];
    const off = lessonCameraPort()!.onSwing!((s) => got.push(s));
    const { getCameraController } = await import('@/practice/ui/camera/controller');
    await getCameraController().prepare();
    const swing = { kind: 'attack', startT: 0.4, directionDeg: 8, power: 0.5, elevation: 0, footwork: 'auto' } as const;
    session.emitSwing(swing);
    expect(got).toEqual([swing]);
    off();
    release();
  });
});
