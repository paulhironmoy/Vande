/**
 * Practice diagnostics (hidden): the device check's measurements and reasons, this session's per-delivery frame
 * rates and last input-to-bat latency, and the local aggregates. Everything here stays on the device.
 */
import { Button, ScreenShell } from '@/ui';
import type { DeviceAssessment } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { currentLandscapeLock } from '@/platform/orientation';
import { CONTACT_KINDS, INTENT_MATCHES, LATENCY_BUCKETS, TIMING_PROPS, TTFD_BUCKETS, calibrationMs, clearMetrics, type PracticeMetrics } from '@/practice/store';
import s from './Tools.module.css';

export interface DiagnosticsProps {
  assessment: DeviceAssessment | null;
  metrics: PracticeMetrics;
  recentFps: number[];
  lastInputToBatMs: number | null;
  onReset: () => void;
  onBack: () => void;
}

export function Diagnostics({ assessment: a, metrics: m, recentFps, lastInputToBatMs, onReset, onBack }: DiagnosticsProps) {
  const t = usePracticeT();
  const ms = (v: number | null) => (v === null ? t.t('practice.dx.unknown') : t.t('practice.dx.ms', { ms: Math.round(v) }));
  const device: Array<[string, string]> = a
    ? [
        [t.t('practice.dx.tier'), a.tier],
        [t.t('practice.dx.profile'), a.profile],
        [t.t('practice.dx.avg_fps'), t.t('practice.dx.fps', { fps: a.avgFps })],
        [t.t('practice.dx.p95'), ms(a.p95FrameMs)],
        [t.t('practice.dx.spikes'), String(a.spikes)],
        [t.t('practice.dx.context'), String(a.contextLosses)],
        [t.t('practice.dx.input'), ms(a.inputToFrameMs)],
        [t.t('practice.dx.memory'), a.memoryGb === null ? t.t('practice.dx.unknown') : t.t('practice.dx.gb', { gb: a.memoryGb })],
        [t.t('practice.dx.renderer'), a.renderer || t.t('practice.dx.unknown')],
        [t.t('practice.dx.shader'), ms(a.shaderCompileMs)],
        [t.t('practice.dx.tolerance'), ms(a.toleranceMs)],
        [t.t('practice.dx.reasons'), a.reasons.join(', ')],
      ]
    : [[t.t('practice.dx.tier'), t.t('practice.settings.device.none')]];
  const counts = (o: Record<string, number>, keys: readonly string[]) => keys.map((k) => `${k} ${o[k] ?? 0}`).join(' · ');
  const local: Array<[string, string]> = [
    [t.t('practice.dx.deliveries'), String(m.deliveries)],
    [t.t('practice.dx.overs'), String(m.overs)],
    [t.t('practice.dx.wickets'), String(m.wickets)],
    [t.t('practice.dx.next_over'), String(m.nextOver)],
    [t.t('practice.dx.replays'), String(m.replays)],
    [t.t('practice.dx.timing'), counts(m.timing, TIMING_PROPS)],
    [t.t('practice.dx.intent'), counts(m.intent, INTENT_MATCHES)],
    [t.t('practice.dx.latency'), counts(m.latency, LATENCY_BUCKETS)],
    [t.t('practice.dx.ttfd'), counts(m.ttfd, TTFD_BUCKETS)],
    [t.t('practice.diag.contact'), counts(m.contact, CONTACT_KINDS)],
    [t.t('practice.dx.calibration'), ms(calibrationMs())],
  ];
  const peak = Math.max(1, ...m.timingHistogram);
  const dl = (rows: Array<[string, string]>, id: string) => (
    <dl className={s.dl} data-testid={id}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <ScreenShell title={t.t('practice.dx.title')} onBack={onBack} backLabel={t.t('practice.common.back')} narrow testId="practice-diagnostics" contentClassName={s.content}>
      <section className={s.section}>
        <h2>{t.t('practice.dx.device')}</h2>
        {dl(device, 'practice-dx-device')}
      </section>
      <section className={s.section}>
        <h2>{t.t('practice.dx.session')}</h2>
        {dl(
          [
            [t.t('practice.dx.recent_fps'), recentFps.length ? recentFps.map((f) => Math.round(f)).join(', ') : t.t('practice.dx.unknown')],
            [t.t('practice.dx.latency_last'), ms(lastInputToBatMs)],
            [t.t('practice.dx.orientation'), t.tk(`practice.dx.lock.${currentLandscapeLock()}`)],
          ],
          'practice-dx-session',
        )}
      </section>
      <section className={s.section}>
        <h2>{t.t('practice.dx.local')}</h2>
        {dl(local, 'practice-dx-local')}
        <div className={s.hist} aria-hidden="true">
          {m.timingHistogram.map((v, i) => (
            <span key={i} className={s.bar} style={{ height: `${(v / peak) * 100}%` }} />
          ))}
        </div>
        <div className={s.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              clearMetrics();
              onReset();
            }}
          >
            {t.t('practice.dx.reset')}
          </Button>
        </div>
      </section>
    </ScreenShell>
  );
}
