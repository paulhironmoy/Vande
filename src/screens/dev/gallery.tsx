/**
 * DEVELOPMENT GALLERY ONLY (Vite dev server: /src/screens/dev/gallery.html?screen=reveal). Renders screens with
 * fixtures for visual review and e2e screenshots. Not part of the production build.
 */
import '@fontsource-variable/manrope';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { Chip, UiProvider, type ChipTone } from '@/ui';
import { RevealScreen } from '../reveal/RevealScreen';
import { BattingScreen } from '../batting/BattingScreen';
import { localInnings } from '../local/localInnings';
import { BowlingPlannerScreen } from '../planner/BowlingPlannerScreen';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { RecoverAccount } from '../onboarding/RecoverAccount';
import { AgeGate, AgeStop } from '../onboarding/AgeGate';
import { TrainingScreen } from '../training/TrainingScreen';
import { engine } from '@/engine';
import { HighlightPreview } from '@/highlight/HighlightPreview';
import { fixtureMatchLog, FIXTURE_PLAYERS } from './fixtures';
import { useT } from '@/i18n';
import { cardBlob, inviteCardModel, playerOf } from '../share/cards';
import { AwaitingRevealView } from '../match/views';
import type { MatchView } from '@/contracts';

/** A duel whose innings are both in, revealing at a shared slot (`?in=` seconds from now, default 200). */
function RevealCountdown() {
  const [view] = useState<MatchView>(() => {
    const at = new Date(Date.now() + Number(params.get('in') ?? 200) * 1000).toISOString();
    const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    return { matchId: 'gallery', kind: 'duel', phase: 'awaiting_reveal', conditions: { pitch: 'green', weather: 'humid' }, me: 0, players: [FIXTURE_PLAYERS[0], FIXTURE_PLAYERS[1]], locked: [true, true], battingDone: [true, true], seedCommit: 'a'.repeat(64), roomId: null, inviteUrl: null, rematch: null, myCommit: 'f'.repeat(64), opponentCommit: 'e'.repeat(64), deadlines: { lockBy: hours(-3), batBy: hours(20), revealAt: params.get('slot') === '0' ? null : at }, myBallsFaced: 6 };
  });
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <AwaitingRevealView view={view} me={FIXTURE_PLAYERS[0]} opponent={FIXTURE_PLAYERS[1]} now={Date.now()} services={null} />
    </main>
  );
}

/** A share card as the image people receive (`?card=invite` or `cup-invite`, with `&cup=` for a named cup). */
function CardPreview({ card }: { card: string }) {
  const tr = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    const cup = card === 'cup-invite' ? { name: params.get('cup') ?? 'Office Cup 2026' } : undefined;
    void cardBlob(inviteCardModel(tr, { inviter: playerOf(FIXTURE_PLAYERS[0]), conditions: cup ? null : { pitch: 'green', weather: 'humid' }, url: `https://vande.example/i/${'AbQFWHH7n9sE4Q6HOZ_P5Esznt8MGdOYr7Tqcc311sAM7EmrfV1'}.${'o011b4kCB4ZrT0x9QwErTy'}`, cup }), tr.locale).then((b) => {
      if (alive && b) setSrc((url = URL.createObjectURL(b)));
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card, tr]);
  return (
    <main style={{ padding: 16 }}>
      <h1 className="sr-only">Share card</h1>
      {src && <img src={src} alt={tr.t('invite.card_alt', { name: FIXTURE_PLAYERS[0].alias })} style={{ width: '100%', height: 'auto', display: 'block' }} data-testid="card-image" />}
    </main>
  );
}

const params = new URLSearchParams(location.search);
/** The moderated display names a highlight draws (`?names=A,B` tries others, e.g. long or renamed ones). */
const HIGHLIGHT_NAMES = ((params.get('names') ?? '').split(',').filter(Boolean).length === 2 ? params.get('names')!.split(',') : [FIXTURE_PLAYERS[0].alias, FIXTURE_PLAYERS[1].alias]) as [string, string];
const screen = params.get('screen') ?? 'reveal';
const locale = (params.get('locale') ?? 'en') as LocaleId;
useApp.getState().updateSettings({
  locale,
  reducedMotion: params.get('rm') === '1' ? 'on' : 'system',
  highContrast: params.get('hc') === '1',
  quality: (params.get('q') as 'auto' | 'low' | 'standard' | 'high' | null) ?? 'auto',
  textScale: params.get('ts') === '1.3' ? 1.3 : 1,
});

