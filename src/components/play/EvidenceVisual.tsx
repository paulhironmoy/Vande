import type { EvidenceVisualType } from '@/engine/types';
import styles from './EvidenceVisual.module.css';

/** Abstract diagram standing in for a piece of evidence. Decorative; the caption carries the meaning. */
export function EvidenceVisual({ type, caption, size = 'thumb', className }: { type: EvidenceVisualType; caption: string; size?: 'thumb' | 'large'; className?: string }) {
  return (
    <figure className={[styles.figure, size === 'large' ? styles.large : styles.thumb, className ?? ''].filter(Boolean).join(' ')} data-type={type}>
      <svg viewBox="0 0 160 100" className={styles.svg} aria-hidden="true" focusable="false">
        <rect x="0" y="0" width="160" height="100" rx="8" className={styles.bg} />
        <Glyph type={type} />
      </svg>
      {size === 'large' ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}

function Glyph({ type }: { type: EvidenceVisualType }) {
  switch (type) {
    case 'photo':
      return (
        <g className={styles.ink}>
          <rect x="18" y="14" width="124" height="72" rx="4" className={styles.frame} />
          <circle cx="48" cy="38" r="8" className={styles.fill} />
          <path d="M22 82l34-30 26 22 18-14 38 22z" className={styles.fill} />
        </g>
      );
    case 'document':
      return (
        <g className={styles.ink}>
          <rect x="44" y="10" width="72" height="80" rx="4" className={styles.frame} />
          <path d="M56 28h48M56 40h48M56 52h36M56 64h44M56 76h24" />
          <path d="M100 10v14h16" />
        </g>
      );
    case 'recording':
      return (
        <g className={styles.ink}>
          <path d="M10 50h12l6-18 8 36 8-48 8 56 8-40 8 24 8-14 8 10 8-6 8 4 8-2 8 1h20" className={styles.wave} />
          <path d="M10 50h140" className={styles.axis} />
        </g>
      );
    case 'message':
      return (
        <g className={styles.ink}>
          <path d="M20 20h72a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H40l-14 10V54h-6a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6z" className={styles.frame} />
          <path d="M30 32h50M30 42h34" />
          <path d="M68 56h66a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-6v10l-14-10H68a6 6 0 0 1-6-6V62a6 6 0 0 1 6-6z" className={styles.frameAlt} />
          <path d="M76 68h50M76 78h30" />
        </g>
      );
    case 'chart':
      return (
        <g className={styles.ink}>
          <path d="M20 84h120M20 84V16" className={styles.axis} />
          <rect x="34" y="52" width="14" height="32" className={styles.fill} />
          <rect x="58" y="36" width="14" height="48" className={styles.fill} />
          <rect x="82" y="60" width="14" height="24" className={styles.fill} />
          <rect x="106" y="24" width="14" height="60" className={styles.fillAlt} />
          <path d="M26 70l27-18 24 20 24-34 26 10" className={styles.wave} />
        </g>
      );
    case 'map':
      return (
        <g className={styles.ink}>
          <path d="M10 20h140M10 50h140M10 80h140M40 10v80M80 10v80M120 10v80" className={styles.grid} />
          <path d="M20 70 Q60 40 100 60 T150 30" className={styles.wave} />
          <circle cx="100" cy="60" r="6" className={styles.fillAlt} />
          <circle cx="100" cy="60" r="14" className={styles.frameAlt} />
        </g>
      );
    case 'ledger':
      return (
        <g className={styles.ink}>
          <rect x="16" y="14" width="128" height="72" rx="4" className={styles.frame} />
          <path d="M16 32h128M16 50h128M16 68h128M56 14v72M100 14v72" />
          <path d="M24 42h22M64 42h26M108 42h26M24 60h22M64 60h26M108 60h26M24 78h22M64 78h26M108 78h26" className={styles.grid} />
        </g>
      );
    case 'video':
      return (
        <g className={styles.ink}>
          <rect x="18" y="14" width="124" height="72" rx="6" className={styles.frame} />
          <path d="M70 34l28 16-28 16z" className={styles.fill} />
          <path d="M26 78h108" className={styles.axis} />
          <circle cx="60" cy="78" r="4" className={styles.fillAlt} />
        </g>
      );
  }
}
