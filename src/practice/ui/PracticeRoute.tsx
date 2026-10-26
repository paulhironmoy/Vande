/**
 * The Practice route (/practice): offline, first-person batting, everything on the device. It binds the real
 * modules (./ports.ts), waits for the Practice copy of the active language, and installs the test hooks only in a
 * VITE_PRACTICE_TEST_HOOKS=1 build.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsEventName, AnalyticsProps } from '@/contracts';
import type { RouteOf } from '@/app/router';
import { useRouter } from '@/app/router';
import { getServices } from '@/app/services';
import { useApp } from '@/app/store';
import { StateView } from '@/ui';
import { BLADE_L, BOUNDARY_R, PITCH_HALF, REGION_EDGES, RING_R, batTravelMs, fielderClass } from '@/physics';
import { loadPracticeCatalog } from '@/i18n/practice';
import { buildKit, createStage, engine, inputKit } from './ports';
import { PracticeKitContext, type PracticeKit } from './context';
import { PracticeApp } from './PracticeApp';
import { takePracticeSelectedAt } from './launch';
import type { FlowHooks, PracticeFlow } from './flow/controller';

const TEST_HOOKS = import.meta.env.VITE_PRACTICE_TEST_HOOKS === '1';

const KIT: PracticeKit = {
  engine,
  build: buildKit,
  input: inputKit,
  createStage,
  ground: { boundaryR: BOUNDARY_R, ringR: RING_R, pitchHalf: PITCH_HALF, bladeM: BLADE_L },
  regionEdges: { straight: REGION_EDGES.straight, midOff: REGION_EDGES.midOff, cover: REGION_EDGES.cover, point: REGION_EDGES.point, behind: REGION_EDGES.behind },
  fielderClass,
  batTravelMs,
};

function track(event: AnalyticsEventName, props?: AnalyticsProps) {
  // Consent-gated inside analytics; nothing waits for it.
  void getServices().then(
    (s) => s.analytics.track(event, props),
    () => undefined,
  );
}

export default function PracticeRoute(_props: { route: RouteOf<'practice'> }) {
  const locale = useApp((s) => s.settings.locale);
  const back = useRouter((s) => s.back);
  const [ready, setReady] = useState(false);
  const [hooks, setHooks] = useState<FlowHooks | null | undefined>(TEST_HOOKS ? undefined : null);
  const openedAt = useMemo(() => takePracticeSelectedAt() ?? performance.now(), []);
  const flowRef = useRef<PracticeFlow | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPracticeCatalog(locale).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [locale]);

  useEffect(() => {
    if (!TEST_HOOKS) return;
    let alive = true;
    void import('./testHooks').then((m) => alive && setHooks(m.createTestHooks(batTravelMs, () => flowRef.current)));
    return () => {
      alive = false;
    };
  }, []);

  if (!ready || hooks === undefined) {
    return (
      <main>
        <StateView kind="loading" />
      </main>
    );
  }
  return (
    <PracticeKitContext.Provider value={KIT}>
      <PracticeApp appVersion={__APP_VERSION__} analytics={track} hooks={hooks} openedAt={openedAt} onExit={back} onFlow={(f) => (flowRef.current = f)} />
    </PracticeKitContext.Provider>
  );
}
