import { useEffect, useState } from 'react';
import { useApp } from '@/app/store';
import type { AboutPage } from '@/app/storeTypes';
import { storage } from '@/app/persistence';
import { Button, Card, ScreenShell } from '@/components/ui';
import s from './AboutScreen.module.css';

const CONTENT_DATE = '23 October 2026';
const ISSUES_URL = 'https://github.com/paulhironmoy/Vande/issues';
const REPO_URL = 'https://github.com/paulhironmoy/Vande';

const PAGES: { id: AboutPage; label: string; title: string }[] = [
  { id: 'disclosure', label: 'Disclosure', title: 'Independent product disclosure' },
  { id: 'privacy', label: 'Privacy', title: 'Privacy' },
  { id: 'accessibility', label: 'Accessibility', title: 'Accessibility statement' },
  { id: 'attribution', label: 'Attribution', title: 'Open-source attribution' },
  { id: 'support', label: 'Support', title: 'Support' },
  { id: 'version', label: 'Version', title: 'Version & build' },
];

function Disclosure() {
  return (
    <>
      <h2>Who makes VANDE</h2>
      <p>
        <strong>VANDE: Republic Under Pressure</strong> is an independent civic-strategy game. It is <strong>not affiliated with, endorsed by, or
        connected to the Government of India</strong>, any state government, the Election Commission of India, any court, police service, political
        party, public institution or news organisation.
      </p>
      <h2>Fiction, not reporting</h2>
      <p>
        Every scenario, district, character, document, recording and opponent is fictional. Characters are identified by role and a first name only.
        No real individual, organisation, community, religion or party is depicted, accused or implied. Any resemblance is coincidental.
      </p>
      <h2>Opponents are behaviours</h2>
      <p>
        The five simulated opponents (Grievance Exploiter, Provocateur, Disinformation Cell, Sabotage Network, Overreaction Trap) are rule-based
        patterns of behaviour that run entirely on your device. They never represent a people, a faith or a political movement. Abstract “bug” glyphs
        mark fabricated evidence and covert manipulation — never human beings.
      </p>
      <h2>What the game teaches</h2>
      <p>
        The game rewards addressing legitimate grievances, protecting peaceful assembly and independent journalism, verifying evidence before acting,
        keeping enforcement lawful and proportionate, and preventing violence and sabotage. Both indiscriminate suppression and uncontrolled disorder
        lose. Rights moments explain constitutional ideas in plain language and link to official public sources.
      </p>
      <p>
        <strong>Educational content — not legal advice.</strong> Nothing in VANDE is a statement of law, policy or fact about any real situation.
      </p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h2>Nothing leaves your device</h2>
      <p>
        VANDE has no accounts, no servers, no analytics and no advertising. Your campaign progress, results, history, personal bests, Republic
        condition and settings are stored only in your browser or in the Android app's local storage (IndexedDB).
      </p>
      <h2>What is stored locally</h2>
      <ul>
        <li>Settings and accessibility preferences.</li>
        <li>The chapter you are playing, so a refresh or interruption restores it.</li>
        <li>Completed chapters, campaigns, daily challenges and personal bests.</li>
        <li>Your long-term Republic condition.</li>
      </ul>
      <h2>Sharing is in your hands</h2>
      <p>
        Result cards and challenge links are generated on your device. A challenge link contains only the scenario, a seed number, the difficulty,
        the selected opponents and your score — never your name or device details. Sharing uses your device's own share sheet; nothing is sent to us.
      </p>
      <h2>Offline by design</h2>
      <p>
        After the first visit the game is cached so it works without a connection. The only network requests are the game's own static files.
        Official-source links in rights moments open external government or court websites with their own privacy policies.
      </p>
      <h2>Export and deletion</h2>
      <p>
        From Settings you can export everything as a JSON file or delete all local progress at once. Uninstalling the app or clearing site data has the
        same effect.
      </p>
    </>
  );
}

