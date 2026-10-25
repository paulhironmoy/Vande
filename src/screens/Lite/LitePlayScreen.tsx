import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '@/app/store';
import { Button, Icon } from '@/components/ui';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES, SIMPLE_STATES, cityMood, starsFor } from '@/app/simple';
import { checkCondition, classifyOutcome, computeChapterResult, evidenceActions, getScenario } from '@/engine';
import {
  DIMENSIONS,
  type Condition,
  type DecisionOption,
  type Dimension,
  type ScenarioDecision,
  type ScenarioEvidence,
  type Scores,
} from '@/engine/types';
import { strategicFeedback } from '@/progression/feedback';
import { track } from '@/analytics';
import { haptic } from '@/audio/haptics';
import { playGameSound, unlockGameAudio } from '@/audio/gameSounds';
import { Burst, CountUp, FloatingPoints, confettiFromElement, confettiRain, fireConfetti } from '@/components/game/fx';
import { ACTION_META, ActionCard, ClueCard, Medal, actionKindOf, medalTierFor, type ClueVerdict } from '@/components/game/cards';
import { ChallengeSheet } from '@/components/game/share/ChallengeSheet';
import { DareSheet } from '@/components/game/dare/DareSheet';
import { Countdown } from '@/components/game/dare/Countdown';
import { decodeLiteChallenge, encodeLiteChallenge, liteChallengeUrl, type LiteChallenge } from '@/share/liteChallenge';
import { DARE_HINTS, dareTimeLeft, decodeDare, decodeDareReply, nextLocalMidnight, type Dare, type DareReply } from '@/share/dare';
import { INSIGHT, LITE_POINTS, evaluateMove, insightFor, isChecked, movePoints, rankOf, scoreDelta, streakMultiplier, type InsightTier, type MoveEval } from '@/lite/points';
import { closeCallMargin, tierOf } from '@/lite/toughness';
import { visualPlanFor } from '@/lite/visuals';
import { HowPointsSheet } from '@/components/game/points';
import { Pictogram } from '@/components/game/pictograms';
import { ReplyLanding } from './ReplyLanding';
import { flags } from '@/app/flags';
import { FRIEND_POINTS } from '@/lite/points';
import { awardChallenger, readLedger, writeLedger } from '@/lite/ledger';
import { answerTwist, assignTwist, dareKeyOf, drawTwist, ensureAttempt, readAttempt, recordDareAnswer, twistById } from '@/lite/twists';
import { gradeVerifiedAttempt, startVerifiedAttempt, verifiedDaresEnabled, verifyReplySignature } from '@/community/liteDares';
import { LiteGoal } from '@/components/game/community/LiteGoal';
import type { FriendLedger, TwistAttempt, TwistKind } from '@/lite/contracts';
import { TwistQuestion } from '@/components/game/twist';
import s from './LitePlayScreen.module.css';

/**
 * Lite: Chapter 1 as a game you want to win. One moment at a time, self-paced.
 * Every move card says what it does and what it costs. After each answer, every move is revealed with what it
 * would have done to the city, ranked, so players learn from the ones they did not pick. Points, a fair-play
 * streak, clue scanning, missions and a medal reward good judgement. Any question can be sent to friends as a
 * dare that ends at midnight; the friend gets the exact same moment in the exact same city.
 */

interface DareDraft {
  path: string;
  step: string;
  points: number;
  best: boolean;
  moveNumber: number;
  moveTitle: string;
}

type Step =
  | { kind: 'begin' }
  | { kind: 'clue'; evidence: ScenarioEvidence; decision: ScenarioDecision }
  | { kind: 'clue-result'; evidence: ScenarioEvidence; verdict: ClueVerdict }
  | { kind: 'decision'; decision: ScenarioDecision }
  | {
      kind: 'feedback';
      option: DecisionOption;
      decision: ScenarioDecision;
      gained: number;
      parts: string[];
      delta: Partial<Scores>;
      tone: 'great' | 'good' | 'bad';
      consequence: string;
      ranked: MoveEval[];
      bestId: string;
      dare: DareDraft;
      /** Insight points earned on this move (own runs only). */
      insight: number;
      tier: InsightTier;
      /** Ties for the top count as best (same rule as Insight). */
      isBest: boolean;
    }
  | { kind: 'rights'; id: string }
  | { kind: 'twist' }
  | { kind: 'rights-result'; id: string; optionId: string; dare: DareDraft; insight: number }
  | { kind: 'ended' };

const MAX_TICKS = 400;
const BEST_KEY = 'vande:lite-best';
const BEST_INSIGHT_KEY = 'vande:lite-best-insight';
const RUN_KEY = 'vande:lite-run';
const PICK_MS = 340;
const SCAN_MS = 700;
const CHAPTER_TITLE = 'The Exam Leak';

/** Three short missions for Chapter 1 (same conditions as the chapter's resolution rules). */
const MISSIONS: { label: string; condition: Condition }[] = [
  { label: 'Start a proper check', condition: { flag: 'investigation-opened' } },
  { label: 'Prove the leak', condition: { anyFlag: ['leak-verified', 'strongroom-breach-confirmed'] } },
  { label: 'Catch the paper sellers', condition: { anyFlag: ['racket-arrest', 'racket-traced'] } },
];

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

/** "Boss question · ×3 Insight" before answering. In a dare the multiplier is left out: dares earn no Insight. */
function TierBadge({ stepId, own }: { stepId: string; own: boolean }) {
  const tier = tierOf(stepId);
  const meta = INSIGHT.tiers[tier];
  return (
    <span className={s.tier} data-tier={tier} data-testid="lite-tier">
      <Icon name="pulse" size={14} strokeWidth={2.4} />
      {meta.label} question{own ? ` · ×${meta.multiplier} ${INSIGHT.short}` : ''}
    </span>
  );
}

interface RunCounters {
  campaignId: string;
  points: number;
  streak: number;
  bugs: number;
  choices: number;
  path: string[];
  /** Insight points so far (added later; absent in older saved runs). */
  insight?: number;
  /** Move questions shown with pictures / as text, and best picks on each (the bias check for pictures). */
  visual?: VisualStats;
}

