/** "Why it happened": the delivery and the swing explained from the game's measured evidence (warm-up, dismissal). */
import type { BowlerFamily, DeliveryRecord, DeliveryResult } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import { whySentences } from '../coaching';
import s from '../screens/Play.module.css';

export function Why({ result, record, family }: { result: DeliveryResult; record?: Pick<DeliveryRecord, 'bowler' | 'field'> | null; family?: BowlerFamily }) {
  const t = usePracticeT();
  const { engine } = useKit();
  const facts = engine.coachingFacts(result, record ?? undefined);
  const why = whySentences(t, facts, Boolean(result.swing), result.coaching.lbw ?? null, record?.bowler.family ?? family ?? 'pace');
  return (
    <>
      <ul className={s.why} data-testid="practice-why">
        {why.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className={s.tip}>{why.tip}</p>
    </>
  );
}

