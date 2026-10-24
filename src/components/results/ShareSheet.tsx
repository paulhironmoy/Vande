import { useEffect, useMemo, useState } from 'react';
import type { CampaignResult } from '@/engine/types';
import { buildCardModel, renderCard, type CardSize } from '@/share/resultCard';
import { basePath, fileNameFor, shareResult, type ShareOutcome } from '@/share/share';
import { Button, useApp } from './deps';
import layout from './layout.module.css';
import { copyText, downloadBlob } from './format';
import { DownloadIcon, LinkIcon, ShareIcon } from './icons';
import { ResultsSheet } from './ResultsSheet';
import styles from './ShareSheet.module.css';

interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  result: CampaignResult;
}

const OUTCOME_TOAST: Record<ShareOutcome, { text: string; kind: 'success' | 'info' | 'warning' }> = {
  shared: { text: 'Challenge sent.', kind: 'success' },
  copied: { text: 'Challenge link copied. Your card image was downloaded.', kind: 'success' },
  downloaded: { text: 'Card image downloaded. Copy the link to share it.', kind: 'info' },
  cancelled: { text: 'Sharing cancelled.', kind: 'info' },
  failed: { text: 'Sharing is not available here. Copy the link instead.', kind: 'warning' },
};

export function ShareSheet({ open, onClose, result }: ShareSheetProps) {
  const toast = useApp((s) => s.toast);
  const [size, setSize] = useState<CardSize>('landscape');
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const model = useMemo(() => buildCardModel(result, { origin, base: basePath() }), [result, origin]);

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
      const outcome = await shareResult(result, origin, { size, blob: preview?.blob, model });
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
    <ResultsSheet open={open} onClose={onClose} title="Challenge friends" testId="share-sheet">
      <div className={layout.stack}>
        <p className={styles.tagline}>{model.tagline}</p>
        <div className={layout.row} style={{ justifyContent: 'space-between' }}>
          <span className={layout.muted}>Generated on this device. Nothing is uploaded.</span>
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
            <span className={styles.codeLabel}>Challenge code</span>
            <span className={styles.code} data-testid="challenge-code">
              {model.code}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onCopyCode}>
            Copy code
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
              Download image
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