interface VisualStats {
  vq: number;
  vb: number;
  tq: number;
  tb: number;
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
function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeNumber(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
}
const readBest = () => readNumber(BEST_KEY);
const writeBest = (v: number) => writeNumber(BEST_KEY, v);
const readBestInsight = () => readNumber(BEST_INSIGHT_KEY);
function reduced(): boolean {
  try {
    return document.documentElement.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
const later = (fn: () => void, ms: number) => (reduced() || ms <= 0 ? fn() : window.setTimeout(fn, ms));

function deltaChips(delta: Partial<Scores>, max = 3) {
  return (Object.entries(delta) as [Dimension, number][])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, max)
    .map(([d, v]) => ({ d, v, label: `${SIMPLE_DIMENSIONS[d].short} ${v > 0 ? '+' : '−'}${Math.abs(v)}` }));
}

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
  const dareCode = screen.name === 'lite' ? screen.dare : undefined;
  const replyCode = screen.name === 'lite' ? screen.reply : undefined;
  const reply: DareReply | null = useMemo(() => (replyCode ? decodeDareReply(replyCode) : null), [replyCode]);
  const friend: LiteChallenge | null = useMemo(() => (code ? decodeLiteChallenge(code) : null), [code]);
  const incoming: Dare | null = useMemo(() => (dareCode ? decodeDare(dareCode) : null), [dareCode]);

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
  const [dareSheet, setDareSheet] = useState<{ dare: Dare; moveNumber: number; moveTitle: string } | null>(null);
  const [dareActive, setDareActive] = useState(false);
  const [dareAnswer, setDareAnswer] = useState<{ points: number; best: boolean } | null>(null);
  /** True when this is a retake on this device: the first answer still counts. */
  const [dareRetake, setDareRetake] = useState(false);
  const [dareError, setDareError] = useState<string | null>(null);
  const [replySheet, setReplySheet] = useState<DareReply | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [ledger, setLedger] = useState<FriendLedger>(readLedger);
  const [attempt, setAttempt] = useState<TwistAttempt | undefined>(undefined);
  const [dareKind, setDareKind] = useState<TwistKind>('talk');
  const [replySent, setReplySent] = useState(false);
  const [replyStep, setReplyStep] = useState<'reply-landing' | 'rematch' | 'rematch-result'>('reply-landing');
  const [challengerAward, setChallengerAward] = useState<{ earned: number; capped: boolean } | null>(null);
  /** Verified dares (off unless the build enables them and the player opted in to community sharing). */
  const optedIn = useApp((st) => st.settings.communitySharing === 'on');
  const verifiedRef = useRef<{ dareKey: string; attemptId: string; twistId: string } | null>(null);
  const startPromise = useRef<Promise<void> | null>(null);
  const [twistLoading, setTwistLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  /** Trade-results experiment (off by default): "who won" unlocks once the friend sends their result back. */
  const tradeResults = flags.liteTradeResults;
  const [insight, setInsight] = useState(0);
  const [bestInsight, setBestInsight] = useState(readBestInsight);
  const [pointsOpen, setPointsOpen] = useState(false);
  const visualStats = useRef<VisualStats>({ vq: 0, vb: 0, tq: 0, tb: 0 });

  const feedSeen = useRef(0);
  const finishedRef = useRef<string | undefined>(undefined);
  const prevAchieved = useRef<boolean[]>([false, false, false]);
  const pointsRef = useRef<HTMLSpanElement>(null);
  const missionsRef = useRef<HTMLSpanElement>(null);
  const medalRef = useRef<HTMLDivElement>(null);
  const openedFriend = useRef<string | undefined>(undefined);
  const startedHere = useRef(false);
  /** Replay path of the current run: every scan, move and fair-play answer, in order. */
  const pathRef = useRef<string[]>([]);
  const focusKey = useRef('');
  const stageRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef('');
  const pendingPath = useRef<string[] | undefined>(undefined);

  // A stored run resumes only if it is still in progress; friend links always start from their own start card.
  const ready = Boolean(
    plan?.lite && game && scenario && scenario.id === 'examination-crisis' && (startedHere.current || (!friend && !incoming && !reply && game.status !== 'ended')),
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
    setInsight(restored?.insight ?? 0);
    setBestInsight(readBestInsight());
    visualStats.current = restored?.visual ? { ...restored.visual } : { vq: 0, vb: 0, tq: 0, tb: 0 };
    pathRef.current = restored?.path ?? pendingPath.current ?? [];
    pendingPath.current = undefined;
    prevAchieved.current = useApp.getState().game ? MISSIONS.map((m) => checkCondition(m.condition, useApp.getState().game!)) : [false, false, false];
    feedSeen.current = useApp.getState().game?.feed.length ?? 0;
  }, [campaignId]);

  useEffect(() => {
    if (campaignId) writeRun({ campaignId, points, streak, bugs, choices, path: pathRef.current, insight, visual: { ...visualStats.current } });
  }, [campaignId, points, streak, bugs, choices, overlay, insight]);

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
    if (fresh >= 0 && game?.status !== 'ended' && !dareActive) {
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
    const missionBonus = done * LITE_POINTS.missionBonus;
    const total = points + missionBonus + stars * LITE_POINTS.starBonus;
    return { result, stars, done, missionBonus, total, insight };
  }, [ended, game, scenario, points, insight]);

