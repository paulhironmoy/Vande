import styles from './SimulatedBand.module.css';

interface SimulatedBandProps {
  band: { low: number; high: number; typical: number };
  /** The player's own score, if any. */
  mine?: number;
}

export const SIMULATED_LABEL = 'Simulated range — not real players';

/** A clearly-labelled simulated comparison range. Never presents simulated scores as people. */
export function SimulatedBand({ band, mine }: SimulatedBandProps) {
  const low = Math.max(0, Math.min(100, Math.round(band.low)));
  const high = Math.max(low, Math.min(100, Math.round(band.high)));
  const typical = Math.max(low, Math.min(high, Math.round(band.typical)));
  const aria = `${SIMULATED_LABEL}. Low ${low}, typical ${typical}, high ${high}${mine !== undefined ? `. Your score ${Math.round(mine)}` : ''}.`;
  return (
    <figure className={styles.figure} aria-label={aria}>
      <div
        className={styles.track}
        aria-hidden="true"
        style={{
          ['--low' as string]: `${low}%`,
          ['--high' as string]: `${high}%`,
          ['--typical' as string]: `${typical}%`,
          ['--mine' as string]: `${mine !== undefined ? Math.round(mine) : 0}%`,
        }}
      >
        <span className={styles.range} />
        <span className={styles.typical} />
        {mine !== undefined && <span className={styles.mine}>You</span>}
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <span className={styles.swatchRange} />
          Simulated {low}–{high}
        </span>
        <span>
          <span className={styles.swatchTypical} />
          Typical <strong>{typical}</strong>
        </span>
        {mine !== undefined && (
          <span>
            <span className={styles.swatchMine} />
            You <strong>{Math.round(mine)}</strong>
          </span>
        )}
      </div>
      <figcaption className={styles.caption}>
        <strong>{SIMULATED_LABEL}.</strong> Generated locally from the day&apos;s seed so you can gauge your result. Nobody else&apos;s score is collected or shown.
      </figcaption>
    </figure>
  );
}
