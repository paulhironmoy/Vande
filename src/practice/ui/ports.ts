/**
 * The one place the Practice UI binds the other workstreams' modules (src/physics, src/practice/game,
 * src/practice/coach, src/input, src/render3d). Everything else in src/practice/ui sees only the interfaces in
 * ./flow/types.ts, so a rename here is a one-file change and the compiler checks every binding against them.
 */
import { autoField, fieldIntent, flight, regionOf, resolveDelivery } from '@/physics';
import {
  MAX_BOUNCERS,
  REFERENCE_BALLS,
  REFERENCE_OVER,
  ballSeed,
  bowlerFor,
  buildBall,
  buildOver,
  coachingFacts,
  inningsReducer,
  inningsSummary,
  lengthBand,
  lineBand,
  makeRecord,
  newInnings,
  nextDelivery,
  overPattern,
  overSummary,
  randomOver,
  repeatDelivery,
  replayDelivery,
  resumeInnings,
  stockRangeFor,
  tapFromTarget,
  targetFromTap,
  validateOver,
  variationsFor,
} from '@/practice/game';
import {
  analyzeBall,
  analyzeBallInSlices,
  coachTip,
  compareAttempts,
  formFromAttempts,
  formSample,
  masteryEvent,
  masteryKey,
  masteryProgress,
  optionOf,
  primaryInsight,
  recordAttempt,
  startMastery,
  praiseEarned,
  tipWords,
} from '@/practice/coach';
import {
  GestureSurface,
  calibrationFromTaps,
  calibrationsFromTaps,
  eventModality,
  normalizeGesture,
  pointerIsDown,
  resolveCalibrations,
} from '@/input';
import { createPracticeStage } from '@/render3d';
import { PRACTICE_SIM_VERSION } from '@/contracts';
import PracticeWorker from '@/practice/worker/practice.worker?worker';
import { createOffThread, type OffThreadWork, type WorkerPort } from './flow/offThread';
import type { BuildKit, CoachKit, InputKit, PracticeEngine, StageFactory } from './flow/types';

export const engine: PracticeEngine = {
  flight,
  resolveDelivery,
  autoField,
  fieldIntent,
  regionOf,
  randomOver: ({ seed, conditions, assist, difficulty, family }) =>
    randomOver({ seed, conditions, assist, family, difficulty }),
  referenceOver: () => REFERENCE_OVER,
  referenceBalls: () => REFERENCE_BALLS,
  ballSeed,
  newInnings,
  inningsReducer,
  resumeInnings,
  nextDelivery,
  makeRecord,
  replayDelivery,
  repeatDelivery: (record, swing) => repeatDelivery(record, swing),
  overSummary,
  inningsSummary,
  coachingFacts,
  normalizeGesture,
  resolveCalibrations: (set) => resolveCalibrations(set),
  pointerIsDown,
};

export const buildKit: BuildKit = {
  variationsFor,
  buildBall,
  bowlerFor,
  buildOver,
  validateOver,
  targetFromTap,
  tapFromTarget,
  lengthBand,
  lineBand,
  stockRange: (b, difficulty) => stockRangeFor(b.family, { paceBand: b.paceBand, spinType: b.spinType, difficulty }),
  maxBouncers: MAX_BOUNCERS,
  overPattern,
};

export const coachKit: CoachKit = {
  analyzeBall: (record, result) => analyzeBall(record, result),
  analyzeBallInSlices: (record, result, opts) => analyzeBallInSlices(record, result, opts),
  optionOf,
  primaryInsight,
  coachTip: (record, analysis) => coachTip(record, analysis),
  tipWords: (t, tip) => tipWords(t, tip),
  praiseEarned: (analysis, rec, tip) => praiseEarned(analysis, rec, tip),
  compareAttempts,
  masteryKey,
  startMastery,
  recordAttempt,
  masteryProgress,
  masteryEvent,
  formSample,
  formFromAttempts,
};

export const inputKit: InputKit = { GestureSurface, calibrationFromTaps, calibrationsFromTaps, eventModality };

