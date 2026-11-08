/**
 * Small pieces the camera's screens share: the live picture, the "in frame" badge, the one-time download strip and the
 * words for a hint. The picture is a video element the camera core attaches its stream to; nothing here reads, copies or
 * keeps a frame.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePracticeT, type PracticeT } from '@/i18n/practice';
import { Icon } from '@/ui';
import { currentEnv } from '../controls/state';
import { defaultControl, type PointerControl } from '../controls/model';
import { getCameraController } from './controller';
import type { FrameBadge, FrameHint } from './hints';
import type { DownloadView } from './panels';
import { getCameraUi, subscribeCameraUi, type CameraUi } from './store';
import s from './camera.module.css';

/** The store, as a hook. */
export function useCameraUi(): CameraUi {
  return useSyncExternalStore(subscribeCameraUi, getCameraUi, getCameraUi);
}

/** The control a "Bat with ..." button goes to when the camera is not wanted: the device's default (never the camera). */
export function useFallbackControl(): PointerControl {
  return useMemo(() => defaultControl(currentEnv()), []);
}

/** Milliseconds this screen has been waiting while `active` (so "looking for you" can become "step into view"). */
export function useWaited(active: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active) {
      setMs(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [active]);
  return ms;
}

/** The words of the one-tap way back: "Bat with mouse" or "Bat with touch". */
export function switchLabel(t: PracticeT, control: PointerControl): string {
  return t.t(control === 'touch' ? 'practice.camera.switch.touch' : 'practice.camera.switch.mouse');
}

/** The fine hint under the picture (the badge carries "step into view" and "looking for you" on its own). */
export function hintText(t: PracticeT, hint: FrameHint): string | null {
  switch (hint) {
    case 'dark':
      return t.t('practice.camera.guide.dark');
    case 'too_close':
      return t.t('practice.camera.guide.too_close');
    case 'too_far':
      return t.t('practice.camera.guide.too_far');
    case 'arms_out':
      return t.t('practice.camera.guide.arms_out');
    case 'hands':
      return t.t('practice.camera.guide.hands');
    case 'ok':
      return t.t('practice.camera.ready.ok');
    case 'step_in':
    case 'finding':
      return null;
  }
}

export function badgeText(t: PracticeT, badge: FrameBadge): string {
  return t.t(
    badge === 'yes'
      ? 'practice.camera.frame.yes'
      : badge === 'no'
        ? 'practice.camera.frame.no'
        : 'practice.camera.frame.finding',
  );
}

/** The mirrored live picture. `live` is true once the stream is open (the core attaches it when asked). */
export function Preview({ live }: { live: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !live) return;
    return getCameraController().attachPreview(video);
  }, [live]);
  return (
    <div className={s.frame} data-testid="camera-preview-frame">
      <video
        ref={ref}
        className={s.video}
        muted
        playsInline
        autoPlay
        aria-hidden="true"
        tabIndex={-1}
        data-testid="camera-preview"
        data-live={live ? 'true' : 'false'}
      />
    </div>
  );
}

/** "You are in frame" and its neighbours: a word and a dot, never colour alone. */
export function Badge({ state }: { state: FrameBadge }) {
  const t = usePracticeT();
  return (
    <span className={s.badge} data-state={state} data-testid="camera-frame-badge">
      {state === 'yes' ? (
        <Icon name="check" size={16} aria-hidden="true" />
      ) : (
        <span className={s.dot} aria-hidden="true" />
      )}
      <span>{badgeText(t, state)}</span>
    </span>
  );
}

/** The one-time download: how much, how far, and what is happening if it is not simply going. */
export function DownloadStrip({ download, cached }: { download: DownloadView | null; cached: boolean }) {
  const t = usePracticeT();
  if (!download) {
    return cached ? (
      <p className={s.note} data-testid="camera-download-ready">
        {t.t('practice.camera.download.ready')}
      </p>
    ) : null;
  }
  const one = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  const line =
    download.state === 'stalled'
      ? t.t('practice.camera.download.stalled')
      : download.state === 'retrying'
        ? t.t('practice.camera.download.retrying', { n: download.attempt, max: download.maxAttempts })
        : download.state === 'failed'
          ? t.t(
              download.failure === 'offline'
                ? 'practice.camera.download.offline'
                : download.failure === 'space'
                  ? 'practice.camera.download.space'
                  : 'practice.camera.download.failed',
            )
          : null;
  return (
    <div className={s.download} data-testid="camera-download" data-state={download.state}>
      <p className={s.note}>{t.t('practice.camera.consent.download', { mb: t.number(download.totalMb, one) })}</p>
      <div className={s.downloadRow}>
        <span data-testid="camera-download-mb">
          {t.t('practice.camera.download.progress', {
            done: t.number(download.doneMb, one),
            total: t.number(download.totalMb, one),
          })}
        </span>
        <span data-testid="camera-download-pct">{t.t('practice.camera.download.percent', { pct: download.pct })}</span>
      </div>
      <div
        className={s.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={download.pct}
        aria-label={t.t('practice.camera.download.label', { pct: download.pct })}
        data-state={download.state}
        data-testid="camera-download-bar"
      >
        <span className={s.barFill} style={{ width: `${download.pct}%` }} />
      </div>
      {line && (
        <p
          className={s.note}
          data-tone={download.state === 'failed' ? 'caution' : undefined}
          data-testid="camera-download-line"
        >
          {line}
        </p>
      )}
    </div>
  );
}
