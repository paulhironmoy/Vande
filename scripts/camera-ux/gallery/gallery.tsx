/**
 * DEVELOPMENT AND EVIDENCE ONLY (CAMERA-UX). Renders the camera's screens in the states of the fake session, in a real
 * browser, for layout, 200% text and axe checks: /scripts/camera-ux/gallery/index.html?s=<state>&scale=1|2&hand=right|left.
 * Not part of the production build, never imported by the app. The Play screen behind the card, chip and banner is a
 * stand-in (a dark stage with two rail corners), so overlap with the real rail is checked on the real Play screen.
 */
import '@fontsource-variable/manrope';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useApp } from '@/app/store';
import { UiProvider } from '@/ui';
import { sys } from '@/practice/ui/design';
import { CameraCue } from '@/practice/ui/camera/CameraCue';
import { CameraChip, LostBanner, LostNote, ReadinessCard } from '@/practice/ui/camera/Card';
import { getCameraController, resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { Setup } from '@/practice/ui/camera/Setup';
import { publishCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import type { PoseReadiness } from '@/practice/ui/camera/ports';
import { createFakeSession, type FakeSession } from '../../../tests/unit/practice/ui/camera/fakeSession';

const q = new URLSearchParams(location.search);
const STATE = q.get('s') ?? 'consent';
const SCALE = Number(q.get('scale') ?? '1');
const HAND = (q.get('hand') ?? 'right') as 'right' | 'left';
const FALLBACK = (q.get('fallback') ?? 'mouse') as 'mouse' | 'touch';
const CONTRAST = q.get('contrast') === 'high';
const MOTION = q.get('motion') === 'reduced';
const LANG = (q.get('lang') ?? 'en') as 'en' | 'hi' | 'hi-Latn';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const click = (id: string) => (document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null)?.click();

/** The preview's picture: a still gradient behind the video box (no stream is made here; no frame of anything exists). */
function makeSession(cached: boolean): FakeSession {
  const s = createFakeSession({ cached, bytes: 9_136_226, openSettings: true });
  s.attachPreview = (video) => {
    video.style.background = 'linear-gradient(160deg, #3b556f 0%, #243040 55%, #1b2430 100%)';
    return () => undefined;
  };
  return s;
}

type Drive = (s: FakeSession) => Promise<void>;

/** Each state: the session, what to tap, what the camera reports. */
const DRIVES: Record<string, { surface: 'setup' | 'card' | 'chip' | 'banner' | 'note' | 'cue'; cached?: boolean; seen?: boolean; drive?: Drive }> = {
  consent: { surface: 'setup' },
  'consent-short': { surface: 'setup', cached: true, seen: true },
  permission: {
    surface: 'setup',
    drive: async () => {
      click('camera-consent-allow');
      await tick(60);
    },
  },
  'guide-download': {
    surface: 'setup',
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.set({ stage: 'loading', pack: { state: 'downloading', bytesDone: 3_700_000, bytesTotal: 9_136_226, attempt: 1, maxAttempts: 2 } });
    },
  },
  'guide-stalled': {
    surface: 'setup',
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.set({ stage: 'loading', pack: { state: 'stalled', bytesDone: 3_700_000, bytesTotal: 9_136_226, attempt: 1, maxAttempts: 2 } });
    },
  },
  'guide-retrying': {
    surface: 'setup',
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.set({ stage: 'loading', pack: { state: 'retrying', bytesDone: 1_000_000, bytesTotal: 9_136_226, attempt: 2, maxAttempts: 2 } });
    },
  },
  'guide-failed': {
    surface: 'setup',
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.set({ stage: 'loading', pack: { state: 'downloading', bytesDone: 1_000_000, bytesTotal: 9_136_226, attempt: 1, maxAttempts: 2 } });
      s.fail('offline');
    },
  },
  'guide-out': {
    surface: 'setup',
    cached: true,
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.finish();
      s.setReadiness({ shoulders: true, head: true, distance: 'too_close' } satisfies Partial<PoseReadiness>);
    },
  },
  'guide-in': {
    surface: 'setup',
    cached: true,
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.finish();
      s.seen();
    },
  },
  'trouble-blocked': { surface: 'setup', cached: true, drive: async (s) => (click('camera-consent-allow'), await tick(40), s.fail('blocked')) },
  'trouble-busy': { surface: 'setup', cached: true, drive: async (s) => (click('camera-consent-allow'), await tick(40), s.fail('busy')) },
  'trouble-black': { surface: 'setup', cached: true, drive: async (s) => (click('camera-consent-allow'), await tick(40), s.fail('black')) },
  'trouble-none': { surface: 'setup', cached: true, drive: async (s) => (click('camera-consent-allow'), await tick(40), s.fail('none')) },
  'trouble-inapp': {
    surface: 'setup',
    cached: true,
    drive: async () => {
      publishCameraUi({ problem: 'in_app_browser' });
    },
  },
  'trouble-light': {
    surface: 'setup',
    cached: true,
    drive: async (s) => {
      click('camera-consent-allow');
      await tick(40);
      s.finish();
      s.setReadiness({ poorLight: true });
      publishCameraUi({ lightHelp: true });
    },
  },
  'trouble-slow': { surface: 'setup', cached: true, drive: async (s) => (click('camera-consent-allow'), await tick(40), s.finish(), s.set({ problem: 'too_slow' })) },
  'trouble-unsupported': { surface: 'setup', cached: true, drive: async () => void publishCameraUi({ problem: 'unsupported' }) },
  'card-start': { surface: 'card', cached: true, seen: true },
  'card-consent': { surface: 'card', cached: true },
  'card-view': {
    surface: 'card',
    cached: true,
    seen: true,
    drive: async (s) => {
      click('camera-start-button');
      await tick(40);
      s.finish();
      s.setReadiness({ shoulders: true, head: true, distance: 'ok', battingHand: false });
    },
  },
  'card-download': {
    surface: 'card',
    seen: true,
    drive: async (s) => {
      click('camera-start-button');
      await tick(40);
      s.set({ stage: 'loading', pack: { state: 'downloading', bytesDone: 5_000_000, bytesTotal: 9_136_226, attempt: 1, maxAttempts: 2 } });
    },
  },
  'card-busy': { surface: 'card', cached: true, seen: true, drive: async (s) => (click('camera-start-button'), await tick(40), s.fail('busy')) },
  chip: { surface: 'chip', cached: true, drive: async (s) => (await startRunning(s), s.seen()) },
  'chip-lost': { surface: 'chip', cached: true, drive: async (s) => (await startRunning(s), s.set({ lost: true })) },
  banner: { surface: 'banner', cached: true, drive: async (s) => (await startRunning(s), s.set({ lost: true })) },
  note: { surface: 'note', cached: true, drive: async () => undefined },
  'cue-loop': { surface: 'cue' },
  'cue-still': { surface: 'cue' },
};

