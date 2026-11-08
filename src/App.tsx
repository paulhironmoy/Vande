/**
 * Root app shell — ROOT-OWNED. Providers, the route switch, connectivity and update banners, Android Back, focus on
 * navigation and a per-screen error boundary. Screens come from the workstreams' route tables
 * (src/screens/routes.ts: experience, src/social/routes.ts: social); a route without a screen shows Not found.
 * A normal start opens Practice (Stage 1 of docs/VANDE-PRODUCT-SEQUENCE.md); deep links open their own screens.
 */
import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { StateView, StatusBanner, UiProvider } from '@/ui';
import { UpdateBanner } from '@/pwa/UpdateBanner';
import { isNativePlatform } from '@/platform';
import { experienceRoutes } from '@/screens/routes';
import { socialRoutes } from '@/social/routes';
import { lazyRoute } from '@/screens/app/lazyRoute';
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

/** How long a start at the root waits for the services (they deliver an Android App Link) before opening Practice. */
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

/** Android Back: close the top layer, else go back, else go Home, and exit from Home or from Practice (Stage 1's home). */
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
        else if (route.name === 'practice' && !legacyHomeAtRoot()) void App.exitApp();
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

/** The test-only switch that keeps the legacy home at the root (the legacy suites set localStorage vc:legacy-home = '1'). */
function legacyHomeAtRoot(): boolean {
  try {
    return localStorage.getItem('vc:legacy-home') === '1';
  } catch {
    return false;
  }
}

/**
 * Stage 1 (docs/VANDE-PRODUCT-SEQUENCE.md): a start at the root opens Practice. A deep link wins: the start waits briefly
 * for the services, which open an Android App Link, and goes to Practice only if the route is still home. The legacy home
 * stays reachable through its deep links and, for the legacy test suites, the vc:legacy-home switch.
 */
function useStartInPractice(route: Route): boolean {
  const [pending, setPending] = useState(() => route.name === 'home' && !legacyHomeAtRoot());
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const done = () => {
      if (!alive) return;
      alive = false;
      setPending(false);
      const { route: now, navigate } = useRouter.getState();
      if (now.name === 'home') navigate({ name: 'practice' }, { replace: true });
    };
    const timer = setTimeout(done, LAUNCH_LINK_WAIT_MS);
    void getServices().then(done, done);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pending]);
  useEffect(() => {
    if (route.name !== 'home') setPending(false);
  }, [route]);
  return pending && route.name === 'home';
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
  const starting = useStartInPractice(route);

  const Screen = screenFor(route);
  const key = JSON.stringify(route);
  const loading = (
    <main>
      <StateView kind="loading" />
    </main>
  );
  return (
    <UiProvider>
      {/* Practice is fully local. The legacy sync warning is irrelevant here and must not cover a delivery. */}
      {!starting && route.name !== 'practice' && <StatusBanner status={online ? 'online' : 'offline'} />}
      <ScreenBoundary resetKey={starting ? 'launch' : key}>
        <Suspense fallback={loading}>
          {starting ? (
            loading
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