  // Finish: medal drop, stars one by one, fanfare, confetti for a strong run.
  useEffect(() => {
    if (!summary || !campaignId || finishedRef.current === campaignId) return;
    finishedRef.current = campaignId;
    const newBest = summary.total > best;
    const beatFriend = friend ? summary.total > friend.points : false;
    if (newBest) writeBest(summary.total);
    if (summary.insight > bestInsight) writeNumber(BEST_INSIGHT_KEY, summary.insight);
    const vs = visualStats.current;
    track('lite_completed', { state: 'completed', visualQuestions: vs.vq, visualBest: vs.vb, textQuestions: vs.tq, textBest: vs.tb });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const sc = useApp.getState().scenario;
    if (g && sc) {
      const fresh = g.feed.slice(feedSeen.current);
      feedSeen.current = g.feed.length;
      const opp = [...fresh].reverse().find((f) => f.kind === 'opponent');
      if (opp) {
        const ev = sc.events.find((e) => e.message === opp.text);
        setAlert(ev?.simple ?? opp.text);
      } else setAlert(null);
    }
  };

  /** Scan a clue exactly the way the Scan button does (inspect, compare, keep safe). */
  const scanEvidence = (evId: string) => {
    const sc = useApp.getState().scenario!;
    for (const verb of ['inspect', 'compare', 'preserve'] as const) {
      const acts = evidenceActions(useApp.getState().game!, sc, evId).filter((a) => a.enabled && a.verb === verb);
      for (const a of acts) dispatch({ type: 'evidence', tick: useApp.getState().game!.tick, evidenceId: evId, verb, compareWith: a.compareWith });
    }
  };

  /** Replays one recorded token: `e<i>` scan, `d<i>-<o>` move, `r<i>-<o>` fair-play answer. Throws on anything invalid. */
  const applyToken = (tok: string) => {
    const sc = useApp.getState().scenario!;
    const tick = useApp.getState().game!.tick;
    if (/^e\d+$/.test(tok)) {
      const ev = sc.evidence[Number(tok.slice(1))];
      if (!ev) throw new Error('bad clue');
      scanEvidence(ev.id);
      return;
    }
    const m = /^([dr])(\d+)-(\d+)$/.exec(tok);
    if (!m) throw new Error('bad token');
    if (m[1] === 'd') {
      const d = sc.decisions[Number(m[2])];
      const o = d?.options[Number(m[3])];
      if (!d || !o) throw new Error('bad move');
      dispatch({ type: 'decide', tick, decisionId: d.id, optionId: o.id });
    } else {
      const rm = sc.rightsMoments[Number(m[2])];
      const o = rm?.options[Number(m[3])];
      if (!rm || !o) throw new Error('bad answer');
      dispatch({ type: 'rights', tick, momentId: rm.id, optionId: o.id });
    }
  };

  useEffect(() => {
    if (!ready) return;
    const g = useApp.getState().game;
    if (g && g.tick === 0 && g.status === 'running' && !g.pendingDecisionIds.length && !overlay) setOverlay({ kind: 'begin' });
  }, [ready, overlay]);

  // When a new moment appears, move focus to its heading (keyboard and screen-reader users land on the new content).
  useEffect(() => {
    if (!ready || focusKey.current === lastFocused.current) return;
    lastFocused.current = focusKey.current;
    const h = stageRef.current?.querySelector('h1, h2') as HTMLElement | null;
    if (h) {
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  });

  const play = () => {
    unlockGameAudio();
    playGameSound('select');
    startedHere.current = true;
    setDareActive(false);
    setDareAnswer(null);
    setAttempt(undefined);
    setChallengerAward(null);
    setLedger(readLedger());
    startLite(friend ? { seed: friend.seed } : undefined);
  };

  const takeDare = () => {
    if (!incoming) return;
    unlockGameAudio();
    playGameSound('select');
    const tokens = incoming.path ? incoming.path.split('.') : [];
    startedHere.current = true;
    pendingPath.current = [...tokens];
    startLite({ seed: incoming.seed });
    try {
      for (const tok of tokens) {
        advance();
        applyToken(tok);
      }
      advance();
      const g = useApp.getState().game!;
      const sc = useApp.getState().scenario!;
      const idx = Number(incoming.step.slice(1));
      const ok = incoming.step.startsWith('d') ? g.pendingDecisionIds.includes(sc.decisions[idx]?.id ?? '') : g.pendingRightsIds.includes(sc.rightsMoments[idx]?.id ?? '');
      if (!ok) throw new Error('mismatch');
      setDareActive(true);
      setDareAnswer(null);
      setDareRetake(false);
      setDareError(null);
      setAttempt(readAttempt(dareKeyOf(incoming)));
      setReplySent(false);
      setChallengerAward(null);
      verifiedRef.current = null;
      track('lite_challenge_opened');
    } catch {
      startedHere.current = false;
      abandonCampaign();
      setDareError('This dare could not be replayed on this device. Play the whole chapter instead.');
    }
  };

  const leave = () => {
    abandonCampaign();
    navigate({ name: 'home' });
  };

  /** "Dare more friends" from a reply: the same move, a fresh midnight, a new chain. */
  const dareMoreFromReply = (r: DareReply) => {
    const scx = getScenario('examination-crisis');
    const i = Number(r.dare.step.slice(1));
    setDareSheet({
      dare: { ...r.dare, deadline: nextLocalMidnight(), chain: 1 },
      moveNumber: (r.dare.path ? r.dare.path.split('.').filter((tk) => tk.startsWith('d')).length : 0) + 1,
      moveTitle: r.dare.step.startsWith('d') ? scx.decisions[i]?.simple?.title ?? scx.decisions[i]?.title ?? '' : scx.rightsMoments[i]?.simple?.question ?? '',
    });
  };

  const playFullChapter = () => {
    setDareActive(false);
    setDareAnswer(null);
    navigate({ name: 'lite' });
    startedHere.current = true;
    startLite();
  };

  // ------------------------------------------------------------------ start / landing
  if (!ready || !game || !scenario) {
    const sc = getScenario('examination-crisis');
    const dareIdx = incoming ? Number(incoming.step.slice(1)) : 0;
    const dareIsMove = incoming ? incoming.step.startsWith('d') : false;
    const dareMoveNumber = incoming ? (incoming.path ? incoming.path.split('.').filter((t) => t.startsWith('d')).length : 0) + 1 : 1;
    const dareQuestion = incoming
      ? dareIsMove
        ? sc.decisions[dareIdx]?.simple?.title ?? sc.decisions[dareIdx]?.title ?? 'A tough call'
        : sc.rightsMoments[dareIdx]?.simple?.question ?? sc.rightsMoments[dareIdx]?.question ?? 'A fair-play question'
      : '';
    const expired = incoming ? dareTimeLeft(incoming.deadline).expired : false;
    return (
      <main className={s.screen} data-testid="lite-screen" data-step={reply ? replyStep : incoming ? 'dare-landing' : 'start'}>
        <div className={s.aurora} aria-hidden="true" />
        {reply && replyCode ? (
          <ReplyLanding
            reply={reply}
            replyCode={replyCode}
            onPlay={play}
            onDareMore={() => dareMoreFromReply(reply)}
            onHowPoints={() => setPointsOpen(true)}
            onStep={setReplyStep}
            verify={flags.darePublicKey ? (r) => verifyReplySignature(r) : undefined}
          />
        ) : (
        <section className={`${s.hero} ${s.enter}`}>
          {incoming ? (
            <>
              <Countdown deadline={incoming.deadline} data-testid="dare-countdown" />
              <p className={s.kicker}>
                Your friend dared you{incoming.chain > 1 ? ` · dare chain #${incoming.chain}` : ''}
              </p>
              <h1 className={s.heroTitle}>{dareQuestion}</h1>
              <TierBadge stepId={(dareIsMove ? sc.decisions[dareIdx]?.id : sc.rightsMoments[dareIdx]?.id) ?? ''} own={false} />
              <p className={s.lead}>{dareIsMove ? `Move ${dareMoveNumber} of ${CHAPTER_TITLE}. One question, about 20 seconds.` : `A fair-play question from ${CHAPTER_TITLE}. About 20 seconds.`}</p>
              <p className={s.lockRow}>
                <Icon name="lock" size={16} /> Their move and score stay hidden until you answer.
              </p>
              {incoming.hint !== undefined ? (
                hintShown ? (
                  <p className={s.hintBox} data-testid="dare-hint">
                    <Icon name="sparkle" size={16} /> {DARE_HINTS[incoming.hint]}
                  </p>
                ) : (
                  <Button variant="ghost" size="md" block icon="sparkle" onClick={() => setHintShown(true)} data-testid="dare-hint-reveal">
                    Your friend left you a hint
                  </Button>
                )
              ) : null}
              <Button variant="primary" size="lg" block icon="play" onClick={takeDare} data-testid="dare-accept">
                {expired ? 'Try it anyway' : 'Take the dare'}
              </Button>
              <p className={s.fine}>{expired ? 'This dare ended at midnight. You can still play it.' : 'Answer, then dare 3 friends before midnight.'}</p>
              {dareError ? <p className={s.fine}>{dareError}</p> : null}
            </>
          ) : friend ? (
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
              <h1 className={s.heroTitle}>{CHAPTER_TITLE}</h1>
              <p className={s.lead}>Keep the city calm, fair and free. Win the gold medal.</p>
              {best > 0 ? (
                <p className={s.bestPill}>
                  <Icon name="sparkle" size={16} /> Your best · {fmt(best)}
                </p>
              ) : null}
              {ledger.helper.answers > 0 ? (
                <p className={s.bestPill} data-testid="helper-stats">
                  <Icon name="users" size={16} /> Friends helped {ledger.helper.answers} · understood {ledger.helper.understood}
                </p>
              ) : null}
              {ledger.challenger.points > 0 ? (
                <p className={s.bestPill} data-testid="challenger-stats">
                  <Icon name="message" size={16} /> {fmt(ledger.challenger.points)} {FRIEND_POINTS.challengerName}
                </p>
              ) : null}
            </>
          )}
          {incoming ? null : (
            <Button variant="primary" size="lg" block icon="play" onClick={play} data-testid="lite-start">
              {friend ? 'Accept challenge' : 'Play'}
            </Button>
          )}
          {(code && !friend) || (dareCode && !incoming) || (replyCode && !reply) ? <p className={s.fine}>That link did not work. Start a fresh game instead.</p> : null}
          {(dareCode && !incoming) || (replyCode && !reply) ? (
            <Button variant="secondary" size="lg" block onClick={play} data-testid="lite-start">
              Play
            </Button>
          ) : null}
          <Button variant="ghost" size="md" block icon="info" onClick={() => setPointsOpen(true)} data-testid="how-points-open">
            How points work
          </Button>
        </section>
        )}
        <LiteGoal optedIn={optedIn} />
        <HowPointsSheet open={pointsOpen} onClose={() => setPointsOpen(false)} />
        {dareSheet ? (
          <DareSheet open onClose={() => setDareSheet(null)} dare={dareSheet.dare} moveNumber={dareSheet.moveNumber} moveTitle={dareSheet.moveTitle} chapterTitle={CHAPTER_TITLE} />
        ) : null}
      </main>
    );
  }

  const decisionOf = (id: string) => scenario.decisions.find((d) => d.id === id)!;
  const evidenceOf = (id: string) => scenario.evidence.find((e) => e.id === id)!;
  const simpleOption = (d: ScenarioDecision, o: DecisionOption) => d.simple?.options[o.id];
  const clueChecked = (id: string) => isChecked(game, id);
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
  const moveNumberNow = () => pathRef.current.filter((t) => t.startsWith('d')).length + 1;

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
      scanEvidence(ev.id);
      pathRef.current = [...pathRef.current, `e${scenario.evidence.findIndex((x) => x.id === ev.id)}`];
      const state = useApp.getState().game!.evidence[ev.id].state;
      let gained = 0;
      let label: string = SIMPLE_STATES[state].label;
      if (state === 'manipulated') {
        gained = LITE_POINTS.clueFakeCaught;
        label = 'Fake · bug squashed';
        setBugs((b) => b + 1);
        playGameSound('squash');
        haptic('success');
        fireConfetti({ origin: { x: 0.5, y: 0.45 }, count: 60, spread: 100, power: 0.9, palette: ['#ff5c75', '#ff8a9c', '#aab6c8', '#62d6ff'] });
      } else if (state === 'verified' || state === 'corroborated') {
        gained = LITE_POINTS.clueVerified;
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
    const stateBefore = useApp.getState().game!;
    const decisionIndex = scenario.decisions.findIndex((x) => x.id === d.id);
    const optionIndex = d.options.findIndex((x) => x.id === o.id);
    // Every move, evaluated from the same moment, so the reveal is honest about the roads not taken.
    const evals = d.options.map((opt, i) => evaluateMove(stateBefore, scenario, d, opt, i));
    const mine = evals[optionIndex];
    const bestEval = evals.reduce((a, b) => (b.pts > a.pts ? b : a), evals[0]);
    const pathBefore = pathRef.current.join('.');
    const moveNumber = moveNumberNow();

    dispatch({ type: 'decide', tick: stateBefore.tick, decisionId: d.id, optionId: o.id });
    pathRef.current = [...pathRef.current, `d${decisionIndex}-${optionIndex}`];
    const after = useApp.getState().game!;
    const { delta, pos, neg } = scoreDelta(stateBefore.scores, after.scores);
    const parts: string[] = [];
    let gained = movePoints(pos, neg);
    parts.push(`${fmt(gained)} base`);
    if (mine.pts > gained) {
      gained = mine.pts;
      parts.push('×2 clue scanned');
    }
    const nextStreak = mine.harsh ? 0 : streak + 1;
    if (nextStreak >= 2 && !dareActive) {
      const mult = streakMultiplier(nextStreak);
      gained = Math.round(gained * mult);
      parts.push(`×${String(mult).replace(/\.?0+$/, '')} streak`);
    }
    const tone: 'great' | 'good' | 'bad' = mine.harsh || neg > pos ? 'bad' : gained >= 300 ? 'great' : 'good';
    setStreak(nextStreak);
    setPoints((p) => p + gained);
    setChoices((n) => n + 1);
    setFloat({ amount: gained, tone, key: Date.now() });
    setBurst((b) => b + 1);
    const foundBest = mine.option.id === bestEval.option.id || mine.pts >= bestEval.pts;
    const tier = tierOf(d.id);
    const { rank, behindBest } = rankOf(evals, o.id);
    const insightGain = dareActive ? 0 : insightFor(tier, rank, behindBest, closeCallMargin());
    if (insightGain) setInsight((n) => n + insightGain);
    if (!dareActive) {
      const st = visualStats.current;
      if (visualPlanFor(d)) {
        st.vq += 1;
        if (foundBest) st.vb += 1;
      } else {
        st.tq += 1;
        if (foundBest) st.tb += 1;
      }
    }

    if (dareActive && incoming) {
      const first = recordDareAnswer(dareKeyOf(incoming), { points: mine.pts, best: foundBest });
      const counted = first.dare ?? { points: mine.pts, best: foundBest };
      setDareAnswer(counted);
      setDareRetake(counted.points !== mine.pts || counted.best !== foundBest);
      setAttempt(first);
      setDareKind(actionKindOf(bestEval.option.tags));
      registerVerified({ points: counted.points, best: counted.best, kind: actionKindOf(bestEval.option.tags) });
      const won = mine.pts > incoming.points;
      const tie = mine.pts === incoming.points;
      if (tradeResults) later(() => playGameSound('correct'), 300);
      else later(() => {
        playGameSound(won ? 'win' : tie ? 'correct' : 'lose');
        if (won) {
          haptic('success');
          fireConfetti({ count: 120, spread: 90 });
          confettiRain(1800);
        }
      }, 300);
    } else if (tone === 'bad') {
      playGameSound('wrong');
      haptic('warning');
    } else {
      playGameSound(tone === 'great' ? 'great' : 'correct');
      playGameSound('coin', { intensity: 0.6 });
      haptic(tone === 'great' ? 'success' : 'light');
      if (nextStreak >= 2) later(() => playGameSound('streak', { step: nextStreak - 2 }), 260);
      if (tone === 'great' || foundBest) fireConfetti({ origin: { x: 0.5, y: 0.4 }, count: foundBest ? 70 : 50, spread: 60, power: 0.8 });
    }
    setPicked(null);
    setOverlay({
      kind: 'feedback',
      option: o,
      decision: d,
      gained,
      parts,
      delta,
      tone,
      consequence: mine.consequence,
      ranked: [...evals].sort((a, b) => b.pts - a.pts),
      bestId: bestEval.option.id,
      dare: { path: pathBefore, step: `d${decisionIndex}`, points: mine.pts, best: foundBest, moveNumber, moveTitle: d.simple?.title ?? d.title },
      insight: insightGain,
      tier,
      isBest: foundBest,
    });
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
      const rmIndex = scenario.rightsMoments.findIndex((r) => r.id === id);
      const rm = scenario.rightsMoments[rmIndex];
      const optIndex = rm.options.findIndex((o) => o.id === optionId);
      const pathBefore = pathRef.current.join('.');
      dispatch({ type: 'rights', tick: useApp.getState().game!.tick, momentId: id, optionId });
      pathRef.current = [...pathRef.current, `r${rmIndex}-${optIndex}`];
      const correct = rm.options[optIndex]?.correct ?? false;
      const pts = correct ? LITE_POINTS.fairPlayCorrect : 0;
      const rightsInsight = correct && !dareActive ? insightFor(tierOf(id), 1, 0, closeCallMargin()) : 0;
      if (rightsInsight) setInsight((n) => n + rightsInsight);
      if (pts) {
        setPoints((p) => p + pts);
        setFloat({ amount: pts, tone: 'good', key: Date.now() });
      }
      if (dareActive && incoming) {
        const first = recordDareAnswer(dareKeyOf(incoming), { points: pts, best: correct });
        const counted = first.dare ?? { points: pts, best: correct };
        setDareAnswer(counted);
        setDareRetake(counted.points !== pts || counted.best !== correct);
        setAttempt(first);
        setDareKind('rule');
        registerVerified({ points: counted.points, best: counted.best, kind: 'rule' });
        const won = pts > incoming.points;
        if (tradeResults) playGameSound('correct');
        else {
          playGameSound(won ? 'win' : pts === incoming.points ? 'correct' : 'lose');
          if (won) fireConfetti({ count: 110, spread: 90 });
        }
      } else if (correct) {
        playGameSound('correct');
        playGameSound('coin', { intensity: 0.6 });
        haptic('success');
        fireConfetti({ origin: { x: 0.5, y: 0.55 }, count: 45, spread: 70, power: 0.8 });
      } else {
        playGameSound('wrong');
        haptic('warning');
      }
      setPicked(null);
      setOverlay({
        kind: 'rights-result',
        id,
        optionId,
        dare: { path: pathBefore, step: `r${rmIndex}`, points: pts, best: correct, moveNumber: moveNumberNow(), moveTitle: rm.simple?.question ?? rm.question },
        insight: rightsInsight,
      });
    }, PICK_MS);
  };

