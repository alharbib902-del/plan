import 'server-only';

import { createHmac } from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  ADMIN_COOKIE_NAME,
  requireAdminSession,
} from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type {
  ClientPrivilegeColumns,
  ClientLoyaltyLedgerRow,
  PrivilegeTierChangeLogRow,
  AdminForceTierResult,
  ClientPrivilegeTier,
} from '@/lib/privilege/types';

/**
 * Phase 13 PR 1 — D17 admin PII surface for privilege detail.
 *
 * Mirrors Phase 12 `lib/medevac/admin-pii.ts` pattern:
 *   - readAdminClientPrivilegeDetail(clientId): audited read returning
 *     tier + balance + recent ledger entries + recent change_log;
 *     audit row written BEFORE the SELECT so missing-attribution
 *     failures can never expose data unaudited.
 *   - forceAdminClientPrivilegeTier(clientId, newTier, reason,
 *     lockUntil): calls §4.5 RPC; session metadata required;
 *     fail-closed on missing fingerprint secret.
 *
 * Round 13 PR #80 D17 invariant enforced here:
 *   - audit_logs.user_id = NULL (admin auth is cookie, not users.id)
 *   - session identity via cookie_expiry + cookie_fingerprint
 *     (HMAC of raw cookie using ADMIN_AUDIT_FINGERPRINT_SECRET)
 *   - fail-closed: missing env → AdminPrivilegeEnvError BEFORE any
 *     cookie read or RPC call
 *   - route-param isUuid() short-circuit on bad UUID
 */

export class AdminPrivilegeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminPrivilegeEnvError';
  }
}

function readFingerprintSecret(): string {
  const secret = process.env.ADMIN_AUDIT_FINGERPRINT_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new AdminPrivilegeEnvError(
      'ADMIN_AUDIT_FINGERPRINT_SECRET is missing or empty'
    );
  }
  return secret;
}

export interface AdminClientPrivilegeDetail {
  client: {
    id: string;
    full_name: string;
    auth_email: string;
    contact_phone: string;
  } & ClientPrivilegeColumns;
  recent_ledger: ClientLoyaltyLedgerRow[];
  recent_change_log: PrivilegeTierChangeLogRow[];
  audit_logged_at: string;
}

type LooseAdminClient = {
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
    insert: (row: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message?: string } | null;
    }>;
  };
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

/**
 * Audited admin privilege read for one client.
 *
 * Steps:
 *   1. Fail-closed env guard (ADMIN_AUDIT_FINGERPRINT_SECRET).
 *   2. Route-param isUuid() guard → null on bad UUID.
 *   3. Read raw cookie + requireAdminSession() guard.
 *   4. Compute cookie_fingerprint via HMAC.
 *   5. Write audit_logs row BEFORE any SELECT.
 *   6. Load client + recent ledger (20) + recent change_log (10).
 */
