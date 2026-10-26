/**
 * VANDE Cricket admin console (admin.html; web builds only, never in the Android app or the service-worker precache).
 * Highlights: lists jobs by day and status, the consent audit trail and moderation, previews the rendered MP4 through a
 * short-lived signed link, and approves, rejects, schedules, retries, unlists and removes. Quota use and dead letters
 * have their own views. Reports: the moderation queue (open or closed, by kind) with the reported player and post as
 * they are now, and dismiss, rename, suspend, unsuspend and remove-post, each audited with the moderator's identity.
 * Everything shown comes from the Worker; text is always inserted as text, never as HTML.
 */
import './admin.css';
import { HIGHLIGHT_STATUSES, type HighlightStatus } from '@/contracts';
import { AdminApiError, createAdminApi, loadAuth, saveAuth, type AdminApi, type AdminAuth } from './api';
import type { AdminJob, AdminJobDetail, AdminQuota, AdminReport } from './types';

/** Every status, in pipeline order (the contract's own list). */
export const STATUSES: readonly HighlightStatus[] = HIGHLIGHT_STATUSES;

type Child = Node | string | null | undefined | false;

/** Element helper: string children become text nodes (no HTML parsing anywhere). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false) node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

function istToday(now = Date.now()): string {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

function badge(status: string): HTMLElement {
  return el('span', { class: `status status-${status}` }, status.replace(/_/g, ' '));
}

export function jobRow(job: AdminJob, open: (jobId: string) => void): HTMLTableRowElement {
  return el(
    'tr',
    {},
    el('td', {}, job.day),
    el('td', {}, badge(job.status)),
    el('td', {}, el('button', { type: 'button', class: 'link', onclick: () => open(job.jobId) }, job.title)),
    el('td', {}, `${job.aliases[0]} · ${job.aliases[1]}`),
    el('td', {}, job.ranks.map((r) => (r === null ? '–' : `#${r}`)).join(' / ')),
    el('td', {}, job.visibility),
    el('td', {}, String(job.attempts)),
    el('td', { class: 'muted' }, job.lastError ?? ''),
  );
}

/** One report in the queue table (player-chosen names and post text inserted as text only). */
export function reportRow(r: AdminReport, open: (id: number) => void): HTMLTableRowElement {
  const who = r.player ? (r.player.alias ?? (r.player.status === 'deleted' ? 'deleted account' : 'unknown player')) : 'unknown player';
  const what = r.post ? (r.post.text ?? (r.post.phraseId ? `banter: ${r.post.phraseId}` : r.post.present ? r.post.kind ?? 'post' : 'post removed')) : 'the player';
  return el(
    'tr',
    {},
    el('td', {}, el('button', { type: 'button', class: 'link', onclick: () => open(r.id) }, `#${r.id}`)),
    el('td', {}, r.createdHour.slice(0, 13).replace('T', ' ')),
    el('td', {}, r.kind),
    el('td', {}, r.reason),
    el('td', {}, who, r.player && r.player.openReports > 1 ? el('span', { class: 'muted' }, ` · ${r.player.openReports} open`) : null),
    el('td', {}, what),
    el('td', {}, badge(r.status), r.resolution && r.resolution !== r.status ? el('span', { class: 'muted' }, ` ${r.resolution.replace(/_/g, ' ')}`) : null),
    el('td', { class: 'muted' }, r.player?.suspendedUntil ? `suspended until ${r.player.suspendedUntil.slice(0, 10)}` : ''),
  );
}

export interface AdminDeps {
  api?: AdminApi;
  storage?: Storage | null;
  confirm?: (message: string) => boolean;
  now?: () => number;
}