  /**
   * Verified dares: registers the friend's answer and adopts the server-chosen twist and nonce. Fire and forget;
   * without a response the local twist is used and the reply goes unsigned. Safe to repeat (the server is idempotent),
   * which also recovers the attempt after a reload.
   */
  const registerVerified = (claim: { points: number; best: boolean; kind: TwistKind }) => {
    if (!incoming || !verifiedDaresEnabled(optedIn)) return;
    const key = dareKeyOf(incoming);
    const tokens = incoming.path ? incoming.path.split('.') : [];
    const answerPath = pathRef.current.slice(tokens.length).join('.');
    const nonce = ensureAttempt(key).nonce;
    startPromise.current = startVerifiedAttempt({ optedIn, installId: useApp.getState().installId, dare: incoming, nonce, answerPath, claim })
      .then((res) => {
        if (!res) return;
        const a = assignTwist(key, res.twistId, res.nonce);
        if (!a) return;
        verifiedRef.current = { dareKey: key, attemptId: res.attemptId, twistId: res.twistId };
        setAttempt(a);
      })
      .catch(() => undefined)
      .finally(() => {
        startPromise.current = null;
      });
  };

  /** The friend takes one twist: drawn once per dare on this device, matched to the dared move's kind. */
  const startTwist = async () => {
    if (!incoming || twistLoading) return;
    if (startPromise.current) {
      setTwistLoading(true);
      await startPromise.current;
      setTwistLoading(false);
    }
    const a = drawTwist(dareKeyOf(incoming), dareKind);
    if (!a?.twistId || !twistById(a.twistId)) {
      useApp.getState().toast({ text: 'No twist is ready on this device. Send your result back instead.', kind: 'info', duration: 2600 });
      return;
    }
    playGameSound('flip');
    setAttempt(a);
    setOverlay({ kind: 'twist' });
  };