function Gallery() {
  const [log] = useState(fixtureMatchLog);
  switch (screen) {
    case 'reveal':
      return <RevealScreen log={log} verified onRematch={() => undefined} onShare={() => undefined} autoplay={params.get('autoplay') !== '0'} initialMode={(params.get('mode') as 'full' | 'key_moments' | null) ?? undefined} startAt={Number(params.get('t') ?? 0)} />;
    case 'batting': {
      const conditions = { pitch: 'hard' as const, weather: 'clear' as const };
      const plan = engine.ghostPlan(engine.GHOSTS[0]?.id ?? 'anchor', 'gallery', conditions);
      const inn = localInnings({ plan, conditions, seed: 'gallery-seed' });
      return (
        <BattingScreen
          setup={{ conditions, field: plan.field, batter: FIXTURE_PLAYERS[0], bowler: { ...FIXTURE_PLAYERS[1], alias: 'The Anchor', kind: 'ghost' } }}
          nextBall={inn.nextBall}
          submitShot={inn.submitShot}
          onComplete={() => undefined}
          connectivity={(params.get('net') as 'online' | 'offline' | 'reconnecting') ?? 'online'}
          title="Practice Ghost"
        />
      );
    }
    case 'onboarding':
      return (
        <OnboardingScreen
          onComplete={() => undefined}
          initialSeed="swing-king-7"
          initialAlias={params.get('alias') ?? ''}
          // ?recover=1 shows the recovery entry; its sheet answers "no player linked" (nothing leaves the page).
          footerExtra={params.get('recover') === '1' ? <RecoverAccount methods={['google', 'passkey']} recover={async () => 'no_account'} /> : undefined}
        />
      );
    case 'age':
      // The neutral age question (nothing is stored from the gallery: the answer only logs).
      return <AgeGate onAnswer={(a) => console.info('age answer', a)} footerExtra={params.get('recover') === '1' ? <RecoverAccount methods={['google', 'passkey']} recover={async () => 'no_account'} /> : undefined} />;
    case 'age-stop':
      return <AgeStop />;
    case 'training':
      return <TrainingScreen player={FIXTURE_PLAYERS[0]} onDone={() => undefined} onSkip={() => undefined} />;
    case 'planner':
      return <BowlingPlannerScreen conditions={{ pitch: 'green', weather: 'humid' }} unlocked={engine.STARTER_VARIANTS} onLock={async () => ({ commitHash: '9f2c4e1ab07d33c58e1f0a7b6c2d9e4f' })} onBack={() => undefined} deadline="Locks in 5 hours" />;
    case 'reveal-countdown':
      return <RevealCountdown />;
    case 'card':
      return <CardPreview card={params.get('card') ?? 'cup-invite'} />;
    case 'chips': {
      const tones: ChipTone[] = ['neutral', 'cyan', 'amber', 'success', 'danger', 'violet', 'green', 'clay'];
      return (
        <main style={{ padding: 24, display: 'grid', gap: 16 }}>
          <h1 className="sr-only">Chips</h1>
          {[false, true].map((solid) => (
            <section key={String(solid)} aria-label={solid ? 'Solid chips' : 'Outline chips'} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tones.map((tone) => (
                <Chip key={tone} tone={tone} solid={solid} icon="check">
                  {tone}
                </Chip>
              ))}
              {tones.map((tone) => (
                <Chip key={`${tone}-lg`} tone={tone} solid={solid} size="lg" dot>
                  {tone} large
                </Chip>
              ))}
            </section>
          ))}
        </main>
      );
    }
    case 'highlight':
      return (
        <main style={{ padding: 24 }}>
          <h1 className="sr-only">Highlight preview</h1>
          <HighlightPreview
            input={{ jobId: 'gallery', log, aliases: HIGHLIGHT_NAMES, locale, fixtureLabel: 'Office Cup · Final', day: '2026-10-25', ranks: [12, null], standings: [{ alias: HIGHLIGHT_NAMES[0], from: 3, to: 1 }, { alias: HIGHLIGHT_NAMES[1], from: 1, to: 2 }], cta: { url: 'https://vande.example/h/abc123' } }}
            autoplay={params.get('autoplay') !== '0'}
          />
        </main>
      );
    default:
      return <p style={{ padding: 24 }}>Unknown screen: {screen}</p>;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiProvider>
      <Gallery />
    </UiProvider>
  </StrictMode>,
);
