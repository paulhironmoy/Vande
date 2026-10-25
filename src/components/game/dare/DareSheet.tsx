import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Sheet } from '@/components/ui';
import { useApp } from '@/app/store';
import { haptic } from '@/audio/haptics';
import { track } from '@/analytics';
import { APP_NAME } from '@/share/resultCard';
import { shareCard, shareMethodOf, type ShareMethod } from '@/share/share';
import { FRIEND_POINTS } from '@/lite/points';
import { DARE_HINTS, dareReplyText, dareReplyUrl, dareShareText, dareUrl, encodeDare, encodeDareReply, type Dare, type DareReply } from '@/share/dare';
import { dareCardAlt, dareCardFileName, renderDareCard, type DareCardModel } from '@/share/dareCard';
import { Countdown } from './Countdown';
import { CHANNEL_GLYPH, CHANNEL_LABEL, DARE_CHANNELS, channelUrl, copyText, openTarget, type DareChannel } from './channels';
import s from './DareSheet.module.css';

export interface DareSheetProps {
  open: boolean;
  onClose: () => void;
  dare: Dare;
  moveNumber: number;
  /** The dared question (never the answer). */
  moveTitle: string;
  chapterTitle: string;
  /** 'dare' (default): dare 3 friends. 'reply': send your result back to the friend who dared you. */
  mode?: 'dare' | 'reply';
  /** Required for reply mode: the dare you answered plus your result on it. */
  reply?: DareReply;
  /**
   * Called after every successful share action in either mode (share sheet, any channel tap, copy link), with how
   * it was shared. The Lite screen uses it to award Challenger points and record the reply as sent.
   */
  onShared?: (method: ShareMethod) => void;
  /** Reply mode, trade-results experiment: hide the friend's score until this sheet has shared once. */
  hideTheirScore?: boolean;
}

type Hint = 0 | 1 | 2 | undefined;

const SLOTS = 3;

function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 19.5c1.3-3.4 4-5.1 7.2-5.1s5.9 1.7 7.2 5.1" />
    </svg>
  );
}

/**
 * "Dare 3 friends" sheet: the ice-bucket hand-off after a move. The three slots only count the player's own share
 * actions in this sheet (a personal progress hint); they never claim delivery or that anyone accepted.
 */
