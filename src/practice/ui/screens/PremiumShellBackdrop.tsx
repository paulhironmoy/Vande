import s from './PremiumShellBackdrop.module.css';

export interface PremiumShellBackdropProps {
  variant: 'home' | 'setup';
}

/**
 * The quiet, non-interactive cricket world behind Practice navigation. The source image is an optimised derivative of
 * the registered VANDE stadium asset; the foreground layers keep the shell continuous if that image is unavailable.
 * It never previews a delivery or carries information, so assistive technology can ignore it completely.
 */
export function PremiumShellBackdrop({ variant }: PremiumShellBackdropProps) {
  return (
    <div className={`${s.world} ${s[variant]}`} aria-hidden="true">
      <div className={s.stadium} />
      <div className={s.outfield} />
      <div className={s.pitch}>
        <span className={s.crease} />
        <span className={s.stumps} />
      </div>
      <div className={s.scrim} />
      <div className={s.grain} />
    </div>
  );
}
