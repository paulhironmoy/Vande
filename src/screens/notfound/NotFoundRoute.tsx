import { useRouter, type RouteOf } from '@/app/router';
import { useT } from '@/i18n';
import { Button, Icon, Logo } from '@/ui';
import s from './NotFoundRoute.module.css';

/** Unknown links: a calm way home (never a raw error). */
export default function NotFoundRoute(_props: { route: RouteOf<'not_found'> }) {
  const { t } = useT();
  const navigate = useRouter((st) => st.navigate);
  return (
    <main className={s.screen} data-testid="not-found-screen">
      <Logo size={56} title={t('brand.name')} />
      <span className={s.emblem} aria-hidden="true">
        <Icon name="stumps" size={40} />
      </span>
      <h1 className={s.h1}>{t('notfound.title')}</h1>
      <p className={s.body}>{t('notfound.body')}</p>
      <Button variant="primary" size="lg" icon="home" onClick={() => navigate({ name: 'home' }, { replace: true })} data-testid="not-found-home">
        {t('common.home')}
      </Button>
    </main>
  );
}
