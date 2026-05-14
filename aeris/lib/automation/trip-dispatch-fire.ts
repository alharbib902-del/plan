// Server-side ONLY — invoked from Server Actions only.
import { resolveSiteUrl } from '@/lib/checkout/site-url';

/**
 * Phase 9 PR 2 — fire-and-forget POST helper for the
 * trip-distribution match trigger (mirror of Phase 7 PR 2e
 * `fireAndForgetMatchTrigger` for empty-legs).
 *
 * The Server Action `createAuthenticatedTripRequest` calls
 * this helper AFTER `create_authenticated_trip_request` RPC
 * commits, but ONLY when
 * `process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true'`.
 * The helper fires a POST to
 * `/api/trip-distribution/internal/dispatch` with the new
 * trip-request id and returns IMMEDIATELY without awaiting
 * the response — the charter form's latency budget stays
 * bounded; dispatch delivery is best-effort within seconds.
 *
 * The endpoint itself ships with PR 4 (`auto_dispatch_trip_request`
 * RPC + cron drain). Until PR 4 lands, leaving the flag
 * unset (default-disabled, mirrors Phase 9 PR 1 PORTAL flag
 * discipline) keeps this helper from firing — no 404 storm
 * on the Vercel logs, no false canary signal.
 *
 * On missing `CRON_SECRET`, the helper logs a structured
 * warning + returns without firing, matching the empty-legs
 * pattern. PR 4 will own the cron drain that replays missed
 * trips when this fires path is degraded.
 */

export function fireAndForgetTripDispatch(tripRequestId: string): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim().length === 0) {
    console.warn(
      '[trip-dispatch-fire] CRON_SECRET missing; skipping synchronous fire (PR 4 cron drain will replay)'
    );
    return;
  }

  const siteUrl = resolveSiteUrl();
  const url = `${siteUrl}/api/trip-distribution/internal/dispatch`;

  // No await — fire and forget. The charter form's latency
  // budget excludes the dispatcher's runtime.
  void fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cronSecret.trim()}`,
    },
    body: JSON.stringify({
      trip_request_id: tripRequestId,
      event: 'created',
    }),
    cache: 'no-store',
  }).catch((err) => {
    console.error(
      '[trip-dispatch-fire] non-blocking fetch error',
      err
    );
  });
}
