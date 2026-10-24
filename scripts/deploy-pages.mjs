#!/usr/bin/env node
/**
 * Deploys the production web build to GitHub Pages (branch `gh-pages`) with history preserved.
 *
 *   node scripts/deploy-pages.mjs            # build (BASE_PATH=/Vande/) + push
 *   node scripts/deploy-pages.mjs --no-build # push the existing dist-pages/
 *
 * Idempotent: if the build output is identical to what is already deployed, nothing is pushed.
 * Rollback: see docs/ROLLBACK.md (every deploy is a commit on gh-pages).
 */
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(root, 'dist-pages');
const REPO_SLUG = 'Vande'; // https://github.com/paulhironmoy/Vande
const BASE_PATH = `/${REPO_SLUG}/`;
const PAGES_URL = `https://paulhironmoy.github.io${BASE_PATH}`;
const BRANCH = 'gh-pages';
const noBuild = process.argv.includes('--no-build');

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const pkg = JSON.parse(sh('cat package.json'));
const version = pkg.version;
const sourceSha = sh('git rev-parse --short HEAD');

if (!noBuild) {
  console.log(`▶ Building v${version} with BASE_PATH=${BASE_PATH} → dist-pages/`);
  run('npm', ['run', 'build:pages'], { env: { ...process.env, BASE_PATH } });
}
if (!existsSync(join(outDir, 'index.html'))) {
  console.error('✗ dist-pages/index.html not found — build first.');
  process.exit(1);
}
writeFileSync(join(outDir, '.nojekyll'), '');
writeFileSync(join(outDir, 'VERSION.txt'), `vande ${version} source ${sourceSha} deployed ${new Date().toISOString()}\n`);

// Prepare a worktree on gh-pages (existing history) or an orphan branch.
const wt = mkdtempSync(join(tmpdir(), 'vande-gh-pages-'));
let remoteExists = false;
try {
  sh(`git fetch origin ${BRANCH}`);
  remoteExists = true;
} catch {
  remoteExists = false;
}
try {
  if (remoteExists) {
    sh(`git worktree add --detach "${wt}" origin/${BRANCH}`);
    sh(`git checkout -B ${BRANCH}`, { cwd: wt });
  } else {
    sh(`git worktree add --detach "${wt}"`);
    sh(`git checkout --orphan ${BRANCH}`, { cwd: wt });
    sh('git rm -rfq . || true', { cwd: wt });
  }
  // Replace contents with the new build.
  for (const entry of readdirSync(wt)) {
    if (entry === '.git') continue;
    rmSync(join(wt, entry), { recursive: true, force: true });
  }
  cpSync(outDir, wt, { recursive: true });
  sh('git add -A', { cwd: wt });
  const status = sh('git status --porcelain', { cwd: wt });
  if (!status) {
    console.log('✓ Nothing to deploy — gh-pages already matches this build.');
  } else {
    sh(
      `git -c user.name="vande-deploy" -c user.email="paulhironmoy@users.noreply.github.com" commit -q -m "Deploy v${version} from ${sourceSha}"`,
      { cwd: wt },
    );
    const deploySha = sh('git rev-parse --short HEAD', { cwd: wt });
    console.log(`▶ Pushing ${BRANCH} (${deploySha}) to origin…`);
    run('git', ['push', 'origin', `HEAD:${BRANCH}`], { cwd: wt });
    console.log(`✓ Deployed commit ${deploySha} to ${BRANCH}`);
  }
} finally {
  try {
    sh(`git worktree remove --force "${wt}"`);
  } catch {
    rmSync(wt, { recursive: true, force: true });
    try {
      sh('git worktree prune');
    } catch {
      /* ignore */
    }
  }
}

console.log(`\n🌐 ${PAGES_URL}`);
console.log('   GitHub Pages usually publishes within 1–3 minutes. Verify with:');
console.log(`   curl -sI ${PAGES_URL} | head -1   &&   curl -s ${PAGES_URL}VERSION.txt`);
console.log('   If the site returns 404 after 5 minutes, enable Pages once: repo Settings → Pages → Source: "Deploy from a branch" → gh-pages / (root).');
