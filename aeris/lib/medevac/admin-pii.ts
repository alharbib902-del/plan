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
  MedevacRequestRow,
  MedevacRequestRedactedRow,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — D12 admin PII surface for medevac requests.
 *
 * Two exports:
 *   - readAdminMedevacRequestDetail(requestId): AUDITED full
 *     read; calls the §4.10 SECURITY DEFINER RPC which writes
 *     the `admin_pii_read` audit row + returns the PII payload
 *     in ONE statement-level transaction. The audit INSERT
 *     happens BEFORE the PII SELECT inside the RPC, so a
 *     SELECT failure can never expose data unaudited.
 *   - listAdminMedevacRequests(): REDACTED list/index variant
 *     for `/admin/medevac` queue + future search/export. NEVER
 *     selects patient_name_snapshot OR patient_age_snapshot;
 *     no audit row is written because no PII left the DB.
 *
 * Round 6/7/10/11 PR #75 fixes are all enforced here:
 *   - audit_logs.user_id = NULL (admin auth is a cookie, not
 *     a users.id); session identity lives in new_value via
 *     cookie_expiry + cookie_fingerprint (HMAC of the raw
 *     cookie using ADMIN_AUDIT_FINGERPRINT_SECRET)
 *   - fail-closed env guard: if
 *     ADMIN_AUDIT_FINGERPRINT_SECRET is missing/empty we
 *     throw AdminPiiEnvError BEFORE any cookie read or RPC
 *     call — refusing to render PII without a working audit
 *     fingerprint pipeline
 *   - route-param isUuid() short-circuit: a URL like
 *     /admin/medevac/not-a-uuid returns null before any RPC
 *     call, fingerprint compute, or audit write
 *   - the helper hashes the SAME raw cookie value Postgres
 *     later stores the HMAC of, so the fingerprint is
 *     reproducible per-session (queryable in audit_logs
 *     without ever leaking the cookie itself)
 */

export class AdminPiiEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminPiiEnvError';
  }
}

/**
 * Read the audit-fingerprint secret once, fail-closed if it's
 * missing/empty. Cached at module level so subsequent calls
 * don't re-validate the env every request.
 */
function readFingerprintSecret(): string {
  const secret = process.env.ADMIN_AUDIT_FINGERPRINT_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new AdminPiiEnvError(
      'ADMIN_AUDIT_FINGERPRINT_SECRET is missing or empty'
    );
  }
  return secret;
}

export interface AdminMedevacRequestDetail {
  request: MedevacRequestRow;
  audit_logged_at: string;
}

/**
 * Audited admin PII read for a single medevac request.
 *
 * Steps (Round 10/11 PR #75 sequence):
 *   1. Fail-closed env guard (ADMIN_AUDIT_FINGERPRINT_SECRET).
 *   2. Route-param isUuid() short-circuit → null on bad UUID.
 *   3. Read raw cookie + validate via requireAdminSession().
 *   4. HMAC the SAME raw cookie with the env secret →
 *      cookie_fingerprint.
 *   5. Call §4.10 SECURITY DEFINER RPC; RPC writes the audit
 *      row first, then SELECTs the PII payload — all atomic.
 *   6. Return the RPC payload. Re-throw any structured RPC
 *      error so the page never receives PII with a missing-
 *      attribution failure mode.
 *
 * Returns:
 *   - { request, audit_logged_at } on ok
 *   - null when the request was not found OR the requestId
 *     was not a valid UUID (page renders its standard
 *     not-found branch)
 *
 * Throws:
 *   - AdminPiiEnvError when ADMIN_AUDIT_FINGERPRINT_SECRET is
 *     missing/empty (caught by the page-level error boundary
 *     which surfaces "admin temporarily unavailable")
 *   - Error on any RPC-level structured error other than
 *     `request_not_found` (e.g. `admin_session_metadata_required`
 *     which can only happen if the helper itself is bypassed)
 */
