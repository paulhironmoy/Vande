/**
 * The description of every file in the inbox (one sources.csv, or one JSON file per recording) and the licence rules.
 *
 * Allowed (wedge §6.4, owner decisions 2026-11-03): owner-made; CC0 1.0; CC BY 3.0 or 4.0. Refused, with a reason in
 * plain words: non-commercial, Sampling+, share-alike, no-derivatives, public domain that is not CC0 (O-C4: no),
 * unknown licences, and any missing field. Stand-ins (O-C2) must say `stand-in` and come from Kenney, OpenGameArt or
 * Freesound; they are used only for a sound that has no real recording.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { KINDS, NOT_HERE } from './kinds.mjs';

export const COLUMNS = ['file', 'kind', 'sound', 'source', 'licence', 'author', 'url', 'date', 'title', 'label', 'description', 'start', 'end'];
const ALIASES = { license: 'licence', name: 'file', filename: 'file', notes: 'description', what: 'description' };
export const SOURCES = ['owner', 'freesound', 'stand-in'];
export const LICENCES = { 'owner-made': null, 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/', 'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/' };
export const STAND_IN_HOSTS = ['kenney.nl', 'opengameart.org', 'freesound.org'];

/** RFC 4180 CSV (quotes, doubled quotes, commas and newlines inside quotes); `#` lines and blank lines are skipped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  let line = 1;
  let rowLine = 1;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && cell.trim() === '') {
      q = true;
      cell = '';
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push({ line: rowLine, cells: row });
      row = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push({ line: rowLine, cells: row });
  }
  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === '') && !r.cells[0].trim().startsWith('#'));
}

/** sources.csv to entries keyed by column name; unknown columns are reported, never silently used. */
export function readSourcesCsv(file) {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  if (!rows.length) return { entries: [], problems: [] };
  const head = rows[0].cells.map((h) => {
    const k = h.trim().toLowerCase();
    return ALIASES[k] ?? k;
  });
  const problems = head.filter((h) => h && !COLUMNS.includes(h)).map((h) => `sources.csv: unknown column "${h}" (the columns are: ${COLUMNS.join(', ')})`);
  if (!head.includes('file')) problems.push('sources.csv: the first line must name the columns, starting with "file"');
  const entries = rows.slice(1).map((r) => {
    const e = { where: `sources.csv line ${r.line}` };
    head.forEach((h, i) => {
      if (COLUMNS.includes(h)) e[h] = (r.cells[i] ?? '').trim();
    });
    return e;
  });
  return { entries, problems };
}

/** A JSON sidecar: `<file>.json` or `<file stem>.json`, an object with the same fields. */
export function readJsonSidecar(file, audioFile) {
  let o;
  try {
    o = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { problems: [`${basename(file)}: not valid JSON (${e.message})`] };
  }
  const e = { where: basename(file), file: audioFile };
  for (const [k, v] of Object.entries(o)) {
    const key = ALIASES[k.toLowerCase()] ?? k.toLowerCase();
    if (COLUMNS.includes(key) && key !== 'file') e[key] = v === null || v === undefined ? '' : String(v).trim();
  }
  return { entry: e, problems: [] };
}

/** The licence as one of LICENCES' ids, or a refusal in plain words. */
export function normaliseLicence(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'the licence is missing' };
  const t = ` ${s.toLowerCase().replace(/[-_/(),]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (/ (nc|noncommercial|non commercial) /.test(t) || /non ?commercial/.test(t)) return { error: `"${s}" is non-commercial: not allowed (VANDE is a commercial game; wedge §6.4)` };
  if (/sampling/.test(t)) return { error: `"${s}" is Sampling+: not allowed` };
  if (/ (sa|sharealike|share alike) /.test(t)) return { error: `"${s}" is share-alike: not allowed (wedge §7.2)` };
  if (/ (nd|noderivatives|no derivatives|noderivs) /.test(t)) return { error: `"${s}" forbids changes, and every take is trimmed and levelled: not allowed` };
  if (/^ (owner|owner made|ownermade|own|mine) $/.test(t)) return { id: 'owner-made' };
  if (/^ (cc0|cc0 1\.0|cc 0|cc zero|creative commons 0|creative commons 0 1\.0|creative commons zero) $/.test(t)) return { id: 'CC0-1.0' };
  if (/public domain| pd | pdm | pd self | cc pdm|publicdomain/.test(t)) return { error: `"${s}" is public domain but not CC0: not allowed (owner decision O-C4, 2026-11-03)` };
  const by = /^ (cc by|ccby|attribution|creative commons attribution) (\d\.\d) $/.exec(t);
  if (by) return ['3.0', '4.0'].includes(by[2]) ? { id: `CC-BY-${by[2]}` } : { error: `"${s}": only CC BY 3.0 and 4.0 are allowed` };
  if (/^ (cc by|ccby|attribution|creative commons attribution) $/.test(t)) return { error: `"${s}": say which version, CC-BY-3.0 or CC-BY-4.0 (the licence link on the sound's page shows it)` };
  return { error: `"${s}" is not a licence this kit knows: allowed are owner-made, CC0-1.0, CC-BY-3.0 and CC-BY-4.0` };
}

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1990;
}

const FREESOUND_PAGE = /^https?:\/\/(www\.)?freesound\.org\/people\/([^/\s]+)\/sounds\/(\d+)\/?$/i;

