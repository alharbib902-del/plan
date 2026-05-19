/**
 * Phase 13 PR 1 — Privilege type definitions.
 *
 * Mirrors the SQL ENUMs + table shapes from
 * 20260519000043_phase_13_pr_1_privilege_intake.sql so callers
 * have stable TypeScript types without waiting for
 * `db:types` regen.
 */

export type ClientPrivilegeTier =
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond';

export const TIER_RANK: Record<ClientPrivilegeTier, number> = {
  silver: 1,
  gold: 2,
  platinum: 3,
  diamond: 4,
};

export const TIER_ORDER: ClientPrivilegeTier[] = [
  'silver',
  'gold',
  'platinum',
  'diamond',
];

export type LoyaltyLedgerEventType =
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'expire'
  | 'refund_back'
  | 'diamond_shield_granted'
  | 'diamond_shield_skipped_paying_paid_plan'
  | 'diamond_shield_revoked_on_downgrade';

export type PrivilegeTierChangeReason =
  | 'signup_default'
  | 'auto_upgrade'
  | 'auto_downgrade'
  | 'admin_force'
  | 'admin_lock_expired'
  | 'data_correction';

export type PrivilegeAdminActionType =
  | 'view_privilege_detail'
  | 'force_tier_change'
  | 'set_tier_lock'
  | 'manual_cashback_adjustment';

/**
 * Row shape returned from privilege_tier_thresholds. Used by
 * the public /privilege page + the /me/privilege progress bar.
 */
export interface PrivilegeTierThreshold {
  tier: ClientPrivilegeTier;
  min_qualified_spend_sar: string; // DECIMAL serialized as string
  cashback_pct: string;
  empty_legs_boost_hours: number;
  free_diamond_shield: boolean;
  two_factor_required: boolean;
  cashback_expiry_months: number;
  perks_jsonb: Record<string, unknown>;
  updated_at: string;
}

/**
 * Row shape for client_loyalty_ledger. `amount_sar` is signed
 * per the §3.2 amount_sign_check constraint.
 */
export interface ClientLoyaltyLedgerRow {
  id: string;
  client_id: string;
  event_type: LoyaltyLedgerEventType;
  amount_sar: string;
  balance_after_sar: string;
  booking_id: string | null;
  source_change_log_id: string | null;
  source_subscription_id: string | null;
  admin_actor_cookie_fingerprint: string | null;
  admin_reason: string | null;
  cashback_expiry_at: string | null;
  created_at: string;
}

/**
 * Row shape for privilege_tier_change_log. Admin-only audit trail.
 */
export interface PrivilegeTierChangeLogRow {
  id: string;
  client_id: string;
  from_tier: ClientPrivilegeTier;
  to_tier: ClientPrivilegeTier;
  reason: PrivilegeTierChangeReason;
  qualified_spend_12m_sar: string;
  grace_started_at: string | null;
  admin_actor_cookie_fingerprint: string | null;
  admin_reason: string | null;
  lock_until: string | null;
  source_booking_id: string | null;
  created_at: string;
}

/**
 * Subset of clients columns added by Phase 13.
 */
export interface ClientPrivilegeColumns {
  privilege_tier: ClientPrivilegeTier;
  privilege_tier_assigned_at: string;
  privilege_tier_qualified_spend_12m_sar: string;
  privilege_below_threshold_since: string | null;
  tier_locked_until: string | null;
  cashback_balance_sar: string;
  two_factor_enabled: boolean;
}

/**
 * JSONB envelope shape from evaluate_client_privilege_tier RPC.
 * Per spec §4.2.
 */
export type EvaluateTierResult =
  | {
      ok: true;
      tier_action:
        | 'upgrade'
        | 'no_change'
        | 'start_grace'
        | 'grace_in_progress'
        | 'downgrade_one_step'
        | 'locked_no_action';
      from_tier: ClientPrivilegeTier;
      to_tier: ClientPrivilegeTier;
      qualified_spend_12m_sar: number;
      change_log_id: string | null;
      diamond_shield_granted_subscription_id: string | null;
    }
  | { ok: false; error: string };

/**
 * JSONB envelope shape from award_cashback_for_booking RPC.
 * Per spec §4.3 + D21 idempotency.
 */
export type AwardCashbackResult =
  | {
      ok: true;
      already_awarded: false;
      ledger_id: string;
      tier_at_award: ClientPrivilegeTier;
      cashback_pct: number;
      amount_paid_sar: number;
      cashback_amount_sar: number;
      new_balance_sar: number;
    }
  | {
      ok: true;
      already_awarded: true;
      skipped_reason:
        | 'duplicate_earn_for_booking'
        | 'duplicate_earn_for_booking_race';
      booking_id: string;
    }
  | { ok: false; error: string };

/**
 * JSONB envelope shape from redeem_cashback_for_booking RPC.
 * Per spec §4.4 + F27/F28.
 */
export type RedeemCashbackResult =
  | {
      ok: true;
      ledger_id: string;
      redeemed_sar: number;
      new_balance_sar: number;
      booking_id: string;
    }
  | {
      ok: false;
      error:
        | 'redemption_amount_invalid'
        | 'already_redeemed_for_booking'
        | 'already_redeemed_for_booking_race'
        | 'client_not_found'
        | 'booking_not_found'
        | 'insufficient_balance'
        | 'redemption_exceeds_cap'
        | 'redemption_leaves_no_cash_payment'
        | 'booking_already_paid';
      current_balance?: number;
      requested?: number;
      max_allowed?: number;
    };

/**
 * JSONB envelope shape from admin_force_privilege_tier RPC.
 * Per spec §4.5.
 */
export type AdminForceTierResult =
  | {
      ok: true;
      no_op: false;
      from_tier: ClientPrivilegeTier;
      to_tier: ClientPrivilegeTier;
      change_log_id: string;
      lock_until: string | null;
    }
  | {
      ok: true;
      no_op: true;
      reason: 'tier_unchanged_no_lock';
    }
  | {
      ok: false;
      error:
        | 'admin_session_metadata_required'
        | 'admin_reason_too_short'
        | 'lock_until_must_be_future'
        | 'client_not_found';
    };
