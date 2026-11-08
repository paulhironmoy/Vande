/**
 * A dedicated worker in this process, for the work-thread tests: the real protocol host (src/practice/worker/host.ts)
 * behind a WorkerPort, every message crossing as a structured clone (exactly what postMessage does to it), each
 * delivered in its own later task. Faults can be injected: a spawn that throws, a worker that errors, stays silent,
 * answers with another build, or fails one kind of request.
 */
import { PRACTICE_SIM_VERSION, type DeliveryRecord, type DeliveryResult, type NormalizedSwing } from '@/contracts';
import { resolveDelivery } from '@/physics';
import { analyzeBallInSlices, coachTip, formSample, optionOf } from '@/practice/coach';
import { repeatDelivery } from '@/practice/game';
import { createWorkHost, type WorkKit } from '@/practice/worker/host';
import type { FromWorker, ToWorker } from '@/practice/worker/protocol';
import type { WorkerPort } from '@/practice/ui/flow/offThread';

export const BUILD = 'test-build';

/** The worker's kit, bound exactly as src/practice/worker/practice.worker.ts binds it. */
export const realWorkKit: WorkKit = {
  resolveDelivery,
  repeatDelivery: (record: DeliveryRecord, swing: NormalizedSwing | null) => repeatDelivery(record, swing),
  analyzeBallInSlices: (record, result, opts) => analyzeBallInSlices(record, result, opts),
  coachTip: (record, analysis) => coachTip(record, analysis),
  formSample,
  optionOf,
};

export interface HarnessOptions {
  kit?: WorkKit;
  build?: string;
  sim?: number;
  /** How a message is delivered later (default: a zero timeout). */
  later?: (f: () => void) => void;
  /** Drop every message of these kinds the worker would send (a silent worker). */
  drop?: ReadonlyArray<FromWorker['t']>;
  /** Raise the worker's error event on the first message of this kind sent to it. */
  errorOn?: ToWorker['t'];
  /** Raise messageerror instead of delivering the first reply of this kind. */
  messageErrorOn?: FromWorker['t'];
  /** The host's yield (default: its own; the flow tests use a microtask so fake timers drive everything). */
  yieldTask?: () => Promise<void>;
}

export interface Harness {
  port: WorkerPort;
  sent: ToWorker[];
  received: FromWorker[];
  terminated: () => boolean;
}

export function inProcessWorker(o: HarnessOptions = {}): Harness {
  const later = o.later ?? ((f: () => void) => setTimeout(f, 0));
  const sent: ToWorker[] = [];
  const received: FromWorker[] = [];
  let dead = false;
  let erroredOnce = false;
  let messageErroredOnce = false;
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(msg) {
      if (dead) return;
      const copy = structuredClone(msg);
      sent.push(copy);
      if (o.errorOn === msg.t && !erroredOnce) {
        erroredOnce = true;
        later(() => !dead && port.onerror?.(new Error('worker error')));
        return;
      }
      later(() => !dead && host.handle(copy));
    },
    terminate() {
      dead = true;
    },
  };
  const host = createWorkHost(
    o.kit ?? realWorkKit,
    (msg) => {
      if (dead || o.drop?.includes(msg.t)) return;
      const copy = structuredClone(msg);
      received.push(copy);
      later(() => {
        if (dead) return;
        if (o.messageErrorOn === msg.t && !messageErroredOnce) {
          messageErroredOnce = true;
          port.onmessageerror?.(new Error('messageerror'));
          return;
        }
        port.onmessage?.({ data: copy } as MessageEvent<FromWorker>);
      });
    },
    { build: o.build ?? BUILD, sim: o.sim ?? PRACTICE_SIM_VERSION, ...(o.yieldTask ? { yieldTask: o.yieldTask } : {}) },
  );
  return { port, sent, received, terminated: () => dead };
}

/** Object.is all the way down: the same keys in the same order and the same values (-0 and NaN included). */
export function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  if (Array.isArray(a) !== Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return `${path}:type`;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${path}:keys`;
  for (const k of ka) {
    const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** Plain data only (what the worker can send): no functions, class instances, typed arrays, holes or symbol keys. */
export function plainDataIssues(v: unknown, path = '$', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return out;
  if (typeof v !== 'object') {
    out.push(`${path}:${typeof v}`);
    return out;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) out.push(`${path}[${i}]:hole`);
      plainDataIssues(v[i], `${path}[${i}]`, out);
    }
    return out;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) out.push(`${path}:${(v as object).constructor?.name ?? 'proto'}`);
  if (Object.getOwnPropertySymbols(v).length) out.push(`${path}:symbol`);
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) out.push(`${path}.${k}:undefined`);
    else plainDataIssues(x, `${path}.${k}`, out);
  }
  return out;
}

export type { DeliveryResult };
