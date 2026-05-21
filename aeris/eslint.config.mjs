// Next 16 + ESLint 9 flat-config.
// `eslint-config-next/core-web-vitals` already exports a flat-config array
// (see node_modules/eslint-config-next/dist/core-web-vitals.js).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

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
