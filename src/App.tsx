import { Component, Suspense, lazy, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useApp } from '@/app/store';
import { useSettingsEffects } from '@/app/settingsEffects';
import { useNavigationSync } from '@/app/navigation';
import { useGameLoop } from '@/app/gameLoop';
import { installAudioUnlock } from '@/audio/sounds';
import { Button, ToastHost } from '@/components/ui';
import { LaunchScreen } from '@/screens/Launch/LaunchScreen';
import { IntroScreen } from '@/screens/Intro/IntroScreen';
import { HomeScreen } from '@/screens/Home/HomeScreen';

const PlayScreen = lazy(() => import('@/screens/Play/PlayScreen'));
const OpponentSelectScreen = lazy(() => import('@/screens/OpponentSelect/OpponentSelectScreen').then((m) => ({ default: m.OpponentSelectScreen })));
const BriefingScreen = lazy(() => import('@/screens/Briefing/BriefingScreen').then((m) => ({ default: m.BriefingScreen })));
const ChapterResultScreen = lazy(() => import('@/screens/ChapterResult/ChapterResultScreen').then((m) => ({ default: m.ChapterResultScreen })));
const FinalResultScreen = lazy(() => import('@/screens/FinalResult/FinalResultScreen').then((m) => ({ default: m.FinalResultScreen })));
const DailyScreen = lazy(() => import('@/screens/Daily/DailyScreen').then((m) => ({ default: m.DailyScreen })));
const ChallengeScreen = lazy(() => import('@/screens/Challenge/ChallengeScreen').then((m) => ({ default: m.ChallengeScreen })));
const RepublicScreen = lazy(() => import('@/screens/Republic/RepublicScreen').then((m) => ({ default: m.RepublicScreen })));
const HistoryScreen = lazy(() => import('@/screens/History/HistoryScreen').then((m) => ({ default: m.HistoryScreen })));
const SettingsScreen = lazy(() => import('@/screens/Settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const AboutScreen = lazy(() => import('@/screens/About/AboutScreen').then((m) => ({ default: m.AboutScreen })));
const UpdateBanner = lazy(() => import('@/pwa/UpdateBanner').then((m) => ({ default: m.UpdateBanner })));

function CurrentScreen() {
  const screen = useApp((s) => s.screen);
  const hydrated = useApp((s) => s.hydrated);
  if (!hydrated) return <LaunchScreen />;
  switch (screen.name) {
    case 'launch':
      return <LaunchScreen />;
    case 'intro':
      return <IntroScreen />;
    case 'home':
      return <HomeScreen />;
    case 'opponents':
      return <OpponentSelectScreen />;
    case 'briefing':
      return <BriefingScreen />;
    case 'play':
      return <PlayScreen />;
    case 'chapter-result':
      return <ChapterResultScreen />;
    case 'final-result':
      return <FinalResultScreen />;
    case 'daily':
      return <DailyScreen />;
    case 'challenge':
      return <ChallengeScreen />;
    case 'republic':
      return <RepublicScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'about':
      return <AboutScreen />;
    default:
      return <HomeScreen />;
  }
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('VANDE screen error', error, info.componentStack);
  }
  private goHome = () => {
    this.setState({ error: null });
    useApp.getState().navigate({ name: 'home' });
  };
  private reload = () => {
    location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
        <div className="panel" style={{ maxWidth: '28rem', padding: '1.5rem' }}>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Something went wrong</h1>
          <p className="secondary mt-2">Your progress is saved on this device. You can return home or reload the game.</p>
          <div className="row-wrap mt-6">
            <Button variant="primary" onClick={this.goHome}>
              Return home
            </Button>
            <Button onClick={this.reload} icon="refresh">
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

function Effects() {
  const hydrate = useApp((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  useEffect(() => installAudioUnlock(), []);
  useSettingsEffects();
  useNavigationSync();
  useGameLoop();
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <Effects />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<div className="app-fallback" aria-hidden="true" />}>
          <CurrentScreen />
        </Suspense>
      </main>
      <ToastHost />
      <Suspense fallback={null}>
        <UpdateBanner />
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