  const onTwistAnswer = (optionId: string) => {
    if (!incoming || !attempt?.twistId || attempt.answer) return;
    const a = answerTwist(dareKeyOf(incoming), optionId);
    if (!a) return;
    setAttempt(a);
    const right = a.outcome === 'right';
    track('lite_twist_answered', { right });
    if (right) {
      playGameSound('correct');
      playGameSound('coin', { intensity: 0.6 });
      haptic('success');
      fireConfetti({ origin: { x: 0.5, y: 0.5 }, count: 60, spread: 70, power: 0.8 });
    } else {
      playGameSound('wrong');
      haptic('warning');
    }
  };

  /** The friend's reply (R2): the dare result, the twist outcome and the nonce that makes it unique. */
  const buildReply = (): DareReply | null => {
    if (!incoming || !dareAnswer) return null;
    const a = attempt ?? ensureAttempt(dareKeyOf(incoming));
    const answered = Boolean(a.answer && a.twistId);
    return {
      dare: incoming,
      points: dareAnswer.points,
      best: dareAnswer.best,
      version: 2,
      twistId: answered ? a.twistId : undefined,
      twist: answered ? (a.outcome ?? 'wrong') : 'skipped',
      nonce: a.nonce,
      rematchDeadline: nextLocalMidnight(),
    };
  };

