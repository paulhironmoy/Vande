/** The English the screens show, read from the catalog (COPY owns the wording; these tests follow it, not a copy of it). */
import { practiceEn } from '@/i18n/practice/en';

type Key = keyof typeof practiceEn;

export function w(key: Key, params: Record<string, string | number> = {}): string {
  return (practiceEn[key] as string).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
