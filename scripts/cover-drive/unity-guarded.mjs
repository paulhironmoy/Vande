#!/usr/bin/env node
/**
 * Runs one Unity batchmode command on unity/VandePractice only if no other Unity editor has the project open.
 * Meant to run inside the shared Unity lock wrapper, so the check happens after the lock is held:
 *
 *   <unity-lock-wrapper> <label> node scripts/cover-drive/unity-guarded.mjs <unity args...>
 *
 * Matches real editor processes only (the command line starts with a Unity.app binary and names this project), not
 * shells that mention Unity in their arguments, and refuses if Temp/UnityLockfile exists. Exit code 75 = busy.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectPath = path.join(repoRoot, 'unity/VandePractice');
const version = readFileSync(path.join(projectPath, 'ProjectSettings/ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/)[1];
const unityBin = process.env.VANDE_UNITY_BIN ?? `/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`;

const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
const editors = (ps.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => {
  const command = l.replace(/^\d+\s+/, '');
  return /^\/\S*Unity\.app\/Contents\/MacOS\/Unity(\s|$)/.test(command) && command.includes(projectPath);
});
const lockfile = existsSync(path.join(projectPath, 'Temp/UnityLockfile'));
if (editors.length || lockfile) {
  process.stderr.write(`unity-guarded: project busy; editors=${JSON.stringify(editors)} lockfile=${lockfile}\n`);
  process.exit(75);
}
const r = spawnSync(unityBin, process.argv.slice(2), { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
