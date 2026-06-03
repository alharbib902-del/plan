import * as Sentry from '@sentry/nextjs';

import { sentryEnabled } from './sentry-options';

/**
 * REA-01 — explicit capture for OPERATIONAL errors that are deliberately
 * swallowed (logged + returned as JSON) instead of thrown, so Next's
 * `onRequestError` instrumentation never sees them.
 *
 * Scope (agreed with the founder): wired ONLY at the run-aborting failure
 * points of the business-critical cron jobs — dispatch / drain, SLA
 * escalation, certificate / reservation / window / cashback expiry, privilege
 * evaluation, and referral rewards — where a silent failure stalls a whole
 * pipeline. Secondary / per-row cron errors stay `console.error` + the
 * returned error counters + the `cron_last_run_at` canary (a documented
 * follow-up can widen this later).
 *
 * No-op when Sentry is disabled (no DSN): `captureException` short-circuits
 * with no active client, so this neither throws nor phones home.
 *
 * Awaited at the call sites: a cron route handler may freeze / return its JSON
 * before a buffered event ships, so when a DSN is set we `flush(1500)` to push
 * the capture out — wrapped in try/catch so a flush timeout or transport
 * failure can never break the cron run. Call sites keep their existing
 * `console.error` + JSON response untouched.
 */
export async function captureCronError(
  scope: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  Sentry.captureException(error, {
    level: 'error',
    tags: { cron: scope, operational: true },
    ...(context ? { extra: context } : {}),
  });
  if (!sentryEnabled()) return;
  try {
    await Sentry.flush(1500);
  } catch {
    // A flush timeout / transport failure must never break the cron run.
  }
}