/**
 * The work thread for one Practice visit (src/practice/worker/practice.worker.ts binds the same physics and coach
 * functions as `engine` and `coachKit` above). Null where there are no workers: everything then runs on the main
 * thread, as it always did. The worker itself starts when the flow first needs it.
 */
export function createWork(): OffThreadWork | null {
  if (typeof Worker !== 'function') return null;
  return createOffThread({
    build: __BUILD_ID__,
    sim: PRACTICE_SIM_VERSION,
    spawn: () => new PracticeWorker({ name: 'vande-practice' }) as unknown as WorkerPort,
  });
}

/** App text choice and the native OS font scale meet only at the Unity presentation boundary. */
export function effectiveUnityTextScale(appTextScale: number, systemTextScale: number): number {
  return Math.min(2, Math.max(1, appTextScale * systemTextScale));
}

export const createStage: StageFactory = async (opts) => {
  if (__UNITY_PRACTICE_ENABLED__ && !opts.force2d && !opts.skipUnity) {
    try {
      const [
        { nativeUnityPracticeBridge, unityAvailabilityRequiresClassic },
        { createWebUnityPracticeBridge },
        { createUnityPracticeStage },
        { useApp },
        { getAudioSettings },
        { loadCalibrations },
        { createPracticeT, loadPracticeCatalog },
      ] = await Promise.all([
        import('@/platform/unityPractice'),
        import('@/platform/unityPracticeWeb'),
        import('@/practice/unity'),
        import('@/app/store'),
        import('@/audio'),
        import('@/practice/store'),
        import('@/i18n/practice'),
      ]);
      const bridge = __UNITY_PRACTICE_WEB_ENABLED__
        ? createWebUnityPracticeBridge()
        : await nativeUnityPracticeBridge();
      const availability = await bridge.availability();
      if (unityAvailabilityRequiresClassic(availability, __UNITY_PRACTICE_WEB_ENABLED__)) {
        return { kind: 'route', target: 'classic', reason: 'low_memory_device' };
      }
      if (availability.available) {
        const pixelsPerDp = __UNITY_PRACTICE_WEB_ENABLED__ ? 1 : availability.pixelsPerDp;
        if (typeof pixelsPerDp !== 'number' || !Number.isFinite(pixelsPerDp) || pixelsPerDp < 1 || pixelsPerDp > 8) {
          return createPracticeStage(opts);
        }
        const systemTextScale = availability.systemTextScale;
        if (
          typeof systemTextScale !== 'number' ||
          !Number.isFinite(systemTextScale) ||
          systemTextScale < 0.5 ||
          systemTextScale > 3
        ) {
          return createPracticeStage(opts);
        }
        const app = useApp.getState();
        const audio = getAudioSettings();
        const practiceT = createPracticeT(app.settings.locale, await loadPracticeCatalog(app.settings.locale));
        const soundOn = app.settings.sound && (audio.effects > 0 || audio.crowd > 0 || audio.music > 0);
        return createUnityPracticeStage({
          enableUnityPractice: true,
          bridge,
          buildId: __BUILD_ID__,
          sessionId:
            globalThis.crypto.randomUUID?.() ??
            `practice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          deviceTier: opts.deviceTier ?? 'full',
          assistance: opts.assistance ?? 'learn',
          locale: app.settings.locale,
          pixelsPerDp,
          textScale: effectiveUnityTextScale(app.settings.textScale, systemTextScale),
          highContrast: app.settings.highContrast,
          readyHint: practiceT.t('practice.live.hint'),
          captions: audio.captions,
          audio: soundOn,
          haptics: app.settings.haptics && audio.haptics,
          calibrations: () => resolveCalibrations(loadCalibrations()),
          ...(__UNITY_PRACTICE_WEB_ENABLED__ ? { launchTimeoutMs: 60_000 } : {}),
        });
      }
    } catch {
      // The opt-in native renderer is additive. Any missing/incompatible bridge returns to the established renderer.
    }
  }
  return createPracticeStage(opts);
};
