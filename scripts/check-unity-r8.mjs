#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HOST = 'in.vande.cricket.unity.UnityPracticeHost';
const JNI_ENTRYPOINTS = [
  'pendingOperationIdFromUnity',
  'runtimeLoadedFromUnity',
  'readyFromUnity',
  'emitFromUnity',
];

/** R8 mapping proof for the string-resolved Unity C# -> Android Java boundary. */
export function inspectUnityR8Mapping(mapping) {
  const lines = mapping.split(/\r?\n/);
  const header = `${HOST} -> ${HOST}:`;
  const start = lines.indexOf(header);
  if (start < 0) return { ok: false, errors: [`R8 did not preserve the literal host class: ${HOST}`] };
  let end = start + 1;
  // Current R8 mappings place unindented metadata comments (for example the
  // sourceFile record) directly below a class header.  The next class mapping,
  // not indentation, is therefore the reliable boundary for this class.
  while (end < lines.length && !/^[^#\s].*\s->\s.*:$/.test(lines[end])) end += 1;
  const members = lines.slice(start + 1, end);
  const errors = JNI_ENTRYPOINTS.flatMap((name) => {
    const retained = members.some((line) => line.includes(`${name}(`) && line.endsWith(` -> ${name}`));
    return retained ? [] : [`R8 did not preserve Unity JNI entrypoint: ${name}`];
  });
  return { ok: errors.length === 0, errors };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = argument('mapping');
  if (!path) {
    console.error('Usage: node scripts/check-unity-r8.mjs --mapping <mapping.txt>');
    process.exit(2);
  }
  const result = inspectUnityR8Mapping(readFileSync(path, 'utf8'));
  if (!result.ok) {
    for (const error of result.errors) console.error(`  FAIL  ${error}`);
    process.exit(1);
  }
  console.log(`PASS: R8 preserved ${HOST} and ${JNI_ENTRYPOINTS.length} Unity JNI entrypoints.`);
}
