import s from './PremiumShellBackdrop.module.css';

export interface PremiumShellBackdropProps {
  variant: 'home' | 'setup';
}

/**
 * The quiet, non-interactive cricket world behind Practice navigation. The image is the venue's hero plate (a capture of
 * the stage's own stadium, no players); the outfield and pitch shapes and the gradients under it keep the shell
 * continuous if the image is unavailable. It never previews a delivery or carries information, so assistive technology
 * can ignore it completely.
 */
export function PremiumShellBackdrop({ variant }: PremiumShellBackdropProps) {
  return (
    <div className={`${s.world} ${s[variant]}`} aria-hidden="true">
      {/* The fallback shapes come first so the plate paints over them when it has loaded. */}
      <div className={s.outfield} />
      <div className={s.pitch}>
        <span className={s.crease} />
        <span className={s.stumps} />
      </div>
      <div className={s.stadium} />
      <div className={s.scrim} />
      <div className={s.grain} />
    </div>
  );
}
