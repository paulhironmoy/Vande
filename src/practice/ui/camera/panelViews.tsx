/**
 * The camera's panels, one per `Panel` kind (./panels.ts). Each renders a heading, a scrolling body and its actions as a
 * fragment, so the setup dialog and the small card before a ball lay out the same words the same way. All words come
 * from COPY (`practice.camera.*`); none is written here. Every panel ends in the one-tap way back: "Bat with mouse" or
 * "Bat with touch".
 */
import { useRef, useState, type RefObject } from 'react';
import { usePracticeT, type PracticeT } from '@/i18n/practice';
import { PButton, sys } from '../design';
import type { PointerControl } from '../controls/model';
import type { BrowserFamily, Platform } from './environment';
import { canRetry, type TroubleCase } from './problems';
import type { DownloadView, Panel } from './panels';
import { Badge, DownloadStrip, Preview, hintText, switchLabel } from './parts';
import s from './camera.module.css';

export interface PanelIds {
  title: string;
  body: string;
  status: string;
}

/** What the panels do. The container wires them: Setup answers its caller, the card talks to the camera and the control. */
export interface PanelActions {
  fallback: PointerControl;
  /** "Use camera" (the consent, or the card's start). */
  start(): void;
  /** "Try again" after a failure. */
  retry(): void;
  /** "Start batting" (setup only). */
  ready(): void;
  /** The one-tap way back to mouse or touch. */
  switchAway(): void;
  /** "Setup help" (the card only). */
  help?(): void;
  /** Keep waiting in the light panel. */
  keepTrying(): void;
}

/** Where the player is and what they can do about a block, read from the page (replaced in tests). */
export interface TroubleEnv {
  family: BrowserFamily;
  platform: Platform;
  native: boolean;
  /** The link to this page without a fragment, and a link that opens it in Chrome (Android), or null. */
  link: string;
  chromeUrl: string | null;
  canOpenSettings: boolean;
  openSettings(): void;
  openChrome(url: string): void;
  copy(text: string): Promise<boolean>;
}

// ---- consent ---------------------------------------------------------------------------------------------------------

