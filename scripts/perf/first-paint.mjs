/**
 * Cold-load first paint on a phone profile (CPU throttled 4x, slow and fast 4G over CDP), medians of RUNS runs, for
 * the returning player's hub, a first visit and an invite link. Serves the given build itself (gzip, like hosting).
 *
 *   npx vite build --outDir dist-perf && node scripts/perf/first-paint.mjs dist-perf
 *   RUNS=5 VERBOSE=1 node scripts/perf/first-paint.mjs dist-perf
 */
import { chromium, serveBuild } from './serve.mjs';

const dir = process.argv[2] ?? 'dist';
const PROFILES = {
  slow4g: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
  fast4g: { latency: 60, down: (9 * 1024 * 1024) / 8, up: (1.5 * 1024 * 1024) / 8, cpu: 4 },
};
const runs = Number(process.env.RUNS ?? 3);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const PLAYER = { id: null, alias: 'Swing King', avatar: { seed: 'k3j2h4g5f6' }, kit: { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' } };

const server = await serveBuild(dir);
const browser = await (await chromium()).launch({ args: ['--ignore-gpu-blocklist'] });
try {
  const once = async (profile, path, selector, player) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    if (player)
      await ctx.addInitScript((p) => {
        localStorage.setItem('vc:player', JSON.stringify(p));
        localStorage.setItem('vc:age', 'adult');
      }, PLAYER);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const p = PROFILES[profile];
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    let bytes = 0;
    const js = [];
    cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
    page.on('response', (r) => {
      if (r.url().endsWith('.js')) js.push(r.url().split('/').pop());
    });
    const t0 = Date.now();
    await page.goto(`${server.url}${path}`, { waitUntil: 'commit' });
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 60_000 });
    const useful = Date.now() - t0;
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);
    const kb = Math.round(bytes / 1024);
    await ctx.close();
    return { useful, fcp: fcp ? Math.round(fcp) : null, kb, js };
  };
  const cases = [
    ['returning player, hub', '/', '[data-testid=home-screen]', true],
    ['first visit, age question', '/', '[data-testid=age-screen]', false],
    ['invite link (offline build shows its state)', '/i/abcdefgh1234', 'main h1, main h2', false],
  ];
  for (const profile of Object.keys(PROFILES)) {
    for (const [name, path, selector, player] of cases) {
      const rs = [];
      for (let i = 0; i < runs; i++) rs.push(await once(profile, path, selector, player));
      console.log(`${profile.padEnd(7)} ${name.padEnd(46)} useful ${median(rs.map((r) => r.useful))} ms  fcp ${median(rs.map((r) => r.fcp))} ms  transfer ${median(rs.map((r) => r.kb))} KB  js ${rs[0].js.length} files`);
      if (process.env.VERBOSE) console.log('   ', rs[0].js.join(' '));
    }
  }
} finally {
  await browser.close();
  await server.close();
}
