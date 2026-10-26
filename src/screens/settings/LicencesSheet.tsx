import { useEffect, useId, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { Button, Sheet } from '@/ui';
import { LICENCES } from './licences';
import { filterNotices, loadNotices, type NoticeEntry } from './notices';
import s from './LicencesSheet.module.css';

/**
 * Open-source licences: the full notices (every npm package and Android library with its licence text), searchable by
 * name or licence, after a short note on the fonts and the app's own artwork and sound. Offline before the file was
 * ever fetched, the short list stands in.
 */
export function LicencesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tr = useT();
  const { t } = tr;
  const [entries, setEntries] = useState<NoticeEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const searchId = useId();

  useEffect(() => {
    if (!open || entries) return;
    let live = true;
    setFailed(false);
    loadNotices().then(
      (e) => live && setEntries(e),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, entries, attempt]);

  const shown = useMemo(() => (entries ? filterNotices(entries, query) : []), [entries, query]);
  const count = shown.filter((e) => !e.heading && e.title).length;

  return (
    <Sheet open={open} onClose={onClose} title={t('settings.licences')} testId="settings-licences-sheet">
      <div className={s.wrap}>
        <p className={s.note}>{t('settings.licences_assets')}</p>
        {entries ? (
          <>
            <div className={s.search}>
              <label htmlFor={searchId} className={s.label}>
                {t('settings.licences_search')}
              </label>
              <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} data-testid="licences-search" />
              <span className={s.count} aria-live="polite">
                {query ? (count ? t('settings.licences_count', { count }) : t('settings.licences_none')) : ''}
              </span>
            </div>
            <div className={s.list} data-testid="licences-full">
              {shown.map((e, i) =>
                e.heading ? (
                  <h3 key={`h${i}`} className={s.heading}>
                    {e.title}
                  </h3>
                ) : (
                  <section key={`e${i}`} className={s.entry}>
                    {e.title && <h4 className={s.title}>{e.title}</h4>}
                    {e.body && <pre className={s.text}>{e.body}</pre>}
                  </section>
                ),
              )}
            </div>
          </>
        ) : failed ? (
          <>
            <p className={s.note}>{t('settings.licences_offline')}</p>
            <Button variant="secondary" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
            <ul className={s.short}>
              {LICENCES.map((l) => (
                <li key={l.name}>
                  <strong>{l.name}</strong>
                  <span>
                    {l.licence} · {l.copyright}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={s.note}>{t('common.loading')}</p>
        )}
        <p className={s.note}>{t('settings.licences_note')}</p>
      </div>
    </Sheet>
  );
}
