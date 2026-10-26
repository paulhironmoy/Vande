import { lazy, Suspense } from 'react';
import type { HighlightRenderInput, MatchEventLog } from '@/contracts';
import { StateView } from '@/ui';

const RevealScreen = lazy(() => import('@/screens/reveal/RevealScreen').then((m) => ({ default: m.RevealScreen })));
// The composer behind the official Short; its module pulls in the 3D renderer, so it loads only when asked for.
const HighlightPreview = lazy(() => import('@/highlight').then((m) => ({ default: m.HighlightPreview })));

/** Full-screen playback of a highlight's whole replay (the public landing's in-app replay). */
export function CutPlayer({ log, onClose }: { log: MatchEventLog; onClose: () => void }) {
  return (
    <Suspense
      fallback={
        <main>
          <StateView kind="loading" />
        </main>
      }
    >
      <RevealScreen log={log} initialMode="full" onClose={onClose} />
    </Suspense>
  );
}

/**
 * The exact Short a participant is asked to approve: the same input and composer as the official render (same cut,
 * same on-screen text), played inline at phone size.
 */
export function ExactCut({ input }: { input: HighlightRenderInput }) {
  return (
    <Suspense fallback={<StateView kind="loading" compact />}>
      <HighlightPreview input={input} />
    </Suspense>
  );
}
