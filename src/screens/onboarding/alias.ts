/** Alias rules shared by onboarding, the invite's quick alias step and the alias fix prompt (server re-checks). */
const ALIAS_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} _-]*$/u;

export function validateAlias(alias: string): 'short' | 'long' | 'chars' | null {
  const a = alias.trim();
  if ([...a].length < 3) return 'short';
  if ([...a].length > 16) return 'long';
  if (!ALIAS_RE.test(a)) return 'chars';
  return null;
}
