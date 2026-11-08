/**
 * A flow driver that works on the tree before the rebuild (38924bd: Practice/Skip launch, a menu with Quick random
 * over and Build an over) and on the rebuilt one (Practice → Quick, Predefined or Random → Play), by trying known
 * test ids first and then accessible names. Every action is logged with what was on screen when it was taken, so
 * steps, decisions and first-ball time are measured, not assumed. When the rebuilt flow's test ids settle, add them
 * here (first in each list).
 */
import { hookState, sleep } from './env.mjs';

const NAV = /^(back|close|settings|help|pause|sound|mute|menu|exit|skip to content|more options?|info|about|cancel)$/i;

/** Candidate locators per logical action: [kind, value] with kind 'tid' (data-testid) or 'name' (button name regex). */
export const CANDIDATES = {
  launch: [['tid', 'launch-choice'], ['tid', 'launch-screen'], ['tid', 'launch'], ['tid', 'vande-launch']],
  practice: [['tid', 'launch-practice'], ['tid', 'practice-entry'], ['name', /^\s*practice\b/i]],
  quick: [['tid', 'practice-quick'], ['tid', 'practice-mode-quick'], ['name', /^\s*quick practice\b/i], ['tid', 'practice-random'], ['name', /quick/i]],
  predefined: [['tid', 'practice-predefined'], ['tid', 'practice-mode-predefined'], ['name', /^\s*predefined/i], ['tid', 'practice-build'], ['name', /build an over/i]],
  random: [['tid', 'practice-random-over'], ['tid', 'practice-mode-random'], ['tid', 'practice-random'], ['name', /^\s*random over\b/i]],
  chase: [['tid', 'launch-chase'], ['tid', 'chase-entry'], ['name', /^\s*chase\b/i]],
  /** Forward confirmations between the mode and the first ball, in the order they are tried. */
  play: [
    ['tid', 'practice-setup-play'],
    ['tid', 'practice-play-start'],
    ['tid', 'practice-start'],
    ['tid', 'practice-build-start'],
    ['tid', 'practice-tap-go'],
    ['tid', 'practice-radar-go'],
    ['tid', 'practice-field-go'],
    ['tid', 'practice-start-over'],
    ['name', /^\s*(play|start batting|start|bat|face the over|begin)\b/i],
  ],
};

export async function visible(loc) {
  try {
    return (await loc.count()) > 0 && (await loc.first().isVisible()) && (await loc.first().isEnabled());
  } catch {
    return false;
  }
}

/** The first visible, enabled match for a logical action, or null. */
export async function find(page, action, { reject = null } = {}) {
  for (const [kind, value] of CANDIDATES[action]) {
    const loc = kind === 'tid' ? page.getByTestId(value) : page.getByRole('button', { name: value });
    if (!(await visible(loc))) continue;
    const el = loc.first();
    const tid = await el.getAttribute('data-testid').catch(() => null);
    const label = ((await el.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (reject && reject(label)) continue;
    return { loc: el, how: kind === 'tid' ? `testid=${value}` : `name=${value}`, tid, label };
  }
  // Stage 1 (docs/VANDE-PRODUCT-SEQUENCE.md): Random's one-tap default replaces Quick. With no Quick on screen, the
  // minimal path is Random Over.
  if (action === 'quick') {
    const r = await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) });
    if (r) return { ...r, how: `${r.how} (no Quick: Random's default)` };
  }
  return null;
}

/** Forward alternatives on screen now: reachable, enabled controls that are not navigation. */
export async function alternatives(page) {
  const controls = await page.evaluate(() => window.__eval.controls()).catch(() => []);
  const forward = controls.filter((c) => c.reachable && !c.disabled && !NAV.test(c.name.trim()) && c.name.trim().length > 0);
  return { controls, forward };
}

/** Taps (touch contexts) or clicks; returns the time it was sent. */
export async function press(page, target, touch) {
  const t = Date.now();
  if (touch) await target.loc.tap({ timeout: 10_000 });
  else await target.loc.click({ timeout: 10_000 });
  return t;
}

/** Labels a logical action must not pick (Quick never takes "Random Over" unless it also says quick, and so on). */
const EXCLUDE = {
  quick: (label) => /random over/i.test(label) && !/quick/i.test(label),
  random: (label) => /quick/i.test(label),
};

/**
 * From a loaded launch screen to the first released ball. `mode` is quick, predefined or random.
 * - eager: every forward action is pressed as soon as it shows (the mechanical first-ball time);
 * - patient: after the mode, the driver waits `patienceMs` before pressing, so screens that advance by themselves
 *   (a field radar with a timer) cost no tap: the required taps.
 * For predefined, `configure(page)` fills the over when its editor shows and returns its taps (reported apart).
 * Returns the steps (each with the forward alternatives on screen) and whether a ball was reached.
 */
