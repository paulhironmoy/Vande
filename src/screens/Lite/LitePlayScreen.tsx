import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/store';
import { Button, Icon } from '@/components/ui';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES, SIMPLE_STATES, cityMood, starsFor } from '@/app/simple';
import { checkCondition, classifyOutcome, computeChapterResult, evidenceActions } from '@/engine';
import { DIMENSIONS, type Condition, type DecisionOption, type Dimension, type ScenarioDecision, type ScenarioEvidence, type Scores } from '@/engine/types';
import { strategicFeedback } from '@/progression/feedback';
import { track } from '@/analytics';
import { haptic } from '@/audio/haptics';
import { playGameSound, unlockGameAudio } from '@/audio/gameSounds';
import { Burst, CountUp, FloatingPoints, confettiFromElement, confettiRain, fireConfetti } from '@/components/game/fx';
import { ActionCard, ClueCard, Medal, actionKindOf, medalTierFor, type ClueVerdict } from '@/components/game/cards';
import { ChallengeSheet } from '@/components/game/share/ChallengeSheet';
import { decodeLiteChallenge, encodeLiteChallenge, liteChallengeUrl, type LiteChallenge } from '@/share/liteChallenge';
import s from './LitePlayScreen.module.css';

/**
 * Lite: Chapter 1 as a game you want to win. One moment at a time, self-paced.
 * City bars react to every move, points fly into the counter, fair moves chain a calm streak, scanning clues
 * squashes bugs, missions unlock with a cheer, and the finish awards a medal you can send to friends.
 * The real deterministic simulation runs underneath, so a friend's link replays the same city and events.
 */

type Step =
  | { kind: 'begin' }
  | { kind: 'clue'; evidence: ScenarioEvidence; decision: ScenarioDecision }
  | { kind: 'clue-result'; evidence: ScenarioEvidence; verdict: ClueVerdict }
  | { kind: 'decision'; decision: ScenarioDecision }
  | { kind: 'feedback'; option: DecisionOption; decision: ScenarioDecision; gained: number; parts: string[]; delta: Partial<Scores>; tone: 'great' | 'good' | 'bad'; consequence: string }
  | { kind: 'rights'; id: string }
  | { kind: 'rights-result'; id: string; optionId: string }
  | { kind: 'ended' };

const MAX_TICKS = 400;
const BEST_KEY = 'vande:lite-best';
const HARSH = new Set(['disproportionate', 'suppressive', 'censorship']);
const PICK_MS = 340;
const SCAN_MS = 700;

/** Three short missions for Chapter 1 (same conditions as the chapter's resolution rules). */
const MISSIONS: { label: string; condition: Condition }[] = [
  { label: 'Start a proper check', condition: { flag: 'investigation-opened' } },
  { label: 'Prove the leak', condition: { anyFlag: ['leak-verified', 'strongroom-breach-confirmed'] } },
  { label: 'Catch the paper sellers', condition: { anyFlag: ['racket-arrest', 'racket-traced'] } },
];

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const RUN_KEY = 'vande:lite-run';

