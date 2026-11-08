/**
 * Predefined Over: choose the six deliveries to master. The reference over (the benchmark: full outswinger,
 * inswinger at the stumps, hard length, cutter, bouncer, yorker) is the first, recommended choice; "Your own six" is
 * a fast visual sequence: one bowler for the over, then a tap on the pitch map per ball (its pace band and delivery
 * carry forward), with copy, reorder and clear. The finished over shows as six compact chips.
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  AssistLevel,
  BowlerFamily,
  DeliveryVariation,
  Handedness,
  PaceBand,
  PitchCondition,
  PracticeOverPlan,
  SpinType,
} from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { emptyDraft, loadDraft, saveDraft, type BuildDraft, type DraftBall } from '@/practice/store';
import { PButton, PSegmented, Screen, sys } from '../design';
import { useKit } from '../context';
import { variationKey } from '../coaching';
import { BallEditor } from './BallEditor';
import { planFromDraft } from './buildPlan';
import type { Target } from './PitchMap';
import s from './Predefined.module.css';

export interface PredefinedProps {
  assist: AssistLevel;
  handedness: Handedness;
  /** The pitch (the innings' own, between overs). */
  conditions: PitchCondition;
  seed: () => string;
  onReference: () => void;
  onOwn: (plan: PracticeOverPlan) => void;
  onBack: () => void;
}

