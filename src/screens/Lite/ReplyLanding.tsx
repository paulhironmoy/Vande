import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@/components/ui';
import { track } from '@/analytics';
import { haptic } from '@/audio/haptics';
import { playGameSound } from '@/audio/gameSounds';
import { fireConfetti, confettiRain } from '@/components/game/fx';
import { Countdown } from '@/components/game/dare/Countdown';
import { TwistQuestion } from '@/components/game/twist';
import { dareTimeLeft, type DareReply } from '@/share/dare';
import { FRIEND_POINTS } from '@/lite/points';
import { awardHelperReply, readLedger, replyIdentity, writeLedger } from '@/lite/ledger';
import { answerRematch, ensureRematch, readRematch, twistById, type RematchRecord } from '@/lite/twists';
import type { AwardResult, FriendLedger } from '@/lite/contracts';
import s from './LitePlayScreen.module.css';

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

type Award = Pick<AwardResult, 'earned' | 'fresh' | 'upgraded' | 'capped'>;

/** One award per reply per page load, so React's development double effects never count a reply twice. */
const awardMemo = new Map<string, Award>();

export interface ReplyLandingProps {
  reply: DareReply;
  replyCode: string;
  onPlay: () => void;
  onDareMore: () => void;
  onHowPoints: () => void;
  /** Reports the step for the screen's data-step: 'reply-landing' | 'rematch' | 'rematch-result'. */
  onStep: (step: 'reply-landing' | 'rematch' | 'rematch-result') => void;
  /**
   * Resolves whether the reply's signature is valid (verified dares, wave 2). Without it, every reply is local:
   * a signature field alone never counts as verified, because it sits outside the checksum.
   */
  verify?: (reply: DareReply) => Promise<boolean>;
}

/**
 * The helper opens a friend's reply: Helper points (caps and dedupe from the ledger), then the rematch, where the
 * friend's twist comes back as a dare. The friend's twist result stays hidden until the helper answers: nothing on
 * this page that depends on it (title, lines, the +100 part of the award, sounds, the tally) shows before then.
 * The points themselves are counted at once, so they are never lost if the rematch is skipped.
 */