export async function pathToFirstBall(page, { mode = 'quick', touch = false, configure = null, patient = false, patienceMs = 4000, dwellMs = 0, timeoutMs = 90_000, t0 = Date.now() } = {}) {
  const steps = [];
  let configured = false;
  let configTaps = 0;
  let waitingSince = null;
  const started = Date.now();
  let practiceAt = null;
  let modeOnScreenAtStart = null;
  while (Date.now() - started < timeoutMs && steps.length < 12) {
    const st = await hookState(page);
    if (st && ['runup', 'live', 'playing', 'coaching', 'warmup_explain'].includes(st.phase)) return { steps, configTaps, reached: true };
    if (st && st.phase === 'dead' && st.balls > 0) return { steps, configTaps, reached: true };
    // The first run's demonstration and the pre-delivery teaching moment: nothing to press, wait for the ball.
    if (st && st.screen === 'live' && ['intro', 'ready', 'loading'].includes(st.phase)) {
      await sleep(250);
      continue;
    }
    // The mode is not offered at all (e.g. no Random Over before the rebuild): say so instead of waiting.
    const modeDone = steps.some((s) => s.step === 'mode') || (st && ['live', 'compat', 'preparing', 'error'].includes(st.screen));
    if (practiceAt === null && modeOnScreenAtStart === null) modeOnScreenAtStart = Date.now();
    const since = practiceAt ?? modeOnScreenAtStart;
    if (!modeDone && since !== null && Date.now() - since > 12000 && !(await find(page, mode, EXCLUDE[mode] ? { reject: EXCLUDE[mode] } : {}))) return { steps, configTaps, reached: false, unavailable: mode };
    const order = [];
    // Stage 1: the root may open Practice itself (Random Over and Predefined Over on screen), with no Practice entry.
    const modeOnScreen = Boolean(await find(page, mode, EXCLUDE[mode] ? { reject: EXCLUDE[mode] } : {}));
    if (!steps.some((s) => s.step === 'practice') && !modeOnScreen) order.push('practice');
    if (!steps.some((s) => s.step === 'mode') && !(st && ['live', 'compat', 'preparing', 'error'].includes(st.screen))) order.push(mode);
    order.push('play');
    let target = null;
    let step = null;
    for (const a of order) {
      const exclude = EXCLUDE[a];
      target = await find(page, a, exclude ? { reject: exclude } : {});
      if (target) {
        step = a === mode ? 'mode' : a;
        break;
      }
    }
    if (!target && configure && !configured && steps.some((s) => s.step === 'mode')) {
      const n = await configure(page);
      if (n !== null) {
        configured = true;
        configTaps = n;
        continue;
      }
    }
    if (!target) {
      waitingSince = null;
      await sleep(250);
      continue;
    }
    if (patient && step === 'play') {
      waitingSince ??= Date.now();
      if (Date.now() - waitingSince < patienceMs) {
        await sleep(250);
        continue;
      }
    }
    waitingSince = null;
    const alt = await alternatives(page);
    // F2: a scripted player dwells on every decision (two or more forward alternatives) before pressing.
    if (dwellMs && alt.forward.length >= 2) await sleep(dwellMs);
    const at = await press(page, target, touch).catch(() => null);
    if (at === null) continue;
    steps.push({ step, how: target.how, testid: target.tid, label: target.label, atMs: at - t0, alternatives: alt.forward.map((c) => c.name).slice(0, 12), controls: alt.controls.length, decision: alt.forward.length >= 2 });
    if (step === 'practice') practiceAt = Date.now();
    await sleep(150);
  }
  return { steps, configTaps, reached: false };
}

const PLAY_TIDS = ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go'];
const BOWLING = ['radar', 'runup', 'live', 'intro', 'ready'];

/**
 * From the Practice home or setup: presses Quick (or Random's default) and then Play until a delivery is under way.
 * Play can stay disabled while the device check runs (a new device), so this keeps trying until `timeoutMs`.
 */
export async function pressUntilBowling(page, touch, { timeoutMs = 60_000, mode = 'quick' } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const st = await page.evaluate(() => (window.__vandePractice ? window.__vandePractice.state() : null)).catch(() => null);
    if (st && BOWLING.includes(st.phase)) return true;
    let pressed = false;
    for (const id of PLAY_TIDS) {
      const loc = page.getByTestId(id);
      if (await visible(loc)) {
        await press(page, { loc: loc.first() }, touch).catch(() => undefined);
        pressed = true;
        break;
      }
    }
    if (!pressed) {
      const t = await find(page, mode, mode === 'quick' ? { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) } : {});
      if (t) await press(page, t, touch).catch(() => undefined);
    }
    await sleep(400);
  }
  return false;
}
