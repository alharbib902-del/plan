import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyCronAuth,
  unauthorizedJsonResponse,
} from '@/lib/empty-legs/cron-auth';
import {
  isCertExpired,
  hasAnyCapability,
  shouldResetWarnings,
  dueWarningThreshold,
  thresholdColumn,
  type CertExpiryRow,
} from '@/lib/medevac/cert-expiry-helpers';

/**
 * Phase 12 PR 3 — medical certification expiry cron.
 *
 * Schedule: every 30 minutes (vercel.json).
 * Auth: shared CRON_SECRET.
 *
 * Per spec D11 — three independent actions per tick (Round 1
 * P1 #4 + Round 4 P2 #4):
 *
 *   1. Warning cascade (NO flag flip)
 *      Scan rows where certification_expires_at − NOW() falls
 *      inside one of the 4 thresholds (30/14/7/1 day) AND the
 *      matching warning_*d_sent_at flag is NULL. Stamp the
 *      flag (atomic conditional UPDATE) and queue the
 *      `expired_medical_cert_alert` email exactly once per
 *      renewal cycle.
 *
 *   2. Enforcement flip (cert ACTUALLY expired)
 *      Scan rows where certification_expires_at <= NOW() AND
 *      at least one supports_* is still true. Flip all 4
 *      supports_* to false (the §3.5 enforce trigger allows
 *      this UPDATE because the cert is expired) + queue the
 *      final `medical_cert_expired_now` email.
 *
 *   3. Renewal reset (Round 4 P2 #4 — > 30 days only)
 *      Scan rows where certification_expires_at > NOW() +
 *      INTERVAL '30 days' AND any warning_*d_sent_at is NOT
 *      NULL. Reset all 4 flags to NULL so the warning
 *      cascade re-fires for the next cycle.
 *      Critically narrow to > 30 days — without that
 *      threshold a mid-warning-window renewal would reset
 *      the flags + the cron would re-send every threshold
 *      on the next tick.
 *
 * Email side: this cron stamps + audits, but the
 * `expired_medical_cert_alert` and `medical_cert_expired_now`
 * email senders themselves are out of scope for PR 3 v1 —
 * they're queued as audit_logs entries here and a future
 * notifications pipeline / Phase 13 polish wires them to
 * Resend. The MVP value is the supports_* flip (which gates
 * distribution.ts immediately) and the warning-flag stamping
 * (which prevents duplicate emails once the senders ship).
 */

const SCAN_LIMIT = 200;

// Row shape for the route's local processing. Wraps the
// shared CertExpiryRow (testable helpers in
// lib/medevac/cert-expiry-helpers.ts) with the aircraft_id
// FK column the route needs for UPDATE targeting.
interface CertRow extends CertExpiryRow {
  aircraft_id: string;
}

