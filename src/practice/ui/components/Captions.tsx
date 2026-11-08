/**
 * Captions for essential sounds (an accessibility setting owned by src/audio): the latest one, shown in the status
 * strip and never over the play. src/audio emits none between the start of the approach and contact, and none before
 * the physical event is confirmed (a boundary at the rope, a wicket at the stumps).
 */
import { useEffect, useState } from 'react';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import s from './Live.module.css';

export function Captions() {
  const t = usePracticeT();
  const { audio } = useKit();
  const [caption, setCaption] = useState<{ id: number; key: string } | null>(null);
  useEffect(() => {
    if (!audio) return;
    let timer: number | undefined;
    const off = audio.onCaption((c) => {
      setCaption({ id: c.id, key: c.key });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCaption((cur) => (cur?.id === c.id ? null : cur)), Math.max(1200, c.holdMs));
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [audio]);
  return (
    <p className={s.caption} aria-live="polite" data-testid="practice-captions">
      {caption ? t.tk(`practice.caption.${caption.key}`) : ''}
    </p>
  );
}
