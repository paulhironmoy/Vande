/**
 * Production startup: actual first screen, first handled tap and first released delivery.
 * First and returning visits share the real cache/innings; terminal recovery uses visible New innings.
 * Run: node scripts/perf/practice-startup.mjs --dist dist-perfprod --runs 3 --cpu 1,4,6 --net none,fast4g --out NEW_DIRECTORY
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus as hostCpus, release as hostRelease } from 'node:os';
import { ROOT, serveBuild } from './serve.mjs';
import { OBSERVER, launch } from './practice-lib.mjs';
import { measureStartupVisit } from './startup-visit.mjs';
import { summarizeStartupVisits } from './startup-summary.mjs';

const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const dist = arg('dist', 'dist-perfprod');
const runs = Number(arg('runs', 3));
const cpus = arg('cpu', '1,4,6').split(',').map(Number);
const nets = arg('net', 'none,fast4g').split(',');
const out = resolve(ROOT, arg('out', 'test-results-perf/startup'));
const gpu = arg('gpu', 'metal');
const build = arg('build', 'unknown');
const NET = { none: null, fast4g: { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 } };
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
if (!Number.isInteger(runs) || runs < 1 || cpus.some(cpu => !Number.isFinite(cpu) || cpu < 1) || nets.some(net => !(net in NET))) throw new Error('Invalid run, CPU or network settings');
if (existsSync(resolve(out, 'startup.json')) || existsSync(resolve(out, 'EVIDENCE-STARTUP.md'))) throw new Error('Startup evidence already exists; use a new output directory to preserve prior results');
mkdirSync(out, { recursive: true });
const hash = file => createHash('sha256').update(readFileSync(resolve(ROOT, file))).digest('hex');
const toolFiles = ['scripts/perf/practice-startup.mjs', 'scripts/perf/startup-visit.mjs', 'scripts/perf/startup-state.mjs', 'scripts/perf/startup-summary.mjs', 'scripts/perf/practice-lib.mjs', 'scripts/perf/observer.js', 'scripts/perf/serve.mjs'];
const results = {
  build, dist, started: new Date().toISOString(), uptimeStart: uptime(), browser: null,
  host: { platform: process.platform, release: hostRelease(), arch: process.arch, cpu: hostCpus()[0]?.model ?? 'unknown' },
  requestedGpu: gpu, tooling: Object.fromEntries(toolFiles.map(file => [file, hash(file)])),
  cases: [], failures: [], cleanupErrors: [], pairs: [],
};
const groups = [];
let server, browser;
try {
  server = await serveBuild(dist);
  browser = await launch(gpu);
  results.browser = browser.version();
  for (const net of nets) for (const cpu of cpus) {
    const first = [], returning = [];
    groups.push({ net, cpu, first, returning });
    for (let run = 0; run < runs; run++) {
      let context;
      const pair = { net, cpu, run, cleanupErrors: [] };
      results.pairs.push(pair);
      try {
        context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
        await context.addInitScript({ path: OBSERVER });
        pair.first = await measureStartupVisit({ context, url: server.url, cpu, network: NET[net] });
        first.push(pair.first);
        if (pair.first.ok) pair.returning = await measureStartupVisit({ context, url: server.url, cpu, network: NET[net], previous: pair.first });
        else pair.returning = { ok: false, errors: [], failure: { message: 'Returning visit not attempted: cold visit failed' } };
        returning.push(pair.returning);
      } catch (error) {
        const failed = { ok: false, errors: [], failure: { message: String(error) } };
        if (!pair.first) { pair.first = failed; first.push(failed); }
        if (!pair.returning) { pair.returning = failed; returning.push(failed); }
        results.failures.push({ net, cpu, run, message: String(error) });
      } finally {
        if (context) try { await context.close(); } catch (error) {
          pair.cleanupErrors.push(String(error));
          results.cleanupErrors.push({ target: 'context', net, cpu, run, message: String(error) });
        }
      }
    }
  }
} catch (error) {
  results.failures.push({ message: String(error) });
} finally {
  if (browser) try { await browser.close(); } catch (error) { results.cleanupErrors.push({ target: 'browser', message: String(error) }); }
  if (server) try { await server.close(); } catch (error) { results.cleanupErrors.push({ target: 'server', message: String(error) }); }
  // Aggregate only after cleanup: page listeners retain late errors even after the visit returned.
  for (const { net, cpu, first, returning } of groups) for (const [kind, list] of [['first visit', first], ['returning', returning]]) {
    results.cases.push({ net, cpu, kind, ...summarizeStartupVisits(list), uptime: uptime() });
  }
  results.finished = new Date().toISOString();
  results.uptimeEnd = uptime();
  results.toolingAfter = Object.fromEntries(toolFiles.map(file => [file, hash(file)]));
  results.toolingMatched = JSON.stringify(results.toolingAfter) === JSON.stringify(results.tooling);
  results.passed = results.toolingMatched && !results.failures.length && !results.cleanupErrors.length &&
    results.cases.length === nets.length * cpus.length * 2 &&
    results.cases.every(c => c.n === runs && c.errors === 0 && !c.failures.length);
  writeFileSync(resolve(out, 'startup.json'), JSON.stringify(results, null, 2), { flag: 'wx' });
}

const escape = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const rows = results.cases.map((c, i) => [
  `E-START-${String(i + 1).padStart(3, '0')}`, build, results.started,
  `${results.host.cpu}, ${results.host.platform} ${results.host.release}/${results.host.arch}, Chromium ${results.browser}, ${gpu}, CPU ${c.cpu}×`,
  `${dist}; ${c.kind}; 915×412 at 2.625×; ${c.net}; ${c.uptime}`,
  'One cold/returning pair per run; preserved innings; status-matched visible actions; actual first screen, first handled input, first released ball. Terminal New innings is explicit.',
  `${runs} complete observations; finite metrics; 0 console/page/crash/cleanup errors`,
  `n=${c.n}; first screen ${c.firstScreenMs} ms; interactive ${c.interactiveMs} ms; first ball ${c.firstReleaseMs} ms; errors ${c.errors}; failures ${c.failures.length}`,
  c.n === runs && c.errors === 0 && !c.failures.length && results.passed ? 'Pass' : 'Fail', 'startup.json',
]);
writeFileSync(resolve(out, 'EVIDENCE-STARTUP.md'),
  `# Practice startup, build ${build}\n\nOverall: ${results.passed ? 'PASS' : 'FAIL'}. Failed attempts and cleanup errors remain in startup.json.\n\n| ID | Build | UTC | Device | Settings | Method | Expected | Observed | Result | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.map(row => `| ${row.map(escape).join(' | ')} |`).join('\n')}\n`,
  { flag: 'wx' });
console.log(`Practice startup: ${results.passed ? 'PASS' : 'FAIL'}; ${out}; ${results.uptimeStart}`);
for (const c of results.cases) console.log(`${c.net} CPU${c.cpu} ${c.kind}: ${c.n}/${runs}, first screen ${c.firstScreenMs} ms, interactive ${c.interactiveMs} ms, release ${c.firstReleaseMs} ms, errors ${c.errors}, failures ${c.failures.length}`);
process.exitCode = results.passed ? 0 : 1;
