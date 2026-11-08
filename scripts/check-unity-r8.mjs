#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HOST = 'in.vande.cricket.unity.UnityPracticeHost';
const CAMERA_ACCESS = 'in.vande.cricket.plugins.CameraAccessPlugin';
const CAMERA_ACCESS_MEMBERS = ['getStatus', 'request', 'openSettings', 'afterRequest'];
const SYSTEM_GESTURES = 'in.vande.cricket.plugins.SystemGesturesPlugin';
const SYSTEM_GESTURES_MEMBERS = ['setBattingExclusion'];
const JNI_ENTRYPOINTS = [
  'pendingOperationIdFromUnity',
  'runtimeLoadedFromUnity',
  'readyFromUnity',
  'emitFromUnity',
];

/**
 * The member lines of a class that R8 kept under its own name, or null when the class was renamed or removed.
 */
function keptClassMembers(mapping, className) {
  const lines = mapping.split(/\r?\n/);
  const header = `${className} -> ${className}:`;
  const start = lines.indexOf(header);
  if (start < 0) return null;
  let end = start + 1;
  // Current R8 mappings place unindented metadata comments (for example the
  // sourceFile record) directly below a class header.  The next class mapping,
  // not indentation, is therefore the reliable boundary for this class.
  while (end < lines.length && !/^[^#\s].*\s->\s.*:$/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end);
}

const keptMethod = (members, name) => members.some((line) => line.includes(`${name}(`) && line.endsWith(` -> ${name}`));

/** R8 mapping proof for the string-resolved Unity C# -> Android Java boundary. */
export function inspectUnityR8Mapping(mapping) {
  const members = keptClassMembers(mapping, HOST);
  if (!members) return { ok: false, errors: [`R8 did not preserve the literal host class: ${HOST}`] };
  const errors = JNI_ENTRYPOINTS.flatMap((name) => (
    keptMethod(members, name) ? [] : [`R8 did not preserve Unity JNI entrypoint: ${name}`]
  ));
  return { ok: errors.length === 0, errors };
}

function inspectPluginMapping(mapping, className, methods, label) {
  const members = keptClassMembers(mapping, className);
  if (!members) return { ok: false, errors: [`R8 did not preserve the ${label} class: ${className}`] };
  const errors = methods.flatMap((name) => (keptMethod(members, name) ? [] : [`R8 did not preserve the ${label} method: ${name}`]));
  return { ok: errors.length === 0, errors };
}

/**
 * R8 mapping proof for the two native plugins that Capacitor reaches by reflection (the plugin class by its registered name, each
 * call by method name, the permission callback by the name given to requestPermissionForAlias). A Unity-linked build, the only one
 * that minifies, must keep these names exactly.
 */
export function inspectCameraAccessR8Mapping(mapping) {
  return inspectPluginMapping(mapping, CAMERA_ACCESS, CAMERA_ACCESS_MEMBERS, 'camera permission helper');
}

export function inspectSystemGesturesR8Mapping(mapping) {
  return inspectPluginMapping(mapping, SYSTEM_GESTURES, SYSTEM_GESTURES_MEMBERS, 'system gestures plugin');
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
  const mapping = readFileSync(path, 'utf8');
  const results = [inspectUnityR8Mapping(mapping), inspectCameraAccessR8Mapping(mapping), inspectSystemGesturesR8Mapping(mapping)];
  const errors = results.flatMap((result) => result.errors);
  if (errors.length > 0) {
    for (const error of errors) console.error(`  FAIL  ${error}`);
    process.exit(1);
  }
  console.log(`PASS: R8 preserved ${HOST} and ${JNI_ENTRYPOINTS.length} Unity JNI entrypoints.`);
  console.log(`PASS: R8 preserved ${CAMERA_ACCESS} and its ${CAMERA_ACCESS_MEMBERS.length} reflective methods.`);
  console.log(`PASS: R8 preserved ${SYSTEM_GESTURES} and its ${SYSTEM_GESTURES_MEMBERS.length} reflective method.`);
}