export function ConsentPanel(p: {
  ids: PanelIds;
  short: boolean;
  downloadMb: number | null;
  actions: PanelActions;
  primaryRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = usePracticeT();
  const mb =
    p.downloadMb === null ? null : t.number(p.downloadMb, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <>
      <h2 id={p.ids.title} className={sys.title} data-testid="camera-consent-title">
        {t.t('practice.camera.consent.title')}
      </h2>
      <div className={s.sheetBody} id={p.ids.body} tabIndex={0} data-testid="camera-consent">
        <ul className={s.lines}>
          {/* What a person decides on comes first: where the video goes. */}
          <li>{t.t('practice.camera.consent.privacy')}</li>
          {!p.short && <li>{t.t('practice.camera.consent.what')}</li>}
          {!p.short && <li>{t.t('practice.camera.consent.stop')}</li>}
          {!p.short && <li>{t.t('practice.camera.consent.others')}</li>}
          {mb !== null && (
            <li data-testid="camera-consent-download">{t.t('practice.camera.consent.download', { mb })}</li>
          )}
        </ul>
        <p className={s.note}>{t.t('practice.camera.permission.asking')}</p>
      </div>
      <div className={s.actions}>
        <PButton
          ref={p.primaryRef}
          variant="primary"
          size="lg"
          className={s.lead}
          onClick={p.actions.start}
          data-testid="camera-consent-allow"
        >
          {t.t('practice.camera.consent.allow')}
        </PButton>
        <PButton variant="secondary" onClick={p.actions.switchAway} data-testid="camera-consent-fallback">
          {switchLabel(t, p.actions.fallback)}
        </PButton>
      </div>
    </>
  );
}

// ---- the card's start (the camera is the control, but not running in this visit) -----------------------------------

export function StartPanel(p: {
  ids: PanelIds;
  actions: PanelActions;
  primaryRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = usePracticeT();
  return (
    <>
      <h2 id={p.ids.title} className={sys.section} data-testid="camera-start-title">
        {t.t('practice.camera.consent.title')}
      </h2>
      <div className={s.sheetBody} id={p.ids.body} tabIndex={0} data-testid="camera-start">
        <p className={s.status}>{t.t('practice.camera.privacy.line')}</p>
      </div>
      <div className={s.actions}>
        <PButton ref={p.primaryRef} variant="primary" onClick={p.actions.start} data-testid="camera-start-button">
          {t.t('practice.camera.consent.allow')}
        </PButton>
        <PButton variant="secondary" onClick={p.actions.switchAway} data-testid="camera-start-fallback">
          {switchLabel(t, p.actions.fallback)}
        </PButton>
      </div>
    </>
  );
}

// ---- waiting for the system's permission prompt --------------------------------------------------------------------

export function PermissionPanel(p: { ids: PanelIds; actions: PanelActions }) {
  const t = usePracticeT();
  return (
    <>
      <h2 id={p.ids.title} className={sys.title}>
        {t.t('practice.camera.consent.title')}
      </h2>
      <div className={s.sheetBody} id={p.ids.body} tabIndex={0} data-testid="camera-permission">
        <p className={s.status} role="status" id={p.ids.status}>
          {t.t('practice.camera.permission.asking')}
        </p>
      </div>
      <div className={s.actions}>
        <PButton variant="secondary" onClick={p.actions.switchAway} data-testid="camera-permission-fallback">
          {switchLabel(t, p.actions.fallback)}
        </PButton>
      </div>
    </>
  );
}

// ---- the picture: the setup guide, and the card before a ball -----------------------------------------------------

export function ViewPanel(p: {
  ids: PanelIds;
  mode: 'setup' | 'card';
  view: Extract<Panel, { kind: 'view' }>;
  /** The stream is open, so the picture can be shown. */
  live: boolean;
  desktop: boolean;
  actions: PanelActions;
  primaryRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = usePracticeT();
  const { view } = p;
  const hint = hintText(t, view.hint);
  const failed = view.download?.state === 'failed';
  const near = 1.5;
  const far = 2.5;
  // The download came while this screen was up: say once that it is kept for offline play.
  const sawDownload = useRef(false);
  if (view.download && view.download.state !== 'failed') sawDownload.current = true;
  const cachedNow = !view.download && sawDownload.current;

  const picture = (
    <div className={s.picture}>
      <Preview live={p.live} />
      <Badge state={view.badge} />
    </div>
  );
  const status = (
    <p
      className={s.status}
      role="status"
      aria-live="polite"
      id={p.ids.status}
      data-testid="camera-hint"
      data-hint={view.hint}
    >
      {hint}
    </p>
  );
  const download = <DownloadStrip download={view.download as DownloadView | null} cached={cachedNow} />;

  const primary = failed ? (
    <PButton ref={p.primaryRef} variant="primary" onClick={p.actions.retry} data-testid="camera-download-retry">
      {t.t('practice.error.retry')}
    </PButton>
  ) : p.mode === 'setup' ? (
    <PButton
      ref={p.primaryRef}
      variant="primary"
      size="lg"
      className={s.lead}
      disabled={!view.canStart}
      aria-describedby={p.ids.status}
      onClick={p.actions.ready}
      data-testid="camera-guide-start"
    >
      {t.t('practice.camera.guide.done')}
    </PButton>
  ) : null;

  if (p.mode === 'card') {
    return (
      <>
        <h2 id={p.ids.title} className={sys.section} data-testid="camera-ready-line">
          {t.t('practice.camera.ready.line')}
        </h2>
        <div
          className={`${s.sheetBody} ${s.cardRow}`}
          id={p.ids.body}
          tabIndex={0}
          data-picture="true"
          data-testid="camera-ready-body"
        >
          {picture}
          <div className={s.copy}>
            {download}
            {status}
          </div>
        </div>
        <div className={s.actions}>
          {primary}
          <PButton variant="secondary" onClick={p.actions.switchAway} data-testid="camera-ready-fallback">
            {switchLabel(t, p.actions.fallback)}
          </PButton>
          {p.actions.help && (
            <PButton variant="quiet" onClick={p.actions.help} data-testid="camera-ready-help">
              {t.t('practice.camera.lost.help')}
            </PButton>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <h2 id={p.ids.title} className={sys.title} data-testid="camera-guide-title">
        {t.t('practice.camera.guide.title')}
      </h2>
      <div className={s.sheetBody} id={p.ids.body} tabIndex={0} data-testid="camera-guide">
        <div className={s.columns}>
          {picture}
          <div className={s.copy}>
            <ul className={s.lines}>
              <li>{t.t(p.desktop ? 'practice.camera.guide.laptop' : 'practice.camera.guide.phone', { near, far })}</li>
              <li>{t.t('practice.camera.guide.frame')}</li>
              <li>{t.t('practice.camera.guide.light')}</li>
              <li>{t.t('practice.camera.guide.hands')}</li>
            </ul>
            {download}
            {status}
          </div>
        </div>
      </div>
      <div className={s.actions}>
        {primary}
        <PButton variant="secondary" onClick={p.actions.switchAway} data-testid="camera-guide-fallback">
          {switchLabel(t, p.actions.fallback)}
        </PButton>
      </div>
    </>
  );
}

// ---- troubleshooting -------------------------------------------------------------------------------------------------

function stepsFor(t: PracticeT, kind: TroubleCase, env: TroubleEnv): string[] {
  if (kind === 'blocked') {
    const key = `practice.camera.trouble.blocked.${env.family}`;
    return [t.has(key) ? t.tk(key) : t.t('practice.camera.trouble.blocked.other')];
  }
  if (kind === 'black') {
    return [t.t('practice.camera.trouble.black.shutter'), t.t('practice.camera.trouble.black.toggle')];
  }
  return [];
}

export function TroublePanel(p: {
  ids: PanelIds;
  kind: TroubleCase;
  env: TroubleEnv;
  actions: PanelActions;
  primaryRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = usePracticeT();
  const { kind, env, actions } = p;
  const [copied, setCopied] = useState<'no' | 'yes' | 'manual'>('no');
  const steps = stepsFor(t, kind, env);
  const retry = kind === 'light' ? actions.keepTrying : actions.retry;
  const showRetry = canRetry({ kind: 'trouble', case: kind });
  const inApp = kind === 'inapp';
  const chrome = inApp && env.platform === 'android' ? env.chromeUrl : null;

  const copy = async () => {
    const ok = await env.copy(env.link);
    setCopied(ok ? 'yes' : 'manual');
  };

  const primary = chrome ? (
    <PButton
      ref={p.primaryRef}
      variant="primary"
      onClick={() => env.openChrome(chrome)}
      data-testid="camera-trouble-open-chrome"
    >
      {t.t('practice.camera.trouble.inapp.open')}
    </PButton>
  ) : inApp ? (
    <PButton ref={p.primaryRef} variant="primary" onClick={() => void copy()} data-testid="camera-trouble-copy">
      {t.t('practice.camera.trouble.inapp.copy')}
    </PButton>
  ) : showRetry ? (
    <PButton ref={p.primaryRef} variant="primary" onClick={retry} data-testid="camera-trouble-retry">
      {kind === 'light' ? t.t('practice.camera.lost.retry') : t.t('practice.error.retry')}
    </PButton>
  ) : null;

  return (
    <>
      <h2 id={p.ids.title} className={sys.title} data-testid="camera-trouble-title">
        {t.tk(`practice.camera.trouble.${kind}.title`)}
      </h2>
      <div className={s.sheetBody} id={p.ids.body} tabIndex={0} data-testid="camera-trouble" data-case={kind}>
        <p className={sys.body}>{t.tk(`practice.camera.trouble.${kind}.body`)}</p>
        {steps.length > 0 && (
          <ol className={s.steps} data-testid="camera-trouble-steps">
            {steps.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}
        {inApp && (
          <div role="status" aria-live="polite" data-testid="camera-trouble-copied">
            {copied === 'yes' && <p className={s.note}>{t.t('practice.camera.trouble.inapp.copied')}</p>}
            {copied === 'manual' && (
              <input
                className={s.note}
                readOnly
                value={env.link}
                aria-label={t.t('practice.camera.trouble.inapp.copy')}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="camera-trouble-link"
              />
            )}
          </div>
        )}
      </div>
      <div className={s.actions}>
        {primary}
        {chrome && (
          <PButton variant="secondary" onClick={() => void copy()} data-testid="camera-trouble-copy">
            {t.t('practice.camera.trouble.inapp.copy')}
          </PButton>
        )}
        {kind === 'blocked' && env.canOpenSettings && (
          <PButton variant="secondary" onClick={env.openSettings} data-testid="camera-trouble-settings">
            {t.tk('practice.camera.trouble.blocked.open_settings')}
          </PButton>
        )}
        <PButton
          variant={primary ? (chrome ? 'quiet' : 'secondary') : 'primary'}
          ref={primary ? undefined : p.primaryRef}
          onClick={actions.switchAway}
          data-testid="camera-trouble-fallback"
        >
          {switchLabel(t, actions.fallback)}
        </PButton>
      </div>
    </>
  );
}

// ---- the right panel for the state -----------------------------------------------------------------------------------

export function PanelHost(p: {
  panel: Panel;
  mode: 'setup' | 'card';
  ids: PanelIds;
  actions: PanelActions;
  env: TroubleEnv;
  /** The stream is open, so the picture can be shown. */
  live: boolean;
  desktop: boolean;
  /** The one-time download in MB, or null when it is not needed (or not known yet). */
  downloadMb: number | null;
  primaryRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { panel, ids, actions } = p;
  switch (panel.kind) {
    case 'consent':
      return (
        <ConsentPanel
          ids={ids}
          short={panel.short}
          downloadMb={p.downloadMb}
          actions={actions}
          primaryRef={p.primaryRef}
        />
      );
    case 'start':
      return <StartPanel ids={ids} actions={actions} primaryRef={p.primaryRef} />;
    case 'permission':
      return <PermissionPanel ids={ids} actions={actions} />;
    case 'view':
      return (
        <ViewPanel
          ids={ids}
          mode={p.mode}
          view={panel}
          live={p.live}
          desktop={p.desktop}
          actions={actions}
          primaryRef={p.primaryRef}
        />
      );
    case 'trouble':
      return <TroublePanel ids={ids} kind={panel.case} env={p.env} actions={actions} primaryRef={p.primaryRef} />;
  }
}