type LooseSelect = {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
    update: (patch: Record<string, unknown>) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        is: (
          col: string,
          val: unknown
        ) => {
          select: (cols: string) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        } & Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

type LooseAudit = {
  from: (table: string) => {
    insert: (rows: Record<string, unknown>[]) => Promise<{
      data: unknown;
      error: { message?: string } | null;
    }>;
  };
};

// Helper functions extracted to lib/medevac/cert-expiry-helpers.ts
// so the warning-cascade + enforcement-flip + renewal-reset
// logic is testable in isolation (medical-cert-expiry.test.ts).

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) return unauthorizedJsonResponse();

  const admin = createAdminClient() as unknown as LooseSelect;
  const audit = createAdminClient() as unknown as LooseAudit;

  // Scan ALL cert rows (v1 — fine for our scale; later
  // polish can add a partial index on rows that need attention).
  const { data, error } = await admin
    .from('aircraft_medical_certifications')
    .select(
      [
        'aircraft_id',
        'supports_bmt',
        'supports_als',
        'supports_cct',
        'supports_repatriation',
        'certification_expires_at',
        'warning_30d_sent_at',
        'warning_14d_sent_at',
        'warning_7d_sent_at',
        'warning_1d_sent_at',
      ].join(',')
    )
    .limit(SCAN_LIMIT);
  if (error) {
    console.error(
      '[medevac.cron.expire-certs] read failed',
      error
    );
    return NextResponse.json(
      { ok: false, error: 'read_failed' },
      { status: 500 }
    );
  }
  const certs = (data ?? []) as CertRow[];

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let warnings_queued = 0;
  let enforcement_flipped = 0;
  let renewal_reset = 0;
  let errors = 0;
  const auditRows: Record<string, unknown>[] = [];

  for (const row of certs) {
    const expired = isCertExpired(row, nowMs);

    // 2. Enforcement flip — cert expired AND any flag still true.
    if (expired && hasAnyCapability(row)) {
      try {
        const flipResult = await admin
          .from('aircraft_medical_certifications')
          .update({
            supports_bmt: false,
            supports_als: false,
            supports_cct: false,
            supports_repatriation: false,
            updated_at: nowIso,
          })
          .eq('aircraft_id', row.aircraft_id)
          .is('aircraft_id', row.aircraft_id) // identity guard
          .select('aircraft_id');
        // Note: the `.is('aircraft_id', row.aircraft_id)` segment is
        // a no-op identity filter to keep the chain shape consistent
        // with the loose-cast LooseSelect type. PostgREST evaluates
        // it (col IS value), which always matches for non-NULL UUIDs.
        if (
          flipResult &&
          typeof flipResult === 'object' &&
          'error' in flipResult &&
          flipResult.error
        ) {
          console.error(
            '[medevac.cron.expire-certs] flip failed',
            flipResult.error
          );
          errors += 1;
        } else {
          enforcement_flipped += 1;
          auditRows.push({
            entity_type: 'aircraft_medical_certifications',
            entity_id: row.aircraft_id,
            action: 'medical_cert_expired_now',
            new_value: {
              expired_at: row.certification_expires_at,
              flipped_at: nowIso,
            },
            user_id: null,
          });
        }
      } catch (err) {
        console.error('[medevac.cron.expire-certs] flip threw', err);
        errors += 1;
      }
      continue; // already-expired rows skip warning + reset
    }

    // 3. Renewal reset — shouldResetWarnings enforces the
    // > 30 days floor from Round 4 PR #75 P2 #4 fix so a
    // mid-warning-window renewal doesn't spam the cascade.
    if (shouldResetWarnings(row, nowMs)) {
      try {
        const resetResult = await admin
          .from('aircraft_medical_certifications')
          .update({
            warning_30d_sent_at: null,
            warning_14d_sent_at: null,
            warning_7d_sent_at: null,
            warning_1d_sent_at: null,
            updated_at: nowIso,
          })
          .eq('aircraft_id', row.aircraft_id)
          .is('aircraft_id', row.aircraft_id)
          .select('aircraft_id');
        if (
          resetResult &&
          typeof resetResult === 'object' &&
          'error' in resetResult &&
          resetResult.error
        ) {
          console.error(
            '[medevac.cron.expire-certs] reset failed',
            resetResult.error
          );
          errors += 1;
        } else {
          renewal_reset += 1;
          auditRows.push({
            entity_type: 'aircraft_medical_certifications',
            entity_id: row.aircraft_id,
            action: 'medical_cert_warning_flags_reset',
            new_value: {
              renewed_to: row.certification_expires_at,
              reset_at: nowIso,
            },
            user_id: null,
          });
        }
      } catch (err) {
        console.error(
          '[medevac.cron.expire-certs] reset threw',
          err
        );
        errors += 1;
      }
      continue;
    }

    // 1. Warning cascade — atomic flag-stamp per threshold.
    const due = dueWarningThreshold(row, nowMs);
    if (!due) continue;
    const col = thresholdColumn(due);
    try {
      const stampResult = await admin
        .from('aircraft_medical_certifications')
        .update({
          [col]: nowIso,
          updated_at: nowIso,
        })
        .eq('aircraft_id', row.aircraft_id)
        .is(col, null)
        .select('aircraft_id');
      const stampedCount = Array.isArray(
        (stampResult as { data?: unknown }).data
      )
        ? ((stampResult as { data: unknown[] }).data.length)
        : 0;
      if (
        stampResult &&
        typeof stampResult === 'object' &&
        'error' in stampResult &&
        stampResult.error
      ) {
        console.error(
          '[medevac.cron.expire-certs] warning stamp failed',
          stampResult.error
        );
        errors += 1;
        continue;
      }
      if (stampedCount === 0) {
        // Race lost — another worker stamped already; skip.
        continue;
      }
      warnings_queued += 1;
      auditRows.push({
        entity_type: 'aircraft_medical_certifications',
        entity_id: row.aircraft_id,
        action: 'medical_cert_warning_queued',
        new_value: {
          threshold_days: due,
          expires_at: row.certification_expires_at,
          stamped_at: nowIso,
        },
        user_id: null,
      });
    } catch (err) {
      console.error(
        '[medevac.cron.expire-certs] warning stamp threw',
        err
      );
      errors += 1;
    }
  }

  if (auditRows.length > 0) {
    try {
      const auditResult = await audit
        .from('audit_logs')
        .insert(auditRows);
      if (auditResult.error) {
        console.error(
          '[medevac.cron.expire-certs] audit insert failed',
          auditResult.error
        );
      }
    } catch (err) {
      console.error('[medevac.cron.expire-certs] audit insert threw', err);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: certs.length,
    warnings_queued,
    enforcement_flipped,
    renewal_reset,
    errors,
  });
}
