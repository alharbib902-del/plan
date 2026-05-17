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
import {
  sendCertWarningEmail,
  sendCertExpiredEmail,
} from '@/lib/medevac/cert-notifications';

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
 *      matching warning_*d_sent_at flag is NULL. Atomically
 *      stamp the flag, send the cert-warning email inline
 *      (operator + founder per Round 2 P2 #3), then audit
 *      with `email_sent: bool` so the canary card surfaces
 *      Resend failures alongside the dispatch + SLA channels.
 *
 *   2. Enforcement flip (cert ACTUALLY expired)
 *      Scan rows where certification_expires_at <= NOW() AND
 *      at least one supports_* is still true. Flip all 4
 *      supports_* to false (the §3.5 enforce trigger allows
 *      this UPDATE because the cert is expired), send the
 *      final `medical_cert_expired_now` email (operator +
 *      founder), then audit with `email_sent`.
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
 * Email pipeline (Round 2 PR #78 P2 #3 fix; Round 4 PR #78
 * P2 #1 fix rewrote this paragraph to remove a stale
 * placeholder quote that misled an automated scan):
 *   - cert warning emails (4 thresholds) AND the final
 *     cert-expired email are sent INLINE by this cron route
 *     via `lib/medevac/cert-notifications.ts`
 *     (`sendCertWarningEmail` + `sendCertExpiredEmail`).
 *   - each send fires AFTER the atomic stamp/flip in the
 *     same loop iteration wins; that ordering plus the
 *     stamp-is-the-record-of-firing invariant guarantees
 *     two concurrent workers never both send the same
 *     threshold for the same cert.
 *   - email failures DO NOT roll back the stamp/flip — the
 *     dispatch-safety invariant is the supports_* flip
 *     (gates distribution.ts immediately); the email is
 *     observability. Rolling back on send-failure would
 *     re-fire the threshold on the next tick and spam.
 *   - each send writes its outcome into
 *     `medevac_email_alert_status` via
 *     recordMedevacEmailAlertStatus, so a Resend outage
 *     surfaces on the 7th `<ChannelHealth>` card on
 *     /admin/operators/canary.
 *   - audit_logs `new_value` carries `email_sent: bool`
 *     alongside the existing stamped_at / flipped_at fields.
 */

const SCAN_LIMIT = 200;

// Row shape for the route's local processing. Wraps the
// shared CertExpiryRow (testable helpers in
// lib/medevac/cert-expiry-helpers.ts) with the aircraft_id
// FK column the route needs for UPDATE targeting.
interface CertRow extends CertExpiryRow {
  aircraft_id: string;
}

// Round 1 PR #78 P1 #2 fix — `.eq()` chains directly to
// `.is()` (for the warning-cascade column-null check) OR to
// `.select()` (for the enforcement-flip + renewal-reset
// identity-only updates). The earlier shape inserted a
// no-op `.is('aircraft_id', row.aircraft_id)` segment to
// keep the chain uniform — but PostgREST `.is()` is for
// NULL / boolean checks, NOT UUID equality, so the
// resulting filter was invalid and the UPDATE silently
// did nothing in some PostgREST versions (expired certs
// would never flip; renewals would never reset). The
// type split below mirrors the two real call sites:
//   - flipChain / resetChain → `.eq().select(...)`
//   - warningChain          → `.eq().is(col, null).select(...)`
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
        select: (cols: string) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
        is: (
          col: string,
          val: unknown
        ) => {
          select: (cols: string) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        };
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
        // Round 1 PR #78 P1 #2 fix — dropped the bogus
        // `.is('aircraft_id', row.aircraft_id)` identity guard
        // (PostgREST `.is()` is for NULL/boolean checks, not
        // UUID equality — it generated an invalid filter and
        // the UPDATE silently no-op'd in some PostgREST
        // versions, leaving expired aircraft eligible for
        // dispatch). The primary-key `.eq('aircraft_id', ...)`
        // is the only filter needed; `.select('aircraft_id')`
        // returns the affected row so we can verify the flip
        // actually landed via updatedCount > 0.
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
          .select('aircraft_id');
        const flipCount = Array.isArray(
          (flipResult as { data?: unknown }).data
        )
          ? ((flipResult as { data: unknown[] }).data.length)
          : 0;
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
        } else if (flipCount === 0) {
          // The PK didn't match — row deleted between read +
          // write (rare; defensive log so a regression here
          // surfaces).
          console.error(
            '[medevac.cron.expire-certs] flip affected 0 rows',
            { aircraft_id: row.aircraft_id }
          );
          errors += 1;
        } else {
          enforcement_flipped += 1;
          // Round 2 PR #78 P2 #3 fix — fire the final
          // `medical_cert_expired_now` operator + founder
          // email AFTER the flip lands. Email failures don't
          // roll back the flip (the flip is the
          // dispatch-safety invariant; the email is
          // observability) but they do flag the singleton
          // via recordMedevacEmailAlertStatus.
          const email = await sendCertExpiredEmail({
            aircraft_id: row.aircraft_id,
            certification_expires_at: row.certification_expires_at,
          });
          auditRows.push({
            entity_type: 'aircraft_medical_certifications',
            entity_id: row.aircraft_id,
            action: 'medical_cert_expired_now',
            new_value: {
              expired_at: row.certification_expires_at,
              flipped_at: nowIso,
              email_sent: email.sent,
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
        // Round 1 PR #78 P1 #2 fix — same `.is()` drop as the
        // enforcement flip above. PK `.eq()` is the only
        // filter needed; `.select()` returns the affected row
        // so we can verify the reset landed.
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
          .select('aircraft_id');
        const resetCount = Array.isArray(
          (resetResult as { data?: unknown }).data
        )
          ? ((resetResult as { data: unknown[] }).data.length)
          : 0;
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
        } else if (resetCount === 0) {
          console.error(
            '[medevac.cron.expire-certs] reset affected 0 rows',
            { aircraft_id: row.aircraft_id }
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
      // Round 2 PR #78 P2 #3 fix — fire the cascade warning
      // email AFTER the atomic flag stamp wins (so two
      // concurrent workers never both send). Email failure
      // doesn't roll back the stamp (the stamp is the "this
      // threshold already fired" record; rolling it back
      // would re-fire the email on the next tick + spam).
      const email = await sendCertWarningEmail({
        aircraft_id: row.aircraft_id,
        threshold_days: due,
        certification_expires_at: row.certification_expires_at,
      });
      auditRows.push({
        entity_type: 'aircraft_medical_certifications',
        entity_id: row.aircraft_id,
        action: 'medical_cert_warning_queued',
        new_value: {
          threshold_days: due,
          expires_at: row.certification_expires_at,
          stamped_at: nowIso,
          email_sent: email.sent,
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
