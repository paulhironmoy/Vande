/**
 * Every way the camera can fail reaches the player as one panel with its own plain steps (or a line on the download), and
 * every one of them leaves the way back to mouse or touch. A browser's own camera errors are understood too.
 */
import { describe, expect, it } from 'vitest';
import { canRetry, problemOfError, viewOfProblem } from '@/practice/ui/camera/problems';
import type { CameraProblem } from '@/practice/ui/camera/ports';

const ALL: CameraProblem[] = [
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

describe('viewOfProblem', () => {
  it('shows every start failure as a troubleshooting panel or a download line, and a lost track as neither', () => {
    for (const p of ALL) {
      const view = viewOfProblem(p);
      if (p === 'lost_tracking') expect(view).toBeNull();
      else expect(view, p).not.toBeNull();
    }
  });

  it('names the panel the owner listed for each cause', () => {
    const trouble = (p: CameraProblem) => {
      const v = viewOfProblem(p);
      return v?.kind === 'trouble' ? v.case : null;
    };
    expect(trouble('blocked')).toBe('blocked');
    expect(trouble('busy')).toBe('busy');
    expect(trouble('black')).toBe('black');
    expect(trouble('none')).toBe('none');
    expect(trouble('in_app_browser')).toBe('inapp');
    expect(trouble('too_slow')).toBe('slow');
    // A rear-only or over-constrained camera is, to the player, "no camera that Practice can use".
    expect(trouble('rear_only')).toBe('none');
    expect(trouble('overconstrained')).toBe('none');
    expect(trouble('insecure')).toBe('unsupported');
    expect(trouble('engine_failed')).toBe('unsupported');
  });

  it('keeps download trouble on the download strip, with its own words for offline, no space and the rest', () => {
    expect(viewOfProblem('offline')).toEqual({ kind: 'pack', failure: 'offline' });
    expect(viewOfProblem('space')).toEqual({ kind: 'pack', failure: 'space' });
    expect(viewOfProblem('download_failed')).toEqual({ kind: 'pack', failure: 'failed' });
    expect(viewOfProblem('verify_failed')).toEqual({ kind: 'pack', failure: 'failed' });
  });
});

describe('canRetry', () => {
  it('offers "Try again" where trying again can help, and not where the page or the device is the problem', () => {
    expect(canRetry({ kind: 'trouble', case: 'blocked' })).toBe(true);
    expect(canRetry({ kind: 'trouble', case: 'busy' })).toBe(true);
    expect(canRetry({ kind: 'trouble', case: 'black' })).toBe(true);
    expect(canRetry({ kind: 'trouble', case: 'none' })).toBe(true);
    expect(canRetry({ kind: 'trouble', case: 'light' })).toBe(true);
    expect(canRetry({ kind: 'pack', failure: 'offline' })).toBe(true);
    expect(canRetry({ kind: 'trouble', case: 'inapp' })).toBe(false);
    expect(canRetry({ kind: 'trouble', case: 'slow' })).toBe(false);
    expect(canRetry({ kind: 'trouble', case: 'unsupported' })).toBe(false);
  });
});

describe('problemOfError', () => {
  it('trusts the core when it names the problem', () => {
    expect(problemOfError(Object.assign(new Error('x'), { problem: 'black' }))).toBe('black');
    expect(problemOfError({ problem: 'space' })).toBe('space');
  });

  it("understands a browser's camera errors by name", () => {
    const named = (name: string) => problemOfError(Object.assign(new Error('x'), { name }));
    expect(named('NotAllowedError')).toBe('blocked');
    expect(named('PermissionDeniedError')).toBe('blocked');
    expect(named('SecurityError')).toBe('blocked');
    expect(named('NotFoundError')).toBe('none');
    expect(named('DevicesNotFoundError')).toBe('none');
    expect(named('NotReadableError')).toBe('busy');
    expect(named('TrackStartError')).toBe('busy');
    expect(named('AbortError')).toBe('busy');
    expect(named('OverconstrainedError')).toBe('overconstrained');
    expect(named('QuotaExceededError')).toBe('space');
  });

  it('calls anything else the engine failing, and never throws on a strange value', () => {
    expect(problemOfError(new Error('boom'))).toBe('engine_failed');
    expect(problemOfError(null)).toBe('engine_failed');
    expect(problemOfError('text')).toBe('engine_failed');
    expect(problemOfError({ problem: 'not a problem' })).toBe('engine_failed');
  });
});
