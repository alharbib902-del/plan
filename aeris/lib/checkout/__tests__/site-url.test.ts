/**
 * Phase 6.2 PR 2c — unit tests for resolveSiteUrlFromEnv.
 *
 * Covers the Codex round-1 + round-2 P2 fixes:
 *   - Layer 1 (preview override) wins over Layer 2 when
 *     VERCEL_ENV='preview' AND VERCEL_URL is set.
 *   - Layer 2 (explicit override) wins on Production.
 *   - Layer 3 (Vercel-injected) covers Production without
 *     explicit override.
 *   - Layer 4 (static fallback) covers local dev.
 *   - Whitespace + trailing slashes normalized everywhere.
 *
 * Mirrors the lib/addons/__tests__/catalog-vs-seed.test.ts
 * pattern: zero deps beyond Node's built-in assert + the SUT.
 * Run via:  npm run test:checkout-site-url
 */

import { strict as assert } from 'node:assert';

import { resolveSiteUrlFromEnv } from '@/lib/checkout/site-url';

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

// eslint-disable-next-line no-console
console.log('[site-url] running tests...');

// ────────────────────────────────────────────────────────────
// Codex round 2 P2 fix: Preview overrides NEXT_PUBLIC_SITE_URL.
// ────────────────────────────────────────────────────────────

test('Preview: VERCEL_URL wins even when NEXT_PUBLIC_SITE_URL is set to production', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'preview',
    vercelUrl: 'aeris-abc123-earis-projects.vercel.app',
    publicSiteUrl: 'https://aeris.sa',
  });
  assert.equal(
    result,
    'https://aeris-abc123-earis-projects.vercel.app',
    'Preview deploy must NOT route to the production canonical URL'
  );
});

test('Preview: VERCEL_URL wins when NEXT_PUBLIC_SITE_URL is unset too', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'preview',
    vercelUrl: 'aeris-pr-42-earis-projects.vercel.app',
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-pr-42-earis-projects.vercel.app');
});

test('Preview without VERCEL_URL: falls through to override', () => {
  // Anomalous (Vercel always injects VERCEL_URL), but the
  // resolver is defensive — fall through to layer 2.
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'preview',
    vercelUrl: undefined,
    publicSiteUrl: 'https://aeris.sa',
  });
  assert.equal(result, 'https://aeris.sa');
});

test('Preview without VERCEL_URL and no override: static fallback', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'preview',
    vercelUrl: undefined,
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

// ────────────────────────────────────────────────────────────
// Production paths.
// ────────────────────────────────────────────────────────────

test('Production with NEXT_PUBLIC_SITE_URL: explicit override wins', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: 'aeris-flax.vercel.app',
    publicSiteUrl: 'https://aeris.sa',
  });
  assert.equal(result, 'https://aeris.sa');
});

test('Production without override: VERCEL_URL is used', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: 'aeris-flax.vercel.app',
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

test('Production without override and no VERCEL_URL: static fallback', () => {
  // Theoretical — Vercel always injects VERCEL_URL on Production.
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: undefined,
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

// ────────────────────────────────────────────────────────────
// Local-dev / non-Vercel paths.
// ────────────────────────────────────────────────────────────

test('Local dev (no env vars): static fallback', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: undefined,
    vercelUrl: undefined,
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

test('Local dev with NEXT_PUBLIC_SITE_URL set in .env.local: override wins', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: undefined,
    vercelUrl: undefined,
    publicSiteUrl: 'http://localhost:3000',
  });
  assert.equal(result, 'http://localhost:3000');
});

test('Vercel local dev emulation (vercel dev): static fallback', () => {
  // `vercel dev` sets VERCEL_ENV='development' but does NOT
  // inject VERCEL_URL. Override path applies if set; static
  // fallback otherwise.
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'development',
    vercelUrl: undefined,
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

// ────────────────────────────────────────────────────────────
// Normalization (whitespace + trailing slashes).
// ────────────────────────────────────────────────────────────

test('NEXT_PUBLIC_SITE_URL: trailing slashes stripped', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: undefined,
    publicSiteUrl: 'https://aeris.sa/',
  });
  assert.equal(result, 'https://aeris.sa');
});

test('NEXT_PUBLIC_SITE_URL: multiple trailing slashes stripped', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: undefined,
    publicSiteUrl: 'https://aeris.sa///',
  });
  assert.equal(result, 'https://aeris.sa');
});

test('NEXT_PUBLIC_SITE_URL: leading/trailing whitespace trimmed', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: undefined,
    publicSiteUrl: '  https://aeris.sa  ',
  });
  assert.equal(result, 'https://aeris.sa');
});

test('VERCEL_URL: trailing slash stripped', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: 'aeris-flax.vercel.app/',
    publicSiteUrl: undefined,
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

test('Whitespace-only strings treated as missing', () => {
  // Whitespace-only override → falls through to VERCEL_URL.
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'production',
    vercelUrl: 'aeris-flax.vercel.app',
    publicSiteUrl: '   ',
  });
  assert.equal(result, 'https://aeris-flax.vercel.app');
});

test('Whitespace-only VERCEL_URL on Preview: falls through to override', () => {
  const result = resolveSiteUrlFromEnv({
    vercelEnv: 'preview',
    vercelUrl: '   ',
    publicSiteUrl: 'https://aeris.sa',
  });
  assert.equal(result, 'https://aeris.sa');
});

// ────────────────────────────────────────────────────────────
// Final summary + exit code.
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`[site-url] ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
