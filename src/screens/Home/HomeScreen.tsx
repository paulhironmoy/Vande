import { useMemo, useState } from 'react';
import { useApp } from '@/app/store';
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
  const [confirmNew, setConfirmNew] = useState(false);

  const dailySpec = useMemo(() => getDailySpec(new Date()), []);
  const dailyDone = daily.find((d) => d.date === dailySpec.date);
  const condition = describeCondition(republic);
  // A campaign record exists only while a run is in progress (it is cleared when the run finishes or is abandoned).
  const hasCampaign = Boolean(campaign && plan);

  const continueCaption = (() => {
    if (!campaign || !plan) return '';
    const idx = campaign.chapterIndex;
    const scenarioId = plan.scenarioIds[Math.min(idx, plan.scenarioIds.length - 1)];
    const title = getScenario(scenarioId).title;
    const chapterLabel = plan.scenarioIds.length > 1 ? `Chapter ${idx + 1} of ${plan.scenarioIds.length} · ` : '';
    if (game && game.status !== 'briefing') return `${chapterLabel}${title} · ${formatClock(Math.max(0, game.duration - game.tick))} left`;
    if (campaign.completed.length === idx + 1) return `${chapterLabel}${title} · chapter complete`;
    return `${chapterLabel}${title} · briefing`;
  })();

  const startNew = () => {
    if (hasCampaign) setConfirmNew(true);
    else beginCampaignSetup();
  };

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

      <Card className={s.hero} data-testid="home-condition" aria-label="Your Republic condition">
        <ConditionRing condition={republic} className={s.ring} />
        <div className={s.heroText}>
          <div className={s.eyebrow}>Your Republic</div>
          <div className={s.condition}>{condition.label}</div>
          <p className={s.summary}>{condition.summary}</p>
          <div className={s.meta}>
            <Chip icon="history" tone="neutral">
              {republic.crises === 1 ? '1 crisis faced' : `${republic.crises} crises faced`}
            </Chip>
            <Chip icon="sparkle" tone="cyan">
              {republic.campaigns === 1 ? '1 campaign' : `${republic.campaigns} campaigns`}
            </Chip>
          </div>
        </div>
      </Card>

      <div className={s.primary}>
        {hasCampaign ? (
          <>
            <Button variant="primary" size="lg" block icon="play" onClick={continueCampaign} data-testid="home-continue">
              Continue campaign
            </Button>
            <p className={s.primaryCaption}>{continueCaption}</p>
            <Button variant="ghost" size="sm" onClick={startNew} data-testid="home-start-campaign">
              Start a new campaign instead
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" block icon="play" onClick={startNew} data-testid="home-start-campaign">
              Start the 10-minute campaign
            </Button>
            <p className={s.primaryCaption}>Three chapters · choose 1–5 opponents · pause any time</p>
          </>
        )}
      </div>

      <div className={s.grid}>
        <CardButton className={s.tile} onClick={() => navigate({ name: 'daily' })} data-testid="home-daily">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>Today&apos;s Republic Crisis</span>
            <Icon name="clock" size={18} />
          </div>
          <div className={s.tileTitle}>{dailySpec.title}</div>
          <div className={s.tileText}>
            3 minutes · {dailySpec.opponents.map((o) => OPPONENTS[o].name).join(' + ')}
          </div>
          <div className={s.tileFoot}>
            <span>{dailyDone ? `Your result: ${dailyDone.score}` : 'Not played yet'}</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>

        <CardButton className={s.tile} onClick={() => navigate({ name: 'republic' })} data-testid="home-republic">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>Living Republic</span>
            <Icon name="building" size={18} />
          </div>
          <div className={s.tileTitle}>{condition.label}</div>
          <div className={s.tileText}>See how your city has changed across every crisis you have faced.</div>
          <div className={s.tileFoot}>
            <span>Open your Republic</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>

        <CardButton className={s.tile} onClick={() => navigate({ name: 'history' })} data-testid="home-personal-best">
          <div className={s.tileHead}>
            <span className={s.eyebrow}>Personal best</span>
            <Icon name="sparkle" size={18} />
          </div>
          {bests.campaign ? (
            <>
              <div className={s.best}>
                <span className="tabular">{bests.campaign.score}</span>
                <span className="muted text-sm"> / 100</span>
              </div>
              <div className={s.tileText}>{OUTCOME_LABELS[bests.campaign.outcome]}</div>
            </>
          ) : (
            <>
              <div className={s.tileTitle}>No campaign yet</div>
              <div className={s.tileText}>Finish the campaign to set your first Republic score.</div>
            </>
          )}
          <div className={s.tileFoot}>
            <span>Review past crises</span>
            <Icon name="forward" size={18} />
          </div>
        </CardButton>
      </div>

      <div className={s.quiet}>
        <Button variant="ghost" size="sm" icon="history" onClick={() => navigate({ name: 'history' })} data-testid="home-history">
          History
        </Button>
        <Button variant="ghost" size="sm" icon="settings" onClick={() => navigate({ name: 'settings' })}>
          Settings &amp; accessibility
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
        title="Start a new campaign?"
        description="Your current campaign will be discarded. Completed chapters stay in your history."
        confirmLabel="Start new campaign"
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
