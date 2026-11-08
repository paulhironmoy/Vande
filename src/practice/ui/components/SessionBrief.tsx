/**
 * The complete setup of an over, in plain cricket words: the conditions (pitch behaviour, the ball and its age, the
 * light), the bowler (style, an honest pace range, the known pattern), the field (its plan, gaps and catchers), the
 * training objective and the assistance. Shown before the over (the setup screen) and, one tap from the status strip,
 * between balls. A Random Over's own deliveries are never shown: only what any batter could know of the bowler.
 */
import type {
  AssistLevel,
  Difficulty,
  FieldIntent,
  FieldLayout,
  Handedness,
  PitchCondition,
  PracticeOverPlan,
} from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import { bowlerStyle, intentionLine, paceRangeText, variationName, zoneWord } from '../coaching';
import type { OverKind } from '../flow/state';
import { PDisclosure, PSegmented, sys } from '../design';
import { ControlChip } from '../controls';
import { FieldMap } from './FieldMap';
import s from './SessionBrief.module.css';

export interface SessionBriefProps {
  kind: OverKind;
  plan: PracticeOverPlan;
  field: FieldLayout;
  intent: FieldIntent | null;
  conditions: PitchCondition;
  assist: AssistLevel;
  handedness: Handedness;
  /** A Random Over's difficulty (the bowler's honest pace range depends on it); unknown for a resumed over. */
  difficulty: Difficulty | null;
  /** Show the field map here (the setup screen draws its own, larger). */
  map?: boolean;
  /** Assistance may still change (a new innings, before its first ball). */
  onAssist?: (a: AssistLevel) => void;
  /** The first session: plain-word glosses for the cricket words used here, open at once. */
  glossary?: boolean;
  /**
   * The first session: only what a new player needs (the bowler, what to do, how fast), with the complete setup one
   * tap away. Cricket words are met when they matter, glossed, never as a wall of terms before the first ball.
   */
  simple?: boolean;
}

const GLOSSES = ['line', 'length', 'swing', 'seam', 'gap', 'catchers', 'sides'] as const;

