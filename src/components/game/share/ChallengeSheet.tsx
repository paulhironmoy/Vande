import { useEffect, useState, type ReactNode } from 'react';
import { Button, Icon, Sheet } from '@/components/ui';
import { useApp } from '@/app/store';
import { haptic } from '@/audio/haptics';
import { APP_NAME } from '@/share/resultCard';
import { shareCard } from '@/share/share';
import { liteShareText } from '@/share/liteChallenge';
import { liteCardAlt, liteCardFileName, medalTier, renderLiteCard, type LiteCardModel } from '@/share/liteCard';
import s from './ChallengeSheet.module.css';
import { track } from '@/analytics';
import { shareMethodOf } from '@/share/share';

export interface ChallengeSheetProps {
  open: boolean;
  onClose: () => void;
  model: LiteCardModel;
  /** The player just beat a friend's challenge. */
  beatFriend?: boolean;
}

type Channel = 'whatsapp' | 'telegram' | 'x' | 'sms' | 'email';

/** Generic monochrome glyphs (24×24, stroke). Deliberately not brand logos; the label names the app. */
const GLYPHS: Record<Channel, ReactNode> = {
  whatsapp: (
    <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5Zm-3 6.2c.4 1.9 2.4 4 4.5 4.6l1.2-1.2 2 .8-.4 1.9c-4.2.4-8.2-3.6-7.8-7.8l1.9-.4.8 2-1.2 1.2Z" />
  ),
  telegram: <path d="M20.5 4.5 3.8 11.2l5.6 2 2 5.6 2.9-3.6 4 2.9 2.2-13.6ZM9.4 13.2l8.4-6.2-6.4 7.6" />,
  x: <path d="M5 19.5 9.5 15l-4-4L16 4.5l3.5 3.5L13 18.5l-4-4M15 6l3 3" />,
  sms: (
    <>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3v-3H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.6" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
};

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  x: 'X',
  sms: 'Messages',
  email: 'Email',
};

function channelUrl(channel: Channel, text: string, url: string): string {
  const e = encodeURIComponent;
  switch (channel) {
    case 'whatsapp':
      return `https://wa.me/?text=${e(`${text}\n${url}`)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${e(url)}&text=${e(text)}`;
    case 'x':
      return `https://x.com/intent/post?text=${e(text)}&url=${e(url)}`;
    case 'sms':
      return `sms:?&body=${e(`${text} ${url}`)}`;
    case 'email':
      return `mailto:?subject=${e('A VANDE challenge for you')}&body=${e(`${text}\n\n${url}`)}`;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/** Opens a share target only in response to a tap. http(s) targets open in a new tab without referrer/opener. */
function openTarget(href: string): void {
  if (href.startsWith('http')) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  // sms: and mailto: hand off to the system app without leaving the game.
  window.location.href = href;
}

export function ChallengeSheet({ open, onClose, model, beatFriend }: ChallengeSheetProps) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { points, stars, outcomeLabel, missionsDone, missionsTotal, bugs, code, url, chapterTitle } = model;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setBlob(null);
    setPreviewUrl(null);
    renderLiteCard({ points, stars, outcomeLabel, missionsDone, missionsTotal, bugs, code, url, chapterTitle }, 'landscape')
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
  }, [open, points, stars, outcomeLabel, missionsDone, missionsTotal, bugs, code, url, chapterTitle]);

  const text = liteShareText({ points, stars, outcomeLabel, beatFriend });
  const alt = liteCardAlt(model);
  const toast = (t: string, kind: 'success' | 'info' | 'warning' = 'success') => useApp.getState().toast({ text: t, kind, duration: 2600 });

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const outcome = await shareCard({
        blob: blob ?? undefined,
        fileName: liteCardFileName(model),
        title: APP_NAME,
        text: `${text}\n${url}`,
        url,
        alt,
        dialogTitle: 'Challenge friends',
      });
      const method = shareMethodOf(outcome);
      if (method) track('lite_shared', { shareMethod: method });
      if (outcome === 'shared') haptic('success');
      else if (outcome === 'copied') toast('Challenge link copied. Paste it to a friend.');
      else if (outcome === 'downloaded') toast('Card saved. Send it with your link.', 'info');
      else if (outcome === 'failed') toast('Sharing is not available here. Copy the link instead.', 'warning');
    } finally {
      setSharing(false);
    }
  };

  const copyLink = async () => {
    const ok = await copyText(url);
    if (ok) haptic('success');
    toast(ok ? 'Link copied' : 'Could not copy the link', ok ? 'success' : 'warning');
  };

  const copyCode = async () => {
    const ok = await copyText(code);
    if (ok) haptic('success');
    toast(ok ? 'Code copied' : 'Could not copy the code', ok ? 'success' : 'warning');
  };

  const saveImage = () => {
    if (!blob) return;
    downloadBlob(blob, liteCardFileName(model));
    haptic('light');
  };

  const tier = medalTier(stars);
  const channels: Channel[] = ['whatsapp', 'telegram', 'x', 'sms', 'email'];

  return (
    <Sheet open={open} onClose={onClose} title="Challenge friends" testId="lite-share-sheet">
      <div className={s.body}>
        <p className={s.lead}>{beatFriend ? 'You beat the challenge. Pass it on.' : 'Send your score. Friends play the same city.'}</p>

        {!failed && (
          <figure className={s.preview} data-testid="lite-share-preview" data-ready={previewUrl ? 'true' : 'false'}>
            {previewUrl ? (
              <img className={s.previewImg} src={previewUrl} alt={alt} width={1200} height={630} />
            ) : (
              <div className={s.placeholder} aria-hidden="true">
                <span className={s.phMedal} data-tier={tier} />
                <span className={s.phPoints}>{Math.max(0, Math.round(points)).toLocaleString('en-US')}</span>
                <span className={s.phStars}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} data-on={i < stars ? 'true' : undefined}>
                      ★
                    </span>
                  ))}
                </span>
              </div>
            )}
          </figure>
        )}

        <Button variant="primary" size="lg" block icon="share" onClick={share} disabled={sharing} className={s.primary} data-testid="lite-share">
          Share challenge
        </Button>

        <ul className={s.channels} aria-label="Send to">
          {channels.map((c) => (
            <li key={c}>
              <button type="button" className={s.channel} onClick={() => openTarget(channelUrl(c, text, url))} data-testid={`lite-share-${c}`}>
                <span className={s.channelIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {GLYPHS[c]}
                  </svg>
                </span>
                <span className={s.channelLabel}>{CHANNEL_LABEL[c]}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={s.channel} onClick={copyLink} data-testid="lite-share-copy">
              <span className={s.channelIcon} aria-hidden="true">
                <Icon name="link" size={24} />
              </span>
              <span className={s.channelLabel}>Copy link</span>
            </button>
          </li>
          <li>
            <button type="button" className={s.channel} onClick={saveImage} disabled={!blob} data-testid="lite-share-save">
              <span className={s.channelIcon} aria-hidden="true">
                <Icon name="download" size={24} />
              </span>
              <span className={s.channelLabel}>Save image</span>
            </button>
          </li>
        </ul>

        <div className={s.code}>
          <div className={s.codeText}>
            <span className={s.codeLabel}>Challenge code</span>
            <code className={s.codeValue} data-testid="lite-share-code">
              {code}
            </code>
          </div>
          <button type="button" className={s.codeCopy} onClick={copyCode} data-testid="lite-share-copy-code">
            <Icon name="copy" size={18} />
            <span>Copy code</span>
          </button>
        </div>

        <p className={s.fine}>Made on this device. Nothing is uploaded until you share.</p>
      </div>
    </Sheet>
  );
}
