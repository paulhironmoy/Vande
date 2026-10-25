import { useEffect, useRef, useState } from 'react';
import { dareTimeLeft } from '@/share/dare';
import s from './Countdown.module.css';

export interface CountdownProps {
  /** Unix seconds. */
  deadline: number;
  /** Short form: "5h 12m". */
  compact?: boolean;
  onExpire?: () => void;
  'data-testid'?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Full form: "5h 12m 08s", "12m 08s" or "45s". */
function longLabel(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${pad2(m)}m ${pad2(sec)}s`;
  if (m > 0) return `${m}m ${pad2(sec)}s`;
  return `${sec}s`;
}

/** Spoken form for assistive tech: "5 hours 12 minutes". */
function spoken(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (!h && (sec || !m)) parts.push(`${sec} ${sec === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

function HourglassIcon() {
  return (
    <svg className={s.icon} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h12M6 20.5h12" />
      <path d="M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5" />
      <path className={s.sand} d="M9.5 18.5c.8-1.4 1.6-2.1 2.5-2.1s1.7.7 2.5 2.1Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Live "Ends in …" countdown to a dare deadline. Window timers only; aria-live off (the label updates quietly). */
export function Countdown({ deadline, compact, onExpire, 'data-testid': testId }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const left = dareTimeLeft(deadline, now);

  useEffect(() => {
    if (left.expired) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [deadline, left.expired]);

  useEffect(() => {
    if (left.expired && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current?.();
    }
    if (!left.expired) expiredRef.current = false;
  }, [left.expired]);

  const urgency = left.expired ? 'ended' : left.ms < 10 * 60 * 1000 ? 'critical' : left.ms < 60 * 60 * 1000 ? 'soon' : 'normal';
  const text = left.expired ? 'Dare ended' : compact ? left.label : `Ends in ${longLabel(left.ms)}`;
  const aria = left.expired ? 'Dare ended' : `Dare ends in ${spoken(left.ms)}`;

  return (
    <span className={[s.countdown, compact ? s.compact : ''].filter(Boolean).join(' ')} role="timer" aria-live="off" aria-label={aria} data-urgency={urgency} data-testid={testId}>
      <HourglassIcon />
      <span className={s.text} aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
