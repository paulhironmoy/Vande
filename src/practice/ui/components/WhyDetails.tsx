/**
 * "Why?" (constitution §14's secondary disclosure): the full explanation from the coach's analysis, in four parts:
 * what the ball did, what you read, what you attempted and why it happened. Every number is the physics' own.
 */
import type { CoachAnalysis, DeliveryRecord, DeliveryResult } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import { batEvidenceLines, intentReadLine, lbwNotOut, reasonWords, timingWords, variationName } from '../coaching';
import { sys } from '../design';
import s from './Live.module.css';

const cm = (m: number) => Math.round(Math.abs(m) * 100);

/** Height of the ball at the bat, in body words (the physics' own height above the ground, m). */
function heightWord(h: number): 'low' | 'knee' | 'waist' | 'chest' | 'head' {
  return h < 0.45 ? 'low' : h < 0.8 ? 'knee' : h < 1.05 ? 'waist' : h < 1.35 ? 'chest' : 'head';
}

export function WhyDetails({ analysis, result, record }: { analysis: CoachAnalysis; result: DeliveryResult; record: DeliveryRecord }) {
  const t = usePracticeT();
  const { build, engine } = useKit();
  const b = analysis.ball;
  const facts = engine.coachingFacts(result, record);
  const family = record.bowler.family;
  const spin = family === 'spin';
  const did: string[] = [
    t.t('practice.why.ball', {
      kph: Math.round(b.speedKph),
      variation: variationName(t, b.variation, record.bowler.spinType),
      length: b.lengthM === null ? t.t('practice.why.full_toss') : t.tk(`practice.length.${build.lengthBand(b.lengthM, family)}`),
      line: t.tk(`practice.lineband.${build.lineBand(b.lineAtStumpsM)}`),
    }),
  ];
  if (Math.abs(b.airMovementM) >= 0.05) did.push(t.tk(`practice.why.${spin ? 'drift' : 'air'}_${b.airMovementM > 0 ? 'away' : 'in'}`, { cm: cm(b.airMovementM) }));
  if (b.pitchMovementM !== null && Math.abs(b.pitchMovementM) >= 0.03) did.push(t.tk(`practice.why.${spin ? 'turn' : 'seam'}_${b.pitchMovementM > 0 ? 'away' : 'in'}`, { cm: cm(b.pitchMovementM) }));
  did.push(t.tk(`practice.why.height.${heightWord(b.heightAtBatM)}`));
  did.push(t.t(b.wouldHitStumps ? 'practice.why.hitting' : 'practice.why.missing'));
  const read = (['line', 'length', 'pace', 'movement', 'bounce'] as const).filter((k) => analysis.read[k] !== 'unclear').map((k) => t.tk(`practice.read.${k}.${analysis.read[k]}`));
  const a = analysis.attempted;
  const exactIntent = intentReadLine(t, facts.intent, engine.regionOf);
  const parts: string[] = a.decision === 'leave'
    ? [exactIntent]
    : [exactIntent, t.tk(`practice.footwork.${a.footwork}`), timingWords(t, a.timingErrorMs, a.timing) ?? ''];
  const batEvidence = batEvidenceLines(t, facts);
  // An on-time label beside a miss, the pad or the body reads as a contradiction; both are true. The timing stays (an
  // honest timing fact) and one line says what happened: the timing was right, the bat never reached the ball.
  const noReach = (a.timing === 'perfect' || a.timing === 'solid') && (a.contact === 'miss' || a.contact === 'pad' || a.contact === 'body');
  const notOut = lbwNotOut(t, result.coaching.lbw);
  return (
    <div className={sys.stackTight} data-testid="practice-why">
      <h4 className={sys.caption}>{t.t('practice.why.did')}</h4>
      <ul className={s.whyList}>
        {did.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {read.length > 0 && (
        <>
          <h4 className={sys.caption}>{t.t('practice.why.read')}</h4>
          <ul className={s.whyList}>
            {read.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      <h4 className={sys.caption}>{t.t('practice.why.attempted')}</h4>
      <ul className={s.whyList}>
        <li>{parts.filter(Boolean).join(' · ')}</li>
        <li>{t.tk(`practice.contact.${a.contact}`)}</li>
        {noReach && <li data-testid="practice-why-no-reach">{t.t('practice.why.no_reach')}</li>}
        {batEvidence.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <h4 className={sys.caption}>{t.t('practice.why.because')}</h4>
      <ul className={s.whyList}>
        {analysis.why.map((r) => (
          <li key={r}>{reasonWords(t, r, result)}</li>
        ))}
        {notOut && <li>{notOut}</li>}
      </ul>
    </div>
  );
}
