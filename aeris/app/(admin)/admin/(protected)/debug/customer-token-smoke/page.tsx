import { notFound } from 'next/navigation';

import {
  CustomerTokenEnvError,
  hashCheckoutToken,
  mintCheckoutToken,
  verifyCheckoutToken,
} from '@/lib/checkout/customer-token';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Phase 6.2 PR 1 — admin-guarded + feature-gated debug
 * smoke route for the customer-checkout token regime.
 *
 * Codex iteration-3 P1 #3 + iteration-10 P1 + P2 #2 fix.
 * Purpose: verify `CUSTOMER_CHECKOUT_SECRET` is hooked up
 * in the current environment (Production / Preview /
 * Development) BEFORE PR 2b's customer-facing routes go
 * live. Runs a mint → verify round-trip using a UUID v4
 * sentinel (Codex iteration-5 P2 #1 fix), asserts
 * round-trip equality on `booking_id`, and reports OK or
 * a clear error.
 *
 * Two gates:
 *   1. Admin guard — inherited from the
 *      `(protected)/layout.tsx` parent.
 *   2. Feature flag — `ENABLE_CHECKOUT_TOKEN_DEBUG === 'true'`.
 *      Default off (route returns 404). Founder enables
 *      explicitly during the pre-flight gate window between
 *      PR 2a probes and PR 2b open, then flips back to
 *      `false`.
 *
 * The route consumes ZERO Phase 6.2 schema (no `bookings`
 * reads, no `booking_addons` reads). It exists solely to
 * exercise the customer-token module against the
 * environment's secret. PR 1's "no customer-facing or
 * add-ons runtime consumer" rule (Acceptance #26)
 * explicitly exempts this route as the only PR 1 UI
 * surface.
 */

// Documented all-zero UUID v4 sentinel (variant + version
// bits set per RFC 4122). Valid UUID v4; will not collide
// with any real `bookings.id` in practice. Codex iteration-5
// P2 #1 fix to the iteration-4 ad-hoc 'smoke' string.
const SMOKE_BOOKING_ID = '00000000-0000-4000-8000-000000000000';

type SmokeResult =
  | { ok: true; booking_id: string; hashLength: number; ttlSeconds: number }
  | { ok: false; error: string };

function runSmoke(): SmokeResult {
  try {
    const issuedAt = Math.floor(Date.now() / 1000);
    const ttlSeconds = 60;

    const minted = mintCheckoutToken({
      bookingId: SMOKE_BOOKING_ID,
      ttlSeconds,
      issuedAt,
    });

    const verified = verifyCheckoutToken(minted.token);
    if (verified === null) {
      return {
        ok: false,
        error:
          'verifyCheckoutToken returned null — signature, payload, or expiry check failed',
      };
    }

    if (verified.booking_id !== SMOKE_BOOKING_ID) {
      return {
        ok: false,
        error: `booking_id round-trip mismatch: minted=${SMOKE_BOOKING_ID}, verified=${verified.booking_id}`,
      };
    }

    if (verified.exp !== issuedAt + ttlSeconds) {
      return {
        ok: false,
        error: `exp round-trip mismatch: minted=${issuedAt + ttlSeconds}, verified=${verified.exp}`,
      };
    }

    // Hash sanity: SHA-256 hex is exactly 64 chars.
    const hash = hashCheckoutToken(minted.token);

    return {
      ok: true,
      booking_id: verified.booking_id,
      hashLength: hash.length,
      ttlSeconds,
    };
  } catch (err) {
    if (err instanceof CustomerTokenEnvError) {
      return {
        ok: false,
        error: `CUSTOMER_CHECKOUT_SECRET is missing or empty in this environment`,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

export default function CustomerTokenSmokePage() {
  // Layer 2 of the gate (admin auth is layer 1 via the
  // parent layout). When the flag is anything other than
  // exactly the string 'true', the route returns 404 — no
  // information leak about the route's existence.
  const flag = process.env.ENABLE_CHECKOUT_TOKEN_DEBUG;
  if (flag !== 'true') {
    notFound();
  }

  const result = runSmoke();
  const env =
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'unknown';

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <header className="mb-8 border-b border-gold/20 pb-4">
        <p className="text-xs uppercase tracking-wider text-ink-muted">
          Phase 6.2 PR 1 — debug
        </p>
        <h1 className="mt-1 font-en text-2xl font-semibold text-ink">
          Customer-token smoke
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Mint → verify round-trip against{' '}
          <code className="rounded bg-navy-card px-1.5 py-0.5 text-xs">
            CUSTOMER_CHECKOUT_SECRET
          </code>{' '}
          in <code className="text-xs">{env}</code>. Sentinel
          UUID:{' '}
          <code className="text-xs">{SMOKE_BOOKING_ID}</code>.
        </p>
      </header>

      {result.ok ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6">
          <p className="font-en text-lg font-semibold text-emerald-200">
            ✓ OK — secret hooked up correctly
          </p>
          <dl className="mt-4 space-y-2 font-en text-sm text-ink-secondary">
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-ink-muted">booking_id</dt>
              <dd>
                <code className="text-xs">{result.booking_id}</code>
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-ink-muted">hash length</dt>
              <dd>
                <code className="text-xs">{result.hashLength}</code>{' '}
                <span className="text-ink-muted">(expected 64)</span>
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-ink-muted">TTL</dt>
              <dd>
                <code className="text-xs">{result.ttlSeconds}s</code>
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-xs text-ink-muted">
            After verification, set{' '}
            <code className="text-xs">ENABLE_CHECKOUT_TOKEN_DEBUG</code>{' '}
            back to <code className="text-xs">false</code> to
            close this surface.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6">
          <p className="font-en text-lg font-semibold text-rose-200">
            ✗ FAIL — secret not hooked up
          </p>
          <p className="mt-3 font-en text-sm text-ink-secondary">
            {result.error}
          </p>
          <p className="mt-6 text-xs text-ink-muted">
            Set <code className="text-xs">CUSTOMER_CHECKOUT_SECRET</code>{' '}
            in this environment&apos;s Vercel project settings, redeploy,
            and reload this page.
          </p>
        </div>
      )}
    </main>
  );
}
