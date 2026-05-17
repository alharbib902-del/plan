import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyCronAuth,
  unauthorizedJsonResponse,
} from '@/lib/empty-legs/cron-auth';
import { sendFounderSlaEscalationEmail } from '@/lib/medevac/founder-sla-escalation-email';
import { parseSlaIntervalMinutes } from '@/lib/medevac/sla-interval';
import type {
  MedevacRequestRedactedRow,
  MedevacSeverity,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 3 — medevac SLA escalation cron.
 *
 * Schedule: every 5 minutes (vercel.json).
 * Auth: shared CRON_SECRET.
 *
 * Per spec D10: SLA windows by severity (critical=1h,
 * moderate=4h, stable=24h, stored in §3.6 lookup). The cron
 * scans rows where:
 *
 *   status IN ('pending', 'offers_received')
 *     AND dispatched_at IS NOT NULL
 *     AND dispatched_at + sla_interval < NOW()
 *     AND sla_escalated_at IS NULL
 *
 * and stamps medevac_requests.sla_escalated_at atomically
 * (conditional UPDATE on `sla_escalated_at IS NULL` so only
 * one cron worker per request wins the claim). On a winning
 * claim, sends the founder SLA escalation email with PII
 * redacted per D12.
 *
 * Round 1 P1 #1 fix (§4.10 D10 wording) — no `dispatched`
 * status in the enum; the request stays `pending` /
 * `offers_received` and the escalation cron uses the
 * timestamp + status filter.
 */

const SCAN_LIMIT = 50;

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (
        col: string,
        vals: string[]
      ) => {
        not: (
          col: string,
          op: string,
          val: unknown
        ) => {
          is: (
            col: string,
            val: unknown
          ) => {
            limit: (n: number) => Promise<{
              data: unknown;
              error: { message?: string } | null;
            }>;
          };
        };
      };
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
        };
        // Round 2 PR #78 P1 #1 fix — unstamp path uses
        // `.not('sla_escalated_at', 'is', null)` so the
        // type chain needs a `.not(col, op, val).select(...)`
        // branch alongside the existing `.is(...)` branch.
        not: (
          col: string,
          op: string,
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

interface SlaIntervalRow {
  severity: MedevacSeverity;
  // PostgREST returns INTERVAL as ISO 8601 duration or
  // 'HH:MM:SS' depending on PostgREST config; we accept the
  // string + parse defensively below.
  sla_interval: string;
}

// parseSlaIntervalMinutes extracted to lib/medevac/sla-interval.ts
// so the parse logic is testable in isolation (medevac-sla-
// escalation.test.ts).

const REDACTED_COLS = [
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
].join(',');

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) return unauthorizedJsonResponse();

  const admin = createAdminClient() as unknown as LooseClient;

  // Load SLA intervals once.
  type LooseSlaSelect = {
    from: (table: string) => {
      select: (cols: string) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
  const slaLoose = createAdminClient() as unknown as LooseSlaSelect;
  const { data: slaData, error: slaError } = await slaLoose
    .from('medevac_severity_sla')
    .select('severity, sla_interval');
  if (slaError) {
    console.error('[medevac.cron.sla] sla lookup read failed', slaError);
    return NextResponse.json(
      { ok: false, error: 'sla_lookup_failed' },
      { status: 500 }
    );
  }
  const slaMinutes = new Map<MedevacSeverity, number>();
  for (const row of (slaData ?? []) as SlaIntervalRow[]) {
    slaMinutes.set(row.severity, parseSlaIntervalMinutes(row.sla_interval));
  }

  // Scan candidates: pending/offers_received + dispatched_at
  // not null + sla_escalated_at null. We do the time math in
  // JS so we don't need to push an INTERVAL expression through
  // the PostgREST builder.
  const { data: candData, error: candError } = await admin
    .from('medevac_requests')
    .select(REDACTED_COLS)
    .in('status', ['pending', 'offers_received'])
    .not('dispatched_at', 'is', null)
    .is('sla_escalated_at', null)
    .limit(SCAN_LIMIT);
  if (candError) {
    console.error('[medevac.cron.sla] candidates read failed', candError);
    return NextResponse.json(
      { ok: false, error: 'candidates_failed' },
      { status: 500 }
    );
  }
  const candidates = (candData ?? []) as MedevacRequestRedactedRow[];

  const nowMs = Date.now();
  let escalated = 0;
  let skipped_not_due = 0;
  let errors = 0;
  const escalations: Array<{
    medevac_request_id: string;
    medevac_request_number: string;
    severity: MedevacSeverity;
    sla_minutes: number;
    age_minutes: number;
  }> = [];

  for (const row of candidates) {
    if (!row.dispatched_at) {
      skipped_not_due += 1;
      continue;
    }
    const ageMs = nowMs - new Date(row.dispatched_at).getTime();
    const ageMin = ageMs / 60_000;
    const slaMin = slaMinutes.get(row.condition_severity) ?? 0;
    if (slaMin <= 0 || ageMin < slaMin) {
      skipped_not_due += 1;
      continue;
    }

    // Atomic claim: conditional UPDATE on sla_escalated_at IS
    // NULL. If two workers race, only one's UPDATE matches the
    // row + returns it; the loser sees 0 rows and skips.
    const stampResult = await admin
      .from('medevac_requests')
      .update({
        sla_escalated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .is('sla_escalated_at', null)
      .select('id');
    const stampedCount = Array.isArray(stampResult.data)
      ? stampResult.data.length
      : 0;
    if (stampResult.error) {
      console.error('[medevac.cron.sla] stamp failed', stampResult.error);
      errors += 1;
      continue;
    }
    if (stampedCount === 0) {
      // Lost the race — another worker already escalated.
      continue;
    }

    // Send the founder email (PII-redacted per D12).
    const email = await sendFounderSlaEscalationEmail({
      medevac_request: row,
      dispatched_at: row.dispatched_at,
      sla_minutes: slaMin,
    });
    if (!email.sent) {
      // Round 2 PR #78 P1 #1 fix — clear the sla_escalated_at
      // claim so the next cron tick can retry. The previous
      // behavior left the row stamped + counted as `escalated`
      // even when Resend was missing / failing / the founder
      // email was unset → the ONLY founder escalation channel
      // for critical medevac SLA was silently suppressed
      // forever. Roll back the claim so the row re-surfaces
      // on the next 5-min scan.
      const unstampResult = await admin
        .from('medevac_requests')
        .update({
          sla_escalated_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        // Guard against a parallel worker that may have already
        // claimed AND sent successfully — clear ONLY if our
        // own claim is still the stamped value (or close to it
        // within this single-request loop, which is the only
        // window where two workers race). We don't have the
        // pre-stamp value handy, so we use a coarse "still
        // not null" filter: if the value is null already, we
        // skip (another worker rolled back too). This is a
        // best-effort recovery; the worst case is one extra
        // founder email on a rare race, which beats
        // permanently-suppressed escalation.
        .not('sla_escalated_at', 'is', null)
        .select('id');
      const unstampedCount = Array.isArray(unstampResult.data)
        ? unstampResult.data.length
        : 0;
      if (unstampResult.error) {
        console.error(
          '[medevac.cron.sla] unstamp after send-fail errored',
          unstampResult.error
        );
      }
      console.error(
        '[medevac.cron.sla] founder email failed; sla_escalated_at rolled back',
        {
          mev_number: row.medevac_request_number,
          unstamped: unstampedCount,
        }
      );
      errors += 1;
      continue;
    }

    escalated += 1;
    escalations.push({
      medevac_request_id: row.id,
      medevac_request_number: row.medevac_request_number,
      severity: row.condition_severity,
      sla_minutes: slaMin,
      age_minutes: Math.round(ageMin),
    });
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates.length,
    escalated,
    skipped_not_due,
    errors,
    escalations,
  });
}