/**
 * Checks one entry. Returns { ok: true, value } with the normalised fields, or { ok: false, problems }. `fileExists`
 * says whether the named file is in the inbox.
 */
export function validateEntry(e, { fileExists = true } = {}) {
  const p = [];
  const where = e.where ?? e.file;
  const need = (k, what) => {
    if (!String(e[k] ?? '').trim()) p.push(`${what} is missing`);
  };
  need('file', 'the file name');
  if (e.file && !fileExists) p.push(`there is no file called "${e.file}" in the inbox`);
  const kind = Number(e.kind);
  let sound = String(e.sound ?? '').trim().toLowerCase();
  if (!String(e.kind ?? '').trim()) p.push('the kind (a number from 1 to 11) is missing');
  else if (!Number.isInteger(kind) || kind < 1 || kind > 14) p.push(`kind "${e.kind}" is not a number from 1 to 11`);
  else if (NOT_HERE[kind]) p.push(`kind ${kind}: ${NOT_HERE[kind]}`);
  else {
    const options = Object.keys(KINDS[kind].sounds);
    if (!sound && options.length === 1) sound = options[0];
    else if (!sound) p.push(`kind ${kind} needs the sound column: one of ${options.join(', ')}`);
    else if (!options.includes(sound)) p.push(`sound "${sound}" is not part of kind ${kind} (${KINDS[kind].name}): use one of ${options.join(', ')}`);
  }
  const source = String(e.source ?? '').trim().toLowerCase().replace(/^stand ?in$|^standin$/, 'stand-in');
  if (!source) p.push('the source (owner, freesound or stand-in) is missing');
  else if (!SOURCES.includes(source)) p.push(`source "${e.source}" must be owner, freesound or stand-in`);
  const lic = normaliseLicence(e.licence);
  if (lic.error) p.push(lic.error);
  else if (source === 'owner' && lic.id !== 'owner-made') p.push('your own recordings must say owner-made as the licence');
  else if (source && source !== 'owner' && lic.id === 'owner-made') p.push(`a ${source} file cannot be owner-made: write the licence shown on its page`);
  need('author', source === 'owner' ? 'the author (your name, or "VANDE owner")' : 'the author (the user name on the page)');
  const url = String(e.url ?? '').trim();
  if (source === 'freesound') {
    const m = FREESOUND_PAGE.exec(url);
    if (!url) p.push("the url (the sound's Freesound page) is missing");
    else if (!m) p.push(`url "${url}" is not a Freesound sound page (https://freesound.org/people/NAME/sounds/NUMBER/)`);
  } else if (source === 'stand-in') {
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    if (!url) p.push("the url (the stand-in's page) is missing");
    else if (!STAND_IN_HOSTS.includes(host)) p.push(`stand-ins come from ${STAND_IN_HOSTS.join(', ')} only (owner decision O-C2), not "${host || url}"`);
  }
  if (!String(e.date ?? '').trim()) p.push('the date (YYYY-MM-DD) is missing');
  else if (!validDate(String(e.date).trim())) p.push(`date "${e.date}" is not a real date written YYYY-MM-DD`);
  const label = String(e.label ?? '').trim().toLowerCase();
  if (source === 'stand-in' && label !== 'stand-in') p.push('a stand-in must have the label stand-in (owner decision O-C2)');
  if (source && source !== 'stand-in' && label === 'stand-in') p.push('the label stand-in is only for source stand-in');
  const num = (k) => {
    const v = String(e[k] ?? '').trim();
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      p.push(`${k} "${v}" must be a number of seconds`);
      return null;
    }
    return n;
  };
  const start = num('start');
  const end = num('end');
  if (start !== null && end !== null && end <= start) p.push('end must be after start');
  if (p.length) return { ok: false, where, file: e.file, problems: p };
  const warnings = [];
  const fs = FREESOUND_PAGE.exec(url);
  if (fs && fs[2].toLowerCase() !== String(e.author).trim().toLowerCase()) warnings.push(`the author "${e.author}" is not the Freesound user in the url ("${fs[2]}"); check the credit the page asks for`);
  if (lic.id.startsWith('CC-BY') && !String(e.title ?? '').trim()) warnings.push('no title: the credit will use the file name; the title on the page is better');
  return {
    ok: true,
    where,
    warnings,
    value: { file: e.file, kind, sound, source, licence: lic.id, licenceUrl: LICENCES[lic.id], author: String(e.author).trim(), url, date: String(e.date).trim(), title: String(e.title ?? '').trim() || basename(e.file, extname(e.file)), label, description: String(e.description ?? '').trim(), start, end },
  };
}

export const csvTemplate = () =>
  `${COLUMNS.join(',')}
# One line per file. Lines starting with # are ignored. See OWNER-GUIDE.md in the sound folder.
# Your own recording (kind 1, normal hits off the middle of the bat):
# middle-hits.m4a,1,middle,owner,owner-made,VANDE owner,,2026-11-05,,,"English willow bat, leather ball, indoors",,
# A Freesound download (check its page first: the licence must be Creative Commons 0 or Attribution 3.0/4.0):
# pad-thud.wav,6,pad,freesound,CC-BY-4.0,someuser,https://freesound.org/people/someuser/sounds/123456/,2021-04-02,Ball hits pad,,,,
`;

export const exists = existsSync;