  const openReply = async () => {
    const base = buildReply();
    if (!base || !incoming || signing) return;
    playGameSound('select');
    let reply = base;
    const v = verifiedRef.current;
    const a = readAttempt(dareKeyOf(incoming));
    // Grade only once the twist is answered (grading is final); skipped twists go unsigned.
    if (v && a?.answer && a.twistId === v.twistId && v.dareKey === dareKeyOf(incoming) && verifiedDaresEnabled(optedIn)) {
      setSigning(true);
      const res = await gradeVerifiedAttempt({ optedIn, installId: useApp.getState().installId, dare: incoming, attemptId: v.attemptId, twistAnswer: a.answer }).catch(() => null);
      setSigning(false);
      if (res && res.nonce === a.nonce) reply = { ...base, points: res.points, best: res.best, twistId: res.twistId, twist: res.twist, nonce: res.nonce, sig: res.sig };
    }
    setReplySheet(reply);
  };

  /** Challenger points: once per dare, when the friend actually sends their result back. */
  const onReplyShared = (method: 'native' | 'clipboard' | 'download') => {
    if (!incoming || !dareAnswer) return;
    const a = attempt ?? ensureAttempt(dareKeyOf(incoming));
    const understood = dareAnswer.best && a.outcome === 'right';
    const res = awardChallenger(readLedger(), dareKeyOf(incoming), understood, new Date());
    writeLedger(res.ledger);
    setLedger(res.ledger);
    setReplySent(true);
    track('lite_reply_sent', { shareMethod: method, tradeResults });
    if (res.earned > 0) {
      setChallengerAward({ earned: res.earned, capped: false });
      playGameSound('coin');
    } else if (res.capped) setChallengerAward({ earned: 0, capped: true });
  };

  const openDare = (draft: DareDraft) => {
    playGameSound('select');
    setDareSheet({
      dare: { seed: seed ?? 0, path: draft.path, step: draft.step, points: draft.points, best: draft.best, deadline: nextLocalMidnight(), chain: dareActive && incoming ? Math.min(99, incoming.chain + 1) : 1 },
      moveNumber: draft.moveNumber,
      moveTitle: draft.moveTitle,
    });
  };

  const mood = cityMood(game.scores);
  const progress = Math.min(100, Math.round((game.tick / game.duration) * 100));

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

