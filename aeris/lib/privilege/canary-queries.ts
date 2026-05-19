// Server-side ONLY — consumed by the
// /admin/operators/canary page (server component). Same
// rationale as lib/admin/operators/canary-queries.ts.

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 13 PR 3 §6.3 — admin canary observability for the
 * privilege cron pipeline.
 *
 * No new singleton row added in this PR — the canary reads two
 * existing ledger/changelog tables to compute "is anything
 * happening?" signals:
 *
 *   - `last_tier_change_at`  — most recent
 *     `privilege_tier_change_log` row (any reason: auto upgrade,
 *     auto downgrade, admin force). Confirms the evaluate
 *     pipeline (trigger OR cron) has fired recently.
 *
 *   - `last_expire_at`       — most recent
 *     `client_loyalty_ledger` row with event_type='expire'.
 *     Confirms the daily expire cron has fired recently. NULL
 *     until the first expiry actually occurs (24+ months after
 *     activation).
 *
 *   - `eligible_clients_count` — count of clients with
 *     privilege_tier != 'silver'. Used to interpret a NULL
 *     last_tier_change_at: if eligible_clients = 0, "no tier
 *     activity" means there's nothing to evaluate — healthy.
 *     If eligible_clients > 0 AND last_tier_change_at is stale
 *     (>30 days), the cron might be silently degraded.
 *
 * "Stale" thresholds (returned as booleans for the card):
 *   - tier_change_stale = no change in 30 days AND eligible > 0
 *   - expire_stale      = no expire in 35 days AND eligible > 0
 *     (the expire cron runs daily — 35d catches a missed
 *     month + buffer; before the first 24-month window expires
 *     in production this is always TRUE and that's expected;
 *     the card renders an explanatory subtitle).
 *
 * Reads are best-effort: a DB hiccup returns the safe default
 * shape rather than throwing.
 */

export type PrivilegeCanaryStatus = 'healthy' | 'stale' | 'unknown';

export interface PrivilegeCronCanary {
  status: PrivilegeCanaryStatus;
  last_tier_change_at: string | null;
  last_expire_at: string | null;
  eligible_clients_count: number;
  tier_change_stale: boolean;
  expire_stale: boolean;
}

const SAFE_DEFAULT: PrivilegeCronCanary = {
  status: 'unknown',
  last_tier_change_at: null,
  last_expire_at: null,
  eligible_clients_count: 0,
  tier_change_stale: false,
  expire_stale: false,
};

type LooseQueryClient = {
  from: (table: string) => {
    select: (
      cols: string,
      opts?: { count?: 'exact'; head?: boolean }
    ) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => {
        limit: (n: number) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
      neq: (
        col: string,
        val: unknown
      ) => Promise<{
        count: number | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

const TIER_CHANGE_STALE_DAYS = 30;
const EXPIRE_STALE_DAYS = 35;

function isOlderThanDays(iso: string | null, days: number): boolean {
  if (!iso) return true;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms > days * 24 * 60 * 60 * 1000;
}

export async function getPrivilegeCronCanary(): Promise<PrivilegeCronCanary> {
  noStore();
  const client = createAdminClient() as unknown as LooseQueryClient;

  try {
    const [tierChange, expire, eligible] = await Promise.all([
      client
        .from('privilege_tier_change_log')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      client
        .from('client_loyalty_ledger')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      client
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .neq('privilege_tier', 'silver'),
    ]);

    if (tierChange.error || expire.error || eligible.error) {
      return SAFE_DEFAULT;
    }

    const tierChangeRow = (tierChange.data as Array<{ created_at: string }>)[0];
    const expireRow = (expire.data as Array<{ created_at: string }>)[0];

    // For the expire query, we want event_type='expire'. The
    // builder above selected all event types ordered by latest;
    // we re-fetch with the type filter via a separate read to
    // keep the builder cast surface minimal. Inline it here
    // (cheap — single index hit on (event_type, created_at)).
    type RpcOnlyClient = {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            val: unknown
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean }
            ) => {
              limit: (n: number) => Promise<{
                data: unknown;
                error: { message?: string } | null;
              }>;
            };
          };
        };
      };
    };
    const eqClient = client as unknown as RpcOnlyClient;
    const { data: expireOnly } = await eqClient
      .from('client_loyalty_ledger')
      .select('created_at')
      .eq('event_type', 'expire')
      .order('created_at', { ascending: false })
      .limit(1);
    const expireOnlyRow = (
      (expireOnly ?? []) as Array<{ created_at: string }>
    )[0];

    const eligibleCount =
      typeof eligible.count === 'number' && eligible.count >= 0
        ? eligible.count
        : 0;

    // Use the dedicated expire-only row for staleness, NOT the
    // generic latest-ledger row (any ledger event would mask a
    // silent expire cron failure otherwise). The generic
    // expireRow is read for forward-compatibility and currently
    // unused.
    void expireRow;

    const lastTierChangeAt = tierChangeRow?.created_at ?? null;
    const lastExpireAt = expireOnlyRow?.created_at ?? null;

    const tierChangeStale =
      eligibleCount > 0 &&
      isOlderThanDays(lastTierChangeAt, TIER_CHANGE_STALE_DAYS);
    const expireStale =
      eligibleCount > 0 &&
      isOlderThanDays(lastExpireAt, EXPIRE_STALE_DAYS);

    let status: PrivilegeCanaryStatus = 'healthy';
    if (tierChangeStale || expireStale) status = 'stale';

    return {
      status,
      last_tier_change_at: lastTierChangeAt,
      last_expire_at: lastExpireAt,
      eligible_clients_count: eligibleCount,
      tier_change_stale: tierChangeStale,
      expire_stale: expireStale,
    };
  } catch (err) {
    console.error('[privilege-canary] read failed', err);
    return SAFE_DEFAULT;
  }
}
