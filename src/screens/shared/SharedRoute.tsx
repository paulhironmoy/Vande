import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MatchEventLog, PlayerRef, SharedMatch } from '@/contracts';
import { useApp } from '@/app/store';
import { localPlayerRef } from '@/app/storeTypes';
import { useRouter, type RouteOf } from '@/app/router';
import { engine } from '@/engine';
import { practiceAgainst } from '@/net';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, Button, Card, Chip, Icon, ScreenShell, StateView } from '@/ui';
import { BattingScreen } from '../batting/BattingScreen';
import { localInnings } from '../local/localInnings';
import { RevealScreen } from '../reveal/RevealScreen';
import { failureKind } from '../app/errors';
import { useLoad, useNet } from '../app/hooks';
import s from './SharedRoute.module.css';

const GUEST_KIT = { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' } as const;

/** The log as the public sees it: the moderated display names, never the match-time aliases inside the log. */
export function withSharedNames(log: MatchEventLog, aliases: [string, string]): MatchEventLog {
  return { ...log, players: [{ ...log.players[0], alias: aliases[0] }, { ...log.players[1], alias: aliases[1] }] };
}

function randomSeed(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * /s/:code, a revealed match someone shared: a spoiler-safe landing ("A vs B: watch who won"), the reveal verified
 * on this device, practice against either over (locally, unofficial), and the way into the game. Works for anyone:
 * no account, no sign-in, nothing about the result before the reveal is played.
 */
export default function SharedRoute({ route }: { route: RouteOf<'shared'> }) {
  const tr = useT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const player = useApp((st) => st.player);
  const { net, booting } = useNet();
  const shared = useLoad<SharedMatch>(net ? () => net.api.call('GET /v1/s/:code', { params: { code: route.code } }, { anonymous: true }) : null, [net, route.code]);
  const [mode, setMode] = useState<'landing' | 'reveal' | { practice: 0 | 1 }>('landing');
  const [verified, setVerified] = useState<boolean | null>(null);
  const [practiced, setPracticed] = useState<{ bowler: string; runs: number; wickets: number } | null>(null);
  const data = shared.data;
  const log = useMemo(() => (data ? withSharedNames(data.log, data.aliases) : null), [data]);

  useEffect(() => {
    if (!data) return;
    let alive = true;
    // Verified against the original log (the names shown are the moderated ones; the proof is the server's log).
    void engine
      .verifyMatchLog(data.log)
      .then((v) => alive && setVerified(v.ok))
      .catch(() => alive && setVerified(false));
    return () => {
      alive = false;
    };
  }, [data]);

  const shell = (body: ReactNode) => (
    <ScreenShell title={t('shared.title_short')} eyebrow={t('brand.name')} onBack={back} narrow testId="shared-screen">
      {body}
    </ScreenShell>
  );

  if (booting) return shell(<StateView kind="loading" />);
  if (!net) return shell(<StateView kind="offline" title={t('match.needs_online_title')} body={t('shared.offline_build')} actionLabel={t('shared.play')} onAction={() => navigate({ name: 'home' })} />);
  if (!data || !log) {
    const k = shared.error ? failureKind(shared.error) : null;
    if (k === 'offline') return shell(<StateView kind="offline" body={t('shared.offline_body')} onAction={shared.reload} />);
    if (k === 'not_found' || k === 'forbidden' || k === 'invalid') return shell(<StateView kind="error" title={t('shared.gone_title')} body={t('shared.gone_body')} actionLabel={t('shared.play')} onAction={() => navigate({ name: 'home' })} />);
    if (k) return shell(<StateView kind="error" onAction={shared.reload} />);
    return shell(<StateView kind="loading" title={t('shared.loading')} />);
  }

  if (mode === 'reveal') return <RevealScreen log={log} verified={verified} onClose={() => setMode('landing')} />;

  if (typeof mode === 'object') {
    // practiceAgainst(log, x) is the over of the player who is not x: here, the chosen bowler's.
    const bowler = mode.practice;
    const target = practiceAgainst(log, bowler === 0 ? 1 : 0);
    const me: PlayerRef = player ? localPlayerRef(player) : { id: 'local', alias: t('shared.you'), avatar: { seed: 'guest0001' }, kit: { ...GUEST_KIT }, kind: 'human' };
    return <SharedPractice key={`${bowler}-${practiced ? 'again' : 'first'}`} target={target} me={me} onDone={(runs, wickets) => {
      setPracticed({ bowler: target.opponent.alias, runs, wickets });
      setMode('landing');
    }} onExit={() => setMode('landing')} />;
  }

  const [a, b] = log.players;
  return shell(
    <div className={s.stack}>
      <Card className={s.hero} padding={5} data-testid="shared-landing">
        <span className={s.glow} aria-hidden="true" />
        <p className={s.eyebrow}>{data.kind === 'cup' ? t('shared.eyebrow_cup') : t('shared.eyebrow')}</p>
        <div className={s.versus}>
          <Side p={a} />
          <span className={s.vs} aria-hidden="true">
            {t('common.vs')}
          </span>
          <Side p={b} />
        </div>
        <h1 className={s.h1}>{t('shared.title', { a: a.alias, b: b.alias })}</h1>
        <p className={s.body}>{t('shared.lead')}</p>
        <div className={s.chips}>
          <Chip tone="clay" icon="field">
            {t(`pitch.${data.conditions.pitch}` as MessageKey)}
          </Chip>
          <Chip tone="cyan" icon="sparkle">
            {t(`weather.${data.conditions.weather}` as MessageKey)}
          </Chip>
        </div>
        <Button variant="accent" size="xl" block icon="play" onClick={() => setMode('reveal')} data-testid="shared-watch">
          {t('shared.watch')}
        </Button>
        <p className={s.small}>
          <Icon name="seal" size={14} /> {verified === false ? t('shared.unverified') : t('shared.sealed_note')}
        </p>
      </Card>

      <section className={s.section} aria-labelledby="shared-practice">
        <h2 className={s.h2} id="shared-practice">
          {t('shared.practice_title')}
        </h2>
        <p className={s.body}>{t('shared.practice_body')}</p>
        {practiced && (
          <p className={s.result} role="status" data-testid="shared-practice-result">
            <Icon name="bat" size={16} /> {t('shared.practice_result', { name: practiced.bowler, runs: practiced.runs, wickets: practiced.wickets })}
          </p>
        )}
        <div className={s.actions}>
          {([0, 1] as const).map((seat) => (
            <Button key={seat} variant="secondary" icon="bat" onClick={() => setMode({ practice: seat })} data-testid={`shared-practice-${seat}`}>
              {t('shared.practice', { name: log.players[seat].alias })}
            </Button>
          ))}
        </div>
        <p className={s.small}>{t('shared.practice_note')}</p>
      </section>

      <Card className={s.play} padding={4}>
        <h2 className={s.h2}>{t('shared.play_title')}</h2>
        <p className={s.body}>{t('shared.play_body')}</p>
        <Button variant="primary" size="lg" block iconEnd="forward" onClick={() => navigate({ name: 'home' })} data-testid="shared-play">
          {t('shared.play')}
        </Button>
      </Card>
    </div>,
  );
}

function Side({ p }: { p: PlayerRef }) {
  return (
    <div className={s.side}>
      <Avatar avatar={p.avatar} kit={p.kit} size={72} decorative />
      <span className={s.name}>{p.alias}</span>
    </div>
  );
}

/** Bats the over one of the players bowled, on this device with the shared engine (nothing is sent). */
function SharedPractice({ target, me, onDone, onExit }: { target: ReturnType<typeof practiceAgainst>; me: PlayerRef; onDone: (runs: number, wickets: number) => void; onExit: () => void }) {
  const { t } = useT();
  const innings = useMemo(() => localInnings({ plan: target.plan, conditions: target.conditions, seed: randomSeed() }), [target]);
  return (
    <BattingScreen
      setup={{ conditions: target.conditions, field: target.plan.field, batter: me, bowler: target.opponent }}
      nextBall={innings.nextBall}
      submitShot={innings.submitShot}
      onComplete={() => {
        const st = innings.state();
        onDone(st.runs, st.wickets);
      }}
      onExit={onExit}
      totalBalls={6}
      title={t('shared.practice_vs', { name: target.opponent.alias })}
    />
  );
}