function Accessibility() {
  return (
    <>
      <h2>Our commitment</h2>
      <p>
        VANDE aims to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA wherever a game mechanic allows, on phones, tablets
        and desktops.
      </p>
      <h2>What is built in</h2>
      <ul>
        <li>Every control reachable and operable with a keyboard, with visible focus indicators and a skip link.</li>
        <li>Touch targets of at least 44 × 44 pixels and no interaction that depends on hover or precise gestures.</li>
        <li>Screen-reader semantics: landmarks, headings, labelled buttons, live regions for consequences and map captions.</li>
        <li>Status never shown by colour alone — evidence confidence and Republic dimensions always pair colour with a label and an icon.</li>
        <li>Text scaling to 200%, high-contrast mode, colour-blind-safe indicators and captions, all in Settings.</li>
        <li>Reduced motion (following your system setting or forced on) that removes non-essential animation and the launch sequence.</li>
        <li>An adjustable timer pace, and pause and resume at any moment. The pace never changes your score.</li>
        <li>Plain-language explanations throughout, with no required audio.</li>
      </ul>
      <h2>Known limitations</h2>
      <ul>
        <li>The animated city map is decorative reinforcement; every event it shows is also described in the feed and in captions.</li>
        <li>Very old Android WebViews without WebGL show a simplified static map.</li>
      </ul>
      <h2>Tell us what is missing</h2>
      <p>
        If something blocks you, please open an issue at <a href={ISSUES_URL}>{ISSUES_URL}</a>. Accessibility reports are prioritised.
      </p>
    </>
  );
}

