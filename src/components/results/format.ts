import type { Dimension, RepublicOutcome, Scores } from '@/engine/types';
import { DIMENSIONS } from '@/engine/types';

export function formatScore(n: number): string {
  return String(Math.round(Math.max(0, Math.min(100, n))));
}

export function formatDateLong(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** YYYY-MM-DD (local) → Date at local midnight. */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatMinutes(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function approxMinutesLabel(ms: number): string {
  const minutes = ms / 60000;
  if (minutes < 1.25) return 'About a minute';
  const rounded = Math.round(minutes * 2) / 2;
  return `About ${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} minutes`;
}

export const DIMENSION_SHORT: Record<Dimension, string> = {
  freedom: 'Freedom',
  grievance: 'Grievance',
  safety: 'Safety',
  evidence: 'Evidence',
  trust: 'Trust',
  economy: 'Economy',
};

/** CSS custom property that colours a dimension. */
export function dimensionColorVar(dim: Dimension): string {
  switch (dim) {
    case 'freedom':
      return 'var(--o-freedom)';
    case 'grievance':
      return 'var(--o-grievance)';
    case 'safety':
      return 'var(--o-safety)';
    case 'evidence':
      return 'var(--o-evidence)';
    case 'trust':
      return 'var(--o-trust)';
    case 'economy':
      return 'var(--o-economy)';
  }
}

export function meanScore(scores: Scores): number {
  return DIMENSIONS.reduce((acc, d) => acc + scores[d], 0) / DIMENSIONS.length;
}

export function weakestDimension(scores: Scores): Dimension {
  return DIMENSIONS.reduce((w, d) => (scores[d] < scores[w] ? d : w), DIMENSIONS[0]);
}

export function strongestDimension(scores: Scores): Dimension {
  return DIMENSIONS.reduce((w, d) => (scores[d] > scores[w] ? d : w), DIMENSIONS[0]);
}

export type ScoreBand = 'strong' | 'steady' | 'strained' | 'critical';

export function scoreBand(score: number): ScoreBand {
  if (score >= 75) return 'strong';
  if (score >= 55) return 'steady';
  if (score >= 40) return 'strained';
  return 'critical';
}

export const OUTCOME_DESCRIPTIONS: Record<RepublicOutcome, string> = {
  resilient:
    'Grievances were heard, the evidence held and the streets stayed safe without silencing anyone. Institutions came out of the crisis stronger than they went in.',
  'free-fragile':
    'Freedoms were protected, but safety and services frayed. People could speak, and many did, yet too many did not feel safe doing so.',
  'order-without-trust':
    'Order was kept, but at the cost of rights and public confidence. Quiet streets hid a Republic that had stopped believing its institutions.',
  manipulated:
    'Fabricated evidence shaped real decisions. The Republic acted on claims that were never true, and people noticed.',
  'institutionally-weakened':
    'Grievances went unresolved and trust drained away from institutions. The next crisis will start from a weaker place.',
  'economically-disrupted':
    'Shops, transport and public services took the hit. The city kept paying for the crisis long after the crowds went home.',
};

export const OUTCOME_TONE: Record<RepublicOutcome, 'good' | 'mixed' | 'poor'> = {
  resilient: 'good',
  'free-fragile': 'mixed',
  'order-without-trust': 'mixed',
  manipulated: 'poor',
  'institutionally-weakened': 'poor',
  'economically-disrupted': 'mixed',
};

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type }), filename);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
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

/** Local YYYY-MM-DD for an ISO timestamp (or now). */
export function localDateKey(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
