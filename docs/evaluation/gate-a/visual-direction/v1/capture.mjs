import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { linkSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(root, '.capture-v2-'));
const captures = [
  { evidence: false, name: 'golden-screen-v2-844x390.png' },
  { evidence: true, name: 'golden-screen-v2-evidence-844x390.png' },
];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const { evidence, name } of captures) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const url = pathToFileURL(join(root, 'index.html'));
    if (evidence) url.searchParams.set('evidence', '1');
    await page.goto(url.href, { waitUntil: 'load' });
    await page.locator('.world').evaluate((image) => image.decode());
    await page.screenshot({
      path: join(scratch, name),
      type: 'png'
    });
    await page.close();
  }
  await browser.close();
  browser = null;
  const created = [];
  for (const { name } of captures) {
    try {
      const target = join(root, name);
      linkSync(join(scratch, name), target);
      created.push(target);
    } catch (error) {
      for (const target of created.reverse()) {
        try { unlinkSync(target); } catch { /* preserve the original failure */ }
      }
      throw error;
    }
  }
} finally {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
