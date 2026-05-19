import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 13 PR 3 round 2 — shared server helper for the 3
 * accept-offer surfaces (charter, cargo, medevac) so each
 * page can decide whether to render `CashbackRedeemInput`
 * above the accept button.
 *
 * Returns a single decision shape:
 *   - `enabled`: ENABLE_PRIVILEGE flag is 'true' AND the
 *     client has a non-zero balance to redeem. The UI gates
 *     rendering of the input on this; when false, the input
 *     is hidden entirely (Phase 7/Phase 9 accept UX preserved).
 *   - `cashback_balance_sar`: integer SAR. 0 when the flag is
 *     off OR the read failed (fail-closed — never block the
 *     accept by surfacing a stale balance).
 *
 * No audit log entry — same rationale as
 * `lib/privilege/client-pii.ts::readClientPrivilegeDashboard`:
 * a client reading their own balance is not auditable per D17.
 */

export interface AcceptCashbackContext {
  enabled: boolean;
  cashback_balance_sar: number;
}

const DISABLED: AcceptCashbackContext = {
  enabled: false,
  cashback_balance_sar: 0,
};

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
      };
    };
  };
};

export async function loadAcceptCashbackContext(
  clientId: string
): Promise<AcceptCashbackContext> {
  if (process.env.ENABLE_PRIVILEGE !== 'true') return DISABLED;

  const admin = createAdminClient() as unknown as LooseClient;
  const { data, error } = await admin
    .from('clients')
    .select('cashback_balance_sar')
    .eq('id', clientId)
    .single();

  if (error || !data) {
    // Fail-closed: rather than surface a possibly stale balance
    // and let the redeem RPC reject the request later, hide the
    // input entirely. Logged for canary triage.
    if (error && error.code !== 'PGRST116') {
      console.error('[accept-context] balance read failed', error);
    }
    return DISABLED;
  }

  const balance = Number(
    (data as { cashback_balance_sar: number | string | null })
      .cashback_balance_sar ?? 0
  );
  if (!Number.isFinite(balance) || balance <= 0) return DISABLED;

  return {
    enabled: true,
    cashback_balance_sar: balance,
  };
}
