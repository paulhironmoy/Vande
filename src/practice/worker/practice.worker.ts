/**
 * The Practice work thread (a dedicated worker; a classic script in production builds, so it runs wherever the app's
 * own bundle runs). It binds the same functions src/practice/ui/ports.ts binds on the main thread, connects the
 * protocol host to `self`, and nothing else: no DOM, no storage, no timers of its own.
 */
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { resolveDelivery } from '@/physics';
import { repeatDelivery } from '@/practice/game';
import { analyzeBallInSlices, coachTip, formSample, optionOf } from '@/practice/coach';
import { createWorkHost } from './host';
import type { ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const host = createWorkHost(
  {
    resolveDelivery,
    repeatDelivery: (record, swing) => repeatDelivery(record, swing),
    analyzeBallInSlices: (record, result, opts) => analyzeBallInSlices(record, result, opts),
    coachTip: (record, analysis) => coachTip(record, analysis),
    formSample,
    optionOf,
  },
  (m) => self.postMessage(m),
  { build: __BUILD_ID__, sim: PRACTICE_SIM_VERSION },
);

self.onmessage = (e: MessageEvent<ToWorker>) => host.handle(e.data);
