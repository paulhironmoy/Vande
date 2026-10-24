import { useState } from 'react';
import { useApp } from '@/app/store';
import { SIMPLE_OUTCOMES, SIMPLE_UI, scenarioTitle, simpleCondition, useSimple } from '@/app/simple';
import { OUTCOME_LABELS, describeCondition, getScenario } from '@/engine';
import { Logo } from '@/components/brand/Logo';
import { Button, Card, CardButton, Chip, Dialog, Icon, IconButton, ScreenShell } from '@/components/ui';
import { dailyStateFor } from '@/progression/dailyState';
import { utcDailyId } from '@/progression/dailyTime';
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
  const dailyV2 = useApp((st) => st.dailyV2);
  const passport = useApp((st) => st.passport);
  const beginCampaignSetup = useApp((st) => st.beginCampaignSetup);
  const continueCampaign = useApp((st) => st.continueCampaign);
  const abandonCampaign = useApp((st) => st.abandonCampaign);
  const startDailyQuickPlay = useApp((st) => st.startDailyQuickPlay);
  const simple = useSimple();
  const [confirmNew, setConfirmNew] = useState(false);

  const todayId = utcDailyId();
  const dailyInProgress = Boolean(plan?.dailyDate === todayId && game);
  const dailyState = dailyStateFor(todayId, dailyV2, dailyInProgress, simple);
  const condition = simpleCondition(describeCondition(republic), simple);
  // A campaign record exists only while a run is in progress (it is cleared when the run finishes or is abandoned).
  // A daily attempt in progress is handled by the daily button, not the campaign tile.
  const hasCampaign = Boolean(campaign && plan && !plan.dailyDate);
  const playToday = () => (dailyState.status === 'in-progress' ? continueCampaign() : startDailyQuickPlay());

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

      <Card className={s.hero} data-testid="home-condition" aria-label={simple ? 'How your city is doing' : 'Your Republic condition'}>
        <ConditionRing condition={republic} className={s.ring} />
        <div className={s.heroText}>
          <div className={s.eyebrow}>{simple ? 'Your city' : 'Your Republic'}</div>
          <div className={s.condition}>{condition.label}</div>
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
        <Button variant="primary" size="lg" block icon="play" onClick={playToday} data-testid="daily-play-today">
          {dailyState.cta}
        </Button>
        <p className={s.primaryCaption} data-testid="daily-state-line">
          {dailyState.line}
        </p>
        {hasCampaign ? (
          <Button variant="secondary" size="md" block icon="play" onClick={continueCampaign} data-testid="home-continue">
            {simple ? SIMPLE_UI.continue : 'Continue campaign'} · {continueCaption}
          </Button>
        ) : (
          <Button variant="secondary" size="md" block onClick={startNew} data-testid="home-start-campaign">
            {simple ? SIMPLE_UI.startCampaign : 'Start the 10-minute campaign'}
          </Button>
        )}
        {hasCampaign && (
          <Button variant="ghost" size="sm" onClick={startNew} data-testid="home-start-campaign">
            {simple ? 'Start a new story instead' : 'Start a new campaign instead'}
          </Button>
        )}
      </div>

      <div className={s.grid}>
        <CardButton className={s.tile} onClick={() => navigate({ name: 'daily' })} data-testid="home-daily">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>{simple ? SIMPLE_UI.daily : "Today's Crisis"}</span>
            <Icon name="clock" size={18} />
          </div>
          <div className={s.tileTitle}>{dailyState.status === 'official' ? `${dailyState.record?.official?.score}` : dailyState.status === 'in-progress' ? 'In progress' : 'Not played yet'}</div>
          <div className={s.tileText}>{simple ? '3 minutes · same for everyone today' : '3 minutes · the same crisis for everyone today'}</div>
          <div className={s.tileFoot}>
            <span>{simple ? 'Details and past days' : 'Details and calendar'}</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>

        <CardButton className={s.tile} onClick={() => navigate({ name: 'calendar' })} data-testid="home-calendar">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>{simple ? 'Your days' : 'Calendar'}</span>
            <Icon name="history" size={18} />
          </div>
          <div className={s.tileTitle}>
            {dailyV2.filter((d) => d.official).length === 1 ? '1 day' : `${dailyV2.filter((d) => d.official).length} days`} · {passport.earned.length === 1 ? '1 stamp' : `${passport.earned.length} stamps`}
          </div>
          <div className={s.tileText}>{simple ? 'Days played and stamps earned.' : 'Completion calendar and Civic Passport.'}</div>
          <div className={s.tileFoot}>
            <span>{simple ? 'Open your days' : 'Open calendar'}</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>
        <Button variant="link" size="sm" onClick={() => navigate({ name: 'passport' })} data-testid="home-passport" icon="sparkle">
          {simple ? 'Your stamps' : 'Civic Passport'}
        </Button>

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
          <div className={s.tileTitle}>{bests.campaign ? <span className="tabular">{bests.campaign.score}</span> : simple ? 'No story yet' : 'No campaign yet'}</div>
          <div className={s.tileText}>{bests.campaign ? bestOutcome : simple ? 'Finish the story for a score.' : 'Finish the campaign for a score.'}</div>
          <div className={s.tileFoot}>
            <span>{simple ? 'Earlier games' : 'History'}</span>
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
