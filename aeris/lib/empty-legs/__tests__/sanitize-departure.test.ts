import assert from 'node:assert';

import { sanitizeDepartureFilter } from '@/lib/empty-legs/sanitize-departure';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  // --- Legitimate input passes through unchanged (behavior preserved) ---

  await test('IATA code is preserved verbatim', () => {
    assert.equal(sanitizeDepartureFilter('RUH'), 'RUH');
    assert.equal(sanitizeDepartureFilter('JED'), 'JED');
  });

  await test('English freeform label with spaces is preserved', () => {
    assert.equal(sanitizeDepartureFilter('King Khalid'), 'King Khalid');
  });

  await test('Arabic freeform label is preserved (Arabic-first app)', () => {
    // The .ilike prefix side must keep working for Arabic departure labels.
    assert.equal(sanitizeDepartureFilter('الرياض'), 'الرياض');
  });

  await test('digits are preserved', () => {
    assert.equal(sanitizeDepartureFilter('OE123'), 'OE123');
  });

  await test('surrounding whitespace is trimmed', () => {
    assert.equal(sanitizeDepartureFilter('  RUH  '), 'RUH');
  });

  // --- PostgREST .or() metacharacters are stripped (injection guard) ---

  await test('comma (filter separator) is stripped', () => {
    // Without sanitizing this would append an extra OR clause.
    assert.equal(
      sanitizeDepartureFilter('RUH,status.eq.sold'),
      'RUHstatuseqsold'
    );
  });

  await test('dot, parentheses, colon, quotes, backslash are stripped', () => {
    assert.equal(sanitizeDepartureFilter('a.b(c)d:e"f\\g'), 'abcdefg');
  });

  await test('LIKE wildcards (% and *) are stripped', () => {
    assert.equal(sanitizeDepartureFilter('RU%H*'), 'RUH');
  });

  await test('a value made only of metacharacters collapses to empty', () => {
    // Caller skips the filter entirely when the result is empty.
    assert.equal(sanitizeDepartureFilter(',.()":\\%*'), '');
    assert.equal(sanitizeDepartureFilter('   '), '');
  });

  await test('a real injection payload is neutralized', () => {
    const payload = 'RUH,or(status.eq.sold,status.eq.expired)';
    const out = sanitizeDepartureFilter(payload);
    assert.ok(!out.includes(','), 'comma must be removed');
    assert.ok(!out.includes('('), 'open paren must be removed');
    assert.ok(!out.includes(')'), 'close paren must be removed');
    assert.ok(!out.includes('.'), 'dot must be removed');
  });

  // --- Length cap (defense-in-depth, mirrors the route's 64-char cap) ---

  await test('result is capped at 64 characters', () => {
    const long = 'A'.repeat(200);
    assert.equal(sanitizeDepartureFilter(long).length, 64);
  });

  // eslint-disable-next-line no-console
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
