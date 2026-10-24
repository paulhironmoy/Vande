import { useMemo, useState } from 'react';
import { useApp } from '@/app/store';
import { SIMPLE_OPPONENTS, SIMPLE_OUTCOMES, SIMPLE_UI, scenarioTitle, simpleCondition, useSimple } from '@/app/simple';
import { OPPONENTS, OUTCOME_LABELS, describeCondition, getDailySpec, getScenario } from '@/engine';
import { Logo } from '@/components/brand/Logo';
import { Button, Card, CardButton, Chip, Dialog, Icon, IconButton, ScreenShell } from '@/components/ui';
import { ConditionRing } from './ConditionRing';
import s from './HomeScreen.module.css';

function formatClock(ticks: number): string {
  const m = Math.floor(ticks / 60);
  const sec = ticks % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function HomeScreen() {
  const navigate = useApp((st) => st.navigate);
  const campaign = useApp((st) => st.campaign);
  const game = useApp((st) => st.game);
  const plan = useApp((st) => st.plan);
  const republic = useApp((st) => st.republic);
  const bests = useApp((st) => st.bests);
  const daily = useApp((st) => st.daily);
  const beginCampaignSetup = useApp((st) => st.beginCampaignSetup);
  const continueCampaign = useApp((st) => st.continueCampaign);
  const abandonCampaign = useApp((st) => st.abandonCampaign);
  const simple = useSimple();
  const [confirmNew, setConfirmNew] = useState(false);

  const dailySpec = useMemo(() => getDailySpec(new Date()), []);
  const dailyScenario = useMemo(() => {
    try {
      return getScenario(dailySpec.scenarioId);
    } catch {
      return undefined;
    }
  }, [dailySpec.scenarioId]);
  const dailyDone = daily.find((d) => d.date === dailySpec.date);
  const condition = simpleCondition(describeCondition(republic), simple);
  // A campaign record exists only while a run is in progress (it is cleared when the run finishes or is abandoned).
  const hasCampaign = Boolean(campaign && plan);

  const continueCaption = (() => {
    if (!campaign || !plan) return '';
    const idx = campaign.chapterIndex;
    const scenarioId = plan.scenarioIds[Math.min(idx, plan.scenarioIds.length - 1)];
    const title = scenarioTitle(getScenario(scenarioId), simple);
    const chapterLabel = plan.scenarioIds.length > 1 ? `Chapter ${idx + 1} of ${plan.scenarioIds.length} · ` : '';
    if (game && game.status !== 'briefing') return `${chapterLabel}${title} · ${formatClock(Math.max(0, game.duration - game.tick))} left`;
    if (campaign.completed.length === idx + 1) return `${chapterLabel}${title} · ${simple ? 'chapter done' : 'chapter complete'}`;
    return `${chapterLabel}${title} · ${simple ? 'ready to start' : 'briefing'}`;
  })();

  const startNew = () => {
    if (hasCampaign) setConfirmNew(true);
    else beginCampaignSetup();
  };

  const dailyTitle = simple ? `Today: ${scenarioTitle(dailyScenario, true) || dailySpec.title}` : dailySpec.title;
  const dailyOpponents = dailySpec.opponents.map((o) => (simple ? SIMPLE_OPPONENTS[o].nickname : OPPONENTS[o].name)).join(' + ');
  const bestOutcome = bests.campaign ? (simple ? SIMPLE_OUTCOMES[bests.campaign.outcome].label : OUTCOME_LABELS[bests.campaign.outcome]) : '';

  return (
    <ScreenShell testId="home-screen">
      <div className={s.top}>
        <div className={s.brand}>
          <Logo size={40} />
          <div className={s.brandText}>
            <span className={s.wordmark}>
              VANDE<span>//</span>REPUBLIC
            </span>
            <span className={s.dev} lang="hi">
              वन्दे · Freedom. Order. Your Move.
            </span>
          </div>
        </div>
        <IconButton icon="settings" label="Settings" onClick={() => navigate({ name: 'settings' })} data-testid="home-settings" />
      </div>

      {simple && <h1 className={s.greeting}>Ready to help your city?</h1>}

      <Card className={s.hero} data-testid="home-condition" aria-label={simple ? 'How your city is doing' : 'Your Republic condition'}>
        <ConditionRing condition={republic} className={s.ring} />
        <div className={s.heroText}>
          <div className={s.eyebrow}>{simple ? 'Your city' : 'Your Republic'}</div>
          <div className={s.condition}>{condition.label}</div>
          <p className={s.summary}>{condition.summary}</p>
          <div className={s.meta}>
            <Chip icon="history" tone="neutral">
              {simple
                ? republic.crises === 1
                  ? '1 problem faced'
                  : `${republic.crises} problems faced`
                : republic.crises === 1
                  ? '1 crisis faced'
                  : `${republic.crises} crises faced`}
            </Chip>
            <Chip icon="sparkle" tone="cyan">
              {simple
                ? republic.campaigns === 1
                  ? '1 story finished'
                  : `${republic.campaigns} stories finished`
                : republic.campaigns === 1
                  ? '1 campaign'
                  : `${republic.campaigns} campaigns`}
            </Chip>
          </div>
        </div>
      </Card>

      <div className={s.primary}>
        {hasCampaign ? (
          <>
            <Button variant="primary" size="lg" block icon="play" onClick={continueCampaign} data-testid="home-continue">
              {simple ? SIMPLE_UI.continue : 'Continue campaign'}
            </Button>
            <p className={s.primaryCaption}>{continueCaption}</p>
            <Button variant="ghost" size="sm" onClick={startNew} data-testid="home-start-campaign">
              {simple ? 'Start a new story instead' : 'Start a new campaign instead'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" block icon="play" onClick={startNew} data-testid="home-start-campaign">
              {simple ? SIMPLE_UI.startCampaign : 'Start the 10-minute campaign'}
            </Button>
            <p className={s.primaryCaption}>{simple ? 'Three chapters · pause any time' : 'Three chapters · choose 1–5 opponents · pause any time'}</p>
          </>
        )}
      </div>

      <div className={s.grid}>
        <CardButton className={s.tile} onClick={() => navigate({ name: 'daily' })} data-testid="home-daily">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>{simple ? SIMPLE_UI.daily : "Today's Republic Crisis"}</span>
            <Icon name="clock" size={18} />
          </div>
          <div className={s.tileTitle}>{dailyTitle}</div>
          <div className={s.tileText}>3 minutes · {dailyOpponents}</div>
          <div className={s.tileFoot}>
            <span>{dailyDone ? (simple ? `Your score: ${dailyDone.score}` : `Your result: ${dailyDone.score}`) : 'Not played yet'}</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>

        <CardButton className={s.tile} onClick={() => navigate({ name: 'republic' })} data-testid="home-republic">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>{simple ? 'Your city so far' : 'Living Republic'}</span>
            <Icon name="building" size={18} />
          </div>
          <div className={s.tileTitle}>{condition.label}</div>
          <div className={s.tileText}>{simple ? 'See how your city changes after every game.' : 'See how your city has changed across every crisis you have faced.'}</div>
          <div className={s.tileFoot}>
            <span>{simple ? 'Open your city' : 'Open your Republic'}</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>

        <CardButton className={s.tile} onClick={() => navigate({ name: 'history' })} data-testid="home-personal-best">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>{simple ? 'Best score' : 'Personal best'}</span>
            <Icon name="sparkle" size={18} />
          </div>
          {bests.campaign ? (
            <>
              <div className={s.best}>
                <span className="tabular">{bests.campaign.score}</span>
                <span className="muted text-sm"> / 100</span>
              </div>
              <div className={s.tileText}>{bestOutcome}</div>
            </>
          ) : (
            <>
              <div className={s.tileTitle}>{simple ? 'No story finished yet' : 'No campaign yet'}</div>
              <div className={s.tileText}>{simple ? 'Finish the story to get your first score.' : 'Finish the campaign to set your first Republic score.'}</div>
            </>
          )}
          <div className={s.tileFoot}>
            <span>{simple ? 'See earlier games' : 'Review past crises'}</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>
      </div>

      <div className={s.quiet}>
        <Button variant="ghost" size="sm" icon="history" onClick={() => navigate({ name: 'history' })} data-testid="home-history">
          {simple ? 'Earlier games' : 'History'}
        </Button>
        <Button variant="ghost" size="sm" icon="settings" onClick={() => navigate({ name: 'settings' })}>
          {simple ? 'Settings' : 'Settings & accessibility'}
        </Button>
        <Button variant="ghost" size="sm" icon="info" onClick={() => navigate({ name: 'about', page: 'disclosure' })}>
          About
        </Button>
      </div>

      <p className={s.foot}>
        Independent game — not affiliated with or endorsed by the Government of India, any political party or public institution.{' '}
        <a
          href="#disclosure"
          onClick={(e) => {
            e.preventDefault();
            navigate({ name: 'about', page: 'disclosure' });
          }}
        >
          Read the disclosure
        </a>
        . Progress is stored only on this device.
      </p>

      <Dialog
        open={confirmNew}
        title={simple ? 'Start a new story?' : 'Start a new campaign?'}
        description={simple ? 'Your current story will be thrown away. Finished chapters stay in your earlier games.' : 'Your current campaign will be discarded. Completed chapters stay in your history.'}
        confirmLabel={simple ? 'Start new story' : 'Start new campaign'}
        confirmVariant="danger"
        onCancel={() => setConfirmNew(false)}
        onConfirm={() => {
          setConfirmNew(false);
          abandonCampaign();
          beginCampaignSetup();
        }}
      />
    </ScreenShell>
  );
}
