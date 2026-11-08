#!/usr/bin/env node
/**
 * The owner's Freesound shopping list (O-C1): search terms for each sound kind, as links with the licence filter set
 * to Creative Commons 0 or to Attribution, and the checklist to run on every sound's own page before downloading.
 *
 *   node scripts/audio/freesound-search.mjs                 print the list
 *   node scripts/audio/freesound-search.mjs --write <file>  write it as Markdown (the sound folder's FREESOUND-SEARCH.md)
 *
 * This only builds links. It never contacts Freesound: its robots.txt bars agents from /search/, and downloading
 * needs the owner's own (free) account.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from './lib/kinds.mjs';

/** The two licence filters allowed (wedge §6.4). Never "Attribution NonCommercial", never "Sampling+". */
export const LICENCE_FILTERS = { 'Creative Commons 0': 'CC0-1.0', Attribution: 'CC-BY-3.0 or CC-BY-4.0 (the page says which)' };

/** Search terms per kind (REGISTER.md §5, plus a few more). */
export const QUERIES = {
  1: ['cricket bat', 'cricket bat ball', 'cricket shot', 'willow bat hit', 'bat hit leather ball', 'cricket nets'],
  2: ['cricket edge', 'bat edge', 'cricket bat edge'],
  3: ['cricket nick', 'cricket edge thin', 'bat tick'],
  4: ['cricket bat handle hit', 'bat shoulder hit', 'cricket bat top edge'],
  5: ['cricket block', 'cricket defensive shot', 'cricket bat soft hit'],
  6: ['cricket pad', 'ball hit pad', 'leg guard hit'],
  7: ['ball body hit', 'ball hit glove', 'ball hit arm'],
  8: ['bat swing whoosh', 'cricket bat swing', 'wicket keeper gloves catch', 'leather glove catch', 'ball catch glove'],
  9: ['cricket ball bounce', 'leather ball bounce', 'ball bounce grass', 'ball bounce concrete'],
  10: ['cricket stumps', 'cricket bails', 'wicket hit', 'ball hit stumps'],
  11: ['ball hit advertising board', 'ball hit wooden fence', 'boundary board'],
};

const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');

/** A Freesound search link: the words, one licence filter, and short sounds only (under 10 s). */
export function searchUrl(q, licence) {
  if (!(licence in LICENCE_FILTERS)) throw new Error(`licence filter ${licence} is not allowed`);
  return `https://freesound.org/search/?q=${enc(q)}&f=${enc(`license:"${licence}" duration:[0 TO 10]`)}`;
}

export const CHECKLIST = [
  'The licence box on the sound’s page says **Creative Commons 0**, or **Attribution** with version 3.0 or 4.0 (the licence link shows the version). Anything else (Attribution NonCommercial, Sampling+, or no licence shown): skip it.',
  'Look under the description for the sounds it was **made from** (“Sources”). If any of those is NonCommercial, Sampling+ or unknown, skip it.',
  'Read the description. Skip it if it was taken from TV, radio, a film, a game, a match broadcast or a sound library, or if it asks for “no commercial use”.',
  'It must be the real thing for its kind (a cricket bat, ball, pad, glove, stumps). A baseball bat or a generic knock is at best a **stand-in**: put `stand-in` as the source and the label, and use it only if nothing real exists.',
  'Download the original file with the Download button (not a preview), and keep its name. Do not trim or edit it.',
  'Write one line in `sources.csv`: the file name, the kind and sound, `freesound`, the licence (`CC0-1.0`, `CC-BY-3.0` or `CC-BY-4.0`), the author (the user name on the page), the page address (`https://freesound.org/people/NAME/sounds/NUMBER/`), the upload date on the page (YYYY-MM-DD) and the title.',
];

export function markdown() {
  const L = ['# Freesound search list (owner action O-C1)', '', 'Made by `scripts/audio/freesound-search.mjs`. Sign in to your free Freesound account first. Each link searches short sounds (under 10 s) with one allowed licence filter. If a page opens without the filter ticked, tick it yourself in the left column: **License → Creative Commons 0**, then try again with **Attribution**. These links were built, not opened: no agent may use Freesound’s search.', '', '## Before you download any file: the checklist', ''];
  CHECKLIST.forEach((c, i) => L.push(`${i + 1}. ${c}`));
  L.push('', '## Searches', '');
  for (const [k, qs] of Object.entries(QUERIES)) {
    L.push(`### Kind ${k}: ${KINDS[k].name} (sound: ${Object.keys(KINDS[k].sounds).join(', ')})`, '', '| Search | Creative Commons 0 | Attribution |', '| --- | --- | --- |');
    for (const q of qs) L.push(`| ${q} | [CC0](${searchUrl(q, 'Creative Commons 0')}) | [Attribution](${searchUrl(q, 'Attribution')}) |`);
    L.push('');
  }
  L.push('Never use the filters “Attribution NonCommercial” or “Sampling+”. Public-domain files that are not CC0 are not allowed (owner decision O-C4, 2026-11-03).');
  return `${L.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--write');
  if (i >= 0) writeFileSync(resolve(process.argv[i + 1]), markdown());
  else process.stdout.write(markdown());
}