interface RunCounters {
  campaignId: string;
  points: number;
  streak: number;
  bugs: number;
  choices: number;
}
function readRun(campaignId: string | undefined): RunCounters | undefined {
  if (!campaignId) return undefined;
  try {
    const r = JSON.parse(sessionStorage.getItem(RUN_KEY) ?? 'null') as RunCounters | null;
    return r && r.campaignId === campaignId ? r : undefined;
  } catch {
    return undefined;
  }
}
function writeRun(r: RunCounters) {
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* ignore */
  }
}
function reduced(): boolean {
  try {
    return document.documentElement.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
const later = (fn: () => void, ms: number) => (reduced() || ms <= 0 ? fn() : window.setTimeout(fn, ms));

export function LitePlayScreen() {
  const screen = useApp((st) => st.screen);
  const game = useApp((st) => st.game);
  const scenario = useApp((st) => st.scenario);
  const plan = useApp((st) => st.plan);
  const campaignId = useApp((st) => st.campaign?.id);
  const seed = useApp((st) => st.campaign?.config.seed);
  const dispatch = useApp((st) => st.dispatch);
  const startLite = useApp((st) => st.startLite);
  const abandonCampaign = useApp((st) => st.abandonCampaign);
  const navigate = useApp((st) => st.navigate);

  const code = screen.name === 'lite' ? screen.code : undefined;
  const friend: LiteChallenge | null = useMemo(() => (code ? decodeLiteChallenge(code) : null), [code]);

  const [overlay, setOverlay] = useState<Step | null>(null);
  const [choices, setChoices] = useState(0);
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bugs, setBugs] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [best, setBest] = useState(readBest);
  const [picked, setPicked] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [float, setFloat] = useState<{ amount: number; tone: 'good' | 'great' | 'bad'; key: number } | null>(null);
  const [burst, setBurst] = useState(0);
  const [missionToast, setMissionToast] = useState<{ label: string; key: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [starsShown, setStarsShown] = useState(0);

  const feedSeen = useRef(0);
  const finishedRef = useRef<string | undefined>(undefined);
  const prevAchieved = useRef<boolean[]>([false, false, false]);
  const pointsRef = useRef<HTMLSpanElement>(null);
  const missionsRef = useRef<HTMLSpanElement>(null);
  const medalRef = useRef<HTMLDivElement>(null);
  const openedFriend = useRef<string | undefined>(undefined);

  const startedHere = useRef(false);
  // A stored run resumes only if it is still in progress; a friend's link always starts from its own start card.
  const ready = Boolean(
    plan?.lite && game && scenario && scenario.id === 'examination-crisis' && (startedHere.current || (!friend && game.status !== 'ended')),
  );
  const ended = Boolean(ready && game?.status === 'ended');

  // New run: reset local game state (or restore the counters of a run resumed after a reload).
  useEffect(() => {
    const restored = readRun(campaignId);
    setOverlay(null);
    setChoices(restored?.choices ?? 0);
    setPoints(restored?.points ?? 0);
    setStreak(restored?.streak ?? 0);
    setBugs(restored?.bugs ?? 0);
    setAlert(null);
    setPicked(null);
    setScanning(null);
    setFloat(null);
    setMissionToast(null);
    setShareOpen(false);
    setStarsShown(0);
    setBest(readBest());
    prevAchieved.current = [false, false, false];
    feedSeen.current = useApp.getState().game?.feed.length ?? 0;
  }, [campaignId]);

  useEffect(() => {
    if (campaignId) writeRun({ campaignId, points, streak, bugs, choices });
  }, [campaignId, points, streak, bugs, choices]);

  useEffect(() => {
    if (friend && code && openedFriend.current !== code) {
      openedFriend.current = code;
      track('lite_challenge_opened');
    }
  }, [friend, code]);

  // Missions: cheer the moment one completes.
  const achieved = game ? MISSIONS.map((m) => checkCondition(m.condition, game)) : [false, false, false];
  useEffect(() => {
    if (!ready) return;
    const fresh = achieved.findIndex((a, i) => a && !prevAchieved.current[i]);
    prevAchieved.current = achieved;
    if (fresh >= 0 && game?.status !== 'ended') {
      setMissionToast({ label: MISSIONS[fresh].label, key: Date.now() });
      later(() => {
        playGameSound('mission');
        haptic('success');
        confettiFromElement(missionsRef.current, { count: 70, spread: 80 });
      }, 120);
      window.setTimeout(() => setMissionToast(null), 2600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achieved.join(','), ready]);

  const summary = useMemo(() => {
    if (!ended || !game || !scenario) return undefined;
    const result = computeChapterResult(game, scenario, new Date(0).toISOString());
    const stars = starsFor(result.score) as 0 | 1 | 2 | 3;
    const done = MISSIONS.filter((m) => checkCondition(m.condition, game)).length;
    const missionBonus = done * 50;
    const total = points + missionBonus + stars * 100;
    return { result, stars, done, missionBonus, total };
  }, [ended, game, scenario, points]);

  // Finish: medal drop, stars one by one, fanfare, confetti for a strong run.
  useEffect(() => {
    if (!summary || !campaignId || finishedRef.current === campaignId) return;
    finishedRef.current = campaignId;
    const newBest = summary.total > best;
    const beatFriend = friend ? summary.total > friend.points : false;
    if (newBest) writeBest(summary.total);
    track('lite_completed', { state: 'completed' });
    for (let i = 0; i < 3; i++)
      later(() => {
        setStarsShown(i + 1);
        if (i < summary.stars) playGameSound('star', { step: i });
      }, 650 + i * 280);
    later(() => {
      const strong = summary.stars >= 2 || newBest || beatFriend;
      playGameSound(strong ? 'win' : summary.stars === 1 ? 'correct' : 'lose');
      if (strong) {
        haptic('success');
        const r = medalRef.current?.getBoundingClientRect();
        if (r) fireConfetti({ origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }, count: 140, spread: 90, power: 1.1 });
        else fireConfetti({ count: 140 });
        confettiRain(2400);
      }
    }, 650 + 3 * 280);
    if (reduced()) setStarsShown(3);
  }, [summary, campaignId, best, friend]);

  /** Advance game time until something needs an answer, or the chapter ends. Surfaces opponent moves as bug alerts. */
  const advance = () => {
    let guard = 0;
    while (guard++ < MAX_TICKS) {
      const g = useApp.getState().game;
      if (!g || g.status === 'ended') break;
      if (g.pendingDecisionIds.length || g.pendingRightsIds.length) break;
      if (g.status === 'paused') useApp.getState().resumeGame();
      const before = useApp.getState().game?.tick;
      useApp.getState().tickGame(1);
      if (useApp.getState().game?.tick === before) break;
    }
    const g = useApp.getState().game;
    if (g && scenario) {
      const fresh = g.feed.slice(feedSeen.current);
      feedSeen.current = g.feed.length;
      const opp = [...fresh].reverse().find((f) => f.kind === 'opponent');
      if (opp) {
        const ev = scenario.events.find((e) => e.message === opp.text);
        setAlert(ev?.simple ?? opp.text);
      } else setAlert(null);
    }
  };

  useEffect(() => {
    if (!ready) return;
    const g = useApp.getState().game;
    if (g && g.tick === 0 && g.status === 'running' && !g.pendingDecisionIds.length && !overlay) setOverlay({ kind: 'begin' });
  }, [ready, overlay]);

  const play = () => {
    unlockGameAudio();
    playGameSound('select');
    startedHere.current = true;
    startLite(friend ? { seed: friend.seed } : undefined);
  };

  // ------------------------------------------------------------------ start
  if (!ready || !game || !scenario) {
    return (
      <main className={s.screen} data-testid="lite-screen" data-step="start">
        <div className={s.aurora} aria-hidden="true" />
        <section className={`${s.hero} ${s.enter}`}>
          {friend ? (
            <>
              <div className={s.heroMedal}>
                <Medal tier={medalTierFor(friend.stars)} size={112} label={`Your friend's ${medalTierFor(friend.stars)} medal`} />
              </div>
              <p className={s.kicker}>A friend challenges you</p>
              <h1 className={s.heroTitle}>Beat {fmt(friend.points)} points</h1>
              <p className={s.stars} aria-label={`${friend.stars} of 3 stars`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < friend.stars ? s.starOn : s.starOff}>
                    ★
                  </span>
                ))}
              </p>
              <p className={s.lead}>Same city. Same events. Your move.</p>
            </>
          ) : (
            <>
              <p className={s.kicker}>Chapter 1</p>
              <h1 className={s.heroTitle}>The Exam Leak</h1>
              <p className={s.lead}>Keep the city calm, fair and free. Win the gold medal.</p>
              {best > 0 ? (
                <p className={s.bestPill}>
                  <Icon name="sparkle" size={16} /> Your best · {fmt(best)}
                </p>
              ) : null}
            </>
          )}
          <Button variant="primary" size="lg" block icon="play" onClick={play} data-testid="lite-start">
            {friend ? 'Accept challenge' : 'Play'}
          </Button>
          {code && !friend ? <p className={s.fine}>That challenge link did not work. Start a fresh game instead.</p> : null}
        </section>
      </main>
    );
  }

  const decisionOf = (id: string) => scenario.decisions.find((d) => d.id === id)!;
  const evidenceOf = (id: string) => scenario.evidence.find((e) => e.id === id)!;
  const simpleOption = (d: ScenarioDecision, o: DecisionOption) => d.simple?.options[o.id];
  const clueChecked = (id: string) => {
    const es = game.evidence[id];
    return Boolean(es && (es.state === 'verified' || es.state === 'corroborated' || es.state === 'manipulated'));
  };
  const clueFor = (d: ScenarioDecision): ScenarioEvidence | undefined => {
    for (const o of d.options) {
      for (const evId of o.requiresEvidence ?? []) {
        const es = game.evidence[evId];
        if (!es || !es.visible || es.destroyed) continue;
        if (es.state === 'unverified' || es.state === 'unknown') return evidenceOf(evId);
      }
    }
    return undefined;
  };

  const current: Step = (() => {
    if (overlay) return overlay;
    if (game.status === 'ended') return { kind: 'ended' };
    const rightsId = game.pendingRightsIds[0];
    if (rightsId) return { kind: 'rights', id: rightsId };
    const decisionId = game.pendingDecisionIds[0];
    if (decisionId) {
      const decision = decisionOf(decisionId);
      const clue = clueFor(decision);
      if (clue && !game.evidence[clue.id].inspected) return { kind: 'clue', evidence: clue, decision };
      return { kind: 'decision', decision };
    }
    return { kind: 'begin' };
  })();

  const next = () => {
    playGameSound('flip');
    setOverlay(null);
    advance();
  };

  const scanClue = (ev: ScenarioEvidence) => {
    unlockGameAudio();
    setScanning(ev.id);
    playGameSound('scan');
    later(() => {
      const tick = () => useApp.getState().game!.tick;
      for (const verb of ['inspect', 'compare', 'preserve'] as const) {
        const acts = evidenceActions(useApp.getState().game!, scenario, ev.id).filter((a) => a.enabled && a.verb === verb);
        for (const a of acts) dispatch({ type: 'evidence', tick: tick(), evidenceId: ev.id, verb, compareWith: a.compareWith });
      }
      const state = useApp.getState().game!.evidence[ev.id].state;
      let gained = 0;
      let label: string = SIMPLE_STATES[state].label;
      if (state === 'manipulated') {
        gained = 200;
        label = 'Fake · bug squashed';
        setBugs((b) => b + 1);
        playGameSound('squash');
        haptic('success');
        fireConfetti({ origin: { x: 0.5, y: 0.45 }, count: 60, spread: 100, power: 0.9, palette: ['#ff5c75', '#ff8a9c', '#aab6c8', '#62d6ff'] });
      } else if (state === 'verified' || state === 'corroborated') {
        gained = 50;
        playGameSound('correct');
        haptic('light');
      } else {
        playGameSound('flip');
      }
      if (gained) {
        setPoints((p) => p + gained);
        setFloat({ amount: gained, tone: gained >= 200 ? 'great' : 'good', key: Date.now() });
      }
      const note = state === 'unverified' || state === 'unknown' ? SIMPLE_STATES[state].help : ev.simple?.resolutionNote ?? ev.resolutionNote;
      setScanning(null);
      setOverlay({ kind: 'clue-result', evidence: ev, verdict: { state, label, note, gained } });
    }, SCAN_MS);
  };

  const commitChoice = (d: ScenarioDecision, o: DecisionOption) => {
    const before = useApp.getState().game!.scores;
    dispatch({ type: 'decide', tick: useApp.getState().game!.tick, decisionId: d.id, optionId: o.id });
    const after = useApp.getState().game!;
    const feedback = after.lastFeedback;
    const delta: Partial<Scores> = {};
    let pos = 0;
    let neg = 0;
    for (const k of DIMENSIONS) {
      const dv = Math.round(after.scores[k] - before[k]);
      if (dv !== 0) delta[k] = dv;
      if (dv > 0) pos += dv;
      else neg -= dv;
    }
    const harsh = o.tags.some((t) => HARSH.has(t)) || feedback?.warning === 'disproportionate' || feedback?.warning === 'false-accusation';
    const parts: string[] = [];
    let gained = Math.max(10, 100 + pos * 8 - neg * 8);
    parts.push(`${fmt(gained)} base`);
    const relied = (o.requiresEvidence ?? []).filter((id) => game.evidence[id]?.visible);
    if (relied.length && relied.every(clueChecked)) {
      gained *= 2;
      parts.push('×2 clue scanned');
    }
    const nextStreak = harsh ? 0 : streak + 1;
    if (nextStreak >= 2) {
      const mult = 1 + 0.25 * Math.min(nextStreak - 1, 4);
      gained = Math.round(gained * mult);
      parts.push(`×${String(mult).replace(/\.?0+$/, '')} streak`);
    }
    const tone: 'great' | 'good' | 'bad' = harsh || neg > pos ? 'bad' : gained >= 300 ? 'great' : 'good';
    setStreak(nextStreak);
    setPoints((p) => p + gained);
    setChoices((n) => n + 1);
    setFloat({ amount: gained, tone, key: Date.now() });
    setBurst((b) => b + 1);
    if (tone === 'bad') {
      playGameSound('wrong');
      haptic('warning');
    } else {
      playGameSound(tone === 'great' ? 'great' : 'correct');
      playGameSound('coin', { intensity: 0.6 });
      haptic(tone === 'great' ? 'success' : 'light');
      if (nextStreak >= 2) later(() => playGameSound('streak', { step: nextStreak - 2 }), 260);
      if (tone === 'great') fireConfetti({ origin: { x: 0.5, y: 0.4 }, count: 50, spread: 60, power: 0.8 });
    }
    const consequence = simpleOption(d, o)?.consequence ?? feedback?.text ?? o.consequence;
    setPicked(null);
    setOverlay({ kind: 'feedback', option: o, decision: d, gained, parts, delta, tone, consequence });
  };

  const pickOption = (d: ScenarioDecision, o: DecisionOption) => {
    if (picked) return;
    unlockGameAudio();
    playGameSound('select');
    haptic('light');
    setPicked(o.id);
    later(() => commitChoice(d, o), PICK_MS);
  };

  const answerRights = (id: string, optionId: string) => {
    if (picked) return;
    unlockGameAudio();
    playGameSound('select');
    setPicked(optionId);
    later(() => {
      dispatch({ type: 'rights', tick: useApp.getState().game!.tick, momentId: id, optionId });
      const rm = scenario.rightsMoments.find((r) => r.id === id)!;
      const correct = rm.options.find((o) => o.id === optionId)?.correct ?? false;
      if (correct) {
        setPoints((p) => p + 100);
        setFloat({ amount: 100, tone: 'good', key: Date.now() });
        playGameSound('correct');
        playGameSound('coin', { intensity: 0.6 });
        haptic('success');
        fireConfetti({ origin: { x: 0.5, y: 0.55 }, count: 45, spread: 70, power: 0.8 });
      } else {
        playGameSound('wrong');
        haptic('warning');
      }
      setPicked(null);
      setOverlay({ kind: 'rights-result', id, optionId });
    }, PICK_MS);
  };

  const mood = cityMood(game.scores);
  const progress = Math.min(100, Math.round((game.tick / game.duration) * 100));

  const leave = () => {
    abandonCampaign();
    navigate({ name: 'home' });
  };

  const bars = (delta?: Partial<Scores>) => (
    <ul className={s.bars} aria-label="City bars">
      {DIMENSIONS.map((d: Dimension) => {
        const v = Math.round(game.scores[d]);
        const dv = delta?.[d];
        return (
          <li key={d} className={s.bar} data-low={v < 40 ? 'true' : undefined}>
            <span className={s.barLabel}>{SIMPLE_DIMENSIONS[d].short}</span>
            <span className={s.barValue}>
              {v}
              {dv ? <em className={dv > 0 ? s.up : s.down}>{dv > 0 ? `+${dv}` : dv}</em> : null}
            </span>
            <span className={s.barTrack}>
              <span className={s.barFill} style={{ width: `${v}%`, background: `linear-gradient(90deg, color-mix(in srgb, var(--o-${d}) 70%, #fff 0%), var(--o-${d}))` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );

  const stepKey = current.kind + ('decision' in current && current.decision ? current.decision.id : '') + ('evidence' in current && current.evidence ? current.evidence.id : '') + ('id' in current ? current.id : '');

  return (
    <main className={s.screen} data-testid="lite-screen" data-step={current.kind}>
      <div className={s.aurora} aria-hidden="true" />
      <header className={s.top}>
        <button type="button" className={s.round} onClick={leave} aria-label="Leave">
          <Icon name="back" size={20} />
        </button>
        <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Chapter progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className={s.points} ref={pointsRef} data-testid="lite-points" aria-label={`${points} points`}>
          <Icon name="sparkle" size={16} />
          <CountUp key={campaignId} value={points} durationMs={650} />
          {friend ? <small className={s.target}>/ {fmt(friend.points)}</small> : null}
        </span>
      </header>
      {float ? <FloatingPoints key={float.key} amount={float.amount} tone={float.tone} anchorRef={pointsRef} onDone={() => setFloat(null)} /> : null}

      {missionToast ? (
        <div className={s.toast} role="status" key={missionToast.key}>
          <span className={s.toastBadge}>
            <Icon name="check" size={18} strokeWidth={2.6} />
          </span>
          <span>
            <strong>Mission complete</strong>
            <span>{missionToast.label}</span>
          </span>
        </div>
      ) : null}

      {current.kind !== 'begin' && current.kind !== 'ended' ? (
        <section className={s.hud} aria-label="How the city is doing">
          {bars(current.kind === 'feedback' ? current.delta : undefined)}
          <div className={s.hudRow}>
            <span className={s.mood} data-tone={mood.tone}>
              {mood.label}
            </span>
            {streak >= 2 ? (
              <span className={s.streak} key={streak}>
                <Icon name="sparkle" size={14} /> Streak ×{streak}
              </span>
            ) : null}
            <span className={s.missions} ref={missionsRef} aria-label={`${achieved.filter(Boolean).length} of ${MISSIONS.length} missions done`}>
              {MISSIONS.map((m, i) => (
                <span key={i} className={s.missionDot} data-done={achieved[i] ? 'true' : undefined} title={m.label} />
              ))}
            </span>
          </div>
        </section>
      ) : null}

      <div className={s.stage} key={stepKey}>
        {current.kind === 'begin' && (
          <section className={`${s.hero} ${s.enter}`} aria-live="polite">
            <p className={s.kicker}>Chapter 1 · {friend ? `Beat ${fmt(friend.points)}` : 'Your goal'}</p>
            <h1 className={s.heroTitle}>{scenario.simple?.title ?? scenario.title}</h1>
            <p className={s.lead}>{scenario.simple?.subtitle ?? scenario.subtitle}</p>
            <ul className={s.goals}>
              <li>
                <span className={s.goalIcon} data-c="bars">
                  <Icon name="pulse" size={18} />
                </span>
                Keep all six bars above 40
              </li>
              <li>
                <span className={s.goalIcon} data-c="bug">
                  <Icon name="bug" size={18} />
                </span>
                Scan clues, squash fakes · +200
              </li>
              <li>
                <span className={s.goalIcon} data-c="streak">
                  <Icon name="sparkle" size={18} />
                </span>
                Fair moves in a row multiply points
              </li>
            </ul>
            <p className={s.kicker}>Missions</p>
            <ol className={s.missionList} aria-label="Missions">
              {MISSIONS.map((m, i) => (
                <li key={i}>
                  <span className={s.check} aria-hidden="true" />
                  {m.label}
                </li>
              ))}
            </ol>
            {best > 0 && !friend ? <p className={s.bestPill}>Beat your best: {fmt(best)}</p> : null}
            <Button variant="primary" size="lg" block onClick={() => { unlockGameAudio(); next(); }} data-testid="lite-next">
              Begin
            </Button>
          </section>
        )}

        {(current.kind === 'clue' || current.kind === 'clue-result') && (
          <ClueCard
            title={current.evidence.simple?.title ?? current.evidence.title}
            claim={current.evidence.simple?.claim ?? current.evidence.claim}
            source={current.evidence.source}
            phase={current.kind === 'clue-result' ? 'revealed' : scanning === current.evidence.id ? 'scanning' : 'idle'}
            verdict={current.kind === 'clue-result' ? current.verdict : undefined}
            bugAlert={current.kind === 'clue' ? alert : null}
            onScan={() => scanClue(current.evidence)}
            onSkip={() => current.kind === 'clue' && setOverlay({ kind: 'decision', decision: current.decision })}
            onContinue={() => {
              playGameSound('flip');
              setOverlay(null);
            }}
          />
        )}

        {current.kind === 'decision' && (
          <section className={s.decision} aria-live="polite">
            {alert ? (
              <p className={s.alert}>
                <Icon name="bug" size={16} /> {alert}
              </p>
            ) : null}
            <p className={s.kicker}>Move {choices + 1}</p>
            <h1 className={s.title}>{current.decision.simple?.title ?? current.decision.title}</h1>
            <p className={s.lead}>{current.decision.simple?.situation ?? current.decision.situation}</p>
            <div className={s.hand} data-count={current.decision.options.length}>
              {current.decision.options.map((o, i) => {
                const needsClue = (o.requiresEvidence ?? []).some((id) => {
                  const es = game.evidence[id];
                  return es && es.visible && !es.destroyed && (es.state === 'unverified' || es.state === 'unknown');
                });
                const checked = (o.requiresEvidence ?? []).length > 0 && (o.requiresEvidence ?? []).every(clueChecked);
                return (
                  <ActionCard
                    key={o.id}
                    kind={actionKindOf(o.tags)}
                    title={simpleOption(current.decision, o)?.title ?? o.title}
                    badge={needsClue ? { text: 'Clue not scanned', tone: 'caution' } : checked ? { text: '×2 clue scanned', tone: 'bonus' } : undefined}
                    onSelect={() => pickOption(current.decision, o)}
                    picked={picked === o.id}
                    faded={Boolean(picked) && picked !== o.id}
                    disabled={Boolean(picked)}
                    index={i}
                    testId={`lite-option-${o.id}`}
                  />
                );
              })}
            </div>
          </section>
        )}

        {current.kind === 'feedback' && (
          <section className={`${s.hero} ${s.enter} ${current.tone === 'bad' ? s.shake : ''}`} data-tone={current.tone} aria-live="polite">
            <Burst tone={current.tone} trigger={burst} />
            <div className={s.verdictRow}>
              <span className={s.verdictBadge} data-tone={current.tone}>
                <Icon name={current.tone === 'bad' ? 'alert' : 'check'} size={22} strokeWidth={2.4} />
              </span>
              <span className={s.kicker}>{current.tone === 'great' ? 'Great move' : current.tone === 'good' ? 'Nice move' : 'That hurt'}</span>
            </div>
            <p className={s.gain} data-tone={current.tone}>
              +{fmt(current.gained)}
            </p>
            <h1 className={s.titleSm}>{simpleOption(current.decision, current.option)?.title ?? current.option.title}</h1>
            <p className={s.lead}>{current.consequence}</p>
            <div className={s.chips}>
              {current.parts.map((p) => (
                <span key={p} className={s.chip}>
                  {p}
                </span>
              ))}
              {current.tone === 'bad' ? <span className={`${s.chip} ${s.chipWarn}`}>Streak reset · less freedom</span> : null}
            </div>
            <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
              Next
            </Button>
          </section>
        )}

        {(current.kind === 'rights' || current.kind === 'rights-result') && (() => {
          const rm = scenario.rightsMoments.find((r) => r.id === current.id)!;
          const chosen = current.kind === 'rights-result' ? current.optionId : undefined;
          const chosenOpt = chosen ? rm.options.find((o) => o.id === chosen) : undefined;
          return (
            <section className={s.decision} aria-live="polite">
              <div className={s.verdictRow}>
                <span className={s.verdictBadge} data-tone="rule">
                  <Icon name="book" size={20} strokeWidth={2.2} />
                </span>
                <span className={s.kicker}>{chosenOpt ? (chosenOpt.correct ? 'Fair call · +100' : 'Not quite') : 'Fair play · +100'}</span>
              </div>
              <h1 className={s.title}>{rm.simple?.question ?? rm.question}</h1>
              <div className={s.hand} data-count="wide">
                {rm.options.map((o, i) => (
                  <ActionCard
                    key={o.id}
                    kind="rule"
                    layout="wide"
                    hideLabel
                    title={rm.simple?.options[o.id] ?? o.text}
                    onSelect={() => answerRights(rm.id, o.id)}
                    picked={picked === o.id || chosen === o.id}
                    faded={(Boolean(picked) && picked !== o.id) || (Boolean(chosen) && chosen !== o.id && !o.correct)}
                    verdict={chosen ? (o.correct ? 'right' : chosen === o.id ? 'wrong' : undefined) : undefined}
                    disabled={Boolean(picked) || Boolean(chosen)}
                    index={i}
                    testId={`lite-rights-${o.id}`}
                  />
                ))}
              </div>
              {chosenOpt ? (
                <div className={s.explain}>
                  <p className={s.leadStrong}>{rm.simple?.principle ?? rm.principle}</p>
                  <p className={s.fine}>Educational content—not legal advice</p>
                  <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
                    Next
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })()}

        {current.kind === 'ended' && summary && (() => {
          const { result, stars, done, missionBonus, total } = summary;
          const outcome = SIMPLE_OUTCOMES[classifyOutcome(result.scores)];
          const newBest = total > best;
          const beatFriend = friend ? total > friend.points : undefined;
          const challengeCode = encodeLiteChallenge({ seed: seed ?? 0, points: total, stars });
          const tie = friend ? total === friend.points : false;
          const headline = friend ? (beatFriend ? 'You beat your friend!' : tie ? 'A perfect tie!' : 'So close') : newBest ? 'Chapter complete' : stars >= 2 ? 'Well played' : 'Chapter done';
          return (
            <section className={`${s.hero} ${s.result} ${s.enter}`} aria-live="polite" data-testid="lite-result">
              <div className={s.resultMedal} ref={medalRef}>
                <Medal tier={medalTierFor(stars)} size={132} />
                {newBest ? <span className={s.ribbon}>New best</span> : null}
              </div>
              <p className={s.kicker}>{headline}</p>
              <p className={s.stars} aria-label={`${stars} of 3 stars`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < stars && i < starsShown ? s.starOn : s.starOff} data-shown={i < starsShown ? 'true' : undefined}>
                    ★
                  </span>
                ))}
              </p>
              <p className={s.score} data-testid="lite-score" data-value={total}>
                <CountUp value={total} from={0} durationMs={1200} />
                <small>points</small>
              </p>
              {friend ? (
                <div className={s.versus} data-win={beatFriend ? 'true' : undefined}>
                  <span>
                    <small>You</small>
                    <strong>{fmt(total)}</strong>
                  </span>
                  <span className={s.vs}>vs</span>
                  <span>
                    <small>Friend</small>
                    <strong>{fmt(friend.points)}</strong>
                  </span>
                </div>
              ) : null}
              <div className={s.chips}>
                <span className={s.chip}>Moves {fmt(points)}</span>
                <span className={s.chip}>
                  Missions {done}/{MISSIONS.length} · +{missionBonus}
                </span>
                <span className={s.chip}>Stars +{stars * 100}</span>
                {bugs ? <span className={s.chip}>{bugs === 1 ? '1 bug squashed' : `${bugs} bugs squashed`}</span> : null}
              </div>
              <p className={s.outcome}>
                {outcome.label} · city {result.score}
              </p>
              <p className={s.lead}>{strategicFeedback(result.fingerprint, result, true)}</p>
              <Button variant="primary" size="lg" block icon="share" onClick={() => { playGameSound('select'); setShareOpen(true); }} data-testid="lite-challenge">
                Challenge friends
              </Button>
              <Button variant="secondary" size="lg" block icon="refresh" onClick={play} data-testid="lite-again">
                {newBest || beatFriend ? 'Play again' : 'Try to beat it'}
              </Button>
              <Button variant="ghost" size="md" block onClick={leave} data-testid="lite-home">
                Home
              </Button>
              <ChallengeSheet
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                beatFriend={beatFriend}
                model={{
                  points: total,
                  stars,
                  outcomeLabel: outcome.label,
                  missionsDone: done,
                  missionsTotal: MISSIONS.length,
                  bugs,
                  code: challengeCode,
                  url: liteChallengeUrl(challengeCode, window.location.origin),
                  chapterTitle: scenario.simple?.title ?? scenario.title,
                }}
              />
            </section>
          );
        })()}
      </div>
    </main>
  );
}
