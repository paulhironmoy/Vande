/**
 * Training's batting layout at 100%, 130% and 150% text on a 360 x 780 phone: the stage height and where BAT and
 * Play / Next ball sit, so the controls stay on screen whatever the text size. Serves the given build itself.
 *
 *   npx vite build --outDir dist-perf && node scripts/perf/stage-height.mjs dist-perf
 */
import { chromium, serveBuild } from './serve.mjs';

const server = await serveBuild(process.argv[2] ?? 'dist');
const browser = await (await chromium()).launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  for (const scale of [1, 1.3, 1.5]) {
    const page = await (await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    await page.addInitScript((s) => {
      localStorage.setItem('vc:player', JSON.stringify({ id: null, alias: 'Swing King', avatar: { seed: 'k3j2h4g5f6' }, kit: { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' } }));
      localStorage.setItem('vc:age', 'adult');
      localStorage.setItem('vc:settings', JSON.stringify({ locale: 'en', reducedMotion: 'system', sound: false, haptics: false, quality: 'auto', textScale: s, highContrast: false }));
    }, scale);
    await page.goto(`${server.url}/train`);
    await page.getByTestId('bat-next').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid=batting-screen] section');
      const box = (id) => {
        const b = document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect();
        return b ? [Math.round(b.top), Math.round(b.bottom)] : null;
      };
      return { stageH: stage ? getComputedStyle(stage).height : null, font: getComputedStyle(document.documentElement).fontSize, compact: document.querySelector('[data-testid=batting-screen]')?.getAttribute('data-compact'), hit: box('bat-hit'), next: box('bat-next'), docH: document.scrollingElement.scrollHeight };
    });
    console.log(scale, JSON.stringify(r));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
