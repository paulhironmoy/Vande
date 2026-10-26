/**
 * Module resolution for running the TypeScript engine directly on Node (>= 23.6 strips types natively): maps the
 * `@/` alias to `src/` and resolves extensionless relative imports to `.ts` / `index.ts`, like Vite does.
 * Import this file first, then load TypeScript modules with a dynamic `import()`.
 */
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const file = resolveFile(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.endsWith('.ts')) {
      const file = resolveFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

export const repoRoot = root;
