/**
 * The ways the camera can fail, as the player meets them. The core names a failure with a `CameraProblem`; each one
 * becomes either a troubleshooting panel (its own plain steps, `practice.camera.trouble.<case>.*`) or, when the one-time
 * download is what went wrong, a line on the download panel (`practice.camera.download.*`). Every panel offers "Bat
 * with mouse" or "Bat with touch" in one tap, so nothing here can block the game.
 */
import type { CameraProblem } from './ports';

/** The troubleshooting panels (the copy keys are `practice.camera.trouble.<case>.title|body`). */
export type TroubleCase = 'blocked' | 'busy' | 'black' | 'none' | 'inapp' | 'light' | 'slow' | 'unsupported';

/** What went wrong with the one-time download (copy: `practice.camera.download.offline|space|failed`). */
export type PackFailure = 'offline' | 'space' | 'failed';

export type ProblemView = { kind: 'trouble'; case: TroubleCase } | { kind: 'pack'; failure: PackFailure };

/** How a core problem is shown. Null for `lost_tracking`: that is a phase of play (a banner), never a failure to start. */
export function viewOfProblem(problem: CameraProblem): ProblemView | null {
  switch (problem) {
    case 'blocked':
      return { kind: 'trouble', case: 'blocked' };
    case 'busy':
      return { kind: 'trouble', case: 'busy' };
    case 'black':
      return { kind: 'trouble', case: 'black' };
    case 'none':
    case 'rear_only':
    case 'overconstrained':
      return { kind: 'trouble', case: 'none' };
    case 'in_app_browser':
      return { kind: 'trouble', case: 'inapp' };
    case 'too_slow':
      return { kind: 'trouble', case: 'slow' };
    case 'unsupported':
    case 'insecure':
    case 'engine_failed':
      return { kind: 'trouble', case: 'unsupported' };
    case 'offline':
      return { kind: 'pack', failure: 'offline' };
    case 'space':
      return { kind: 'pack', failure: 'space' };
    case 'download_failed':
    case 'verify_failed':
      return { kind: 'pack', failure: 'failed' };
    case 'lost_tracking':
      return null;
  }
}

/** Whether "Try again" can help: not when the page is in another app's window, or the device cannot do it. */
export function canRetry(view: ProblemView): boolean {
  if (view.kind === 'pack') return true;
  return view.case !== 'inapp' && view.case !== 'slow' && view.case !== 'unsupported';
}

const PROBLEMS: readonly CameraProblem[] = [
  'unsupported',
  'insecure',
  'in_app_browser',
  'blocked',
  'busy',
  'none',
  'rear_only',
  'black',
  'overconstrained',
  'offline',
  'space',
  'download_failed',
  'verify_failed',
  'engine_failed',
  'too_slow',
  'lost_tracking',
];

function isProblem(v: unknown): v is CameraProblem {
  return typeof v === 'string' && (PROBLEMS as readonly string[]).includes(v);
}

/**
 * The problem a thrown value stands for: the core's own `.problem`, else what a browser's camera error names
 * (NotAllowed: blocked, NotFound: none, NotReadable or Abort: busy, Overconstrained: none), else the engine failing.
 */
export function problemOfError(error: unknown): CameraProblem {
  if (typeof error === 'object' && error !== null) {
    const e = error as { problem?: unknown; name?: unknown };
    if (isProblem(e.problem)) return e.problem;
    switch (e.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return 'blocked';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'none';
      case 'NotReadableError':
      case 'TrackStartError':
      case 'AbortError':
        return 'busy';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'overconstrained';
      case 'QuotaExceededError':
        return 'space';
    }
  }
  return 'engine_failed';
}
