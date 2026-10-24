import styles from './Stars.module.css';

interface StarsProps {
  count: 0 | 1 | 2 | 3;
  size?: number;
  className?: string;
  /** Visible caption under the stars (optional). */
  caption?: string;
}

/** Three stars with a text alternative — used by the Simple play style on results. */
export function Stars({ count, size = 28, className, caption }: StarsProps) {
  const label = `${count} of 3 stars`;
  return (
    <div className={[styles.wrap, className ?? ''].join(' ')} role="img" aria-label={caption ? `${label}. ${caption}` : label}>
      <span className={styles.row} aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <svg key={i} viewBox="0 0 24 24" width={size} height={size} className={[styles.star, i <= count ? styles.on : styles.off].join(' ')} style={{ ['--i' as string]: i }}>
            <path d="M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6L2.5 9.5l6.6-.8z" />
          </svg>
        ))}
      </span>
      {caption && (
        <span className={styles.caption} aria-hidden="true">
          {caption}
        </span>
      )}
    </div>
  );
}
