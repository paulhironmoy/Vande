import { useEffect, useMemo, useState } from 'react';
import '../engineRules';
import type { Conditions, DeliveryPlan, DeliveryVariant, ExecutionGrade, FieldSetting, InputTrace, Intensity, Intent, Length, Line, OverPlan, SealedSixEngineApi } from '@/contracts';
import * as Engine from '@/engine';
import { engine as realEngine } from '@/engine';
import { overSummary, pitchHints, unlockHint } from '@/engine/advice';
import { useT, type MessageKey } from '@/i18n';
import { useBackHandler } from '@/app/back';
import { Button, CardButton, Chip, Dialog, EnergyMeter, ExecutionMeter, FieldMap, Icon, ScreenShell, SegmentedControl, StateView } from '@/ui';
import { playSealChime } from '@/audio';
import s from './BowlingPlannerScreen.module.css';

const VARIANTS: DeliveryVariant[] = ['good_length', 'yorker', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin'];
const LINES: Line[] = ['wide_off', 'off', 'middle', 'leg'];
const LENGTHS: Length[] = ['full', 'good', 'short'];
const INTENTS: Intent[] = ['attack', 'contain', 'setup'];
const FIELDS: FieldSetting[] = ['attacking', 'balanced', 'sweeper'];
const FAMILY: Record<DeliveryVariant, 'pace' | 'swing' | 'spin'> = { yorker: 'pace', good_length: 'pace', bouncer: 'pace', slower: 'pace', inswing: 'swing', outswing: 'swing', offspin: 'spin', legspin: 'spin' };
const ALLOWED: Record<DeliveryVariant, readonly Length[]> = (Engine as { ALLOWED_LENGTHS?: Record<DeliveryVariant, readonly Length[]> }).ALLOWED_LENGTHS ?? {
  yorker: ['full'],
  good_length: ['full', 'good', 'short'],
  bouncer: ['short'],
  slower: ['full', 'good', 'short'],
  inswing: ['full', 'good', 'short'],
  outswing: ['full', 'good', 'short'],
  offspin: ['full', 'good', 'short'],
  legspin: ['full', 'good', 'short'],
};
const SUPER_ALLOWANCE: number = (Engine as { SUPER_BALL_ALLOWANCE?: number }).SUPER_BALL_ALLOWANCE ?? 3;

interface Draft {
  variant: DeliveryVariant;
  line: Line;
  length: Length;
  intensity: Intensity;
  intent: Intent;
  gesture: InputTrace | null;
  grade: ExecutionGrade | null;
}

const draft = (variant: DeliveryVariant, line: Line, length: Length, intensity: Intensity, intent: Intent): Draft => ({ variant, line, length, intensity, intent, gesture: null, grade: null });

export interface BowlingPlannerProps {
  conditions: Conditions;
  /** Delivery variants this player has unlocked (achievements; never purchasable). */
  unlocked: readonly DeliveryVariant[];
  /** Seals the over (server lock). Resolve with the commit hash to show it. */
  onLock: (plan: OverPlan) => Promise<{ commitHash?: string } | void>;
  onBack?: () => void;
  /** Honest deadline line from the server, e.g. "Locks in 3 hours". */
  deadline?: string | null;
  title?: string;
  engine?: SealedSixEngineApi;
  /**
   * Keeps the draft, and the releases already recorded, on this device until the over is locked (e.g. the match id),
   * so leaving and coming back never resets a ball's one release.
   */
  draftKey?: string;
  /** First real over on this device: a short "how it works" tip at the top (dismissible). */
  coach?: boolean;
}

interface StoredDraft {
  field: FieldSetting;
  balls: Draft[];
  superBall: Draft;
}
const DRAFT_PREFIX = 'vc:plan:';

function readDraft(key: string | undefined): StoredDraft | null {
  if (!key) return null;
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) ?? 'null') as StoredDraft | null;
    return d && Array.isArray(d.balls) && d.balls.length === 6 && d.superBall && typeof d.field === 'string' ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string | undefined, d: StoredDraft | null) {
  if (!key) return;
  try {
    if (d) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* storage unavailable: the draft lives for this visit only */
  }
}

