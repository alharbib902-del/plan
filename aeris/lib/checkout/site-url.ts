/**
 * Phase 6.2 PR 2c — checkout-prep site URL resolver.
 *
 * Resolves the canonical site URL for customer-facing deep
 * links (currently the WhatsApp confirm-message review URL
 * embedded in the checkout-prep page). Designed to keep
 * customer tokens bound to the deployment that minted them
 * even when env vars are misconfigured.
 *
 * Resolution rules — Codex PR #24 review rounds 1 + 2:
 *
 *   1. **Preview override** — when `VERCEL_ENV === 'preview'`
 *      and `VERCEL_URL` is set, return that. Bypasses
 *      `NEXT_PUBLIC_SITE_URL` because the override is
 *      typically set to the production canonical domain
 *      (project-level, not per-deploy). Preview tokens are
 *      signed with the Preview-environment
 *      `CUSTOMER_CHECKOUT_SECRET` and hashed into the
 *      Preview database instance; routing the customer to a
 *      Production hostname breaks all three layers of token
 *      validation (signature mismatch + DB hash mismatch +
 *      different DB row entirely).
 *
 *   2. **Explicit override** — `NEXT_PUBLIC_SITE_URL`.
 *      Reached only when not on Preview. Used on Production
 *      for the canonical brand domain (e.g.
 *      `https://aeris.sa` once DNS lands).
 *
 *   3. **Vercel-injected hostname** — `VERCEL_URL`. Reached
 *      when (env != preview) AND (no explicit override).
 *      Practical case: Production without
 *      `NEXT_PUBLIC_SITE_URL` set yet.
 *
 *   4. **Static last-resort fallback** — only reachable on
 *      `npm run dev` or other non-Vercel hosts (Vercel
 *      always injects `VERCEL_URL` on every deploy).
 *      Production hostname is the safest default; local-dev
 *      tokens never face real customers.
 *
 * Pure function — env values are passed in, not read inline,
 * so the resolution logic is unit-testable without env
 * mocking. The thin `resolveSiteUrl()` wrapper handles the
 * `process.env` read for actual server-component callers.
 */

export interface ResolveSiteUrlEnv {
  /**
   * `process.env.VERCEL_ENV`. Vercel sets this to one of
   * `'production' | 'preview' | 'development'`. Undefined
   * outside Vercel.
   */
  vercelEnv: string | undefined;
  /**
   * `process.env.VERCEL_URL`. Vercel sets this to the
   * deployment-specific hostname (no `https://` prefix) on
   * every deploy (Production AND Preview). Undefined
   * outside Vercel.
   */
  vercelUrl: string | undefined;
  /**
   * `process.env.NEXT_PUBLIC_SITE_URL`. Optional explicit
   * override; typically the canonical brand domain set on
   * the Production environment.
   */
  publicSiteUrl: string | undefined;
}

const STATIC_FALLBACK = 'https://aeris-flax.vercel.app';

function trimSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveSiteUrlFromEnv(env: ResolveSiteUrlEnv): string {
  // Layer 1 — Preview-only: VERCEL_URL trumps explicit
  // override. Keeps Preview tokens bound to the Preview
  // deploy.
  if (env.vercelEnv === 'preview' && isNonEmptyString(env.vercelUrl)) {
    return `https://${trimSlashes(env.vercelUrl)}`;
  }

  // Layer 2 — explicit override (Production canonical / dev override).
  if (isNonEmptyString(env.publicSiteUrl)) {
    return trimSlashes(env.publicSiteUrl);
  }

  // Layer 3 — Vercel-injected hostname (Production without explicit override).
  if (isNonEmptyString(env.vercelUrl)) {
    return `https://${trimSlashes(env.vercelUrl)}`;
  }

  // Layer 4 — static last-resort fallback (local dev / non-Vercel hosts).
  return STATIC_FALLBACK;
}

/**
 * Server-component entry point. Reads `process.env` and
 * forwards to the pure resolver. Call this from server
 * components / Server Actions where you need the canonical
 * site URL for building customer-facing deep links.
 */
export function resolveSiteUrl(): string {
  return resolveSiteUrlFromEnv({
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    publicSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
}
