/**
 * Beside the slow-motion replay: the measured timing, contact, bat face, aim against direction and speeds (the stage
 * draws the trajectory, bat path and contact point). Every number comes from the result or the game's facts.
 */
import type { DeliveryRecord, DeliveryResult } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import { timingWords, zoneWord } from '../coaching';
import s from './Hud.module.css';

export function DiagnosticPanel({ result, record }: { result: DeliveryResult; record: DeliveryRecord | null }) {
  const t = usePracticeT();
  const { engine, ground } = useKit();
  const f = engine.coachingFacts(result, record ?? undefined);
  const c = result.contact;
  const none = t.t('practice.diag.none');
  const face =
    c.faceBearingDeg === null
      ? none
      : Math.abs(c.faceBearingDeg) < 3
        ? t.t('practice.diag.face_straight')
        : t.t(c.faceBearingDeg > 0 ? 'practice.diag.face_off' : 'practice.diag.face_leg', { deg: Math.round(Math.abs(c.faceBearingDeg)) });
  const rows: Array<[string, string]> = [
    [t.t('practice.diag.timing'), result.swing ? (timingWords(t, c.timingErrorMs, c.timing) ?? none) : t.t('practice.contact.leave')],
    [t.t('practice.diag.contact'), t.tk(`practice.contact.${c.kind}`)],
    [t.t('practice.diag.face'), face],
    [t.t('practice.diag.aim'), zoneWord(t, f.intendedRegion) ?? none],
    [t.t('practice.diag.went'), zoneWord(t, f.exitRegion ?? f.endRegion) ?? none],
    [t.t('practice.diag.bat_speed'), c.batSpeedKph === null ? none : t.t('practice.diag.kph', { kph: Math.round(c.batSpeedKph) })],
    [t.t('practice.diag.ball_speed'), t.t('practice.diag.kph', { kph: Math.round(f.delivery.speedKph) })],
    [t.t('practice.diag.blade'), c.bladeU === null ? none : t.t('practice.diag.blade_value', { cm: Math.round(c.bladeU * ground.bladeM * 100) })],
  ];
  return (
    <dl className={s.diag} data-testid="practice-diagnostics-panel">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