/** Plan a sealed over: six deliveries, a Super Ball, a field, and a release gesture for each ball. */
export function BowlingPlannerScreen({ conditions, unlocked, onLock, onBack, deadline, title, engine = realEngine, draftKey, coach = false }: BowlingPlannerProps) {
  const { t } = useT();
  // Android Back leaves the planner (the draft is not sent) instead of leaving the match.
  useBackHandler(Boolean(onBack), () => onBack?.());
  const [stored] = useState(() => readDraft(draftKey));
  const [field, setField] = useState<FieldSetting>(stored?.field ?? 'balanced');
  const [balls, setBalls] = useState<Draft[]>(() => stored?.balls ?? [
    draft('good_length', 'off', 'good', 2, 'contain'),
    draft('good_length', 'off', 'full', 2, 'attack'),
    draft('bouncer', 'middle', 'short', 2, 'setup'),
    draft('yorker', 'middle', 'full', 1, 'attack'),
    draft('good_length', 'off', 'good', 1, 'contain'),
    draft('good_length', 'wide_off', 'full', 2, 'attack'),
  ]);
  const [superBall, setSuperBall] = useState<Draft>(() => stored?.superBall ?? draft('yorker', 'middle', 'full', 1, 'attack'));
  const [sel, setSel] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [locking, setLocking] = useState(false);
  const [locked, setLocked] = useState<{ commitHash?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCoach, setShowCoach] = useState(coach);
  // What works on this pitch and in this weather (engine advice, true to the outcome model).
  const tips = useMemo(() => pitchHints(conditions), [conditions]);
  const anyLocked = VARIANTS.some((v) => !unlocked.includes(v));

  useEffect(() => {
    if (!locked) writeDraft(draftKey, { field, balls, superBall });
  }, [draftKey, field, balls, superBall, locked]);

  const isSuper = sel === 6;
  const cur = isSuper ? superBall : balls[sel];
  const update = (patch: Partial<Draft>) => {
    const next = (d: Draft): Draft => {
      const n = { ...d, ...patch };
      if (patch.variant && !ALLOWED[n.variant].includes(n.length)) n.length = ALLOWED[n.variant][0];
      return n;
    };
    if (isSuper) setSuperBall((d) => next(d));
    else setBalls((bs) => bs.map((d, i) => (i === sel ? next(d) : d)));
  };

  const cost = (d: Draft) => {
    try {
      const c = engine.energyCost({ variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: d.intent });
      return Number.isFinite(c) ? c : 0;
    } catch {
      return 0;
    }
  };
  const used = balls.reduce((sum, d) => sum + cost(d), 0);
  const budget = engine.OVER_ENERGY_BUDGET;
  const superCost = cost(superBall);
  const missing = [...balls, superBall].filter((d) => !d.gesture).length;

  const plan: OverPlan | null = useMemo(() => {
    if (missing > 0) return null;
    const toPlan = (d: Draft): DeliveryPlan => ({ variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: d.intent, gesture: d.gesture! });
    return { v: 1, field, balls: balls.map(toPlan) as OverPlan['balls'], superBall: toPlan(superBall) };
  }, [missing, field, balls, superBall]);

  const validation = useMemo(() => {
    if (!plan) return null;
    try {
      return engine.validatePlan(plan, unlocked);
    } catch {
      // The rules could not run on this device: the plan stays unlockable and the screen says it is invalid.
      return { ok: false as const, errors: ['engine_unavailable'] };
    }
  }, [plan, unlocked, engine]);

  const problem = (() => {
    if (used > budget) return t('plan.energy_over', { n: used - budget });
    if (superCost > SUPER_ALLOWANCE) return t('plan.super_body');
    if (missing > 0) return t('plan.incomplete', { count: missing });
    if (validation && !validation.ok) return t('plan.invalid');
    return null;
  })();

  // The over at a glance, read only when the player is about to seal it (a guide, never a promise).
  const summary = useMemo(() => {
    if (!confirm) return null;
    try {
      return overSummary({ field, balls, superBall }, conditions, { unlocked });
    } catch {
      return null;
    }
  }, [confirm, field, balls, superBall, conditions, unlocked]);

  const doLock = async () => {
    if (!plan || !validation?.ok) return;
    setConfirm(false);
    setLocking(true);
    setError(null);
    try {
      const r = await onLock(plan);
      playSealChime();
      writeDraft(draftKey, null);
      setLocked(r ?? {});
    } catch {
      setError(t('state.error.body'));
    } finally {
      setLocking(false);
    }
  };

  if (locked) {
    return (
      <ScreenShell title={title ?? t('plan.title')} onBack={onBack} narrow testId="planner-locked">
        <StateView kind="locked">{locked.commitHash && <code className={s.hash}>{locked.commitHash.slice(0, 16)}…</code>}</StateView>
      </ScreenShell>
    );
  }

  const family = FAMILY[cur.variant];
  return (
    <ScreenShell
      testId="planner-screen"
      title={title ?? t('plan.title')}
      eyebrow={t(`pitch.${conditions.pitch}` as MessageKey)}
      onBack={onBack}
      narrow
      footer={
        <div className={s.footer}>
          {(problem || error) && (
            <p className={s.problem} role="status">
              <Icon name="alert" size={16} /> {error ?? problem}
            </p>
          )}
          <Button variant="accent" size="lg" block icon="lock" disabled={!validation?.ok || locking} loading={locking} onClick={() => setConfirm(true)} data-testid="plan-lock">
            {locking ? t('plan.locking') : t('plan.lock')}
          </Button>
        </div>
      }
    >
      <div className={s.conditions}>
        <Chip tone="clay" icon="field">
          {t(`pitch.${conditions.pitch}` as MessageKey)}
        </Chip>
        <Chip tone="cyan" icon="sparkle">
          {t(`weather.${conditions.weather}` as MessageKey)}
        </Chip>
        {deadline && (
          <Chip tone="amber" icon="clock">
            {deadline}
          </Chip>
        )}
      </div>
      <p className={s.sub}>{t('plan.subtitle')}</p>
      <aside className={s.pitchTip} data-testid="plan-pitch-tip" aria-label={t(`pitch.${conditions.pitch}` as MessageKey)}>
        <Icon name="info" size={16} />
        <span className={s.pitchTipText}>
          {tips.map((tip) => (
            <span key={tip.key}>{t(tip.key as MessageKey)}</span>
          ))}
        </span>
      </aside>

      {showCoach && (
        <aside className={s.coach} aria-labelledby="plan-coach" data-testid="plan-coach">
          <h2 className={s.coachTitle} id="plan-coach">
            <Icon name="info" size={18} /> {t('plan.coach_title')}
          </h2>
          <ol className={s.coachSteps}>
            <li>{t('plan.coach_1')}</li>
            <li>{t('plan.coach_2')}</li>
            <li>{t('plan.coach_3')}</li>
          </ol>
          <Button variant="secondary" onClick={() => setShowCoach(false)} data-testid="plan-coach-ok">
            {t('plan.coach_ok')}
          </Button>
        </aside>
      )}

      <div className={s.energy}>
        <EnergyMeter used={used} total={budget} pending={isSuper ? 0 : cost(cur)} />
        <p className={s.hint}>{t('plan.energy_hint', { total: budget })}</p>
      </div>

      <section className={s.section}>
        <h2 className={s.h}>{t('plan.field')}</h2>
        {/* The choice spans the full width (it wraps at large text instead of overlapping), the map and notes below. */}
        <SegmentedControl<FieldSetting> label={t('plan.field')} value={field} onChange={setField} options={FIELDS.map((f) => ({ value: f, label: t(`field.${f}` as MessageKey) }))} block />
        <div className={s.fieldRow}>
          <FieldMap field={field} size={112} orientation="broadcast" />
          <div className={s.fieldPick}>
            <p className={s.hint}>{t(`field_hint.${field}` as MessageKey)}</p>
            <p className={s.hint}>{t('plan.field_note')}</p>
          </div>
        </div>
      </section>

      <nav className={s.tabs} aria-label={t('plan.title')}>
        {[...balls, superBall].map((d, i) => (
          <button key={i} type="button" className={s.tab} aria-current={sel === i ? 'step' : undefined} data-super={i === 6 || undefined} onClick={() => setSel(i)} data-testid={`plan-ball-${i}`} data-done={Boolean(d.gesture) || undefined}>
            <span className={s.tabN}>{i === 6 ? t('plan.super_tab') : i + 1}</span>
            <span className={s.tabV}>{t(`variant.${d.variant}` as MessageKey)}</span>
            <span className={s.tabState} data-done={Boolean(d.gesture) || undefined}>
              <Icon name={d.gesture ? 'check' : 'gesture'} size={14} />
            </span>
          </button>
        ))}
      </nav>

      <section className={s.editor} aria-label={isSuper ? t('plan.super_title') : t('plan.ball_tab', { n: sel + 1 })}>
        {isSuper && (
          <p className={s.superNote}>
            <Icon name="sparkle" size={16} /> {t('plan.super_body')} ({t('plan.energy_cost', { n: superCost })} / {SUPER_ALLOWANCE})
          </p>
        )}
        <h3 className={s.h3}>{t('plan.delivery')}</h3>
        <div className={s.variants}>
          {VARIANTS.map((v) => {
            const isLocked = !unlocked.includes(v);
            const unlock = isLocked ? unlockHint(v) : null;
            const c = cost({ ...cur, variant: v, length: ALLOWED[v].includes(cur.length) ? cur.length : ALLOWED[v][0] });
            return (
              <CardButton
                key={v}
                padding={3}
                aria-pressed={cur.variant === v}
                disabled={isLocked}
                onClick={() => update({ variant: v })}
                className={s.variant}
                data-locked={isLocked || undefined}
                data-testid={`plan-variant-${v}`}
                title={unlock ? t(unlock.key as MessageKey) : t(`variant_hint.${v}` as MessageKey)}
              >
                <span className={s.vTop}>
                  <span className={s.vName}>{t(`variant.${v}` as MessageKey)}</span>
                  {isLocked ? (
                    <Icon name="lock" size={16} />
                  ) : (
                    <span className={s.vCost} title={t('plan.energy_cost', { n: c })}>
                      <Icon name="energy" size={12} />
                      <span className="sr-only">{t('plan.energy_cost', { n: c })}</span>
                      <span aria-hidden="true">{c}</span>
                    </span>
                  )}
                </span>
                {unlock ? <span className={s.vUnlock}>{t(unlock.key as MessageKey)}</span> : <span className={s.vFamily}>{t(`family.${FAMILY[v]}` as MessageKey)}</span>}
              </CardButton>
            );
          })}
        </div>
        {anyLocked && <p className={s.hint}>{t('advice.unlock.where')}</p>}
        <p className={s.hint}>{t(`variant_hint.${cur.variant}` as MessageKey)}</p>

        <h3 className={s.h3}>{t('plan.line')}</h3>
        <SegmentedControl<Line> label={t('plan.line')} value={cur.line} onChange={(line) => update({ line })} options={LINES.map((l) => ({ value: l, label: t(`line.${l}` as MessageKey) }))} block />

        <h3 className={s.h3}>{t('plan.length')}</h3>
        <SegmentedControl<Length>
          label={t('plan.length')}
          value={cur.length}
          onChange={(length) => update({ length })}
          options={LENGTHS.map((l) => ({ value: l, label: t(`length.${l}` as MessageKey), disabled: !ALLOWED[cur.variant].includes(l) }))}
          block
        />
        {ALLOWED[cur.variant].length === 1 && <p className={s.hint}>{t('plan.length_fixed')}</p>}

        <h3 className={s.h3}>{family === 'spin' ? t('plan.intensity_spin') : t('plan.intensity')}</h3>
        <SegmentedControl<Intensity>
          label={family === 'spin' ? t('plan.intensity_spin') : t('plan.intensity')}
          value={cur.intensity}
          onChange={(intensity) => update({ intensity })}
          options={([1, 2, 3] as const).map((i) => ({ value: i, label: t(`intensity.${family === 'spin' ? 'spin' : 'pace'}.${i}` as MessageKey) }))}
          block
        />

        <h3 className={s.h3}>{t('plan.intent')}</h3>
        <SegmentedControl<Intent> label={t('plan.intent')} value={cur.intent} onChange={(intent) => update({ intent })} options={INTENTS.map((i) => ({ value: i, label: t(`intent.${i}` as MessageKey) }))} block />
        <p className={s.hint}>{t(`intent_hint.${cur.intent}` as MessageKey)}</p>

        <h3 className={s.h3}>{t('plan.gesture')}</h3>
        <div className={s.gesture}>
          <ExecutionMeter
            key={sel}
            size={190}
            // One release per delivery (GAME_RULES 3.2): once recorded it cannot be redone.
            disabled={Boolean(cur.gesture)}
            hint={cur.gesture ? t('plan.gesture_once') : undefined}
            result={cur.grade ? { grade: cur.grade } : null}
            onComplete={(trace, preview) => {
              update({ gesture: trace, grade: preview?.grade ?? null });
              // Move on to the next ball that still needs a gesture.
              const all = [...balls, superBall];
              const next = all.findIndex((d, i) => i !== sel && !d.gesture);
              if (next >= 0) setTimeout(() => setSel(next), 650);
            }}
          />
          {cur.gesture && (
            <Chip tone={cur.grade === 'perfect' ? 'amber' : cur.grade === 'good' ? 'cyan' : 'neutral'} icon={cur.grade === 'perfect' || cur.grade === 'good' || !cur.grade ? 'check' : 'alert'}>
              {cur.grade ? t(`execution.${cur.grade}` as MessageKey) : t('plan.gesture_done')}
            </Chip>
          )}
        </div>
        {!isSuper && sel > 0 && (
          <Button
            variant="ghost"
            icon="copy"
            onClick={() => {
              const prev = balls[sel - 1];
              update({ variant: prev.variant, line: prev.line, length: prev.length, intensity: prev.intensity, intent: prev.intent });
            }}
          >
            {t('plan.copy_previous')}
          </Button>
        )}
      </section>

      <Dialog open={confirm} title={t('plan.lock_confirm_title')} description={t('plan.lock_confirm_body')} confirmLabel={t('plan.lock')} confirmVariant="accent" onConfirm={() => void doLock()} onCancel={() => setConfirm(false)} testId="plan-lock-dialog">
        {summary && (
          // Compact and self-scrolling, so the dialog's buttons stay on screen at 360 px and large text.
          <section className={s.summary} data-testid="plan-summary" aria-label={t('advice.summary.title')} tabIndex={0}>
            <p className={s.sumLine}>
              <strong>{t('advice.summary.title')}:</strong>{' '}
              {[
                ...(Object.keys(summary.families) as Array<keyof typeof summary.families>).filter((f) => summary.families[f] > 0).map((f) => t(`advice.summary.${f}` as MessageKey, { count: summary.families[f] })),
                t('advice.summary.energy', { used: summary.energy.used, budget: summary.energy.budget }),
                t(`advice.summary.field_${summary.field}` as MessageKey),
              ].join(' · ')}
            </p>
            {summary.reads.length > 0 && (
              <ul className={s.reads}>
                {summary.reads.slice(0, 2).map((r) => (
                  <li key={r.key}>{t(r.key as MessageKey, r.params)}</li>
                ))}
              </ul>
            )}
            <p className={s.sumLine}>
              {[t('advice.summary.lengths', summary.lengths), t('advice.summary.lines', { count: summary.lines }), t('advice.summary.super', { variant: t(`variant.${summary.superBall.variant}` as MessageKey) })].join(' · ')}
            </p>
            <p className={s.sumNote}>{t('advice.summary.note')}</p>
          </section>
        )}
      </Dialog>
    </ScreenShell>
  );
}