export async function readAdminMedevacRequestDetail(
  requestId: string
): Promise<AdminMedevacRequestDetail | null> {
  // Step 1 — fail-closed env guard.
  const secret = readFingerprintSecret();

  // Step 2 — route-param UUID guard (Round 8 P2 #3).
  if (!isUuid(requestId)) return null;

  // Step 3 — read raw cookie + validate via requireAdminSession().
  // requireAdminSession() re-reads + verifies the same cookie
  // via verifyAdminCookieValue() internally and redirects to
  // /admin/login on failure, so `session` is guaranteed valid.
  const rawCookie = cookies().get(ADMIN_COOKIE_NAME)?.value;
  const session = requireAdminSession();
  if (!rawCookie) {
    // requireAdminSession would already have redirected; this
    // is belt-and-suspenders for the TS narrowing path.
    redirect('/admin/login');
  }

  // Step 4 — HMAC the SAME raw cookie with the env secret.
  const cookie_fingerprint = createHmac('sha256', secret)
    .update(rawCookie, 'utf8')
    .digest('hex');
  const cookie_expiry =
    typeof session.expiry === 'number' ? String(session.expiry) : '';

  // Step 5 — call the SECURITY DEFINER RPC.
  // Loose-cast pattern (Phase 9 convention #15) because the
  // §4.10 RPC isn't in types/database.ts yet.
  type LooseRpcClient = {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  const looseClient = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await looseClient.rpc(
    'admin_read_medevac_request_detail',
    {
      p_request_id: requestId,
      p_session_metadata: {
        cookie_expiry,
        cookie_fingerprint,
      },
    }
  );

  if (error) {
    console.error('[medevac.admin-pii.read] RPC failed', error);
    throw new Error(
      `readAdminMedevacRequestDetail failed: ${error.message}`
    );
  }

  // Step 6 — handle the RPC's JSON envelope.
  const result = data as
    | {
        ok: true;
        request: MedevacRequestRow;
        audit_logged_at: string;
      }
    | { ok: false; error: string }
    | null;

  if (!result) {
    throw new Error(
      'readAdminMedevacRequestDetail: RPC returned no payload'
    );
  }

  if (result.ok === false) {
    if (result.error === 'request_not_found') {
      // Real not-found — render the standard 404 branch.
      // The audit row was still written (captures the access
      // attempt) per §4.10 step 1.
      return null;
    }
    // Anything else (especially `admin_session_metadata_required`)
    // means a helper bypass — re-throw so the page never
    // receives PII with a missing-attribution failure mode.
    throw new Error(
      `readAdminMedevacRequestDetail: ${result.error}`
    );
  }

  return {
    request: result.request,
    audit_logged_at: result.audit_logged_at,
  };
}

/**
 * PII-free list/index variant for `/admin/medevac` queue +
 * future admin search/export. NEVER selects
 * patient_name_snapshot OR patient_age_snapshot — those are
 * admin-detail-only per D8 (Round 10 P1 #1). No audit row
 * is written because no PII left the DB.
 */
export async function listAdminMedevacRequests(
  limit = 50
): Promise<MedevacRequestRedactedRow[]> {
  type LooseSelectClient = {
    from: (table: string) => {
      select: (cols: string) => {
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
  const looseClient = createAdminClient() as unknown as LooseSelectClient;
  const { data, error } = await looseClient
    .from('medevac_requests')
    .select(
      [
        'id',
        'medevac_request_number',
        'condition_severity',
        'service_level',
        'from_location_freeform',
        'from_iata',
        'to_hospital_name',
        'to_iata',
        'status',
        'is_covered',
        'estimated_value_sar',
        'dispatched_at',
        'sla_escalated_at',
        'created_at',
        'updated_at',
      ].join(',')
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[medevac.admin-pii.list] read failed', error);
    throw new Error(
      `listAdminMedevacRequests failed: ${error.message}`
    );
  }
  return (data ?? []) as MedevacRequestRedactedRow[];
}
