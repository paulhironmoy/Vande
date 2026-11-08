/**
 * Which screen the camera shows, as a pure function of the store (./store.ts). One screen, one purpose: the consent,
 * the wait for the system's permission, the guide with its picture (the pack downloads behind it, so the player gets in
 * position while it comes), or one troubleshooting panel. The same function serves the first-time setup (`setup`) and
 * the small card shown before a ball (`card`).
 *
 * Order of the rules is the order of importance: a failure outranks everything; before the player taps "Use camera"
 * nothing but the consent (or the card's start button) is shown; then the stage of the session decides.
 */
import { badgeOf, hintOf, type FrameBadge, type FrameHint } from './hints';
import type { PackStatus } from './ports';
import { viewOfProblem, type PackFailure, type ProblemView, type TroubleCase } from './problems';
import type { CameraUi } from './store';

export type PanelMode = 'setup' | 'card';

/** The download shown beside the picture while it comes (or why it did not). */
export interface DownloadView {
  state: 'downloading' | 'stalled' | 'retrying' | 'verifying' | 'failed';
  /** Whole percent, 0 to 100. */
  pct: number;
  doneMb: number;
  totalMb: number;
  attempt: number;
  maxAttempts: number;
  /** Only when `state` is `failed`. */
  failure: PackFailure | null;
}

export type Panel =
  /** First tap: why the camera is wanted. `short` when this device has seen it before (setup only). */
  | { kind: 'consent'; short: boolean }
  /** The card before a ball, the camera not started in this visit: one tap to start. */
  | { kind: 'start' }
  /** Waiting for the system's permission prompt. */
  | { kind: 'permission' }
  /** The picture, the badge and the hint; the download (when there is one) and the engine starting show here too. */
  | {
      kind: 'view';
      download: DownloadView | null;
      starting: boolean;
      hint: FrameHint;
      badge: FrameBadge;
      /** Setup only: "Start batting" can be pressed. */
      canStart: boolean;
    }
  | { kind: 'trouble'; case: TroubleCase };

const MB = 1_000_000;

export function downloadOf(pack: PackStatus, failure: PackFailure | null): DownloadView | null {
  const failed = failure !== null;
  if (!failed && (pack.state === 'absent' || pack.state === 'cached' || pack.state === 'checking')) return null;
  const total = pack.bytesTotal;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.floor((100 * pack.bytesDone) / total))) : 0;
  return {
    state: failed ? 'failed' : (pack.state as DownloadView['state']),
    pct,
    doneMb: pack.bytesDone / MB,
    totalMb: total / MB,
    attempt: pack.attempt,
    maxAttempts: pack.maxAttempts,
    failure,
  };
}

export function panelFor(ui: CameraUi, mode: PanelMode, waitedMs = 0): Panel {
  const view: ProblemView | null = ui.problem ? viewOfProblem(ui.problem) : null;
  // A picture too dark to find anyone in, for long enough, is its own panel.
  if (!view && ui.lightHelp && ui.stage === 'running' && !ui.readiness.ready) return { kind: 'trouble', case: 'light' };
  if (view?.kind === 'trouble') return { kind: 'trouble', case: view.case };
  const failure: PackFailure | null = view?.kind === 'pack' ? view.failure : null;
  // A failed session that names no cause is the engine not starting: said as "not available here".
  if (ui.stage === 'failed' && !view) return { kind: 'trouble', case: 'unsupported' };

  if (!ui.started && !failure) {
    // The card on a device that has seen the consent is one tap; on a device that has not, it is the consent itself.
    if (mode === 'card' && ui.consentSeen) return { kind: 'start' };
    return { kind: 'consent', short: ui.consentSeen };
  }
  if (ui.stage === 'idle' || ui.stage === 'opening')
    return failure ? viewPanel(ui, failure, waitedMs) : { kind: 'permission' };
  return viewPanel(ui, failure, waitedMs);
}

function viewPanel(ui: CameraUi, failure: PackFailure | null, waitedMs: number): Panel {
  const running = ui.stage === 'running';
  return {
    kind: 'view',
    download: downloadOf(ui.pack, failure),
    starting: ui.stage === 'starting' || ui.stage === 'loading',
    hint: running ? hintOf(ui.readiness, ui.lost, waitedMs) : 'finding',
    badge: running ? badgeOf(ui.readiness, ui.lost) : 'finding',
    canStart: running && ui.problem === null && !ui.lost && ui.readiness.ready,
  };
}
