/**
 * P0 regression guard (review 2026-06-08).
 *
 * Vercel Cron invokes every scheduled path with an HTTP GET. A cron
 * route that exports only POST returns 405 and its job body NEVER runs —
 * exactly the defect that silently stalled cargo + medevac distribution
 * and medevac SLA escalation in production.
 *
 * This structural test reads vercel.json and asserts that EVERY scheduled
 * `/api/cron/*` path resolves to a route module that exports a GET handler.
 * It is static (no imports / no env / no DB), matching the other
 * `*-structural` suites, and is auto-gated in CI via `npm test`.
 *
 * Runs as: npm run test:cron-get-contract
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// aeris/ root = four levels up from app/api/cron/__tests__/.
const aerisRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface VercelCron {
  path: string;
  schedule: string;
}

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// eslint-disable-next-line no-console
console.log('\n[cron-get-contract] running …\n');

const vercel = JSON.parse(
  readFileSync(join(aerisRoot, 'vercel.json'), 'utf8')
) as { crons?: VercelCron[] };

const crons = vercel.crons ?? [];

check('vercel.json declares at least one cron', () => {
  assert.ok(crons.length > 0, 'no crons[] found in vercel.json');
});

// A GET handler may be declared either as a function or a const alias.
const GET_EXPORT = /export\s+(?:async\s+function\s+GET\b|const\s+GET\b)/;

for (const cron of crons) {
  const apiPrefix = '/api/cron/';
  if (!cron.path.startsWith(apiPrefix)) {
    // Only cron routes under /api/cron are covered by this contract.
    continue;
  }
  const rel = cron.path.slice('/api/'.length); // cron/x/y
  const routeFile = join(aerisRoot, 'app', 'api', rel, 'route.ts');

  check(`${cron.path} → route exports a GET handler`, () => {
    let source: string;
    try {
      source = readFileSync(routeFile, 'utf8');
    } catch {
      throw new Error(
        `scheduled cron path has no route module at app/api/${rel}/route.ts`
      );
    }
    assert.ok(
      GET_EXPORT.test(source),
      `app/api/${rel}/route.ts is scheduled in vercel.json but does NOT ` +
        `export a GET handler — Vercel Cron sends GET, so this job would 405`
    );
  });
}

// eslint-disable-next-line no-console
console.log(`\n[cron-get-contract] ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
