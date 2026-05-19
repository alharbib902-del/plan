import 'server-only';

import { requireClientSession } from '@/lib/clients/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  ClientPrivilegeColumns,
  ClientLoyaltyLedgerRow,
  PrivilegeTierChangeLogRow,
} from '@/lib/privilege/types';

/**
 * Phase 13 PR 2 — client own-data read pattern for /me/privilege.
 *
 * Mirrors lib/privilege/admin-pii.ts but for the authenticated
 * client reading THEIR OWN data. The migration's RLS doesn't grant
 * direct SELECT to authenticated role (no Supabase Auth JWT in
 * Phase 9), so we read via service-role + filter by the session
 * client_id. The session helper requireClientSession() already
 * validates the cookie + redirects to /login on failure.
 *
 * No audit log entry — clients reading their own data is not
 * audited (only admin PII reads are per D17).
 */

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        single: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
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

export interface ClientPrivilegeDashboard {
  client_id: string;
  full_name: string;
  privilege: ClientPrivilegeColumns;
  recent_ledger: ClientLoyaltyLedgerRow[];
  recent_change_log: PrivilegeTierChangeLogRow[];
}

/**
 * Loads the current client's privilege dashboard. Called from
 * `/me/privilege` Server Component.
 *
 * Throws via redirect() if the session is invalid (no fallback —
 * a logged-in client must be present).
 */
export async function readClientPrivilegeDashboard(): Promise<ClientPrivilegeDashboard> {
  const session = await requireClientSession();

  const admin = createAdminClient() as unknown as LooseClient;

  const { data: clientRow, error: clientErr } = await admin
    .from('clients')
    .select(
      [
        'full_name',
        'privilege_tier',
        'privilege_tier_assigned_at',
        'privilege_tier_qualified_spend_12m_sar',
        'privilege_below_threshold_since',
        'tier_locked_until',
        'cashback_balance_sar',
        'two_factor_enabled',
      ].join(',')
    )
    .eq('id', session.client_id)
    .single();

  if (clientErr || !clientRow) {
    throw new Error(
      `readClientPrivilegeDashboard: ${clientErr?.message ?? 'client_not_found'}`
    );
  }

  const { data: ledgerData, error: ledgerErr } = await admin
    .from('client_loyalty_ledger')
    .select(
      'id, client_id, event_type, amount_sar, balance_after_sar, booking_id, source_change_log_id, source_subscription_id, admin_actor_cookie_fingerprint, admin_reason, cashback_expiry_at, created_at'
    )
    .eq('client_id', session.client_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (ledgerErr) {
    throw new Error(
      `readClientPrivilegeDashboard ledger: ${ledgerErr.message ?? 'unknown'}`
    );
  }

  const { data: changeLogData, error: changeLogErr } = await admin
    .from('privilege_tier_change_log')
    .select(
      'id, client_id, from_tier, to_tier, reason, qualified_spend_12m_sar, grace_started_at, admin_actor_cookie_fingerprint, admin_reason, lock_until, source_booking_id, created_at'
    )
    .eq('client_id', session.client_id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (changeLogErr) {
    throw new Error(
      `readClientPrivilegeDashboard change_log: ${changeLogErr.message ?? 'unknown'}`
    );
  }

  const c = clientRow as {
    full_name: string;
  } & ClientPrivilegeColumns;

  return {
    client_id: session.client_id,
    full_name: c.full_name,
    privilege: {
      privilege_tier: c.privilege_tier,
      privilege_tier_assigned_at: c.privilege_tier_assigned_at,
      privilege_tier_qualified_spend_12m_sar:
        c.privilege_tier_qualified_spend_12m_sar,
      privilege_below_threshold_since: c.privilege_below_threshold_since,
      tier_locked_until: c.tier_locked_until,
      cashback_balance_sar: c.cashback_balance_sar,
      two_factor_enabled: c.two_factor_enabled,
    },
    recent_ledger: (ledgerData ?? []) as ClientLoyaltyLedgerRow[],
    recent_change_log: (changeLogData ?? []) as PrivilegeTierChangeLogRow[],
  };
}

/**
 * Variant for the /me/privilege/history page that returns the full
 * ledger (paginated client-side for now; v2 may add server-side
 * pagination once volumes warrant).
 */
export async function readClientLedgerHistory(args: {
  limit?: number;
} = {}): Promise<{
  client_id: string;
  ledger: ClientLoyaltyLedgerRow[];
}> {
  const session = await requireClientSession();
  const limit = args.limit ?? 100;

  const admin = createAdminClient() as unknown as LooseClient;

  const { data, error } = await admin
    .from('client_loyalty_ledger')
    .select(
      'id, client_id, event_type, amount_sar, balance_after_sar, booking_id, source_change_log_id, source_subscription_id, admin_actor_cookie_fingerprint, admin_reason, cashback_expiry_at, created_at'
    )
    .eq('client_id', session.client_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`readClientLedgerHistory: ${error.message ?? 'unknown'}`);
  }

  return {
    client_id: session.client_id,
    ledger: (data ?? []) as ClientLoyaltyLedgerRow[],
  };
}

/**
 * Public-facing read of the tier thresholds table. Used by the
 * marketing /privilege page and by client UI components that
 * render the tier comparison table. Service-role bypass (the
 * table is conceptually public but we avoid CREATE POLICY for
 * consistency with Phase 12).
 */
export async function readPublicTierThresholds(): Promise<
  Array<{
    tier: 'silver' | 'gold' | 'platinum' | 'diamond';
    min_qualified_spend_sar: string;
    cashback_pct: string;
    empty_legs_boost_hours: number;
    free_diamond_shield: boolean;
    two_factor_required: boolean;
    cashback_expiry_months: number;
    perks_jsonb: Record<string, unknown>;
  }>
> {
  type LookupClient = {
    from: (table: string) => {
      select: (cols: string) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  const admin = createAdminClient() as unknown as LookupClient;
  const { data, error } = await admin
    .from('privilege_tier_thresholds')
    .select(
      'tier, min_qualified_spend_sar, cashback_pct, empty_legs_boost_hours, free_diamond_shield, two_factor_required, cashback_expiry_months, perks_jsonb'
    )
    .order('min_qualified_spend_sar', { ascending: true });

  if (error) {
    throw new Error(
      `readPublicTierThresholds: ${error.message ?? 'unknown'}`
    );
  }
  return (data ?? []) as Array<{
    tier: 'silver' | 'gold' | 'platinum' | 'diamond';
    min_qualified_spend_sar: string;
    cashback_pct: string;
    empty_legs_boost_hours: number;
    free_diamond_shield: boolean;
    two_factor_required: boolean;
    cashback_expiry_months: number;
    perks_jsonb: Record<string, unknown>;
  }>;
}
