/**
 * Phase 0 (mobile API) — unit tests for Bearer token extraction.
 *
 * Layer-1 (no DB). Runs as `npm run test:mobile-bearer`.
 *
 * The parser is security-relevant: a sloppy parse could accept a
 * non-Bearer scheme or an empty token and feed garbage into the
 * session validator. These cases pin the contract.
 */

import { strict as assert } from 'node:assert';

import { extractBearerToken } from '@/lib/mobile/bearer';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    failed++;
  }
}

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/v1/mobile/test', { headers });
}

test('extracts token from a well-formed header', () => {
  assert.equal(extractBearerToken(reqWith({ authorization: 'Bearer abc123' })), 'abc123');
});

test('is case-insensitive on the scheme', () => {
  assert.equal(extractBearerToken(reqWith({ authorization: 'bearer abc123' })), 'abc123');
});

test('trims surrounding whitespace', () => {
  assert.equal(
    extractBearerToken(reqWith({ authorization: '  Bearer   abc123  ' })),
    'abc123'
  );
});

test('returns null when header is absent', () => {
  assert.equal(extractBearerToken(reqWith({})), null);
});

test('returns null for a non-Bearer scheme', () => {
  assert.equal(extractBearerToken(reqWith({ authorization: 'Basic abc123' })), null);
});

test('returns null for an empty Bearer token', () => {
  assert.equal(extractBearerToken(reqWith({ authorization: 'Bearer ' })), null);
  assert.equal(extractBearerToken(reqWith({ authorization: 'Bearer' })), null);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