const DEPS: { name: string; licence: string; url: string }[] = [
  { name: 'React & React DOM', licence: 'MIT', url: 'https://react.dev/' },
  { name: 'Vite', licence: 'MIT', url: 'https://vite.dev/' },
  { name: 'TypeScript', licence: 'Apache-2.0', url: 'https://www.typescriptlang.org/' },
  { name: 'PixiJS', licence: 'MIT', url: 'https://pixijs.com/' },
  { name: 'Zustand', licence: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'idb', licence: 'ISC', url: 'https://github.com/jakearchibald/idb' },
  { name: 'Workbox & vite-plugin-pwa', licence: 'MIT', url: 'https://developer.chrome.com/docs/workbox' },
  { name: 'Capacitor', licence: 'MIT', url: 'https://capacitorjs.com/' },
  { name: 'Manrope (Mikhail Sharanda)', licence: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/specimen/Manrope' },
  { name: 'Noto Sans Devanagari (Google)', licence: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari' },
  { name: 'Vitest & Playwright (development)', licence: 'MIT / Apache-2.0', url: 'https://vitest.dev/' },
];

function Attribution() {
  return (
    <>
      <h2>Open-source software</h2>
      <p>VANDE is built with free and open-source software. Thank you to every maintainer.</p>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Licence</th>
          </tr>
        </thead>
        <tbody>
          {DEPS.map((d) => (
            <tr key={d.name}>
              <td>
                <a href={d.url} rel="noopener noreferrer" target="_blank">
                  {d.name}
                </a>
              </td>
              <td>{d.licence}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Fonts</h2>
      <p>
        Manrope and Noto Sans Devanagari are bundled under the SIL Open Font License 1.1. No paid fonts, maps, illustrations or services are used.
      </p>
      <h2>Artwork and sound</h2>
      <p>The logo, city map, illustrations and synthesised sound cues are original to this project and need no external assets.</p>
      <h2>Source</h2>
      <p>
        The game's source code is published at <a href={REPO_URL}>{REPO_URL}</a>.
      </p>
    </>
  );
}

function Support() {
  return (
    <>
      <h2>Get help</h2>
      <p>
        Report a bug, an accessibility barrier or a content concern at <a href={ISSUES_URL}>{ISSUES_URL}</a>. Include your device, browser or app
        version, and the version shown on the Version page.
      </p>
      <h2>Frequently asked</h2>
      <ul>
        <li>
          <strong>I refreshed mid-chapter.</strong> The chapter is restored at the same moment, paused. Tap Resume.
        </li>
        <li>
          <strong>Can I play offline?</strong> Yes. After the first visit everything, including the daily challenge, works without a connection.
        </li>
        <li>
          <strong>Why did my score drop after an arrest?</strong> Acting on unverified or manipulated evidence, or using force beyond what the
          situation justifies, costs freedom and trust. Verify first; keep enforcement proportionate.
        </li>
        <li>
          <strong>Are the comparison scores real players?</strong> No. Daily comparison ranges are simulated from the scenario's seed and are labelled
          as such. There are no leaderboards and no accounts.
        </li>
        <li>
          <strong>How do challenges work?</strong> A challenge link reproduces the identical scenario, seed, difficulty and opponents on your
          friend's device. No server is involved.
        </li>
        <li>
          <strong>How do I remove my data?</strong> Settings → Delete all local progress.
        </li>
      </ul>
      <h2>Content concerns</h2>
      <p>
        All scenarios are fictional and reviewed to avoid depicting any real person, organisation or community. If you believe something crosses that
        line, please tell us through the link above.
      </p>
    </>
  );
}

function Version() {
  const online = useApp((st) => st.online);
  const isNative = useApp((st) => st.isNative);
  const [usage, setUsage] = useState<string>('—');
  const [backend, setBackend] = useState<string>('—');
  useEffect(() => {
    let alive = true;
    void storage.estimateUsage().then((u) => {
      if (!alive || !u) return;
      const kb = u.usage / 1024;
      setUsage(kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`);
    });
    void storage.backendKind().then((k) => alive && setBackend(k === 'idb' ? 'IndexedDB' : 'Memory + localStorage fallback'));
    return () => {
      alive = false;
    };
  }, []);
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const build = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'local';
  const date = typeof __BUILD_DATE__ !== 'undefined' ? new Date(__BUILD_DATE__).toUTCString() : '—';
  return (
    <>
      <h2>This build</h2>
      <dl className={s.kv}>
        <dt>Version</dt>
        <dd data-testid="about-version">{version}</dd>
        <dt>Build</dt>
        <dd>{build}</dd>
        <dt>Built</dt>
        <dd>{date}</dd>
        <dt>Platform</dt>
        <dd>{isNative ? 'Android app (Capacitor)' : 'Web / installed PWA'}</dd>
        <dt>Connection</dt>
        <dd>{online ? 'Online' : 'Offline — playing from cache'}</dd>
        <dt>Local storage</dt>
        <dd>
          {backend} · {usage} used
        </dd>
      </dl>
      <h2>Release notes</h2>
      <p>1.0.0 — First public release: three chapters, five opponents, daily challenge, friend challenges, offline play and the Android app.</p>
    </>
  );
}

export function AboutScreen() {
  const screen = useApp((st) => st.screen);
  const navigate = useApp((st) => st.navigate);
  const back = useApp((st) => st.back);
  const page: AboutPage = screen.name === 'about' ? screen.page : 'disclosure';
  const meta = PAGES.find((p) => p.id === page) ?? PAGES[0];
  return (
    <ScreenShell title={meta.title} eyebrow="About VANDE" onBack={() => back()} narrow testId="about-screen">
      <nav className={s.nav} aria-label="About pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={s.navBtn}
            aria-current={p.id === page ? 'page' : undefined}
            onClick={() => navigate({ name: 'about', page: p.id }, { replace: true })}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <Card className={s.doc} as="article" aria-labelledby="about-heading">
        <h1 id="about-heading" className="sr-only">
          {meta.title}
        </h1>
        {page === 'disclosure' && <Disclosure />}
        {page === 'privacy' && <Privacy />}
        {page === 'accessibility' && <Accessibility />}
        {page === 'attribution' && <Attribution />}
        {page === 'support' && <Support />}
        {page === 'version' && <Version />}
        <p className={s.updated}>Content date: {CONTENT_DATE}. Educational content — not legal advice.</p>
      </Card>
      <div className="mt-4">
        <Button variant="ghost" icon="home" onClick={() => navigate({ name: 'home' })}>
          Back to home
        </Button>
      </div>
    </ScreenShell>
  );
}