  /** What the friend can do next: the twist (once), send the result back, pass the dare on. */
  const twistDone = Boolean(attempt?.answer);
  const dareMoveNumber = incoming ? (incoming.path ? incoming.path.split('.').filter((tk) => tk.startsWith('d')).length : 0) + 1 : 1;
  const dareActions =
    dareActive && incoming && dareAnswer ? (
      <>
        {twistDone ? null : (
          <>
            <Button variant="primary" size="lg" block icon="sparkle" onClick={() => void startTwist()} disabled={twistLoading} aria-busy={twistLoading || undefined} data-testid="twist-start">
              {twistLoading ? 'Getting your twist…' : dareAnswer.best ? `Try the twist · +${FRIEND_POINTS.understood} for you both` : 'Try the twist'}
            </Button>
            <p className={s.incentive}>
              {dareAnswer.best
                ? `Same idea, new place. Get it right and you both earn +${FRIEND_POINTS.understood} more.`
                : 'Same idea, new place. It also becomes your rematch dare.'}
            </p>
          </>
        )}
        <Button variant={twistDone ? 'primary' : 'secondary'} size="lg" block icon="share" onClick={() => void openReply()} disabled={signing} aria-busy={signing || undefined} data-testid="dare-reply">
          {signing ? 'Getting it ready…' : 'Send your result back'}
        </Button>
        {challengerAward ? (
          <p className={s.incentive} data-testid="challenger-award">
            {challengerAward.earned > 0
              ? `Sent. +${fmt(challengerAward.earned)} ${FRIEND_POINTS.challengerName}.`
              : `You've earned ${FRIEND_POINTS.challengerName} from ${FRIEND_POINTS.perDayCap} dares today. More start at midnight.`}
          </p>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          block
          icon="users"
          onClick={() =>
            openDare({
              path: incoming.path,
              step: incoming.step,
              points: dareAnswer.points,
              best: dareAnswer.best,
              moveNumber: dareMoveNumber,
              moveTitle: (() => {
                const i = Number(incoming.step.slice(1));
                return incoming.step.startsWith('d') ? scenario.decisions[i]?.simple?.title ?? scenario.decisions[i]?.title ?? '' : scenario.rightsMoments[i]?.simple?.question ?? '';
              })(),
            })
          }
          data-testid="dare-pass"
        >
          Dare 3 friends · before midnight
        </Button>
        <p className={s.incentive}>{`+${FRIEND_POINTS.answer} for each friend who answers. +${FRIEND_POINTS.understood} more when they crack the twist.`}</p>
        <Button variant="ghost" size="md" block icon="play" onClick={playFullChapter} data-testid="dare-full">
          Play the whole chapter
        </Button>
        <Button variant="ghost" size="md" block onClick={leave}>
          Home
        </Button>
      </>
    ) : null;

  /** The dare verdict shown after answering a friend's dare. With trade-results on, "who won" waits for the reply. */
  const tradeLocked = tradeResults && !replySent;
  const dareVerdict =
    dareActive && incoming && dareAnswer ? (
      <div className={s.dareResult} data-win={!tradeLocked && dareAnswer.points > incoming.points ? 'true' : undefined} data-testid="dare-result">
        {dareRetake ? (
          <p className={s.leadSmall} data-testid="dare-first-answer">
            Your first answer on this device counts for this dare.
          </p>
        ) : null}
        {tradeLocked ? (
          <>
            <p className={s.kicker}>Your answer is in</p>
            <div className={s.versus}>
              <span>
                <small>You</small>
                <strong>+{fmt(dareAnswer.points)}</strong>
              </span>
              <span className={s.vs}>vs</span>
              <span>
                <small>Friend</small>
                <strong>?</strong>
              </span>
            </div>
            <p className={s.leadSmall} data-testid="trade-locked">
              Send your result back to see who won.
            </p>
          </>
        ) : (
          <>
            <p className={s.kicker}>{dareAnswer.points > incoming.points ? 'You won the dare' : dareAnswer.points === incoming.points ? 'A perfect tie' : 'Your friend won this one'}</p>
            <div className={s.versus}>
              <span>
                <small>You</small>
                <strong>+{fmt(dareAnswer.points)}</strong>
              </span>
              <span className={s.vs}>vs</span>
              <span>
                <small>Friend</small>
                <strong>+{fmt(incoming.points)}</strong>
              </span>
            </div>
            <p className={s.leadSmall}>
              {incoming.best && dareAnswer.best
                ? 'You both found the best move.'
                : incoming.best
                  ? 'Your friend found the best move. It is marked above.'
                  : dareAnswer.best
                    ? 'You found the best move. Your friend did not.'
                    : 'Neither of you found the best move. It is marked above.'}
            </p>
          </>
        )}
        {dareActions}
      </div>
    ) : null;

  const stepKey =
    current.kind +
    ('decision' in current && current.decision ? current.decision.id : '') +
    ('evidence' in current && current.evidence ? current.evidence.id : '') +
    ('id' in current ? current.id : '') +
    (current.kind === 'twist' && attempt?.answer ? '-answered' : '');
  const dataStep = current.kind === 'twist' ? (attempt?.answer ? 'twist-result' : 'twist') : current.kind;
  focusKey.current = stepKey;

  return (
    <main className={s.screen} data-testid="lite-screen" data-step={dataStep} data-dare={dareActive ? 'true' : undefined}>
      <div className={s.aurora} aria-hidden="true" />
      <header className={s.top}>
        <button type="button" className={s.round} onClick={leave} aria-label="Leave">
          <Icon name="back" size={20} />
        </button>
        {dareActive && incoming ? (
          <div className={s.topCountdown}>
            <Countdown deadline={incoming.deadline} compact />
          </div>
        ) : (
          <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Chapter progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        <button type="button" className={s.round} onClick={() => setPointsOpen(true)} aria-label="How points work" data-testid="how-points-open">
          <Icon name="question" size={20} />
        </button>
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

      {current.kind !== 'begin' && current.kind !== 'ended' && current.kind !== 'twist' ? (
        <section className={s.hud} aria-label="How the city is doing">
          {bars(current.kind === 'feedback' ? current.delta : undefined)}
          <div className={s.hudRow}>
            <span className={s.mood} data-tone={mood.tone}>
              {mood.label}
            </span>
            {streak >= 2 && !dareActive ? (
              <span className={s.streak} key={streak}>
                <Icon name="sparkle" size={14} /> Streak ×{streak}
              </span>
            ) : null}
            {insight > 0 && !dareActive ? (
              <span className={s.insightPill} data-testid="lite-insight" aria-label={`${insight} ${INSIGHT.name}`}>
                <Icon name="pulse" size={14} strokeWidth={2.4} /> {fmt(insight)}
              </span>
            ) : null}
            {dareActive ? (
              <span className={s.dareChip}>
                <Icon name="clock" size={14} /> Dare
              </span>
            ) : (
              <span className={s.missions} ref={missionsRef} aria-label={`${achieved.filter(Boolean).length} of ${MISSIONS.length} missions done`}>
                {MISSIONS.map((m, i) => (
                  <span key={i} className={s.missionDot} data-done={achieved[i] ? 'true' : undefined} title={m.label} />
                ))}
              </span>
            )}
          </div>
        </section>
      ) : null}

      <div className={s.stage} key={stepKey} ref={stageRef}>
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
            <Button
              variant="primary"
              size="lg"
              block
              onClick={() => {
                unlockGameAudio();
                next();
              }}
              data-testid="lite-next"
            >
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
            <div className={s.kickerRow}>
              <p className={s.kicker}>{dareActive ? 'The dare' : `Move ${choices + 1}`}</p>
              <TierBadge stepId={current.decision.id} own={!dareActive} />
            </div>
            <h1 className={s.title}>{current.decision.simple?.title ?? current.decision.title}</h1>
            <p className={s.lead}>{current.decision.simple?.situation ?? current.decision.situation}</p>
            <div className={s.hand} data-count={current.decision.options.length} data-visual={visualPlanFor(current.decision) ? 'true' : undefined}>
              {current.decision.options.map((o, i) => {
                const vplan = visualPlanFor(current.decision);
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
                    visual={vplan?.[o.id]}
                  />
                );
              })}
            </div>
          </section>
        )}

        {current.kind === 'feedback' && (
          <>
            <section className={`${s.hero} ${s.enter} ${current.tone === 'bad' ? s.shake : ''}`} data-tone={current.tone} aria-live="polite">
              <Burst tone={current.tone} trigger={burst} />
              <div className={s.verdictRow}>
                <span className={s.verdictBadge} data-tone={current.tone}>
                  <Icon name={current.tone === 'bad' ? 'alert' : 'check'} size={22} strokeWidth={2.4} />
                </span>
                <span className={s.kicker}>
                  {current.isBest ? 'Best move!' : current.tone === 'great' ? 'Great move' : current.tone === 'good' ? 'Good move' : 'That hurt'}
                </span>
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
                {current.insight > 0 ? (
                  <span className={`${s.chip} ${s.chipInsight}`} data-testid="lite-insight-gain">
                    +{fmt(current.insight)} {INSIGHT.short} · {INSIGHT.tiers[current.tier].label}
                  </span>
                ) : null}
              </div>
            </section>

            <section className={s.reveal} aria-label="What every move would have done" data-testid="lite-reveal">
              <p className={s.revealTitle}>
                <Icon name="eye" size={16} /> What every move would have done
              </p>
              <ul className={s.others}>
                {current.ranked.map((m) => {
                  const rplan = visualPlanFor(current.decision);
                  const pict = rplan?.[m.option.id];
                  const kind = actionKindOf(m.option.tags);
                  const meta = ACTION_META[kind];
                  const mineRow = m.option.id === current.option.id;
                  const bestRow = m.option.id === current.bestId || m.pts === current.ranked[0]?.pts;
                  return (
                    <li
                      key={m.option.id}
                      className={s.other}
                      data-mine={mineRow ? 'true' : undefined}
                      data-best={bestRow ? 'true' : undefined}
                      style={{ '--kind': meta.color, '--kind-deep': meta.deep } as CSSProperties}
                      data-testid={`lite-reveal-${m.option.id}`}
                    >
                      {pict ? (
                        <span className={s.otherPict} aria-hidden="true">
                          <Pictogram visual={pict.visual} size="mini" />
                        </span>
                      ) : (
                        <span className={s.otherBadge} aria-hidden="true">
                          <Icon name={meta.icon} size={18} strokeWidth={2.2} />
                        </span>
                      )}
                      <span className={s.otherBody}>
                        <span className={s.otherHead}>
                          <strong>{simpleOption(current.decision, m.option)?.title ?? m.option.title}</strong>
                          {bestRow ? <span className={s.tagBest}>Best</span> : null}
                          {mineRow ? <span className={s.tagMine}>Your move</span> : null}
                        </span>
                        {mineRow ? null : <span className={s.otherText}>{m.consequence}</span>}
                        <span className={s.deltaRow}>
                          {deltaChips(m.delta).map((c) => (
                            <span key={c.d} className={c.v > 0 ? s.deltaUp : s.deltaDown}>
                              {c.label}
                            </span>
                          ))}
                          {deltaChips(m.delta).length === 0 ? <span className={s.deltaNone}>No change yet</span> : null}
                        </span>
                      </span>
                      <span className={s.otherPts} data-harsh={m.harsh ? 'true' : undefined}>
                        +{fmt(m.pts)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {dareVerdict ?? (
              <div className={s.actions}>
                <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
                  Next
                </Button>
                <Button variant="secondary" size="md" block icon="clock" onClick={() => openDare(current.dare)} data-testid="lite-dare">
                  Dare friends on this move · ends at midnight
                </Button>
                <p className={s.incentive}>
                  {`Your answer stays hidden until they play. +${FRIEND_POINTS.answer} for each friend who answers, +${FRIEND_POINTS.understood} more when they crack the twist.`}
                </p>
              </div>
            )}
          </>
        )}

        {(current.kind === 'rights' || current.kind === 'rights-result') &&
          (() => {
            const rm = scenario.rightsMoments.find((r) => r.id === current.id)!;
            const chosen = current.kind === 'rights-result' ? current.optionId : undefined;
            const chosenOpt = chosen ? rm.options.find((o) => o.id === chosen) : undefined;
            return (
              <section className={s.decision} aria-live="polite">
                <div className={s.verdictRow}>
                  <span className={s.verdictBadge} data-tone="rule">
                    <Icon name="book" size={20} strokeWidth={2.2} />
                  </span>
                  <span className={s.kicker}>
                    {chosenOpt ? (chosenOpt.correct ? `Fair call · +${LITE_POINTS.fairPlayCorrect}` : 'Not quite') : dareActive ? 'The dare · fair play' : `Fair play · +${LITE_POINTS.fairPlayCorrect}`}
                  </span>
                  {chosenOpt ? null : <TierBadge stepId={rm.id} own={!dareActive} />}
                  {current.kind === 'rights-result' && current.insight > 0 ? (
                    <span className={`${s.chip} ${s.chipInsight}`} data-testid="lite-insight-gain">
                      +{fmt(current.insight)} {INSIGHT.short}
                    </span>
                  ) : null}
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
                      note={chosen ? `${o.correct ? 'Fair: ' : 'Unfair: '}${rm.simple?.feedback?.[o.id] ?? o.feedback}` : undefined}
                      onSelect={() => answerRights(rm.id, o.id)}
                      picked={picked === o.id || chosen === o.id}
                      faded={Boolean(picked) && picked !== o.id}
                      verdict={chosen ? (o.correct ? 'right' : chosen === o.id ? 'wrong' : undefined) : undefined}
                      disabled={Boolean(picked) || Boolean(chosen)}
                      index={i}
                      testId={`lite-rights-${o.id}`}
                    />
                  ))}
                </div>
                {chosenOpt && current.kind === 'rights-result' ? (
                  <div className={s.explain}>
                    <p className={s.leadStrong}>{rm.simple?.principle ?? rm.principle}</p>
                    <p className={s.fine}>Educational content—not legal advice</p>
                    {dareVerdict ?? (
                      <>
                        <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
                          Next
                        </Button>
                        <Button variant="secondary" size="md" block icon="clock" onClick={() => openDare(current.dare)} data-testid="lite-dare">
                          Dare friends on this question · ends at midnight
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })()}

        {current.kind === 'twist' &&
          (() => {
            const tw = attempt?.twistId ? twistById(attempt.twistId) : undefined;
            if (!tw || !attempt) return null;
            return (
              <>
                <TwistQuestion
                  twist={tw}
                  order={attempt.order ?? tw.options.map((o) => o.id)}
                  answer={attempt.answer}
                  onAnswer={onTwistAnswer}
                  testIdPrefix="twist"
                  kicker="The twist · same idea, new place"
                />
                {attempt.answer ? (
                  <div className={s.dareResult} data-testid="twist-actions">
                    <p className={s.leadSmall}>
                      {attempt.outcome === 'right'
                        ? dareAnswer?.best
                          ? `You cracked the dare and the twist. Send it back: you both earn +${FRIEND_POINTS.understood} more.`
                          : 'You cracked the twist. Send it back as your rematch dare.'
                        : 'Not this time. Send it back anyway: your twist becomes their rematch.'}
                    </p>
                    {dareActions}
                  </div>
                ) : null}
              </>
            );
          })()}

        {current.kind === 'ended' &&
          summary &&
          (() => {
            const { result, stars, done, missionBonus, total } = summary;
            const outcome = SIMPLE_OUTCOMES[classifyOutcome(result.scores)];
            const newBest = total > best;
            const beatFriend = friend ? total > friend.points : undefined;
            const tie = friend ? total === friend.points : false;
            const challengeCode = encodeLiteChallenge({ seed: seed ?? 0, points: total, stars });
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
                  <span className={s.chip}>Stars +{stars * LITE_POINTS.starBonus}</span>
                  {bugs ? <span className={s.chip}>{bugs === 1 ? '1 bug squashed' : `${bugs} bugs squashed`}</span> : null}
                </div>
                <p className={s.insightLine} data-testid="lite-result-insight" data-value={summary.insight}>
                  <Icon name="pulse" size={16} strokeWidth={2.4} /> {INSIGHT.name} · {fmt(summary.insight)}
                  {summary.insight > bestInsight && bestInsight > 0 ? ' · new best' : bestInsight > 0 ? ` · best ${fmt(Math.max(bestInsight, summary.insight))}` : ''}
                </p>
                <p className={s.outcome}>
                  {outcome.label} · city {result.score}
                </p>
                <p className={s.lead}>{strategicFeedback(result.fingerprint, result, true)}</p>
                <Button
                  variant="primary"
                  size="lg"
                  block
                  icon="share"
                  onClick={() => {
                    playGameSound('select');
                    setShareOpen(true);
                  }}
                  data-testid="lite-challenge"
                >
                  Challenge friends
                </Button>
                <Button variant="secondary" size="lg" block icon="refresh" onClick={play} data-testid="lite-again">
                  {newBest || beatFriend ? 'Play again' : 'Try to beat it'}
                </Button>
                <Button variant="ghost" size="md" block icon="info" onClick={() => setPointsOpen(true)} data-testid="how-points-result">
                  How points work
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

      {dareSheet ? (
        <DareSheet open onClose={() => setDareSheet(null)} dare={dareSheet.dare} moveNumber={dareSheet.moveNumber} moveTitle={dareSheet.moveTitle} chapterTitle={CHAPTER_TITLE} />
      ) : null}
      <HowPointsSheet open={pointsOpen} onClose={() => setPointsOpen(false)} />
      {replySheet ? (
        <DareSheet
          open
          mode="reply"
          reply={replySheet}
          onShared={onReplyShared}
          hideTheirScore={tradeResults && !replySent}
          onClose={() => setReplySheet(null)}
          dare={replySheet.dare}
          moveNumber={(replySheet.dare.path ? replySheet.dare.path.split('.').filter((t) => t.startsWith('d')).length : 0) + 1}
          moveTitle=""
          chapterTitle={CHAPTER_TITLE}
        />
      ) : null}
    </main>
  );
}
