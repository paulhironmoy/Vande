import { useMemo, useState } from 'react';
import type { MatchEventLog, PlayerRef } from '@/contracts';
import { practiceAgainst } from '@/net';
import { BattingScreen } from '@/screens/batting/BattingScreen';
import { localInnings } from '@/screens/local/localInnings';
import { Button, Card, ScreenShell } from '@/ui';
import { useSocialT } from '../i18n';
import s from '../components/social.module.css';

function randomSeed(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * "Can you beat them?": bat the same over a highlight's player bowled, locally with the shared engine. Unofficial
 * practice: nothing is sent, nothing changes any result or ranking.
 */
export default function PracticeAgainst({ log, bowler, me, onDone }: { log: MatchEventLog; bowler: 0 | 1; me: PlayerRef; onDone: () => void }) {
  const { t } = useSocialT();
  const [done, setDone] = useState<{ runs: number; wickets: number } | null>(null);
  // practiceAgainst(log, x) returns the over of the player who is not x: here, the chosen bowler's.
  const target = useMemo(() => practiceAgainst(log, bowler === 0 ? 1 : 0), [log, bowler]);
  const innings = useMemo(() => localInnings({ plan: target.plan, conditions: target.conditions, seed: randomSeed() }), [target]);
  const real = log.innings[bowler === 0 ? 1 : 0];
  const batter = log.players[bowler === 0 ? 1 : 0];

  if (done)
    return (
      <ScreenShell title={t('social.practice.result_title')} onBack={onDone} narrow testId="practice-result">
        <div className={s.stack}>
          <Card padding={5} className={s.stackSm}>
            <p className={s.eyebrow}>{t('social.practice.eyebrow')}</p>
            <h2 className={s.h2}>{t('social.practice.you_scored', { runs: done.runs, wickets: done.wickets })}</h2>
            <p className={s.body}>{t('social.practice.they_scored', { name: batter.alias, runs: real.runs, wickets: real.wickets, bowler: target.opponent.alias })}</p>
            <p className={s.h3}>{done.runs > real.runs ? t('social.practice.beat') : done.runs === real.runs ? t('social.practice.level') : t('social.practice.short', { n: real.runs - done.runs })}</p>
            <p className={s.small}>{t('social.practice.unofficial')}</p>
          </Card>
          <Button variant="primary" size="lg" block onClick={onDone}>
            {t('social.practice.back')}
          </Button>
        </div>
      </ScreenShell>
    );

  return (
    <BattingScreen
      setup={{ conditions: target.conditions, field: target.plan.field, batter: me, bowler: target.opponent }}
      nextBall={innings.nextBall}
      submitShot={innings.submitShot}
      onComplete={() => {
        const st = innings.state();
        setDone({ runs: st.runs, wickets: st.wickets });
      }}
      onExit={onDone}
      totalBalls={6}
      title={t('social.practice.title', { name: target.opponent.alias })}
    />
  );
}
