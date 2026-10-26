#!/usr/bin/env node
/**
 * Repository secret scan (CI): every file Git would commit (tracked, or untracked and not ignored) is checked for
 * private keys, cloud and API credentials, service-account JSON and OAuth client secrets. Exits 1 on any hit.
 *   node scripts/scan-secrets.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['service-account JSON', /"type"\s*:\s*"service_account"/],
  ['OAuth client secret', /"client_secret"\s*:\s*"[^"]{8,}"|GOCSPX-[0-9A-Za-z_-]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /gh[pousr]_[0-9A-Za-z]{36}/],
  ['Slack token', /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ['Cloudflare API token assignment', /CLOUDFLARE_API_TOKEN\s*=\s*['"]?[0-9A-Za-z_-]{30,}/],
  ['keystore password assignment', /(storePassword|keyPassword)\s*=\s*\S{6,}/],
];
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp4|aab|apk|jar|zip|gz)$/i.test(f));
const hits = [];
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 5 * 1024 * 1024) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${file}: ${name}`);
}
if (hits.length) {
  console.error(`✗ possible secrets:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ no secrets in ${files.length} committable files`);
