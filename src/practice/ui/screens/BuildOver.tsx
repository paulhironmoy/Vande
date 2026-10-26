/**
 * Build an Over: one bowler (pace or spin) for the whole over; for each of the six balls, tap a target on the pitch
 * map and pick a delivery, then save it into a slot. Exact order or a one-time shuffle; any ball can be edited or
 * replaced before the over starts. Pace band, spin type and arm are behind "More bowler options". The game module
 * clamps targets to the legal area, chooses the honest speed and validates the over.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, ScreenShell, SegmentedControl } from '@/ui';
import type { AssistLevel, BowlerFamily, DeliveryVariation, Handedness, PaceBand, PracticeOverPlan, SpinType } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { emptyDraft, loadDraft, saveDraft, type BuildDraft, type DraftBall } from '@/practice/store';
import { useKit } from '../context';
import { variationKey } from './Summaries';
import { PitchMap, targetWords, type Target } from './PitchMap';
import s from './BuildOver.module.css';

export interface BuildOverProps {
  assist: AssistLevel;
  handedness: Handedness;
  /** Building the next over of an innings in progress (vs. a new innings). */
  nextOver: boolean;
  onStart: (plan: PracticeOverPlan) => void;
  onBack: () => void;
  /** A fresh over seed (shuffle and the bowler's look). */
  seed: () => string;
}

const DEFAULT_TARGET: Record<BowlerFamily, Target> = { pace: { lineM: 0.15, lengthM: 5.8 }, spin: { lineM: 0.1, lengthM: 4 } };

function firstEmpty(d: BuildDraft): number {
  const i = d.balls.findIndex((b) => b === null);
  return i < 0 ? 0 : i;
}

