import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 11 PR 3 §6.3 — cargo dispatch runs in the last 24 hours.
 *
 * Surfaced as a small stat footer under the 6th canary card. Low
 * or zero is a smoke signal for cron-down or an empty pending
 * queue. Round 2 PR #72 P2 #3 — renamed from "per-operator" to
 * "per-request" so the column label matches the SQL semantics
 * (a true per-operator breakdown is deferred to a future
 * /admin/cargo/dispatch-analytics view).
 *
 * Returns 0 on any read error so the canary card always
 * renders — a transient DB failure on this side-stat should
 * never break the rest of the canary dashboard.
 */
type LooseCountClient = {
  from: (table: string) => {
    select: (
      cols: string,
      opts: { count: 'exact'; head: true }
    ) => {
      gte: (
        col: string,
        val: string
      ) => Promise<{
        count: number | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

export async function getCargoDispatchRuns24h(): Promise<number> {
  try {
    // Loose-cast (PR 1 convention): cargo_dispatch_events_outbox
    // is added by the Phase 11 PR 3 migration but not yet
    // registered in the hand-maintained types/database.ts. Cast
    // the .from() builder so the count query type-checks; runtime
    // behavior is unaffected.
    const admin = createAdminClient() as unknown as LooseCountClient;
    const { count, error } = await admin
      .from('cargo_dispatch_events_outbox')
      .select('*', { count: 'exact', head: true })
      .gte(
        'processed_at',
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );
    if (error) {
      console.error('[cargo.canary] dispatch runs read failed', error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error('[cargo.canary] dispatch runs threw', err);
    return 0;
  }
}
