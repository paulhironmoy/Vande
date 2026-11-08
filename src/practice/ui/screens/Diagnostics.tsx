/**
 * Practice diagnostics (hidden: five taps on the graphics line in Practice settings). The device check's
 * measurements, this session's frame rates and input-to-bat latency, the local aggregates, and the tester mode: the
 * validation study's one-tap questions, stored on this device only and exported as JSON for the user's studies.
 * Technical words are allowed here and nowhere else.
 */
import { useState } from 'react';
import type { DeviceAssessment } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { currentLandscapeLock } from '@/platform/orientation';
import {
  CONTACT_KINDS,
  INTENT_MATCHES,
  LATENCY_BUCKETS,
  TIMING_PROPS,
  TTFD_BUCKETS,
  clearMetrics,
  clearTesterData,
  setTesterEnabled,
  testerAnswerCount,
  testerEnabled,
  testerExport,
  loadCalibrations,
  type PracticeMetrics,
} from '@/practice/store';
import { calibrationList } from './Calibration';
import { PButton, PSetting, PSwitch, Screen, sys } from '../design';
import s from './Tools.module.css';

export interface DiagnosticsProps {
  assessment: DeviceAssessment | null;
  metrics: PracticeMetrics;
  recentFps: number[];
  lastInputToBatMs: number | null;
  onReset: () => void;
  onBack: () => void;
}

/** Shares the export file where the platform can, otherwise downloads it. */
async function exportFile(text: string): Promise<'shared' | 'downloaded'> {
  const name = `vande-practice-tester-${new Date().toISOString().slice(0, 10)}.json`;
  const file = typeof File !== 'undefined' ? new File([text], name, { type: 'application/json' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (file && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch {
      /* fall through to a download */
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}

export function Diagnostics({ assessment: a, metrics: m, recentFps, lastInputToBatMs, onReset, onBack }: DiagnosticsProps) {
  const t = usePracticeT();
  const [tester, setTester] = useState(() => testerEnabled());
  const [count, setCount] = useState(() => testerAnswerCount());
  const [status, setStatus] = useState<string | null>(null);
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
    : [[t.t('practice.dx.tier'), t.t('practice.dx.unknown')]];
  const counts = (o: Record<string, number>, keys: readonly string[]) => keys.map((k) => `${k} ${o[k] ?? 0}`).join(' · ');
  const local: Array<[string, string]> = [
    [t.t('practice.dx.deliveries'), String(m.deliveries)],
    [t.t('practice.dx.overs'), String(m.overs)],
    [t.t('practice.dx.wickets'), String(m.wickets)],
    [t.t('practice.dx.next_over'), String(m.nextOver)],
    [t.t('practice.dx.replays'), String(m.replays)],
    [t.t('practice.dx.repeats'), String(m.repeats)],
    [t.t('practice.dx.timing'), counts(m.timing, TIMING_PROPS)],
    [t.t('practice.dx.intent'), counts(m.intent, INTENT_MATCHES)],
    [t.t('practice.dx.latency'), counts(m.latency, LATENCY_BUCKETS)],
    [t.t('practice.dx.ttfd'), counts(m.ttfd, TTFD_BUCKETS)],
    [t.t('practice.dx.contact'), counts(m.contact, CONTACT_KINDS)],
    [t.t('practice.dx.calibration'), calibrationList(t, loadCalibrations()) ?? t.t('practice.dx.unknown')],
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
    <Screen title={t.t('practice.dx.title')} onBack={onBack} testId="practice-diagnostics">
      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.tester.title')}</h2>
        <PSetting label={t.t('practice.tester.enable')} hint={t.t('practice.tester.enable_hint')} id="dx-tester">
          <PSwitch
            checked={tester}
            onChange={(v) => {
              setTesterEnabled(v);
              setTester(v);
            }}
            labelledBy="dx-tester"
            testId="practice-tester-enable"
          />
        </PSetting>
        <p className={sys.caption} data-testid="practice-tester-count">
          {count ? t.t('practice.tester.count', { count }) : t.t('practice.tester.none')}
        </p>
        <div className={s.actions}>
          <PButton variant="secondary" icon="download" disabled={!count} onClick={() => void exportFile(testerExport()).then((r) => setStatus(t.tk(`practice.tester.${r}`)))} data-testid="practice-tester-export">
            {t.t('practice.tester.export')}
          </PButton>
          <PButton
            variant="quiet"
            icon="copy"
            disabled={!count}
            onClick={() => void navigator.clipboard?.writeText(testerExport()).then(() => setStatus(t.t('practice.tester.copied')), () => setStatus(t.t('practice.tester.copy_failed')))}
            data-testid="practice-tester-copy"
          >
            {t.t('practice.tester.copy')}
          </PButton>
          <PButton
            variant="quiet"
            icon="trash"
            disabled={!count}
            onClick={() => {
              clearTesterData();
              setCount(0);
            }}
            data-testid="practice-tester-clear"
          >
            {t.t('practice.tester.clear')}
          </PButton>
        </div>
        {status && (
          <p className={sys.caption} role="status">
            {status}
          </p>
        )}
      </section>
      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.dx.device')}</h2>
        {dl(device, 'practice-dx-device')}
      </section>
      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.dx.session')}</h2>
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
        <h2 className={sys.section}>{t.t('practice.dx.local')}</h2>
        {dl(local, 'practice-dx-local')}
        <div className={s.hist} aria-hidden="true">
          {m.timingHistogram.map((v, i) => (
            <span key={i} className={s.bar} style={{ height: `${(v / peak) * 100}%` }} />
          ))}
        </div>
        <div className={s.actions}>
          <PButton
            variant="secondary"
            onClick={() => {
              clearMetrics();
              onReset();
            }}
          >
            {t.t('practice.dx.reset')}
          </PButton>
        </div>
      </section>
    </Screen>
  );
}