export async function readAdminClientPrivilegeDetail(
  clientId: string
): Promise<AdminClientPrivilegeDetail | null> {
  const secret = readFingerprintSecret();
  if (!isUuid(clientId)) return null;

  const rawCookie = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  const session = await requireAdminSession();
  if (!rawCookie) {
    redirect('/admin/login');
  }

  const cookie_fingerprint = createHmac('sha256', secret)
    .update(rawCookie, 'utf8')
    .digest('hex');
  const cookie_expiry =
    typeof session.expiry === 'number' ? String(session.expiry) : '';

  const admin = createAdminClient() as unknown as LooseAdminClient;

  // Audit FIRST. Any subsequent failure is acceptable; what we
  // can't allow is a SELECT that returns PII without an audit row.
  const auditedAt = new Date().toISOString();
  const { error: auditErr } = await admin
    .from('audit_logs')
    .insert({
      entity_type: 'client_privilege_detail',
      entity_id: clientId,
      action: 'admin_privilege_read',
      user_id: null,
      new_value: {
        cookie_expiry,
        cookie_fingerprint,
        client_id: clientId,
        viewed_at: auditedAt,
      },
    });

  if (auditErr) {
    console.error('[privilege.admin-pii.read] audit insert failed', auditErr);
    throw new Error(
      `readAdminClientPrivilegeDetail: audit failed: ${auditErr.message}`
    );
  }

  // Load client row
  const { data: clientData, error: clientErr } = await admin
    .from('clients')
    .select(
      [
        'id',
        'full_name',
        'auth_email',
        'contact_phone',
        'privilege_tier',
        'privilege_tier_assigned_at',
        'privilege_tier_qualified_spend_12m_sar',
        'privilege_below_threshold_since',
        'tier_locked_until',
        'cashback_balance_sar',
        'two_factor_enabled',
      ].join(',')
    )
    .eq('id', clientId)
    .single();

  if (clientErr || !clientData) {
    if (clientErr?.code === 'PGRST116') return null; // not found
    if (clientErr) {
      console.error('[privilege.admin-pii.read] client select failed', clientErr);
      throw new Error(
        `readAdminClientPrivilegeDetail: ${clientErr.message ?? 'unknown'}`
      );
    }
    return null;
  }

  // Load recent ledger entries (last 20)
  const { data: ledgerData, error: ledgerErr } = await admin
    .from('client_loyalty_ledger')
    .select(
      'id, client_id, event_type, amount_sar, balance_after_sar, booking_id, source_change_log_id, source_subscription_id, admin_actor_cookie_fingerprint, admin_reason, cashback_expiry_at, created_at'
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (ledgerErr) {
    console.error('[privilege.admin-pii.read] ledger select failed', ledgerErr);
    throw new Error(
      `readAdminClientPrivilegeDetail ledger: ${ledgerErr.message ?? 'unknown'}`
    );
  }

  // Load recent change_log entries (last 10)
  const { data: changeLogData, error: changeLogErr } = await admin
    .from('privilege_tier_change_log')
    .select(
      'id, client_id, from_tier, to_tier, reason, qualified_spend_12m_sar, grace_started_at, admin_actor_cookie_fingerprint, admin_reason, lock_until, source_booking_id, created_at'
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (changeLogErr) {
    console.error('[privilege.admin-pii.read] change_log select failed', changeLogErr);
    throw new Error(
      `readAdminClientPrivilegeDetail change_log: ${changeLogErr.message ?? 'unknown'}`
    );
  }

  return {
    client: clientData as AdminClientPrivilegeDetail['client'],
    recent_ledger: (ledgerData ?? []) as ClientLoyaltyLedgerRow[],
    recent_change_log: (changeLogData ?? []) as PrivilegeTierChangeLogRow[],
    audit_logged_at: auditedAt,
  };
}

/**
 * Admin force tier change. Wraps §4.5 RPC + adds the audit row.
 *
 * Returns the structured RPC envelope so the page can display
 * either success state or the specific error code.
 */
export async function forceAdminClientPrivilegeTier(args: {
  client_id: string;
  new_tier: ClientPrivilegeTier;
  reason: string;
  lock_until: string | null; // YYYY-MM-DD or null
}): Promise<AdminForceTierResult> {
  const secret = readFingerprintSecret();
  if (!isUuid(args.client_id)) {
    return { ok: false, error: 'client_not_found' };
  }

  const rawCookie = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  const session = await requireAdminSession();
  if (!rawCookie) {
    redirect('/admin/login');
  }

  const cookie_fingerprint = createHmac('sha256', secret)
    .update(rawCookie, 'utf8')
    .digest('hex');
  const cookie_expiry =
    typeof session.expiry === 'number' ? String(session.expiry) : '';

  const admin = createAdminClient() as unknown as LooseAdminClient;

  // Audit BEFORE RPC. The RPC also writes its own change_log entry,
  // so we get two audit surfaces (admin action + tier change).
  await admin.from('audit_logs').insert({
    entity_type: 'client_privilege_tier',
    entity_id: args.client_id,
    action: 'admin_privilege_force_tier',
    user_id: null,
    new_value: {
      cookie_expiry,
      cookie_fingerprint,
      client_id: args.client_id,
      requested_tier: args.new_tier,
      reason_preview: args.reason.slice(0, 100),
      lock_until: args.lock_until,
    },
  });

  const { data, error } = await admin.rpc('admin_force_privilege_tier', {
    p_client_id: args.client_id,
    p_new_tier: args.new_tier,
    p_session_metadata: {
      cookie_expiry,
      cookie_fingerprint,
    },
    p_reason: args.reason,
    p_lock_until: args.lock_until,
  });

  if (error) {
    console.error('[privilege.admin-pii.force] RPC error', error);
    return { ok: false, error: 'client_not_found' }; // best-effort mapping
  }

  return data as AdminForceTierResult;
}
