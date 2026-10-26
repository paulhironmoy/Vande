/**
 * Root app shell — ROOT-OWNED. Providers, the route switch, connectivity and update banners, Android Back, focus on
 * navigation and a per-screen error boundary. Screens come from the workstreams' route tables
 * (src/screens/routes.ts: experience, src/social/routes.ts: social); a route without a screen shows Not found.
 * A normal start first offers the launch choice (Practice or Skip, src/practice/ui/LaunchChoice).
 */
import { Component, Suspense, lazy, useEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { StateView, StatusBanner, UiProvider } from '@/ui';
import { UpdateBanner } from '@/pwa/UpdateBanner';
import { isNativePlatform } from '@/platform';
import { experienceRoutes } from '@/screens/routes';
import { socialRoutes } from '@/social/routes';
import { lazyRoute } from '@/screens/app/lazyRoute';
import { shouldOfferLaunchChoice } from '@/practice/ui/launch';
import { closeTopLayer } from './app/back';
import { useRouter, type Route, type RouteTable } from './app/router';
import { getServices } from './app/services';
import { useApp } from './app/store';

const ROUTES: RouteTable = {
  ...experienceRoutes,
  ...socialRoutes,
  // Practice brings its own catalog (src/i18n/practice) and needs no engine copy.
  practice: lazyRoute(() => import('@/practice/ui/PracticeRoute'), { engine: false }),
};

const LaunchChoice = lazy(() => import('@/practice/ui/LaunchChoice'));
/** How long a start waits for the services (they deliver an Android App Link) before offering the launch choice. */
const LAUNCH_LINK_WAIT_MS = 1_500;

function screenFor(route: Route): ComponentType<{ route: Route }> | null {
  const screen = ROUTES[route.name] ?? ROUTES.not_found;
  return (screen as ComponentType<{ route: Route }> | undefined) ?? null;
}

interface BoundaryProps {
  resetKey: string;
  children: ReactNode;
}

/** Keeps a failing screen from blanking the app; navigating elsewhere or "Try again" re-mounts it. */
class ScreenBoundary extends Component<BoundaryProps, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('screen failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main>
        <StateView kind="error" onAction={() => this.setState({ failed: false })} />
      </main>
    );
  }
}

/** Moves focus to the new screen's heading after an in-app navigation, so screen readers announce where they are. */
function useFocusOnNavigate(route: Route) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo?.(0, 0);
    let tries = 0;
    let frame = 0;
    const focus = () => {
      const target = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main');
      if (!target) {
        if (++tries < 60) frame = requestAnimationFrame(focus);
        return;
      }
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [route]);
}

/** Android Back: close the top layer, else go back, else go Home, and only exit from Home. */
function useNativeBack() {
  useEffect(() => {
    if (!isNativePlatform()) return;
    let remove: (() => void) | null = null;
    let disposed = false;
    void import('@capacitor/app').then(async ({ App }) => {
      const handle = await App.addListener('backButton', () => {
        if (closeTopLayer()) return;
        const { route, depth, back, navigate } = useRouter.getState();
        if (depth > 0) back();
        else if (route.name !== 'home') navigate({ name: 'home' }, { replace: true });
        else void App.exitApp();
      });
      if (disposed) void handle.remove();
      else remove = () => void handle.remove();
    });
    return () => {
      disposed = true;
      remove?.();
    };
  }, []);
}

/**
 * The launch choice, once per start that opened the app at its root (shouldOfferLaunchChoice). A deep link wins: the
 * choice waits briefly for the services, which open an Android App Link, and gives way as soon as the route leaves
 * home. Coming back to home later never shows it again.
 */
function useLaunchChoice(route: Route) {
  const [offer, setOffer] = useState(() => shouldOfferLaunchChoice(route));
  const [linkChecked, setLinkChecked] = useState(false);
  useEffect(() => {
    if (!offer) return;
    let alive = true;
    const done = () => alive && setLinkChecked(true);
    const timer = setTimeout(done, LAUNCH_LINK_WAIT_MS);
    void getServices().then(done, done);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [offer]);
  useEffect(() => {
    if (route.name !== 'home') setOffer(false);
  }, [route]);
  return { show: offer && route.name === 'home', ready: linkChecked, dismiss: () => setOffer(false) };
}

export function App() {
  const route = useRouter((s) => s.route);
  const online = useApp((s) => s.online);
  const inPlay = useApp((s) => s.inPlay);

  useEffect(() => {
    void getServices();
    const sync = () => useRouter.getState().syncFromLocation();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useNativeBack();
  useFocusOnNavigate(route);
  const launch = useLaunchChoice(route);
  const navigate = useRouter((s) => s.navigate);

  const Screen = screenFor(route);
  const key = JSON.stringify(route);
  const loading = (
    <main>
      <StateView kind="loading" />
    </main>
  );
  return (
    <UiProvider>
      <StatusBanner status={online ? 'online' : 'offline'} />
      <ScreenBoundary resetKey={launch.show ? 'launch' : key}>
        <Suspense fallback={loading}>
          {launch.show ? (
            launch.ready ? (
              <LaunchChoice
                onPractice={() => {
                  launch.dismiss();
                  navigate({ name: 'practice' }, { replace: true });
                }}
                onSkip={launch.dismiss}
              />
            ) : (
              loading
            )
          ) : Screen ? (
            <Screen key={key} route={route} />
          ) : (
            <main>
              <StateView kind="error" />
            </main>
          )}
        </Suspense>
      </ScreenBoundary>
      {!inPlay && <UpdateBanner />}
    </UiProvider>
  );
}