async function startRunning(s: FakeSession) {
  void getCameraController().begin();
  await tick(40);
  s.finish();
  await tick(20);
  publishCameraUi({ started: true });
}

/** The dead ball's card, as big and as placed as the real one on a phone (left column, bottom), so overlap can be seen. */
function FauxCard() {
  return (
    <div
      data-place="left-bottom"
      style={{
        position: 'absolute',
        left: 'calc(var(--p-safe-l) + 1rem)',
        bottom: '0.5rem',
        width: 'min(24rem, 38%)',
        height: '52%',
        borderRadius: '0.75rem',
        background: 'rgba(16,18,24,0.94)',
        border: '1px solid rgba(243,239,231,0.13)',
        color: '#f3efe7',
        padding: '0.75rem',
        font: '600 0.875rem/1.3 var(--font-sans)',
      }}
    >
      Dot ball · Practice this ball · Next ball
    </div>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-play-root=""
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'linear-gradient(#35506b, #1f3326 62%, #151d17)',
        ['--p-rail-left-bottom' as string]: '5.75rem',
        ['--p-rail-bottom' as string]: '4.75rem',
      }}
    >
      {/* The ball's corridor, to see by eye that nothing here sits in it while a ball is live. */}
      <div style={{ position: 'absolute', left: '38%', width: '24%', top: 0, bottom: 0, background: 'rgba(255,255,255,0.05)' }} />
      <div style={{ position: 'absolute', left: 'calc(var(--p-safe-l) + 1rem)', top: '0.5rem', padding: '0.5rem 1rem 0.5rem 0.5rem', background: 'rgba(8,9,13,0.66)', borderRadius: '0.5rem', color: '#f3efe7', font: '600 0.875rem/1.3 var(--font-sans)' }}>
        0/0 · 0.0 overs
        <br />
        Practice
      </div>
      <div style={{ position: 'absolute', right: '1rem', top: '0.5rem', padding: '0.5rem', background: 'rgba(8,9,13,0.66)', borderRadius: '0.5rem', color: '#f3efe7', font: '600 0.875rem/1.3 var(--font-sans)' }}>
        Balanced pitch · Pause
      </div>
      {children}
    </div>
  );
}

function Gallery() {
  const [ready, setReady] = useState(false);
  const spec = DRIVES[STATE] ?? DRIVES.consent;

  useEffect(() => {
    useApp.setState({
      reducedMotion: MOTION,
      settings: { ...useApp.getState().settings, textScale: SCALE as 1 | 2, highContrast: CONTRAST, locale: LANG },
    });
    localStorage.clear();
    if (spec.seen) localStorage.setItem('vc:practice:camera', JSON.stringify({ consentSeen: true, consentV: 1 }));
    localStorage.setItem('vc:practice:settings', JSON.stringify({ v: 1, handedness: HAND }));
    resetCameraUi(false);
    const session = makeSession(spec.cached ?? false);
    setCameraSessionFactory(() => Promise.resolve(session));
    resetCameraController();
    void (async () => {
      await getCameraController().prepare();
      await tick(60);
      await spec.drive?.(session);
      await tick(120);
      setReady(true);
    })();
  }, [spec]);

  const body = (() => {
    switch (spec.surface) {
      case 'setup':
        return <Setup fallback={FALLBACK} onDone={() => undefined} />;
      case 'card':
        return (
          <Stage>
            <ReadinessCard openHelp={() => undefined} />
          </Stage>
        );
      case 'chip':
        return (
          <Stage>
            <CameraChip lost={STATE === 'chip-lost'} quiet={false} />
          </Stage>
        );
      case 'banner':
        return (
          <Stage>
            <FauxCard />
            <CameraChip lost quiet={false} />
            <LostBanner counted onKeepTrying={() => undefined} onHelp={() => undefined} />
          </Stage>
        );
      case 'note':
        return (
          <Stage>
            <FauxCard />
            <LostNote />
          </Stage>
        );
      case 'cue':
        return (
          <div className={sys.root} style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
            <div style={{ height: '15rem', width: '18rem', display: 'flex' }}>
              <CameraCue play={STATE === 'cue-loop' && !MOTION} label="Two hands rise and come back, then swing forward and down." handedness={HAND} />
            </div>
          </div>
        );
    }
  })();

  return (
    <div data-gallery-ready={ready ? 'true' : 'false'} data-state={STATE}>
      {body}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <UiProvider>
    <div className={sys.root} style={{ display: 'contents' }}>
      <Gallery />
    </div>
  </UiProvider>,
);
