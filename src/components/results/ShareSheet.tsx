import { useEffect, useMemo, useState } from 'react';
import type { CampaignResult, DailyAttemptResult, DailyId } from '@/engine/types';
import { buildCardModel, renderCard, type CardSize } from '@/share/resultCard';
import { basePath, fileNameFor, shareDaily, shareMethodOf, shareResult, type ShareOutcome } from '@/share/share';
import { buildDailyCardModel, dailyFileName, renderDailyCard, type DailyCardSize } from '@/share/dailyCard';
import { FingerprintStrip } from '@/share/FingerprintStrip';
import { track } from '@/analytics';
import { Button, useApp } from './deps';
import layout from './layout.module.css';
import { copyText, downloadBlob } from './format';
import { DownloadIcon, LinkIcon, ShareIcon } from './icons';
import { ResultsSheet } from './ResultsSheet';
import styles from './ShareSheet.module.css';
import { useSimple } from '@/app/simple';

export interface DailyShareInput {
  dailyId: DailyId;
  result: DailyAttemptResult;
  official: boolean;
  /** Daily challenge code (D1-…). */
  code: string;
}

interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  /** Campaign result card (classic mode). */
  result?: CampaignResult;
  /** Spoiler-free daily card; takes precedence over `result`. */
  daily?: DailyShareInput;
}

const OUTCOME_TOAST: Record<ShareOutcome, { text: string; kind: 'success' | 'info' | 'warning' }> = {
  shared: { text: 'Challenge sent.', kind: 'success' },
  copied: { text: 'Challenge link copied. Your card image was downloaded.', kind: 'success' },
  downloaded: { text: 'Card image downloaded. Copy the link to share it.', kind: 'info' },
  cancelled: { text: 'Sharing cancelled.', kind: 'info' },
  failed: { text: 'Sharing is not available here. Copy the link instead.', kind: 'warning' },
};

export function ShareSheet(props: ShareSheetProps) {
  if (props.daily) return <DailyShareSheet {...props} daily={props.daily} />;
  if (props.result) return <CampaignShareSheet {...props} result={props.result} />;
  return null;
}