export function BuildOver({ assist, handedness, nextOver, onStart, onBack, seed }: BuildOverProps) {
  const t = usePracticeT();
  const { build } = useKit();
  const [draft, setDraft] = useState<BuildDraft>(() => loadDraft() ?? emptyDraft());
  const [sel, setSel] = useState(() => firstEmpty(draft));
  const [target, setTarget] = useState<Target>(() => draft.balls[sel] ?? DEFAULT_TARGET[draft.family]);
  const [variation, setVariation] = useState<DeliveryVariation>(() => draft.balls[sel]?.variation ?? 'stock');
  const [more, setMore] = useState(false);
  const [askFamily, setAskFamily] = useState<BowlerFamily | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => saveDraft(draft), [draft]);

  const spinType: SpinType | undefined = draft.family === 'spin' ? draft.spinType : undefined;
  const variations = useMemo(() => build.variationsFor(draft.family, spinType), [build, draft.family, spinType]);
  const varName = (v: DeliveryVariation) => t.tk(`practice.var.${variationKey(v, spinType)}`);
  const ballOpts = { family: draft.family, paceBand: draft.family === 'pace' ? draft.paceBand : undefined, spinType, assist };
  const preview = useMemo(() => {
    try {
      return build.buildBall({ ...ballOpts, target, variation });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, draft.family, draft.paceBand, spinType, assist, target, variation]);

  const select = (i: number) => {
    setSel(i);
    const b = draft.balls[i];
    if (b) {
      setTarget({ lineM: b.lineM, lengthM: b.lengthM });
      setVariation(b.variation);
    }
    setSaved(null);
  };

  const applyFamily = (family: BowlerFamily) => {
    const next = { ...emptyDraft(family), paceBand: draft.paceBand, spinType: draft.spinType, arm: draft.arm, order: draft.order };
    setDraft(next);
    setSel(0);
    setTarget(DEFAULT_TARGET[family]);
    setVariation('stock');
    setError(null);
  };

  const changeFamily = (family: BowlerFamily) => {
    if (family === draft.family) return;
    if (draft.balls.some(Boolean)) setAskFamily(family);
    else applyFamily(family);
  };

  const changeSpin = (st: SpinType) => {
    const list = build.variationsFor('spin', st);
    setDraft({ ...draft, spinType: st, balls: draft.balls.map((b) => (b && list.includes(b.variation) ? b : null)) });
    if (!list.includes(variation)) setVariation('stock');
  };

  const save = () => {
    // The plan's target is what the game clamped it to (a bouncer pitches short, a yorker full).
    const p = preview;
    const ball: DraftBall = { lineM: p?.lineM ?? target.lineM, lengthM: p?.lengthM ?? target.lengthM, variation };
    const balls = [...draft.balls];
    balls[sel] = ball;
    const next = { ...draft, balls };
    setDraft(next);
    setSaved(sel);
    setError(null);
    const empty = next.balls.findIndex((b) => b === null);
    if (empty >= 0) {
      setSel(empty);
      setTarget({ lineM: ball.lineM, lengthM: ball.lengthM });
      setVariation('stock');
    }
  };

  const missing = draft.balls.filter((b) => b === null).length;

  const start = () => {
    if (missing) return;
    try {
      const overSeed = seed();
      const plans = draft.balls.map((b) => build.buildBall({ ...ballOpts, target: { lineM: b!.lineM, lengthM: b!.lengthM }, variation: b!.variation }));
      const bowler = build.bowlerFor({ family: draft.family, paceBand: ballOpts.paceBand, spinType, arm: draft.arm, seed: overSeed });
      const plan = build.buildOver({ bowler, balls: plans, shuffle: draft.order === 'shuffle', seed: overSeed });
      const v = build.validateOver(plan);
      if (!v.ok) {
        setError(errorText(v.errors));
        return;
      }
      onStart(plan);
    } catch (e) {
      setError(errorText(String((e as Error)?.message ?? e).match(/\(([^)]*)\)/)?.[1]?.split(', ') ?? []));
    }
  };

  const errorText = (codes: string[]) => {
    if (codes.includes('too_many_bouncers')) return t.t('practice.build.invalid', { reason: t.t('practice.build.err.bouncers') });
    const ball = codes.map((c) => /^ball(\d)/.exec(c)?.[1]).find(Boolean);
    if (ball !== undefined) return t.t('practice.build.invalid', { reason: t.t('practice.build.err.ball', { n: Number(ball) + 1 }) });
    return t.t('practice.build.invalid', { reason: t.t('practice.build.err.other') });
  };

  const slotDesc = (b: DraftBall | null) => (b ? `${varName(b.variation)} · ${t.tk(`practice.length.${build.lengthBand(b.lengthM, draft.family)}`)}` : t.t('practice.build.slot_empty'));

  return (
    <ScreenShell
      eyebrow={nextOver ? t.t('practice.over.next_build') : t.t('practice.menu.eyebrow')}
      title={t.t('practice.build.title')}
      onBack={onBack}
      backLabel={t.t('practice.common.back')}
      narrow
      testId="practice-build-screen"
      contentClassName={s.content}
      footer={
        <div className={s.footer}>
          {error && (
            <p className={s.error} role="alert" data-testid="practice-build-error">
              {error}
            </p>
          )}
          <p className={s.hint} aria-live="polite">
            {missing ? t.t('practice.build.need_all', { count: missing }) : t.t('practice.build.locked_note')}
          </p>
          <Button variant="accent" size="lg" block disabled={missing > 0} onClick={start} data-testid="practice-build-start">
            {t.t('practice.build.start')}
          </Button>
        </div>
      }
    >
      <p className={s.intro}>{t.t('practice.build.intro')}</p>
      <section className={s.section}>
        <h2>{t.t('practice.build.bowler')}</h2>
        <SegmentedControl
          label={t.t('practice.build.bowler')}
          value={draft.family}
          onChange={changeFamily}
          options={[
            { value: 'pace', label: t.t('practice.bowler.pace') },
            { value: 'spin', label: t.t('practice.bowler.spin') },
          ]}
          block
          testId="practice-build-family"
        />
        <Button variant="link" iconEnd={more ? 'chevron-up' : 'chevron-down'} aria-expanded={more} onClick={() => setMore((m) => !m)} data-testid="practice-build-more">
          {more ? t.t('practice.build.fewer') : t.t('practice.build.more')}
        </Button>
        {more && (
          <div className={s.section}>
            {draft.family === 'pace' ? (
              <SegmentedControl
                label={t.t('practice.build.pace_band')}
                value={draft.paceBand}
                onChange={(v: PaceBand) => setDraft({ ...draft, paceBand: v })}
                options={(['controlled', 'fast', 'express'] as PaceBand[]).map((v) => ({ value: v, label: t.tk(`practice.build.band.${v}`), description: t.tk(`practice.build.band.${v}_hint`) }))}
                block
                testId="practice-build-band"
              />
            ) : (
              <SegmentedControl
                label={t.t('practice.build.spin_type')}
                value={draft.spinType}
                onChange={changeSpin}
                options={(['finger', 'wrist'] as SpinType[]).map((v) => ({ value: v, label: t.tk(`practice.build.spin.${v}`), description: t.tk(`practice.build.spin.${v}_hint`) }))}
                block
                testId="practice-build-spin"
              />
            )}
            <SegmentedControl
              label={t.t('practice.build.arm')}
              value={draft.arm}
              onChange={(v: 'right' | 'left') => setDraft({ ...draft, arm: v })}
              options={[
                { value: 'right', label: t.t('practice.build.arm.right') },
                { value: 'left', label: t.t('practice.build.arm.left') },
              ]}
              block
              testId="practice-build-arm"
            />
          </div>
        )}
      </section>

      <section className={s.section}>
        <h2>{t.t('practice.build.slots')}</h2>
        <ol className={s.slots}>
          {draft.balls.map((b, i) => (
            <li key={i}>
              <button type="button" className={s.slot} aria-pressed={i === sel} data-empty={b ? 'false' : 'true'} onClick={() => select(i)} aria-label={t.t('practice.build.slot_label', { n: i + 1, desc: slotDesc(b) })} data-testid={`practice-slot-${i + 1}`}>
                <span className={s.slotN}>{t.t('practice.common.ball_n', { n: i + 1 })}</span>
                <span className={s.slotName}>{slotDesc(b)}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className={s.section} aria-labelledby="practice-editing">
        <h2 id="practice-editing">{t.t('practice.build.editing', { n: sel + 1 })}</h2>
        <div className={s.editor}>
          <div className={s.section}>
            <p className={s.hint}>{t.t('practice.build.map')}</p>
            <PitchMap build={build} family={draft.family} handedness={handedness} target={target} ballNumber={sel + 1} onChange={setTarget} />
          </div>
          <div className={s.side}>
            <p className={s.targetText} aria-live="polite" data-testid="practice-target-words">
              {targetWords(t, build, draft.family, target)}
            </p>
            <SegmentedControl
              label={t.t('practice.build.delivery')}
              value={variation}
              onChange={setVariation}
              options={variations.map((v) => ({ value: v, label: varName(v), description: more ? t.tk(`practice.var.${variationKey(v, spinType)}_hint`) : undefined }))}
              testId="practice-build-variation"
            />
            {!more && <p className={s.hint}>{t.tk(`practice.var.${variationKey(variation, spinType)}_hint`)}</p>}
            {preview && <p className={s.hint}>{t.t('practice.build.speed', { kph: Math.round(preview.speedKph) })}</p>}
            <div className={s.row}>
              <Button variant="primary" onClick={save} data-testid="practice-build-save">
                {t.t('practice.build.save', { n: sel + 1 })}
              </Button>
              {saved !== null && (
                <span className={s.hint} role="status">
                  {t.t('practice.build.saved', { n: saved + 1 })}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={s.section}>
        <h2>{t.t('practice.build.order')}</h2>
        <SegmentedControl
          label={t.t('practice.build.order')}
          value={draft.order}
          onChange={(v: 'exact' | 'shuffle') => setDraft({ ...draft, order: v })}
          options={[
            { value: 'exact', label: t.t('practice.build.exact') },
            { value: 'shuffle', label: t.t('practice.build.shuffle') },
          ]}
          block
          testId="practice-build-order"
        />
        {draft.order === 'shuffle' && <p className={s.hint}>{t.t('practice.build.shuffle_hint')}</p>}
        <Button variant="link" icon="trash" onClick={() => applyFamily(draft.family)} disabled={!draft.balls.some(Boolean)} data-testid="practice-build-clear">
          {t.t('practice.build.clear')}
        </Button>
      </section>

      <Dialog
        open={askFamily !== null}
        title={t.t('practice.build.family_title')}
        description={t.t('practice.build.family_body')}
        confirmLabel={t.t('practice.build.family_confirm')}
        cancelLabel={t.t('practice.common.cancel')}
        onCancel={() => setAskFamily(null)}
        onConfirm={() => {
          if (askFamily) applyFamily(askFamily);
          setAskFamily(null);
        }}
        testId="practice-build-family-dialog"
      />
    </ScreenShell>
  );
}
