// ESLint flat config (ESLint 10). `npm run lint` checks the TypeScript and JavaScript this repository owns.
//
// The rules are syntactic, with no type-aware linting: the run needs no tsconfig and takes seconds. `tsc` (npm run
// typecheck) already enforces strict types, noUnusedLocals and noUnusedParameters on src and tests, so these rules cover
// what tsc does not see: unreachable or useless code, unused values in the scripts, hook dependencies, console noise.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// An underscore prefix says "unused on purpose" (a callback parameter that must be there, a deliberately ignored error).
const unusedVars = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' };

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    // Build output and tool reports.
    'dist/',
    'dist-*/',
    'dev-dist/',
    'coverage/',
    'test-results*/',
    'playwright-report/',
    'blob-report/',
    'backend/.wrangler/',
    'render-service/dist/',
    // Not JavaScript this repository owns: native projects, evidence, shipped static files, source art and motion data.
    'android/',
    'unity/',
    'release/',
    'public/',
    'store-assets/',
    'assets-src/',
  ]),

  {
    // Every suppression must still suppress something, so a fixed problem cannot leave a stale disable comment behind.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    extends: [js.configs.recommended],
  },

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedVars],
    },
  },

  {
    // Plain JavaScript: Node scripts. Several drive a browser, so the code they pass to page.evaluate may use DOM globals.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', unusedVars],
    },
  },

  {
    // The app and its tests: React hooks must follow the rules of hooks, and the dependency arrays must be complete.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    // Product code does not leave console.log behind; warn, error, info and debug are deliberate diagnostics.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error', 'info', 'debug'] }],
    },
  },
]);
