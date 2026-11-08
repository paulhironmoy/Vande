/**
 * "Alternative shots": the coach's real alternative responses to the same delivery (the same physics): the
 * recommended response, the safest and the higher scoring, each with its expected runs, its dismissal risk and
 * any risk it carries (a shot towards a protected region is never shown without saying so).
 */
import type { CoachAnalysis, CoachOption } from '@/contracts';
import { usePracticeT, type PracticeT } from '@/i18n/practice';
import { shotFamily } from '@/physics/shot';
import { lineStart, riskWord, shotElevationRead, zonePhrases } from '../coaching';
import { sys } from '../design';
import s from './Live.module.css';

/**
 * An option in words. A grounded stroke is named by its own family, the one the physics plays for that swing and the
 * footwork played (src/physics/shot.ts shotFamily: a steer, a glance, a cut, a pull ... not always "Drive"); a raised
 * or lofted one by its height. Never a mapping of bearings of its own.
 */
export function optionWords(t: PracticeT, o: CoachOption): string {
  if (o.decision === 'leave') return t.t('practice.option.leave');
  if (o.decision === 'defend')
    return lineStart(t.t('practice.option.defend', { footwork: t.tk(`practice.footwork.${o.footwork}`) }), t.intl);
  const elevation = shotElevationRead(o.swing?.elevation ?? 0);
  const words = { footwork: t.tk(`practice.footwork.${o.footwork}`), ...zonePhrases(t, o.region) };
  if (elevation === 'grounded') {
    const stroke = o.swing
      ? `practice.option.stroke.${shotFamily(o.swing.kind, o.swing.directionDeg, o.footwork)}`
      : null;
    return lineStart(stroke && t.has(stroke) ? t.tk(stroke, words) : t.t('practice.option.drive', words), t.intl);
  }
  return lineStart(t.t(elevation === 'uppish' ? 'practice.option.uppish' : 'practice.option.loft', words), t.intl);
}

/**
 * `chase`: in a Target Chase the first option's tag is the coach's pick for THIS ball, not "Recommended", which beside
 * the need could be read as the way to win the chase (R-44 item 5). The three options keep their numbers.
 */
export function Alternatives({ analysis, chase = false }: { analysis: CoachAnalysis; chase?: boolean }) {
  const t = usePracticeT();
  return (
    <ul
      className={sys.stackTight}
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
      data-testid="practice-alternatives"
    >
      {analysis.options.map((o, i) => (
        <li key={`${o.kind}-${i}`} className={s.option}>
          <span className={s.optionKind}>
            {chase && o.kind === 'recommended'
              ? t.t('practice.chase.option.recommended')
              : t.tk(`practice.option.kind.${o.kind}`)}
          </span>
          <span className={sys.body}>{optionWords(t, o)}</span>
          <span className={sys.caption}>
            {t.t('practice.option.numbers', {
              runs: o.expectedRuns.toFixed(1),
              risk: Math.round(o.dismissalRisk * 100),
            })}
          </span>
          {o.risks.length > 0 && <span className={s.risk}>{o.risks.map((r) => riskWord(t, r)).join(' · ')}</span>}
        </li>
      ))}
    </ul>
  );
}