function DailyShareSheet({ open, onClose, daily }: ShareSheetProps & { daily: DailyShareInput }) {
  const simple = useSimple();
  const toast = useApp((s) => s.toast);
  const [size, setSize] = useState<DailyCardSize>('landscape');
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const model = useMemo(
    () => buildDailyCardModel({ dailyId: daily.dailyId, result: daily.result, official: daily.official, code: daily.code, origin, base: basePath(), simple }),
    [daily, origin, simple],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | undefined;
    setError(null);
    setPreview(null);
    renderDailyCard(model, size)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, blob });
      })
      .catch(() => {
        if (!cancelled) setError(simple ? 'The picture could not be drawn here. You can still copy the link.' : 'The card image could not be drawn on this device. You can still copy the challenge link.');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, model, size, simple]);

  const onShare = async () => {
    setBusy(true);
    try {
      const outcome = await shareDaily(model, { size, blob: preview?.blob });
      const t = OUTCOME_TOAST[outcome];
      toast({ text: t.text, kind: t.kind, duration: 3200 });
      const method = shareMethodOf(outcome);
      if (method) track('daily_shared', { dailyId: model.dailyId, official: model.official, shareMethod: method, mode: simple ? 'simple' : 'full' });
      if (outcome === 'shared') onClose();
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    const ok = await copyText(model.url);
    toast({ text: ok ? 'Challenge link copied.' : 'Could not copy. Long-press the link to copy it.', kind: ok ? 'success' : 'warning', duration: 2800 });
    if (ok) track('daily_shared', { dailyId: model.dailyId, official: model.official, shareMethod: 'clipboard', mode: simple ? 'simple' : 'full' });
  };

  const onCopyCode = async () => {
    const ok = await copyText(model.code);
    toast({ text: ok ? 'Challenge code copied.' : 'Could not copy the code.', kind: ok ? 'success' : 'warning', duration: 2400 });
  };

  const onDownload = () => {
    if (!preview) return;
    downloadBlob(preview.blob, dailyFileName(model, size));
    toast({ text: simple ? 'Picture saved.' : 'Card image downloaded.', kind: 'success', duration: 2400 });
    track('daily_shared', { dailyId: model.dailyId, official: model.official, shareMethod: 'download', mode: simple ? 'simple' : 'full' });
  };

  return (
    <ResultsSheet open={open} onClose={onClose} title={simple ? 'Challenge a friend' : 'Challenge friends'} testId="share-sheet">
      <div className={layout.stack}>
        <p className={styles.tagline}>{model.invitation}</p>
        <div className={layout.row} style={{ justifyContent: 'space-between' }}>
          <span className={layout.muted}>{simple ? 'No spoilers. Only your pattern and result.' : 'Spoiler-free: your pattern and outcome, never your decisions.'}</span>
          <div className={styles.sizeToggle} role="radiogroup" aria-label="Card format">
            {(['landscape', 'square'] as DailyCardSize[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={size === s} className={styles.sizeOption} onClick={() => setSize(s)}>
                {s === 'landscape' ? 'Wide' : 'Square'}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.preview} style={{ ['--ratio' as string]: size === 'landscape' ? '1200 / 630' : '1 / 1' }}>
          {preview ? (
            <img className={styles.previewImg} src={preview.url} alt={model.alt} data-testid="share-card-preview" />
          ) : (
            <p className={styles.previewState} role="status">
              {error ?? (simple ? 'Drawing your picture…' : 'Drawing your card…')}
            </p>
          )}
        </div>
        <div className={layout.row} style={{ alignItems: 'center', gap: 'var(--s-3)' }}>
          <FingerprintStrip fingerprint={model.fingerprint} outcomeLabel={model.outcomeLabel} score={model.official ? model.score : undefined} simple={simple} size={20} />
          <span className={layout.muted}>{model.official ? (simple ? 'Official result' : 'Official result') : simple ? 'Practice run' : 'Practice run'}</span>
        </div>
        <div className={styles.codeBox}>
          <div>
            <span className={styles.codeLabel}>{simple ? 'Your game code' : 'Challenge code'}</span>
            <span className={styles.code} data-testid="challenge-code">
              {model.code}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onCopyCode} className={styles.copyCode}>
            {simple ? 'Copy the code' : 'Copy code'}
          </Button>
        </div>
        <p className={styles.url}>{model.url}</p>
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={onShare} disabled={busy} data-testid="share-button">
            <span className={styles.btnInner}>
              <ShareIcon size={18} />
              {busy ? 'Opening…' : 'Share'}
            </span>
          </Button>
          <Button variant="secondary" size="lg" onClick={onCopy} data-testid="copy-link">
            <span className={styles.btnInner}>
              <LinkIcon size={18} />
              Copy link
            </span>
          </Button>
          <Button variant="ghost" size="md" onClick={onDownload} disabled={!preview}>
            <span className={styles.btnInner}>
              <DownloadIcon size={18} />
              {simple ? 'Save picture' : 'Download image'}
            </span>
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </ResultsSheet>
  );
}

function CampaignShareSheet({ open, onClose, result }: ShareSheetProps & { result: CampaignResult }) {
  const simple = useSimple();
  const toast = useApp((s) => s.toast);
  const [size, setSize] = useState<CardSize>('landscape');
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const model = useMemo(() => buildCardModel(result, { origin, base: basePath(), simple }), [result, origin, simple]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | undefined;
    setError(null);
    setPreview(null);
    renderCard(model, size)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, blob });
      })
      .catch(() => {
        if (!cancelled) setError('The card image could not be drawn on this device. You can still copy the challenge link.');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, model, size]);

  const onShare = async () => {
    setBusy(true);
    try {
      const outcome = await shareResult(result, origin, { size, blob: preview?.blob, model, simple });
      const t = OUTCOME_TOAST[outcome];
      toast({ text: t.text, kind: t.kind, duration: 3200 });
      if (outcome === 'shared') onClose();
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    const ok = await copyText(model.url);
    toast({ text: ok ? 'Challenge link copied.' : 'Could not copy. Long-press the link to copy it.', kind: ok ? 'success' : 'warning', duration: 2800 });
  };

  const onCopyCode = async () => {
    const ok = await copyText(model.code);
    toast({ text: ok ? 'Challenge code copied.' : 'Could not copy the code.', kind: ok ? 'success' : 'warning', duration: 2400 });
  };

  const onDownload = () => {
    if (!preview) return;
    downloadBlob(preview.blob, fileNameFor(model, size));
    toast({ text: 'Card image downloaded.', kind: 'success', duration: 2400 });
  };

  return (
    <ResultsSheet open={open} onClose={onClose} title={simple ? 'Challenge a friend' : 'Challenge friends'} testId="share-sheet">
      <div className={layout.stack}>
        <p className={styles.tagline}>{model.tagline}</p>
        <div className={layout.row} style={{ justifyContent: 'space-between' }}>
          <span className={layout.muted}>{simple ? 'Made on this device. Nothing is sent anywhere until you share it.' : 'Generated on this device. Nothing is uploaded.'}</span>
          <div className={styles.sizeToggle} role="radiogroup" aria-label="Card format">
            {(['landscape', 'portrait'] as CardSize[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={size === s} className={styles.sizeOption} onClick={() => setSize(s)}>
                {s === 'landscape' ? 'Wide' : 'Story'}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.preview} style={{ ['--ratio' as string]: size === 'landscape' ? '1200 / 630' : '1080 / 1350' }}>
          {preview ? (
            <img className={styles.previewImg} src={preview.url} alt={`Result card: ${model.outcomeLabel}, ${model.score} out of 100. ${model.tagline}`} data-testid="share-card-preview" />
          ) : (
            <p className={styles.previewState} role="status">
              {error ?? 'Drawing your card…'}
            </p>
          )}
        </div>
        <div className={styles.codeBox}>
          <div>
            <span className={styles.codeLabel}>{simple ? 'Your game code' : 'Challenge code'}</span>
            <span className={styles.code} data-testid="challenge-code">
              {model.code}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onCopyCode} className={styles.copyCode}>
            {simple ? 'Copy the code' : 'Copy code'}
          </Button>
        </div>
        <p className={styles.url}>{model.url}</p>
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={onShare} disabled={busy} data-testid="share-button">
            <span className={styles.btnInner}>
              <ShareIcon size={18} />
              {busy ? 'Opening…' : 'Share'}
            </span>
          </Button>
          <Button variant="secondary" size="lg" onClick={onCopy} data-testid="copy-link">
            <span className={styles.btnInner}>
              <LinkIcon size={18} />
              Copy link
            </span>
          </Button>
          <Button variant="ghost" size="md" onClick={onDownload} disabled={!preview}>
            <span className={styles.btnInner}>
              <DownloadIcon size={18} />
              {simple ? 'Save picture' : 'Download image'}
            </span>
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </ResultsSheet>
  );
}
