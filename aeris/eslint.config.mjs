// Next 16 + ESLint 9 flat-config.
// `eslint-config-next/core-web-vitals` already exports a flat-config array
// (see node_modules/eslint-config-next/dist/core-web-vitals.js).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
// `typescript-eslint` is the meta-package `eslint-config-next` itself depends
// on and registers under the `@typescript-eslint` namespace for `*.ts`/`*.tsx`
// (see node_modules/eslint-config-next/dist/index.js → block `next/typescript`).
// We re-import it here so the project-convention rules below resolve the plugin
// independently of `eslint-config-next`'s internal ordering / file scoping.
import tseslint from 'typescript-eslint';

const config = [
  ...nextCoreWebVitals,
  {
    // `react-hooks/purity` is a new rule introduced in
    // eslint-plugin-react-hooks v7 (shipped with Next 16). It flags
    // any call to `Date.now()` / `Math.random()` etc. inside a render
    // body — which is over-eager for React Server Components since
    // they render exactly once per request on the server and have no
    // client-side re-render to produce "unstable results". Until the
    // rule learns to skip RSCs (see upstream issue), we disable it
    // globally; legitimate client-component purity violations are
    // still caught by review.
    //
    // `linterOptions.reportUnusedDisableDirectives: 'off'` keeps the
    // pre-existing `// eslint-disable-next-line no-console` comments
    // in test files harmless. Those comments encode the codebase's
    // intent (production code must not call `console.*`; tests may);
    // the underlying `no-console` rule isn't on by default under the
    // Next 16 flat config, so re-enabling it project-wide is out of
    // scope for the bare migration PR.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'react-hooks/purity': 'off',
    },
  },
  {
    // Project TypeScript conventions, scoped to PRODUCTION source only.
    // `lint:strict` runs `eslint . --max-warnings 0`, so both rules below are
    // set to 'error' and have been verified clean against the current tree:
    //   - the codebase is already `any`-free (intentional, per project rules),
    //     so `no-explicit-any` locks that invariant in without changing code;
    //   - production code uses only `console.error` / `console.warn` (in cron
    //     and error paths); there are zero bare `console.log` calls in app/lib/
    //     components, so `no-console` (allowing error/warn) is also clean.
    // Tests, scripts, e2e and config files are excluded below: hand-rolled tsx
    // test runners legitimately `console.log` progress, and several carry
    // `// eslint-disable-next-line no-console` comments that encode that intent.
    name: 'aeris/ts-conventions',
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    ignores: [
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'scripts/**',
      'e2e/**',
      '**/*.config.ts',
      '**/*.config.mts',
      '**/*.config.cts',
    ],
    // Re-register the same plugin instance `eslint-config-next` uses, so the
    // `@typescript-eslint/*` rules below resolve regardless of config ordering.
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      // NOTE: `@typescript-eslint/no-floating-promises` is intentionally NOT
      // enabled here. It requires type-aware linting (it only runs when the
      // parser is given a TypeScript program via
      // `languageOptions.parserOptions.projectService` / `project`). Turning
      // that on is a heavier change that re-parses the whole project against
      // tsconfig — it both slows linting and risks surfacing many pre-existing
      // floating-promise violations that would break `lint:strict`
      // (`--max-warnings 0`). It should be adopted as its own task that wires
      // `projectService` and fixes any violations it uncovers in isolation.
    },
  },
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
];

export default config;
