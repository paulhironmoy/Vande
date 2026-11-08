/**
 * One ball of a predefined over: the pitch map sets its line and length in one tap; the pace band (pace bowlers) and
 * the delivery (movement and variation, shown only when asked) complete it. Copy, reorder and clear act on this ball.
 */
import { useMemo } from 'react';
import type { AssistLevel, BowlerFamily, DeliveryVariation, Handedness, PaceBand, SpinType } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import type { DraftBall } from '@/practice/store';
import { PButton, PDisclosure, PSegmented, sys } from '../design';
import { useKit } from '../context';
import { variationKey } from '../coaching';
import { PitchMap, targetWords, type Target } from './PitchMap';
import s from './Predefined.module.css';

export interface BallEditorProps {
  index: number;
  ball: DraftBall | null;
  family: BowlerFamily;
  spinType: SpinType;
  /** The band and delivery a new ball starts with (the last ones used). */
  defaults: { paceBand: PaceBand; variation: DeliveryVariation; target: Target };
  assist: AssistLevel;
  handedness: Handedness;
  canCopy: boolean;
  onChange: (ball: DraftBall) => void;
  /** An empty ball: a pace band or delivery chosen first only sets up the coming ball (the pitch tap creates it). */
  onDefaults: (patch: { paceBand?: PaceBand; variation?: DeliveryVariation }) => void;
  onCopy: () => void;
  onMove: (dir: -1 | 1) => void;
  onClear: () => void;
}

export function BallEditor(p: BallEditorProps) {
  const t = usePracticeT();
  const { build } = useKit();
  const target: Target = p.ball ?? p.defaults.target;
  const variation = p.ball?.variation ?? p.defaults.variation;
  const band = p.ball?.paceBand ?? p.defaults.paceBand;
  const spin = p.family === 'spin' ? p.spinType : undefined;
  const variations = useMemo(() => build.variationsFor(p.family, spin), [build, p.family, spin]);
  const name = (v: DeliveryVariation) => t.tk(`practice.var.${variationKey(v, spin)}`);
  const preview = useMemo(() => {
    try {
      return build.buildBall({
        family: p.family,
        target,
        variation,
        paceBand: p.family === 'pace' ? band : undefined,
        spinType: spin,
        assist: p.assist,
      });
    } catch {
      return null;
    }
  }, [build, p.family, target, variation, band, spin, p.assist]);
  // The plan's target is what the game clamped it to (a bouncer pitches short, a yorker full).
  const commit = (next: Partial<DraftBall>) => {
    const merged = {
      lineM: target.lineM,
      lengthM: target.lengthM,
      variation,
      ...(p.family === 'pace' ? { paceBand: band } : {}),
      ...next,
    };
    let lineM = merged.lineM;
    let lengthM = merged.lengthM;
    try {
      const plan = build.buildBall({
        family: p.family,
        target: { lineM, lengthM },
        variation: merged.variation,
        paceBand: merged.paceBand,
        spinType: spin,
        assist: p.assist,
      });
      lineM = plan.lineM;
      lengthM = plan.lengthM;
    } catch {
      /* the game rejects it at Continue with its reason */
    }
    p.onChange({ ...merged, lineM, lengthM });
  };
  return (
    <section className={s.editor} aria-labelledby="practice-editing">
      <PitchMap
        build={build}
        family={p.family}
        handedness={p.handedness}
        target={target}
        ballNumber={p.index + 1}
        onChange={(tg) => commit({ lineM: tg.lineM, lengthM: tg.lengthM })}
      />
      <div className={s.side}>
        <h2 id="practice-editing" className={sys.section}>
          {t.t('practice.build.editing', { n: p.index + 1 })}
        </h2>
        <p className={s.target} aria-live="polite" data-testid="practice-target-words">
          {p.ball ? targetWords(t, build, p.family, target) : t.t('practice.build.map')}
        </p>
        {p.family === 'pace' && (
          <PSegmented
            label={t.t('practice.build.pace_band')}
            value={band}
            onChange={(v: PaceBand) => (p.ball ? commit({ paceBand: v }) : p.onDefaults({ paceBand: v }))}
            options={(['controlled', 'fast', 'express'] as PaceBand[]).map((v) => ({
              value: v,
              label: t.tk(`practice.build.band.${v}`),
            }))}
            testId="practice-build-band"
          />
        )}
        <PDisclosure
          label={t.t('practice.build.delivery_value', { delivery: name(variation) })}
          testId="practice-build-delivery"
        >
          <PSegmented
            label={t.t('practice.build.delivery')}
            value={variation}
            onChange={(v: DeliveryVariation) => (p.ball ? commit({ variation: v }) : p.onDefaults({ variation: v }))}
            options={variations.map((v) => ({
              value: v,
              label: name(v),
              description: t.tk(`practice.var.${variationKey(v, spin)}_hint`),
            }))}
            testId="practice-build-variation"
          />
        </PDisclosure>
        {preview && <p className={sys.caption}>{t.t('practice.build.speed', { kph: Math.round(preview.speedKph) })}</p>}
        {p.ball && (
          <div className={s.actions}>
            <PButton
              variant="quiet"
              icon="copy"
              onClick={p.onCopy}
              disabled={!p.canCopy}
              data-testid="practice-ball-copy"
            >
              {t.t('practice.build.copy')}
            </PButton>
            <PButton
              variant="quiet"
              icon="back"
              onClick={() => p.onMove(-1)}
              disabled={p.index === 0}
              data-testid="practice-ball-earlier"
            >
              {t.t('practice.build.earlier')}
            </PButton>
            <PButton
              variant="quiet"
              iconEnd="forward"
              onClick={() => p.onMove(1)}
              disabled={p.index === 5}
              data-testid="practice-ball-later"
            >
              {t.t('practice.build.later')}
            </PButton>
            <PButton variant="quiet" icon="trash" onClick={p.onClear} data-testid="practice-ball-clear">
              {t.t('practice.build.clear_ball')}
            </PButton>
          </div>
        )}
      </div>
    </section>
  );
}