export function SessionBrief(p: SessionBriefProps) {
  const t = usePracticeT();
  const { build, engine } = useKit();
  const b = p.plan.bowler;
  const fixed = p.kind === 'reference' || p.kind === 'built';
  const shuffled = Boolean(p.plan.shuffled);
  const pattern = fixed ? build.overPattern(p.plan, p.handedness) : null;
  const facts: string[] = [];
  if (pattern) {
    facts.push(t.tk(`practice.pattern.line.${pattern.mainLine}`));
    const move = b.family === 'pace' ? pattern.swing : pattern.turn;
    if (move !== 'none') facts.push(t.tk(`practice.pattern.${b.family === 'pace' ? 'swing' : 'turn'}.${move}`));
    if (pattern.bouncers) facts.push(t.t('practice.pattern.bouncers', { count: pattern.bouncers }));
    if (pattern.yorkers) facts.push(t.t('practice.pattern.yorkers', { count: pattern.yorkers }));
    if (pattern.changeOfPace) facts.push(t.t('practice.pattern.change', { count: pattern.changeOfPace }));
    facts.push(t.t('practice.pattern.kph', { lo: Math.round(pattern.paceKph[0]), hi: Math.round(pattern.paceKph[1]) }));
  }
  const repertoire = build
    .variationsFor(b.family, b.spinType)
    .filter((v) => v !== 'stock')
    .map((v) => variationName(t, v, b.spinType))
    .join(', ');
  const gaps = (p.intent?.gaps ?? []).filter((g) => g.depth === 'deep').map((g) => zoneWord(t, g.region) ?? '');
  const ringGaps = (p.intent?.gaps ?? []).filter((g) => g.depth === 'ring').map((g) => zoneWord(t, g.region) ?? '');
  const catchers = p.field.fielders
    .filter((f) => p.intent?.attacking.includes(f.id) && f.role !== 'keeper')
    .map((f) => t.tk(`practice.pos.${f.role}`));
  const reference = p.kind === 'reference' ? engine.referenceBalls() : [];
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).join(', ');
  const pace = fixed || p.difficulty ? ` · ${paceRangeText(t, build, b, p.difficulty ?? undefined)}` : '';
  if (p.simple) {
    return (
      <div className={s.brief}>
        <section className={s.block} aria-labelledby="brief-bowler-first">
          <h3 id="brief-bowler-first" className={s.label}>
            {t.t('practice.setup.bowler')}
          </h3>
          <p className={s.value}>
            {bowlerStyle(t, b)}
            {pace}
          </p>
        </section>
        <section className={s.block} aria-labelledby="brief-objective-first" data-testid="practice-setup-objective">
          <h3 id="brief-objective-first" className={s.label}>
            {t.t('practice.setup.objective')}
          </h3>
          <p className={s.value}>{t.t('practice.objective.first')}</p>
        </section>
        <PDisclosure label={t.t('practice.setup.full_setup')} testId="practice-full-setup">
          <SessionBrief {...p} simple={false} />
        </PDisclosure>
      </div>
    );
  }
  return (
    <div className={s.brief}>
      {!fixed && (
        <p className={s.unknown} data-testid="practice-unknown-line">
          {t.t('practice.setup.unknown')}
        </p>
      )}
      <section className={s.block} aria-labelledby="brief-conditions">
        <h3 id="brief-conditions" className={s.label}>
          {t.t('practice.setup.conditions')}
        </h3>
        <p className={s.value}>
          {t.t('practice.setup.pitch_value', { pitch: t.tk(`practice.pitch.${p.conditions}`) })}
        </p>
        <p className={sys.caption}>{t.tk(`practice.pitch.${p.conditions}_behaviour`)}</p>
        <p className={s.value}>{t.tk(`practice.ball.${p.plan.ball.colour}_${p.plan.ball.age}`)}</p>
        <p className={sys.caption}>{t.tk(`practice.ball.${p.plan.ball.age}_hint`)}</p>
      </section>
      <section className={s.block} aria-labelledby="brief-bowler">
        <h3 id="brief-bowler" className={s.label}>
          {t.t('practice.setup.bowler')}
        </h3>
        <p className={s.value}>
          {bowlerStyle(t, b)}
          {pace}
        </p>
        {pattern ? (
          <p className={sys.caption} data-testid="practice-pattern">
            {facts.join(' · ')}
          </p>
        ) : (
          <>
            <p className={sys.caption} data-testid="practice-pattern">
              {t.t('practice.pattern.random')}
            </p>
            <p className={sys.caption}>{t.t('practice.pattern.repertoire', { list: repertoire })}</p>
          </>
        )}
      </section>
      <section className={s.block} aria-labelledby="brief-field">
        <h3 id="brief-field" className={s.label}>
          {t.t('practice.setup.field')}
        </h3>
        {p.intent && <p className={s.value}>{intentionLine(t, p.intent.intention)}</p>}
        {gaps.length > 0 && <p className={sys.caption}>{t.t('practice.setup.gaps', { list: uniq(gaps) })}</p>}
        {ringGaps.length > 0 && (
          <p className={sys.caption}>{t.t('practice.setup.ring_gaps', { list: uniq(ringGaps) })}</p>
        )}
        {catchers.length > 0 && (
          <p className={sys.caption}>{t.t('practice.setup.catchers', { list: uniq(catchers) })}</p>
        )}
        {p.map && (
          <FieldMap field={p.field} intent={p.intent} handedness={p.handedness} testId="practice-brief-field" />
        )}
      </section>
      <section className={s.block} aria-labelledby="brief-objective" data-testid="practice-setup-objective">
        <h3 id="brief-objective" className={s.label}>
          {t.t('practice.setup.objective')}
        </h3>
        {p.kind === 'reference' ? (
          <>
            <p className={s.value}>{t.t('practice.objective.reference')}</p>
            <PDisclosure label={t.t('practice.setup.six_balls')} testId="practice-objectives">
              <ol className={s.list}>
                {reference.map((r) => (
                  <li key={r.id}>
                    <strong>{t.tk(`practice.ref.name.${r.id}`)}</strong>: {t.tk(`practice.objective.${r.objective}`)}
                  </li>
                ))}
              </ol>
            </PDisclosure>
          </>
        ) : p.kind === 'built' ? (
          <>
            <p className={s.value}>{t.t('practice.objective.built')}</p>
            <p className={sys.caption}>
              {shuffled
                ? t.t('practice.objective.built_shuffled')
                : p.plan.balls.map((x) => variationName(t, x.variation, b.spinType)).join(' · ')}
            </p>
          </>
        ) : (
          <p className={s.value}>{t.t('practice.objective.random')}</p>
        )}
      </section>
      {p.glossary !== undefined && (
        <PDisclosure label={t.t('practice.gloss.title')} defaultOpen={p.glossary} testId="practice-glossary">
          <ul className={s.list}>
            {GLOSSES.map((g) => (
              <li key={g}>
                <strong>{t.tk(`practice.gloss.${g}`)}</strong>: {t.tk(`practice.gloss.${g}_means`)}
              </li>
            ))}
          </ul>
        </PDisclosure>
      )}
      <section className={s.block} aria-labelledby="brief-assist">
        <h3 id="brief-assist" className={s.label}>
          {t.t('practice.setup.assist')}
        </h3>
        {p.onAssist ? (
          <PSegmented
            label={t.t('practice.setup.assist')}
            value={p.assist}
            onChange={p.onAssist}
            options={(['learn', 'play', 'real'] as AssistLevel[]).map((v) => ({
              value: v,
              label: t.tk(`practice.settings.assist.${v}`),
              description: t.tk(`practice.settings.assist.${v}_hint`),
            }))}
            testId="practice-setup-assist"
          />
        ) : (
          <p className={sys.caption}>
            <span className={s.value}>{t.tk(`practice.settings.assist.${p.assist}`)}</span> ·{' '}
            {t.tk(`practice.settings.assist.${p.assist}_hint`)}
          </p>
        )}
      </section>
      {/* How the player bats can be changed here, between balls (the setup is not offered during a delivery). */}
      {!p.simple && <ControlChip />}
    </div>
  );
}
