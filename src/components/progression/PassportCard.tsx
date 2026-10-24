import type { PassportAccomplishment } from '@/engine/types';
import type { AccomplishmentDefinition } from '@/progression/accomplishments';
import { Icon } from '@/components/ui';
import { dailyIdWords } from '@/progression/dailyTime';
import s from './PassportCard.module.css';

export function PassportCard({ def, earned, simple }: { def: AccomplishmentDefinition; earned?: PassportAccomplishment; simple: boolean }) {
  return (
    <li className={s.card} data-earned={earned ? 'true' : 'false'} data-testid={`passport-${def.id}`}>
      <span className={s.icon} aria-hidden="true">
        <Icon name={def.icon} size={24} />
      </span>
      <div className={s.body}>
        <h3 className={s.title}>{simple ? def.simpleTitle : def.title}</h3>
        <p className={s.text}>{earned ? earned.reason : simple ? def.simpleHowTo : def.howTo}</p>
        <span className={s.when}>{earned ? `${simple ? 'Earned' : 'Earned'} ${earned.dailyId ? dailyIdWords(earned.dailyId) : new Date(earned.earnedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : simple ? 'Not yet' : 'Not yet earned'}</span>
      </div>
    </li>
  );
}