export function ReplyLanding({ reply, replyCode, onPlay, onDareMore, onHowPoints, onStep, verify }: ReplyLandingProps) {
  const [award, setAward] = useState<Award | null>(null);
  const [ledger, setLedger] = useState<FriendLedger>(readLedger);
  const twist = reply.version === 2 && reply.twistId && reply.twist !== 'skipped' ? twistById(reply.twistId) : undefined;
  const replyKey = replyIdentity(reply, replyCode);
  const [rematch, setRematch] = useState<RematchRecord | undefined>(() => (twist ? readRematch(replyKey) : undefined));
  const [playing, setPlaying] = useState(false);
  const rematchExpired = reply.rematchDeadline ? dareTimeLeft(reply.rematchDeadline).expired : false;
  /** The friend took a twist the helper has not answered yet: its outcome must stay hidden. */
  const twistPending = Boolean(twist) && !rematch?.answer;

  useEffect(() => {
    let cancelled = false;
    const cached = awardMemo.get(replyCode);
    if (cached) {
      setLedger(readLedger());
      setAward(cached);
      return undefined;
    }
    void (async () => {
      let verified = false;
      if (verify && reply.sig) {
        try {
          verified = await verify(reply);
        } catch {
          verified = false;
        }
      }
      if (cancelled && awardMemo.has(replyCode)) return;
      let res = awardMemo.get(replyCode);
      if (!res) {
        const out = awardHelperReply(readLedger(), reply, replyCode, new Date(), verified);
        writeLedger(out.ledger);
        res = { earned: out.earned, fresh: out.fresh, upgraded: out.upgraded, capped: out.capped };
        awardMemo.set(replyCode, res);
        track('lite_reply_opened', { awarded: out.earned > 0, capped: Boolean(out.capped) });
        const shown = twist && !readRematch(replyKey)?.answer ? visiblePart(res) : res.earned;
        if (shown > 0) window.setTimeout(() => playGameSound('coin'), 400);
      }
      if (!cancelled) {
        setLedger(readLedger());
        setAward(res);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, replyCode]);

  const phase: 'reply-landing' | 'rematch' | 'rematch-result' = playing ? (rematch?.answer ? 'rematch-result' : 'rematch') : 'reply-landing';
  useEffect(() => onStep(phase), [phase, onStep]);
  const rootRef = useRef<HTMLElement>(null);
  const firstPhase = useRef(true);
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    const h = rootRef.current?.querySelector('h1, h2') as HTMLElement | null;
    if (h) {
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }, [phase]);

  /**
   * The part of this friend's Helper points that depends on their twist (the +100), from the ledger entry for this
   * reply, so it stays hidden across reloads and follow-up replies until the rematch is answered.
   */
  const hiddenBonus = twist ? Math.max(0, (ledger.replies[replyKey] ?? 0) - FRIEND_POINTS.answer) : 0;

  const startRematch = () => {
    if (!twist) return;
    playGameSound('select');
    const rec = ensureRematch(replyKey, twist.id) ?? rematch;
    if (!rec) return;
    setRematch(rec);
    setPlaying(true);
  };

  const onRematchAnswer = (optionId: string) => {
    if (!twist || !rematch || rematch.answer) return;
    const rec = answerRematch(replyKey, optionId) ?? { ...rematch, answer: optionId, outcome: optionId === twist.best ? ('right' as const) : ('wrong' as const) };
    setRematch({ ...rec });
    const mineRight = rec.answer === twist.best;
    const theirsRight = reply.twist === 'right';
    if ((mineRight && !theirsRight) || hiddenBonus > 0) {
      playGameSound('win');
      haptic('success');
      fireConfetti({ count: 120, spread: 90 });
      if (mineRight && !theirsRight) confettiRain(1600);
    } else if (mineRight) playGameSound('correct');
    else playGameSound(theirsRight ? 'lose' : 'wrong');
  };

  const shownEarned = award ? (twistPending ? visiblePart(award) : award.earned) : 0;
  const awardLine = !award
    ? ''
    : award.capped === 'day'
      ? `You've helped ${FRIEND_POINTS.perDayCap} friends today. New Helper points start at midnight.`
      : award.capped === 'dare'
        ? `This dare already rewarded ${FRIEND_POINTS.perDareCap} friends. Dare a new move to earn more.`
        : twistPending
          ? award.fresh
            ? `Helper points for their answer. Answer their twist to see if you earned +${FRIEND_POINTS.understood} more.`
            : 'Answer their twist to see how they did.'
          : award.upgraded
            ? 'They came back and cracked the twist. More Helper points for you.'
            : award.fresh
              ? reply.version === 2 && reply.best && reply.twist === 'right'
                ? 'Helper points: they found the best move and cracked the twist.'
                : 'Helper points for a friend who played. A hint can help them crack the twist next time.'
              : 'You already counted this reply.';

  // While the twist is pending, the tally leaves out the hidden +100 (and its "understood" count).
  const shownStats = {
    answers: ledger.helper.answers,
    understood: ledger.helper.understood - (twistPending && hiddenBonus > 0 ? 1 : 0),
    points: ledger.helper.points - (twistPending ? hiddenBonus : 0),
  };

  if (twist && rematch && playing) {
    const mineRight = rematch.answer ? rematch.answer === twist.best : undefined;
    const theirsRight = reply.twist === 'right';
    const verdict =
      mineRight === undefined
        ? null
        : mineRight && theirsRight
          ? 'A draw: you both cracked it.'
          : mineRight
            ? 'You won the rematch!'
            : theirsRight
              ? 'Your friend won this one.'
              : 'Nobody cracked it this time.';
    return (
      <section className={s.stage} ref={rootRef} aria-label="Rematch">
        <TwistQuestion twist={twist} order={rematch.order} answer={rematch.answer} onAnswer={onRematchAnswer} testIdPrefix="rematch" kicker="Rematch · your friend's twist" />
        {verdict ? (
          <div className={s.dareResult} data-win={mineRight && !theirsRight ? 'true' : undefined} data-testid="rematch-verdict">
            <p className={s.kicker}>{verdict}</p>
            <p className={s.leadSmall}>{theirsRight ? 'Your friend got this twist right.' : 'Your friend did not get this twist.'}</p>
            {hiddenBonus > 0 ? (
              <p className={s.gain} data-tone="great" data-testid="rematch-bonus">
                +{fmt(hiddenBonus)}
              </p>
            ) : null}
            {hiddenBonus > 0 ? <p className={s.leadSmall}>Your bonus Helper points: they found the best move and cracked the twist.</p> : null}
            <Button variant="primary" size="lg" block icon="share" onClick={onDareMore} data-testid="reply-dare-more">
              Dare more friends
            </Button>
            <Button variant="secondary" size="lg" block icon="play" onClick={onPlay} data-testid="lite-start">
              Play the chapter
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`${s.hero} ${s.enter}`} ref={rootRef}>
      <div className={s.verdictRow}>
        <span className={s.verdictBadge} data-tone={reply.best ? 'great' : 'good'}>
          <Icon name={reply.best ? 'check' : 'users'} size={22} strokeWidth={2.4} />
        </span>
        <span className={s.kicker}>Your friend took your dare</span>
      </div>
      <h1 className={s.heroTitle}>{reply.best ? 'They found the best move!' : 'They answered your dare'}</h1>
      <div className={s.versus} data-win={reply.points > reply.dare.points ? 'true' : undefined}>
        <span>
          <small>Friend</small>
          <strong>+{fmt(reply.points)}</strong>
        </span>
        <span className={s.vs}>vs</span>
        <span>
          <small>You</small>
          <strong>+{fmt(reply.dare.points)}</strong>
        </span>
      </div>
      {twist ? (
        <p className={s.leadSmall} data-testid="reply-landing-twist">
          {twistPending ? 'They also took a twist question. It is your rematch now.' : reply.twist === 'right' ? 'They also cracked their twist question.' : 'They also tried a twist question.'}
        </p>
      ) : null}
      {award && shownEarned > 0 ? (
        <p className={s.gain} data-tone="great" data-testid="reply-award">
          +{fmt(shownEarned)}
        </p>
      ) : null}
      <p className={s.lead} data-testid="reply-award-note">
        {awardLine}
      </p>
      <p className={s.bestPill} data-testid="helper-stats">
        <Icon name="users" size={16} /> Friends helped {shownStats.answers} · understood {shownStats.understood} · {fmt(shownStats.points)} {FRIEND_POINTS.helperName}
      </p>
      {twist ? (
        <div className={s.explain} data-testid="rematch-offer">
          <p className={s.kicker}>Your friend dared you back</p>
          {reply.rematchDeadline ? <Countdown deadline={reply.rematchDeadline} data-testid="rematch-countdown" /> : null}
          <p className={s.leadSmall}>
            {rematch?.answer
              ? 'You already answered their twist.'
              : rematchExpired
                ? 'This rematch has ended. You can still play it.'
                : 'Answer their twist. Their result stays hidden until you do.'}
          </p>
          <Button variant="primary" size="lg" block icon="play" onClick={startRematch} data-testid="rematch-accept">
            {rematch?.answer ? 'See the rematch' : rematchExpired ? 'Try it anyway' : 'Answer their twist'}
          </Button>
        </div>
      ) : null}
      <Button variant={twist ? 'secondary' : 'primary'} size="lg" block icon="share" onClick={onDareMore} data-testid="reply-dare-more">
        Dare more friends
      </Button>
      <Button variant="secondary" size="lg" block icon="play" onClick={onPlay} data-testid="lite-start">
        Play the chapter
      </Button>
      <Button variant="ghost" size="md" block icon="info" onClick={onHowPoints} data-testid="how-points-open">
        How points work
      </Button>
    </section>
  );
}

/**
 * The part of an award that does not depend on the friend's twist: the +40 for answering (an upgrade is all twist).
 * Capped and repeat replies earned nothing, so nothing is hidden.
 */
function visiblePart(a: Award): number {
  if (a.upgraded) return 0;
  return Math.min(a.earned, FRIEND_POINTS.answer);
}

/** For tests: forget the in-memory award memo. */
export function __resetReplyAwardMemo() {
  awardMemo.clear();
}
