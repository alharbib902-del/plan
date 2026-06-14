import type {
  ClientLoyaltyLedgerRow,
  PrivilegeTierChangeLogRow,
  ClientPrivilegeColumns,
} from '@/lib/privilege/types';

/**
 * Pure privilege serializers (NO 'server-only', tsx-testable). Strict
 * positive allowlists — never `...row`.
 *
 * SECURITY — the raw loyalty-ledger + tier-change-log rows are an
 * ADMIN audit trail; they MUST NOT leak to the client:
 *   - admin_actor_cookie_fingerprint, admin_reason (admin-internal — the
 *     free-text admin note + the actor fingerprint)
 *   - client_id (it's the caller's own id)
 *   - source_change_log_id / source_subscription_id (internal linkage)
 * The client's OWN money fields (amount_sar / balance_after_sar /
 * cashback_balance_sar / qualified_spend) ARE shown — these are the
 * client's privilege/cashback figures, not internal commission. All
 * arrive as NUMERIC-as-string over PostgREST and pass through verbatim
 * (the app parses).
 */

export function serializePrivilegeLedgerRow(row: ClientLoyaltyLedgerRow) {
  return {
    id: row.id,
    event_type: row.event_type,
    amount_sar: row.amount_sar,
    balance_after_sar: row.balance_after_sar,
    booking_id: row.booking_id,
    cashback_expiry_at: row.cashback_expiry_at,
    created_at: row.created_at,
  };
}

export function serializePrivilegeChangeLogRow(row: PrivilegeTierChangeLogRow) {
  return {
    id: row.id,
    from_tier: row.from_tier,
    to_tier: row.to_tier,
    // `reason` is the STRUCTURED enum (e.g. upgrade/downgrade) — client
    // facing; `admin_reason` (free-text) is stripped above.
    reason: row.reason,
    qualified_spend_12m_sar: row.qualified_spend_12m_sar,
    grace_started_at: row.grace_started_at,
    lock_until: row.lock_until,
    source_booking_id: row.source_booking_id,
    created_at: row.created_at,
  };
}

export function serializePrivilegeColumns(p: ClientPrivilegeColumns) {
  return {
    privilege_tier: p.privilege_tier,
    privilege_tier_assigned_at: p.privilege_tier_assigned_at,
    qualified_spend_12m_sar: p.privilege_tier_qualified_spend_12m_sar,
    below_threshold_since: p.privilege_below_threshold_since,
    tier_locked_until: p.tier_locked_until,
    cashback_balance_sar: p.cashback_balance_sar,
    two_factor_enabled: p.two_factor_enabled,
  };
}

export interface PrivilegeDashboardInput {
  full_name: string;
  privilege: ClientPrivilegeColumns;
  recent_ledger: ClientLoyaltyLedgerRow[];
  recent_change_log: PrivilegeTierChangeLogRow[];
}

export function serializePrivilegeDashboardForMobile(d: PrivilegeDashboardInput) {
  return {
    full_name: d.full_name,
    privilege: serializePrivilegeColumns(d.privilege),
    recent_ledger: d.recent_ledger.map(serializePrivilegeLedgerRow),
    recent_change_log: d.recent_change_log.map(serializePrivilegeChangeLogRow),
  };
}