export function DareSheet({ open, onClose, dare, moveNumber, moveTitle, chapterTitle, mode = 'dare', reply, onShared, hideTheirScore }: DareSheetProps) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sent, setSent] = useState(0);
  const [hint, setHint] = useState<Hint>(dare.hint);

  const isReply = mode === 'reply' && Boolean(reply);
  const prefix = isReply ? 'reply' : 'dare';
  const code = useMemo(() => (isReply && reply ? encodeDareReply(reply) : encodeDare({ ...dare, hint })), [isReply, reply, dare, hint]);
  const url = isReply ? dareReplyUrl(code) : dareUrl(code);
  const text =
    isReply && reply
      ? dareReplyText({ points: reply.points, best: reply.best, senderPoints: hideTheirScore && sent === 0 ? 0 : reply.dare.points, moveNumber, twist: reply.twist })
      : dareShareText({ moveNumber, points: dare.points, best: dare.best, chain: dare.chain, chapterTitle });
  const card: DareCardModel = useMemo(
    () => ({ moveNumber, moveTitle, points: dare.points, best: dare.best, chain: dare.chain, deadlineLabel: 'Ends at midnight', code, chapterTitle }),
    [moveNumber, moveTitle, dare.points, dare.best, dare.chain, code, chapterTitle],
  );
  const alt = dareCardAlt(card);

  // Fresh sheet session: reset the slot count (and the hint choice) when it opens for a new dare.
  useEffect(() => {
    if (open) setSent(0);
  }, [open, dare.seed, dare.path, dare.step]);
  useEffect(() => {
    if (open) setHint(dare.hint);
  }, [open, dare.hint, dare.seed, dare.path, dare.step]);

  useEffect(() => {
    if (!open || isReply) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setBlob(null);
    setPreviewUrl(null);
    renderDareCard(card)
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, card, isReply]);

  const toast = (t: string, kind: 'success' | 'info' | 'warning' = 'success') => useApp.getState().toast({ text: t, kind, duration: 2600 });
  const lightSlot = () => setSent((n) => Math.min(SLOTS, n + 1));

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const outcome = await shareCard({
        blob: isReply ? undefined : (blob ?? undefined),
        fileName: dareCardFileName(card),
        title: APP_NAME,
        text: `${text}\n${url}`,
        url,
        alt: isReply ? undefined : alt,
        dialogTitle: isReply ? 'Send your result back' : 'Dare 3 friends',
      });
      const method = shareMethodOf(outcome);
      if (method) {
        track('lite_shared', { shareMethod: method });
        lightSlot();
        onShared?.(method);
      }
      if (outcome === 'shared') haptic('success');
      else if (outcome === 'copied') toast(isReply ? 'Reply link copied. Paste it to your friend.' : 'Dare link copied. Paste it to a friend.');
      else if (outcome === 'downloaded') toast('Dare card saved. Send it with your link.', 'info');
      else if (outcome === 'failed') toast('Sharing is not available here. Copy the link instead.', 'warning');
    } finally {
      setSharing(false);
    }
  };

  const sendTo = (channel: DareChannel) => {
    openTarget(channelUrl(channel, text, url));
    track('lite_shared', { shareMethod: 'native' });
    haptic('light');
    lightSlot();
    onShared?.('native');
  };

  const copyLink = async () => {
    const ok = await copyText(url);
    if (ok) {
      track('lite_shared', { shareMethod: 'clipboard' });
      haptic('success');
      lightSlot();
      onShared?.('clipboard');
    }
    toast(ok ? (isReply ? 'Reply link copied' : 'Dare link copied') : 'Could not copy the link', ok ? 'success' : 'warning');
  };

  const progress =
    sent === 0
      ? 'Pick three friends, or one group chat: everyone in it gets the same question.'
      : sent < SLOTS
        ? `${sent} of ${SLOTS} shared.`
        : 'All three shared. The chain is moving.';

  const channels = (
    <ul className={s.channels} aria-label="Send to">
      {DARE_CHANNELS.map((c) => (
        <li key={c}>
          <button type="button" className={s.channel} onClick={() => sendTo(c)} data-testid={`${prefix}-share-${c}`}>
            <span className={s.channelIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {CHANNEL_GLYPH[c]}
              </svg>
            </span>
            <span className={s.channelLabel}>{CHANNEL_LABEL[c]}</span>
          </button>
        </li>
      ))}
      <li>
        <button type="button" className={s.channel} onClick={copyLink} data-testid={`${prefix}-share-copy`}>
          <span className={s.channelIcon} aria-hidden="true">
            <Icon name="link" size={24} />
          </span>
          <span className={s.channelLabel}>Copy link</span>
        </button>
      </li>
    </ul>
  );

  if (isReply && reply) {
    return (
      <Sheet open={open} onClose={onClose} title="Send your result back" testId="reply-sheet">
        <div className={s.body}>
          <div className={s.head}>
            <p className={s.lead} data-testid="reply-lead">
              You can both earn points when you send it back.
            </p>
            {reply.twist !== 'skipped' && reply.rematchDeadline ? (
              <p className={s.fine} data-testid="reply-rematch-note">
                Your rematch dare ends at midnight.
              </p>
            ) : null}
          </div>
          <div className={s.replyCard} aria-label="Your result">
            <span className={s.replyMove}>Move {moveNumber}</span>
            <span className={s.replyTitle}>{moveTitle}</span>
            <span className={s.replyScores}>
              <span>
                <small>You</small>
                <strong>+{reply.points.toLocaleString('en-US')}</strong>
              </span>
              <span className={s.replyVs} aria-hidden="true">
                vs
              </span>
              <span>
                <small>Friend</small>
                <strong>
                  {hideTheirScore && sent === 0 ? (
                    <>
                      <span aria-hidden="true">?</span>
                      <span className="sr-only">hidden until you send</span>
                    </>
                  ) : (
                    `+${reply.dare.points.toLocaleString('en-US')}`
                  )}
                </strong>
              </span>
            </span>
            {reply.best ? <span className={s.replyBest}>Best move found</span> : null}
            {reply.twist === 'right' || reply.twist === 'wrong' ? (
              <span className={s.replyTwist} data-tone={reply.twist} data-testid="reply-twist">
                {reply.twist === 'right' ? 'Twist cracked' : 'Twist tried'}
              </span>
            ) : null}
          </div>
          <Button variant="primary" size="lg" block icon="share" onClick={share} disabled={sharing} className={s.primary} data-testid="reply-share">
            Send result back
          </Button>
          {channels}
          <p className={s.fine}>Made on this device. Nothing is uploaded until you share.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Dare 3 friends" testId="dare-sheet">
      <div className={s.body}>
        <div className={s.head}>
          <p className={s.lead}>Your move is in. Pass it on before midnight.</p>
          <Countdown deadline={dare.deadline} data-testid="dare-countdown" />
        </div>

        <ol className={s.slots} aria-label="Friends to dare">
          {Array.from({ length: SLOTS }).map((_, i) => {
            const lit = i < sent;
            return (
              <li key={i} className={s.slot} data-lit={lit ? 'true' : undefined} data-testid={`dare-slot-${i + 1}`}>
                <span className={s.slotIcon} aria-hidden="true">
                  {lit ? <Icon name="check" size={22} strokeWidth={2.4} /> : <PersonGlyph />}
                </span>
                <span className={s.slotLabel}>Friend {i + 1}</span>
                <span className="sr-only">{lit ? ': shared' : ': not shared yet'}</span>
              </li>
            );
          })}
        </ol>
        <p className={s.progress} aria-live="polite">
          {progress}
        </p>
        <p className={s.incentive} data-testid="dare-incentive">
          <Icon name="sparkle" size={16} />
          <span>
            +{FRIEND_POINTS.answer} when a friend answers. +{FRIEND_POINTS.understood} more when they find the best move and crack the twist. Up to {FRIEND_POINTS.perDareCap} friends per dare and {FRIEND_POINTS.perDayCap} a day.
          </span>
        </p>

        {!failed && (
          <figure className={s.preview} data-testid="dare-preview" data-ready={previewUrl ? 'true' : 'false'}>
            {previewUrl ? (
              <img className={s.previewImg} src={previewUrl} alt={alt} width={1080} height={1080} />
            ) : (
              <div className={s.placeholder} aria-hidden="true">
                <span className={s.phDare}>DARE</span>
                <span className={s.phMove}>Move {moveNumber}</span>
                <span className={s.phTitle}>{moveTitle}</span>
                <span className={s.phPoints}>{dare.points > 0 ? `Beat +${dare.points.toLocaleString('en-US')}` : 'Find the best move'}</span>
              </div>
            )}
          </figure>
        )}

        <div className={s.hints} role="radiogroup" aria-labelledby="dare-hint-label">
          <span className={s.hintLabel} id="dare-hint-label">
            Add a hint (optional)
          </span>
          <div className={s.hintRow}>
            <button type="button" role="radio" aria-checked={hint === undefined} className={s.hintChip} onClick={() => setHint(undefined)} data-testid="dare-hint-none">
              No hint
            </button>
            {DARE_HINTS.map((text, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={hint === i}
                className={s.hintChip}
                onClick={() => setHint(i as 0 | 1 | 2)}
                data-testid={`dare-hint-${i}`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <Button variant="primary" size="lg" block icon="share" onClick={share} disabled={sharing} className={s.primary} data-testid="dare-share">
          Send dare
        </Button>

        {channels}

        <p className={s.fine}>Made on this device. Nothing is uploaded until you share. Friends see the question, not your answer.</p>
      </div>
    </Sheet>
  );
}