const START: Record<BowlerFamily, Target> = { pace: { lineM: 0.15, lengthM: 5.8 }, spin: { lineM: 0.1, lengthM: 4 } };
export function Predefined(p: PredefinedProps) {
  const t = usePracticeT();
  const { build, engine } = useKit();
  const [draft, setDraft] = useState<BuildDraft>(() => loadDraft() ?? emptyDraft());
  const [mode, setMode] = useState<'reference' | 'own'>(() => (draft.balls.some(Boolean) ? 'own' : 'reference'));
  const [sel, setSel] = useState(() =>
    Math.max(
      0,
      draft.balls.findIndex((b) => b === null),
    ),
  );
  const [refSel, setRefSel] = useState(0);
  const [defaults, setDefaults] = useState<{ paceBand: PaceBand; variation: DeliveryVariation; target: Target }>({
    paceBand: draft.paceBand,
    variation: 'stock',
    target: START[draft.family],
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => saveDraft(draft), [draft]);
  const reference = useMemo(() => ({ plan: engine.referenceOver(), balls: engine.referenceBalls() }), [engine]);
  const spin: SpinType | undefined = draft.family === 'spin' ? draft.spinType : undefined;
  const missing = draft.balls.filter((b) => b === null).length;

  const setBalls = (balls: Array<DraftBall | null>) => setDraft({ ...draft, balls });
  const change = (i: number, ball: DraftBall) => {
    const wasEmpty = draft.balls[i] === null;
    const balls = [...draft.balls];
    balls[i] = ball;
    setBalls(balls);
    setDefaults({
      paceBand: ball.paceBand ?? defaults.paceBand,
      variation: ball.variation,
      target: { lineM: ball.lineM, lengthM: ball.lengthM },
    });
    setError(null);
    // The sequence moves on by itself: a new ball selects the next empty one.
    if (wasEmpty) {
      const next = balls.findIndex((b, j) => b === null && j > i);
      const any = balls.findIndex((b) => b === null);
      if (next >= 0 || any >= 0) setSel(next >= 0 ? next : any);
    }
  };
  const copy = (i: number) => {
    const target = draft.balls.findIndex((b, j) => b === null && j > i);
    const j = target >= 0 ? target : draft.balls.findIndex((b) => b === null);
    if (j < 0 || !draft.balls[i]) return;
    const balls = [...draft.balls];
    balls[j] = { ...draft.balls[i]! };
    setBalls(balls);
    setSel(j);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j > 5) return;
    const balls = [...draft.balls];
    [balls[i], balls[j]] = [balls[j], balls[i]];
    setBalls(balls);
    setSel(j);
  };
  const family = (f: BowlerFamily) => {
    if (f === draft.family) return;
    // One bowler bowls the whole over: a different kind of bowler starts the six again.
    setDraft({
      ...emptyDraft(f),
      arm: draft.arm,
      paceBand: draft.paceBand,
      spinType: draft.spinType,
      order: draft.order,
    });
    setDefaults({ paceBand: draft.paceBand, variation: 'stock', target: START[f] });
    setSel(0);
  };
  const changeSpin = (st: SpinType) => {
    const list = build.variationsFor('spin', st);
    setDraft({
      ...draft,
      spinType: st,
      balls: draft.balls.map((b) => (b && list.includes(b.variation) ? b : b ? { ...b, variation: 'stock' } : null)),
    });
  };
  const copyReference = () => {
    const balls = reference.plan.balls.map((b) => ({
      lineM: b.lineM,
      lengthM: b.lengthM,
      variation: b.variation,
      paceBand: reference.plan.bowler.paceBand ?? 'fast',
    }));
    setDraft({
      ...emptyDraft('pace'),
      arm: reference.plan.bowler.arm,
      paceBand: reference.plan.bowler.paceBand ?? 'fast',
      balls,
      order: 'exact',
    });
    setMode('own');
    setSel(0);
  };

  const start = () => {
    if (mode === 'reference') {
      p.onReference();
      return;
    }
    if (missing) return;
    try {
      const plan = planFromDraft(build, draft, { assist: p.assist, conditions: p.conditions, seed: p.seed() });
      const v = build.validateOver(plan);
      if (!v.ok) {
        setError(errorText(v.errors));
        return;
      }
      p.onOwn(plan);
    } catch (e) {
      setError(
        errorText(
          String((e as Error)?.message ?? e)
            .match(/\(([^)]*)\)/)?.[1]
            ?.split(', ') ?? [],
        ),
      );
    }
  };
  const errorText = (codes: string[]) => {
    if (codes.includes('too_many_bouncers'))
      return t.t('practice.build.invalid', { reason: t.t('practice.build.err.bouncers', { n: build.maxBouncers }) });
    const ball = codes.map((c) => /^ball(\d)/.exec(c)?.[1]).find(Boolean);
    if (ball !== undefined)
      return t.t('practice.build.invalid', { reason: t.t('practice.build.err.ball', { n: Number(ball) + 1 }) });
    return t.t('practice.build.invalid', { reason: t.t('practice.build.err.other') });
  };
  const style = t.t('practice.build.chip_style', { arm: draft.arm, family: draft.family });
  const lineOf = (b: { lineM: number }) => t.tk(`practice.lineband.${build.lineBand(b.lineM)}`);
  const lengthOf = (b: { lengthM: number }, f: BowlerFamily) =>
    t.tk(`practice.length.${build.lengthBand(b.lengthM, f)}`);

  return (
    <Screen
      title={t.t('practice.build.title')}
      onBack={p.onBack}
      testId="practice-build-screen"
      wide
      footer={
        <>
          {error && (
            <p className={s.error} role="alert" data-testid="practice-build-error">
              {error}
            </p>
          )}
          {mode === 'own' && (
            <p className={sys.caption} aria-live="polite">
              {missing ? t.t('practice.build.need_all', { count: missing }) : t.t('practice.build.locked_note')}
            </p>
          )}
          <PButton
            variant="primary"
            size="lg"
            block
            disabled={mode === 'own' && missing > 0}
            onClick={start}
            data-testid="practice-build-start"
          >
            {t.t('practice.build.continue')}
          </PButton>
        </>
      }
    >
      <PSegmented
        label={t.t('practice.build.mode')}
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'reference',
            label: t.t('practice.build.mode.reference'),
            description: t.t('practice.build.mode.reference_hint'),
          },
          { value: 'own', label: t.t('practice.build.mode.own'), description: t.t('practice.build.mode.own_hint') },
        ]}
        testId="practice-build-mode"
      />
      {mode === 'reference' ? (
        <section className={sys.stack} data-testid="practice-reference">
          <p className={sys.body}>{t.t('practice.build.reference_body')}</p>
          <ol className={s.chips} aria-label={t.t('practice.build.slots')}>
            {reference.balls.map((b, i) => {
              const plan = reference.plan.balls[i];
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    className={s.chip}
                    aria-pressed={i === refSel}
                    onClick={() => setRefSel(i)}
                    data-testid={`practice-ref-${i + 1}`}
                  >
                    <span className={s.chipN}>{t.t('practice.common.ball_n', { n: i + 1 })}</span>
                    <span className={s.chipMain}>{t.tk(`practice.ref.name.${b.id}`)}</span>
                    <span>{t.t('practice.build.speed', { kph: Math.round(plan.speedKph) })}</span>
                    <span className={s.chipStyle}>
                      {t.t('practice.build.chip_style', { arm: reference.plan.bowler.arm, family: 'pace' })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className={sys.body} aria-live="polite" data-testid="practice-ref-objective">
            <strong>{t.tk(`practice.ref.name.${reference.balls[refSel].id}`)}: </strong>
            {t.tk(`practice.objective.${reference.balls[refSel].objective}`)}
          </p>
          <div>
            <PButton variant="quiet" icon="copy" onClick={copyReference} data-testid="practice-ref-copy">
              {t.t('practice.build.reference_copy')}
            </PButton>
          </div>
        </section>
      ) : (
        <>
          <section className={sys.stackTight}>
            <h2 className={sys.section}>{t.t('practice.build.bowler')}</h2>
            <div className={sys.row}>
              <PSegmented
                label={t.t('practice.build.bowler')}
                value={draft.family}
                onChange={family}
                options={(['pace', 'spin'] as BowlerFamily[]).map((v) => ({
                  value: v,
                  label: t.tk(`practice.bowler.${v}`),
                }))}
                testId="practice-build-family"
              />
              <PSegmented
                label={t.t('practice.build.arm')}
                value={draft.arm}
                onChange={(v: 'right' | 'left') => setDraft({ ...draft, arm: v })}
                options={(['right', 'left'] as const).map((v) => ({
                  value: v,
                  label: t.tk(`practice.build.arm.${v}`),
                }))}
                testId="practice-build-arm"
              />
              {draft.family === 'spin' && (
                <PSegmented
                  label={t.t('practice.build.spin_type')}
                  value={draft.spinType}
                  onChange={changeSpin}
                  options={(['finger', 'wrist'] as SpinType[]).map((v) => ({
                    value: v,
                    label: t.tk(`practice.build.spin.${v}`),
                    description: t.tk(`practice.build.spin.${v}_hint`),
                  }))}
                  testId="practice-build-spin"
                />
              )}
            </div>
          </section>
          <ol className={s.chips} aria-label={t.t('practice.build.slots')}>
            {draft.balls.map((b, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={s.chip}
                  aria-pressed={i === sel}
                  data-empty={b ? 'false' : 'true'}
                  onClick={() => setSel(i)}
                  data-testid={`practice-slot-${i + 1}`}
                >
                  <span className={s.chipN}>{t.t('practice.common.ball_n', { n: i + 1 })}</span>
                  {b ? (
                    <>
                      <span className={s.chipMain}>
                        {draft.family === 'pace'
                          ? t.tk(`practice.build.band.${b.paceBand ?? draft.paceBand}`)
                          : t.tk(`practice.var.${variationKey(b.variation, spin)}`)}
                      </span>
                      <span>{lengthOf(b, draft.family)}</span>
                      <span>{lineOf(b)}</span>
                      {draft.family === 'pace' && b.variation !== 'stock' && (
                        <span>{t.tk(`practice.var.${b.variation}`)}</span>
                      )}
                    </>
                  ) : (
                    <span>{t.t('practice.build.slot_empty')}</span>
                  )}
                  <span className={s.chipStyle}>{style}</span>
                </button>
              </li>
            ))}
          </ol>
          <BallEditor
            index={sel}
            ball={draft.balls[sel]}
            family={draft.family}
            spinType={draft.spinType}
            defaults={defaults}
            assist={p.assist}
            handedness={p.handedness}
            canCopy={draft.balls.some((b, j) => b === null && j !== sel)}
            onChange={(b) => change(sel, b)}
            onDefaults={(patch) => setDefaults({ ...defaults, ...patch })}
            onCopy={() => copy(sel)}
            onMove={(d) => move(sel, d)}
            onClear={() => {
              const balls = [...draft.balls];
              balls[sel] = null;
              setBalls(balls);
            }}
          />
          <PSegmented
            label={t.t('practice.build.order')}
            value={draft.order}
            onChange={(v: 'exact' | 'shuffle') => setDraft({ ...draft, order: v })}
            options={[
              { value: 'exact', label: t.t('practice.build.exact') },
              {
                value: 'shuffle',
                label: t.t('practice.build.shuffle'),
                description: t.t('practice.build.shuffle_hint'),
              },
            ]}
            testId="practice-build-order"
          />
        </>
      )}
    </Screen>
  );
}