export function mountAdmin(root: HTMLElement, deps: AdminDeps = {}): { refresh(): Promise<void> } {
  const storage = deps.storage === undefined ? (typeof sessionStorage !== 'undefined' ? sessionStorage : null) : deps.storage;
  let auth: AdminAuth = loadAuth(storage);
  let api = deps.api ?? createAdminApi(auth);
  const confirmFn = deps.confirm ?? ((m: string) => window.confirm(m));
  const state = { day: istToday(deps.now?.()), status: '' as '' | HighlightStatus, view: 'jobs' as 'jobs' | 'quota' | 'dlq' | 'reports', reports: 'open' as 'open' | 'closed', kind: '' as '' | 'player' | 'post' };

  const who = el('span', { class: 'muted' }, '…');
  const message = el('p', { class: 'message', role: 'status', 'aria-live': 'polite' });
  const main = el('main', {});
  const detail = el('section', { class: 'detail', 'aria-label': 'Job detail' });

  const say = (text: string, error = false) => {
    message.textContent = text;
    message.classList.toggle('error', error);
  };
  const failure = (e: unknown) => say(e instanceof AdminApiError ? `${e.status} ${e.code}: ${e.message}` : String(e), true);

  const dayInput = el('input', { type: 'date', value: state.day, 'aria-label': 'Day (IST)', onchange: (e) => ((state.day = (e.target as HTMLInputElement).value), void refresh()) });
  const statusSelect = el('select', { 'aria-label': 'Status', onchange: (e) => ((state.status = (e.target as HTMLSelectElement).value as HighlightStatus | ''), void refresh()) }, el('option', { value: '' }, 'all statuses'), ...STATUSES.map((s) => el('option', { value: s }, s.replace(/_/g, ' '))));
  const baseInput = el('input', { type: 'url', placeholder: 'API origin (blank: this origin)', value: auth.base, 'aria-label': 'API origin' });
  const tokenInput = el('input', { type: 'password', placeholder: 'Admin token (local development only)', value: auth.token ?? '', autocomplete: 'off', 'aria-label': 'Admin token' });
  const settings = el(
    'details',
    { class: 'settings' },
    el('summary', {}, 'Connection'),
    baseInput,
    tokenInput,
    el('button', {
      type: 'button',
      onclick: () => {
        auth = { base: baseInput.value.trim(), token: tokenInput.value.trim() || null };
        saveAuth(storage, auth);
        api = createAdminApi(auth);
        void refresh();
      },
    }, 'Use'),
  );
  const LABELS = { jobs: 'Jobs', quota: 'Quota', dlq: 'Dead letters', reports: 'Reports' } as const;
  const tabs = el(
    'nav',
    { class: 'tabs', 'aria-label': 'Views' },
    ...(['jobs', 'quota', 'dlq', 'reports'] as const).map((v) => el('button', { type: 'button', 'data-view': v, onclick: () => ((state.view = v), detail.replaceChildren(), void refresh()) }, LABELS[v])),
  );
  const reportStatus = el('select', { 'aria-label': 'Reports', onchange: (e) => ((state.reports = (e.target as HTMLSelectElement).value as 'open' | 'closed'), void refresh()) }, el('option', { value: 'open' }, 'open reports'), el('option', { value: 'closed' }, 'closed reports'));
  const reportKind = el('select', { 'aria-label': 'Kind', onchange: (e) => ((state.kind = (e.target as HTMLSelectElement).value as '' | 'player' | 'post'), void refresh()) }, el('option', { value: '' }, 'players and posts'), el('option', { value: 'player' }, 'players'), el('option', { value: 'post' }, 'posts'));
  const jobFilters = el('span', { class: 'filters' }, dayInput, statusSelect);
  const reportFilters = el('span', { class: 'filters', hidden: true }, reportStatus, reportKind);
  root.replaceChildren(el('header', {}, el('h1', {}, 'VANDE Cricket admin'), who, settings), el('div', { class: 'filters' }, jobFilters, reportFilters, tabs), message, main, detail);

  async function act(jobId: string, path: 'approve' | 'reject' | 'retry-render' | 'retry-upload' | 'unlist' | 'remove', body?: { notes?: string }, question?: string) {
    if (question && !confirmFn(question)) return;
    try {
      const key = `POST /v1/admin/jobs/:jobId/${path}` as const;
      const r = await api.call(key, { params: { jobId }, body: body as never });
      say(`${path}: ${r.status}`);
      await openJob(jobId);
      await refresh();
    } catch (e) {
      failure(e);
    }
  }

  async function openJob(jobId: string): Promise<void> {
    try {
      const d: AdminJobDetail = await api.call('GET /v1/admin/jobs/:jobId', { params: { jobId } });
      const notes = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Notes (kept with the decision)', 'aria-label': 'Notes' });
      const when = el('input', { type: 'datetime-local', 'aria-label': 'Upload at' });
      const video = el('video', { controls: true, playsinline: true, preload: 'none', width: '270', height: '480' });
      const j = d.job;
      detail.replaceChildren(
        el('h2', {}, j.title),
        el('p', {}, badge(j.status), ` ${j.fixtureLabel} · ${j.day} · ${j.visibility} · code ${j.attributionCode}`),
        el('p', { class: 'muted' }, `Consent by ${j.consentBy} · attempts ${j.attempts}${j.lastError ? ` · last error ${j.lastError}` : ''}${j.youtubeVideoId ? ` · video ${j.youtubeVideoId}` : ''} · views ${j.views}`),
        el('pre', { class: 'description' }, j.description),
        el(
          'div',
          { class: 'preview' },
          video,
          el('button', {
            type: 'button',
            disabled: !j.videoKey,
            onclick: async () => {
              try {
                const link = await api.call('POST /v1/admin/jobs/:jobId/preview-url', { params: { jobId } });
                video.src = link.url;
                say(`Preview link valid until ${link.expiresAt}`);
              } catch (e) {
                failure(e);
              }
            },
          }, j.videoKey ? 'Load the rendered MP4' : 'Not rendered yet'),
        ),
        notes,
        el(
          'div',
          { class: 'actions' },
          el('button', { type: 'button', onclick: () => act(jobId, 'approve', { notes: notes.value }) }, 'Approve'),
          el('button', { type: 'button', onclick: () => act(jobId, 'reject', { notes: notes.value }, 'Reject this highlight?') }, 'Reject'),
          when,
          el('button', {
            type: 'button',
            onclick: async () => {
              if (!when.value) return say('Pick a time first', true);
              try {
                await api.call('POST /v1/admin/jobs/:jobId/schedule', { params: { jobId }, body: { at: new Date(when.value).toISOString() } });
                say('Scheduled');
                await openJob(jobId);
              } catch (e) {
                failure(e);
              }
            },
          }, 'Schedule'),
          el('button', { type: 'button', onclick: () => act(jobId, 'retry-render') }, 'Retry render'),
          el('button', { type: 'button', onclick: () => act(jobId, 'retry-upload') }, 'Retry upload'),
          el('button', { type: 'button', onclick: () => act(jobId, 'unlist', undefined, 'Unlist this video on YouTube?') }, 'Unlist'),
          el('button', { type: 'button', class: 'danger', onclick: () => act(jobId, 'remove', undefined, 'Delete this video from YouTube? This cannot be undone.') }, 'Remove'),
        ),
        el('h3', {}, 'Consent audit trail'),
        el('table', {}, el('tbody', {}, ...d.consents.map((c) => el('tr', {}, el('td', {}, c.decidedHour), el('td', {}, c.playerId), el('td', {}, c.decision), el('td', {}, c.adultConfirmed ? '18+ confirmed' : ''), el('td', {}, c.approvedVisibility), el('td', { class: 'muted' }, c.reason ?? ''))))),
        el('h3', {}, 'Moderation'),
        el('ul', {}, ...d.moderation.map((m) => el('li', {}, `${m.decidedAt} · ${m.reviewer}${m.admin ? ` (${m.admin})` : ''} · ${m.decision} · alias ${m.aliasCheck}, anti-cheat ${m.antiCheat}, duplicate ${m.duplicate} · ${m.notes}`))),
        el('h3', {}, 'Attribution'),
        el('ul', {}, ...d.attribution.map((a) => el('li', {}, `${a.day} · ${a.event}: ${a.n}`))),
      );
    } catch (e) {
      failure(e);
    }
  }

  async function reportAct(id: number, path: 'dismiss' | 'rename' | 'suspend' | 'unsuspend' | 'remove-post', body: { notes?: string; days?: number }, question?: string) {
    if (question && !confirmFn(question)) return;
    try {
      const key = `POST /v1/admin/reports/:reportId/${path}` as const;
      const r = (await api.call(key, { params: { reportId: String(id) }, body: body as never })) as { status: string; alias?: string; until?: string };
      say(`${path}: ${r.status}${r.alias ? ` · new name ${r.alias}` : ''}${r.until ? ` · until ${r.until.slice(0, 10)}` : ''}`);
      await refresh();
      await openReport(id);
    } catch (e) {
      failure(e);
    }
  }

  let shownReports: AdminReport[] = [];

  async function openReport(id: number): Promise<void> {
    const r = shownReports.find((x) => x.id === id) ?? (await api.call('GET /v1/admin/reports', { query: { status: 'closed' } })).reports.find((x) => x.id === id);
    if (!r) {
      detail.replaceChildren(el('p', { class: 'muted' }, `Report #${id} is no longer in this list.`));
      return;
    }
    const notes = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Notes (kept in the audit log)', 'aria-label': 'Notes' });
    const days = el('input', { type: 'number', min: '1', max: '365', value: '30', 'aria-label': 'Suspension days' });
    const p = r.player;
    const name = p ? (p.alias ?? (p.status === 'deleted' ? 'deleted account' : 'unknown player')) : 'unknown player';
    detail.replaceChildren(
      el('h2', {}, `Report #${r.id}: ${r.kind} · ${r.reason}`),
      el('p', {}, badge(r.status), ` filed ${r.createdHour}${r.resolvedHour ? ` · closed ${r.resolvedHour} (${r.resolution ?? ''})` : ''}`),
      el('p', {}, 'Player: ', el('strong', {}, name), p ? ` · ${p.playerId} · ${p.status}${p.suspendedUntil ? ` · suspended until ${p.suspendedUntil}` : ''} · ${p.openReports} open report(s)` : ''),
      ...(r.post ? [el('p', {}, 'Post: ', r.post.present ? el('q', {}, r.post.text ?? (r.post.phraseId ? `banter ${r.post.phraseId}` : r.post.kind ?? '')) : el('span', { class: 'muted' }, 'removed'), r.post.createdHour ? el('span', { class: 'muted' }, ` · ${r.post.createdHour}`) : null)] : []),
      el('p', { class: 'muted' }, 'The reporter is never shown: reports carry an opaque reference only.'),
      notes,
      el(
        'div',
        { class: 'actions' },
        el('button', { type: 'button', onclick: () => reportAct(r.id, 'dismiss', { notes: notes.value }) }, 'Dismiss'),
        el('button', { type: 'button', disabled: !p || p.status !== 'active', onclick: () => reportAct(r.id, 'rename', { notes: notes.value }, `Give ${name} a generated name everywhere?`) }, 'Rename'),
        days,
        el('button', { type: 'button', class: 'danger', disabled: !p || p.status !== 'active', onclick: () => reportAct(r.id, 'suspend', { notes: notes.value, days: Number(days.value) }, `Pause ${name}'s rooms, cups, groups and name changes for ${days.value} days?`) }, 'Suspend'),
        el('button', { type: 'button', disabled: !p?.suspendedUntil, onclick: () => reportAct(r.id, 'unsuspend', { notes: notes.value }) }, 'Lift suspension'),
        r.post ? el('button', { type: 'button', class: 'danger', disabled: !r.post.present, onclick: () => reportAct(r.id, 'remove-post', { notes: notes.value }, 'Take this post down from its room?') }, 'Remove post') : null,
      ),
      el('h3', {}, 'Audit log'),
      r.history.length ? el('ul', {}, ...r.history.map((h) => el('li', {}, `${h.at} · ${h.admin} · ${h.action.replace(/_/g, ' ')}${h.notes ? ` · ${h.notes}` : ''}`))) : el('p', { class: 'muted' }, 'No action yet.'),
    );
  }

  function reportsTable(reports: AdminReport[]): HTMLElement {
    return el(
      'table',
      { class: 'reports' },
      el('thead', {}, el('tr', {}, ...['Report', 'Filed (UTC)', 'Kind', 'Reason', 'Player', 'Reported', 'Status', ''].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...reports.map((r) => reportRow(r, (id) => void openReport(id)))),
    );
  }

  function quotaView(q: AdminQuota): HTMLElement {
    return el(
      'section',
      { class: 'quota' },
      el('p', {}, `Quota day ${q.quotaDay} (resets ${q.nextResetAt}): ${q.used} of ${q.daily} units used, uploads ${q.uploads} of ${q.usable} (${Math.round(q.headroom * 100)} % headroom kept).`),
      el('p', {}, `${q.uploadsPerDay} uploads fit in one quota day at ${q.perUpload} units each.`),
      el('table', {}, el('tbody', {}, ...q.scheduled.map((s) => el('tr', {}, el('td', {}, s.quotaDay), el('td', {}, `${s.jobs} scheduled`))))),
    );
  }

  function table(jobs: AdminJob[]): HTMLElement {
    return el(
      'table',
      { class: 'jobs' },
      el('thead', {}, el('tr', {}, ...['Day', 'Status', 'Title', 'Players', 'Ranks', 'Visibility', 'Attempts', 'Last error'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...jobs.map((j) => jobRow(j, (id) => void openJob(id)))),
    );
  }

  async function refresh(): Promise<void> {
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    jobFilters.hidden = state.view === 'reports';
    reportFilters.hidden = state.view !== 'reports';
    try {
      const me = await api.call('GET /v1/admin/whoami');
      who.textContent = `${me.id} (${me.via === 'access' ? 'Cloudflare Access' : 'local token'})`;
      if (state.view === 'jobs') {
        const r = await api.call('GET /v1/admin/jobs', { query: { day: state.day, status: state.status || undefined } });
        const counts = Object.entries(r.counts).map(([s, n]) => `${s.replace(/_/g, ' ')} ${n}`).join(' · ');
        main.replaceChildren(el('p', { class: 'muted' }, counts || 'No jobs on this day.'), table(r.jobs));
      } else if (state.view === 'quota') {
        main.replaceChildren(quotaView(await api.call('GET /v1/admin/quota')));
      } else if (state.view === 'dlq') {
        main.replaceChildren(table((await api.call('GET /v1/admin/dlq')).jobs));
      } else {
        const r = await api.call('GET /v1/admin/reports', { query: { status: state.reports, kind: state.kind || undefined } });
        shownReports = r.reports;
        main.replaceChildren(el('p', { class: 'muted' }, `${r.counts.open} open · ${r.counts.closed} closed`), r.reports.length ? reportsTable(r.reports) : el('p', {}, state.reports === 'open' ? 'No open reports.' : 'No closed reports yet.'));
      }
    } catch (e) {
      who.textContent = 'not signed in';
      failure(e);
    }
  }

  void refresh();
  return { refresh };
}

const mountPoint = typeof document !== 'undefined' ? document.getElementById('admin') : null;
if (mountPoint) mountAdmin(mountPoint);
