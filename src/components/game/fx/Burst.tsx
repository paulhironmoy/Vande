import { prefersReducedMotion } from './motion';
import s from './Burst.module.css';

export interface BurstProps {
  tone?: 'good' | 'great' | 'bad';
  /** Change this number to replay the burst; values ≤ 0 render nothing (no burst on first mount). */
  trigger: number;
}

const RAYS = Array.from({ length: 10 }, (_, i) => i * 36);

/**
 * Radial glow ring with ten light rays that expands and fades in 600 ms. Position it inside a
 * `position: relative` parent; it fills the parent and never intercepts pointer events. Reduced motion: nothing.
 */
export function Burst({ tone = 'good', trigger }: BurstProps) {
  if (trigger <= 0 || prefersReducedMotion()) return <></>;
  return (
    <span key={trigger} className={s.burst} data-tone={tone} aria-hidden="true">
      <span className={s.glow} />
      <span className={s.ring} />
      {RAYS.map((deg) => (
        <span key={deg} className={s.ray} style={{ ['--a' as string]: `${deg}deg` }} />
      ))}
    </span>
  );
}
