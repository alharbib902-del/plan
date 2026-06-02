// REA-03 — single aggregator for every unit-test suite.
//
// Auto-discovers all `test:*` scripts in package.json (excluding the
// Playwright `test:e2e*` entries) and runs each via `npm run`, so new
// suites are gated by CI automatically — no need to hand-add each one
// to .github/workflows/ci.yml. Exits non-zero if ANY suite fails.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const suites = Object.keys(pkg.scripts ?? {})
  .filter((name) => name.startsWith('test:') && !name.startsWith('test:e2e'))
  .sort();

if (suites.length === 0) {
  console.error('run-unit-tests: no test:* scripts found');
  process.exit(1);
}

console.log(`Running ${suites.length} unit-test suites...\n`);
const failed = [];

for (const name of suites) {
  const res = spawnSync('npm', ['run', name], {
    cwd: root,
    shell: true,
    encoding: 'utf8',
  });
  if (res.status === 0) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}`);
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    failed.push(name);
  }
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed.`);
if (failed.length > 0) {
  console.error(`Failed suites: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('All unit-test suites passed.');
