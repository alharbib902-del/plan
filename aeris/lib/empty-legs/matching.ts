// Server-side ONLY — same rationale as the PR 2d token
// modules: the `test:empty-legs-matching` Layer-1 test runs
// under tsx outside Next.js where the `'server-only'` shim
// is not resolvable. Surface contract is enforced at the
// call site (this module is only imported from
// `app/api/empty-legs/internal/match-trigger/route.ts`).
import { createAdminClient } from '@/lib/supabase/admin';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import {
  listEligibleCandidates,
  listEligibleClientCandidates,
  type CandidateRow,
  type ClientCandidateRow,
} from './candidate-pool';
import {
  shouldSkipCandidate,
  shouldSkipClientCandidate,
} from './frequency-cap';
import {
  CAPACITY_WEIGHT,
  DISCOUNT_WEIGHT,
  GEO_WEIGHT,
  TIME_WEIGHT,
  TOP_N,
} from './score-weights';
import {
  enqueueLegNotifications,
  enqueueClientLegNotifications,
  type EnqueuedRow,
} from './notifications';

/**
 * Phase 7 PR 2e — empty-legs matching engine.
 *
 * Per-leg ordered branch contract (Codex iteration-10
 * P1 #1 fix). For EACH leg id received from the outbox
 * drain, the engine applies these branches in order:
 *
 *   1. Suppress-notifications check (per-leg, runs
 *      regardless of env-flag state). If
 *      `empty_legs.suppress_notifications = TRUE` →
 *      return `{ ok: true, skipped: 'suppress_notifications',
 *      leg_id }` AND the match-trigger route DOES mark the
 *      outbox row `processed_at = NOW()` (the suppression
 *      is intentional, not a deferred-matching state —
 *      replay would be wrong; mirrors iteration-7 P1 #3).
 *
 *   2. Notifications-disabled flag check (per-leg, only
 *      runs for non-suppressed legs). If
 *      `process.env.ENABLE_EMPTY_LEGS_NOTIFICATIONS !== 'true'`
 *      → return `{ ok: true, skipped: 'notifications_disabled',
 *      leg_id }` AND the match-trigger route does NOT mark
 *      the outbox row processed — the row stays
 *      `processed_at = NULL` and replays after the flag
 *      flips back to `true` (iteration-6 P1 #1).
 *      Frequency-cap + per-leg dedupe state is therefore
 *      not consumed; `wa_url`-NOT-NULL cannot be violated.
 *
 *   3. Candidate matching (per-leg, only runs for
 *      non-suppressed legs with the flag enabled).
 *      Reads candidate-pool, scores against the leg,
 *      filters via frequency-cap, takes top 50, and
 *      writes `empty_leg_notifications` rows + triggers
 *      the founder batch alert. On successful completion
 *      the match-trigger route marks the outbox row
 *      `processed_at = NOW()`.
 *
 * Why the order matters: a single batch of outbox rows
 * can mix suppressed canary test legs with real legs
 * published while a flag-flip is in progress. Putting
 * the suppress check FIRST per-leg means canary test
 * legs are deterministically marked processed while
 * real legs in the same batch correctly hit the
 * notifications-disabled branch and stay pending.
 */

export type MatchOutcome =
  | {
      ok: true;
      matched: {
        leg_id: string;
        rows_written: number;
        // Phase 10 PR 1 round 2 P2 #4: count of client_id-keyed
        // empty_leg_notifications rows successfully inserted.
        // Optional + populated only when the client-loop ran.
        clients_written?: number;
        // Phase 10 PR 1 round 6 P2 #3: count of eligible clients
        // (passed candidate-pool + frequency-cap) but who opted
        // out of BOTH email AND wa.me channels in §3.3
        // notification_preferences. Observability counter only —
        // does NOT affect shouldMarkOutboxProcessed (round 7 P1 #1).
        clients_skipped_preferences?: number;
      };
    }
  | { ok: true; skipped: 'suppress_notifications'; leg_id: string }
  | { ok: true; skipped: 'notifications_disabled'; leg_id: string }
  | { ok: true; skipped: 'leg_not_found'; leg_id: string }
  | { ok: false; leg_id: string; error: string };

/**
 * Whether the match-trigger route should mark the outbox
 * row `processed_at = NOW()` for this leg's outcome.
 *
 *   - matched           → YES (the work is done; counters
 *                              like clients_skipped_preferences
 *                              are observability-only — Phase 10
 *                              round 7 P1 #1 fix)
 *   - suppress_notifications → YES (intentional skip,
 *                                   replay would re-notify
 *                                   real candidates)
 *   - notifications_disabled → NO (replay after flag flip)
 *   - leg_not_found     → YES (no point re-trying a
 *                              deleted leg)
 *   - error             → NO (transient failure, replay)
 *
 * Phase 10 explicitly does NOT change this contract — see
 * spec §4.2 step 3 for the full reasoning.
 */
export function shouldMarkOutboxProcessed(outcome: MatchOutcome): boolean {
  if (!outcome.ok) return false;
  if ('matched' in outcome) return true;
  if (outcome.skipped === 'suppress_notifications') return true;
  if (outcome.skipped === 'leg_not_found') return true;
  // notifications_disabled → leave processed_at NULL.
  return false;
}

function isNotificationsFlagEnabled(): boolean {
  return process.env.ENABLE_EMPTY_LEGS_NOTIFICATIONS === 'true';
}

/**
 * Phase 10 PR 1 — feature flag for the client-loop. Starts OFF
 * in production; flipped to 'true' permanently after Probes
 * 21+22+23 pass per the activation runbook. When unset or
 * false, the entire client extension code path is dead — no
 * production behaviour change vs Phase 7.
 */
function isClientPortalFlagEnabled(): boolean {
  return process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL === 'true';
}

// ============================================================
// Scoring
// ============================================================

/** Returns 0..1 used in `Math.round(weight * factor)`. */
function scoreGeoFactor(leg: EmptyLegRow, candidate: CandidateRow): number {
  // Exact IATA match on EITHER side counts. Customers who
  // stored freeform origins lose this signal entirely —
  // matched the iteration-2 contract (no email channel,
  // no fancy geo lookups).
  const legDep = leg.departure_airport;
  const legArr = leg.arrival_airport;
  const cOrigin = candidate.origin_iata;
  const cDest = candidate.destination_iata;

  if (!cOrigin && !cDest) return 0;

  const originMatches =
    legDep && cOrigin && legDep.toUpperCase() === cOrigin.toUpperCase();
  const destMatches =
    legArr && cDest && legArr.toUpperCase() === cDest.toUpperCase();

  if (originMatches && destMatches) return 1;
  if (originMatches || destMatches) return 0.5;
  return 0;
}

function scoreTimeFactor(leg: EmptyLegRow, candidate: CandidateRow): number {
  if (!candidate.departure_date) return 0;
  if (!leg.departure_window_start || !leg.departure_window_end) return 0;

  const candDay = new Date(candidate.departure_date).getTime();
  const winStart = new Date(leg.departure_window_start).getTime();
  const winEnd = new Date(leg.departure_window_end).getTime();
  const flexHours = leg.flexibility_hours ?? 0;
  const flexMs = flexHours * 60 * 60 * 1000;

  if (
    !Number.isFinite(candDay) ||
    !Number.isFinite(winStart) ||
    !Number.isFinite(winEnd)
  ) {
    return 0;
  }

  // Inside the (window ± flex) → full credit.
  if (candDay >= winStart - flexMs && candDay <= winEnd + flexMs) {
    return 1;
  }

  // Within 7 days of the window → linearly scaled credit.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const distance = Math.min(
    Math.abs(candDay - winStart),
    Math.abs(candDay - winEnd)
  );
  if (distance <= SEVEN_DAYS_MS) {
    return Math.max(0, 1 - distance / SEVEN_DAYS_MS) * 0.5;
  }
  return 0;
}

function scoreCapacityFactor(
  leg: EmptyLegRow,
  candidate: CandidateRow
): number {
  if (typeof candidate.passengers !== 'number') return 0;
  return leg.max_passengers >= candidate.passengers ? 1 : 0;
}

function scoreDiscountFactor(leg: EmptyLegRow): number {
  // current_discount_pct is 0..100; scale into 0..1.
  // Discount of 50% → 0.5, 70% → 0.7. The matcher then
  // multiplies by DISCOUNT_WEIGHT (10), giving 0..10.
  const pct = leg.current_discount_pct ?? 0;
  return Math.max(0, Math.min(1, pct / 100));
}

export function scoreCandidateAgainstLeg(
  leg: EmptyLegRow,
  candidate: CandidateRow
): number {
  const geo = Math.round(scoreGeoFactor(leg, candidate) * GEO_WEIGHT);
  const time = Math.round(scoreTimeFactor(leg, candidate) * TIME_WEIGHT);
  const capacity = Math.round(
    scoreCapacityFactor(leg, candidate) * CAPACITY_WEIGHT
  );
  const discount = Math.round(scoreDiscountFactor(leg) * DISCOUNT_WEIGHT);
  return Math.max(0, Math.min(100, geo + time + capacity + discount));
}

// ============================================================
// Per-leg matching
// ============================================================

interface LookupRow {
  id: string;
  status: string;
  suppress_notifications: boolean;
}

async function loadLegFlags(legId: string): Promise<LookupRow | null> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select('id, status, suppress_notifications')
    .eq('id', legId)
    .maybeSingle();

  if (error) {
    console.error('[matching] loadLegFlags error', error);
    return null;
  }
  return (data as LookupRow | null) ?? null;
}

async function loadFullLeg(legId: string): Promise<EmptyLegRow | null> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select('*')
    .eq('id', legId)
    .maybeSingle();

  if (error) {
    console.error('[matching] loadFullLeg error', error);
    return null;
  }
  return (data as EmptyLegRow | null) ?? null;
}

export async function matchLeg(
  legId: string,
  eventType: 'published' | 'price_dropped'
): Promise<MatchOutcome> {
  // ---- Branch 1 (per-leg): suppress check
  const flags = await loadLegFlags(legId);
  if (!flags) {
    return { ok: true, skipped: 'leg_not_found', leg_id: legId };
  }
  if (flags.suppress_notifications) {
    return {
      ok: true,
      skipped: 'suppress_notifications',
      leg_id: legId,
    };
  }

  // ---- Branch 2 (per-leg, non-suppressed): flag check
  if (!isNotificationsFlagEnabled()) {
    return {
      ok: true,
      skipped: 'notifications_disabled',
      leg_id: legId,
    };
  }

  // ---- Branch 3 (per-leg, non-suppressed, flag on):
  // candidate matching.
  const leg = await loadFullLeg(legId);
  if (!leg) {
    // Race: leg got deleted between the flags lookup and
    // the full read. Treat as not_found.
    return { ok: true, skipped: 'leg_not_found', leg_id: legId };
  }

  // Skip terminal states defensively. The cron drain
  // claims rows by leg_id only; a leg that flipped to
  // sold/expired/cancelled between event emit and
  // matcher run shouldn't surface notifications.
  if (leg.status !== 'available' && leg.status !== 'reserved') {
    return { ok: true, skipped: 'leg_not_found', leg_id: legId };
  }

  let candidates: CandidateRow[];
  try {
    candidates = await listEligibleCandidates();
  } catch (err) {
    console.error('[matching] candidate-pool read error', err);
    return {
      ok: false,
      leg_id: legId,
      error: 'candidate_pool_read_failed',
    };
  }

  const eligible: { cand: CandidateRow; score: number }[] = [];
  for (const cand of candidates) {
    // shouldSkipCandidate runs two DB reads per pair —
    // throttled by the candidate-pool 24h pre-filter so
    // this loop typically iterates ≤ 50 candidates per
    // cycle in practice.
    const skip = await shouldSkipCandidate(cand.id, leg.id);
    if (skip) continue;

    const score = scoreCandidateAgainstLeg(leg, cand);
    if (score <= 0) continue;
    eligible.push({ cand, score });
  }

  // Top-N by descending score.
  eligible.sort((a, b) => b.score - a.score);
  const top = eligible.slice(0, TOP_N);

  let written: EnqueuedRow[];
  try {
    written = await enqueueLegNotifications({
      leg,
      eventType,
      candidates: top.map((t) => t.cand),
    });
  } catch (err) {
    console.error('[matching] enqueue error', err);
    return {
      ok: false,
      leg_id: legId,
      error: 'enqueue_failed',
    };
  }

  // ---- Phase 10 PR 1: client-loop (guarded by ENABLE_CLIENT_EMPTY_LEGS_PORTAL)
  //
  // When OFF, this entire block is dead — no production
  // behaviour change vs Phase 7. When ON, list eligible
  // clients → score → frequency-cap filter → top-N →
  // enqueueClientLegNotifications (which handles per-client
  // channel selection per opt-in prefs + match-email Resend
  // dispatch + alert wiring).
  //
  // Codex round 1 PR #62 P1 #1 fix: client-loop failures used
  // to be swallowed (logged + non-fatal) and the outcome still
  // returned matched, which marked the outbox processed and
  // permanently lost client matches for that leg event. Now a
  // failure returns a retryable {ok: false} so the outbox row
  // stays pending and the next drain tick retries. Both lead
  // INSERTs (unique on lead+leg) and client INSERTs (unique on
  // client+leg) are idempotent on retry — no double notifications.
  // The cost is an extra dispatch attempt for any leg that hit
  // a transient client-loop error, which is the right trade vs
  // silently dropping client matches.
  let clientsWritten: number | undefined;
  let clientsSkippedPreferences: number | undefined;
  if (isClientPortalFlagEnabled()) {
    try {
      const clientCandidates = await listEligibleClientCandidates();
      const eligibleClients: { cand: ClientCandidateRow; score: number }[] = [];
      for (const cand of clientCandidates) {
        const skip = await shouldSkipClientCandidate(cand.client_id, leg.id);
        if (skip) continue;
        const score = scoreCandidateAgainstLeg(leg, cand);
        if (score <= 0) continue;
        eligibleClients.push({ cand, score });
      }
      eligibleClients.sort((a, b) => b.score - a.score);
      const topClients = eligibleClients.slice(0, TOP_N).map((t) => t.cand);

      const clientResult = await enqueueClientLegNotifications({
        leg,
        eventType,
        candidates: topClients,
      });
      clientsWritten = clientResult.written.length;
      clientsSkippedPreferences = clientResult.skipped_preferences;
    } catch (err) {
      console.error('[matching] client-loop failed', err);
      return {
        ok: false,
        leg_id: legId,
        error: 'client_loop_failed',
      };
    }
  }

  return {
    ok: true,
    matched: {
      leg_id: legId,
      rows_written: written.length,
      ...(clientsWritten !== undefined && { clients_written: clientsWritten }),
      ...(clientsSkippedPreferences !== undefined && {
        clients_skipped_preferences: clientsSkippedPreferences,
      }),
    },
  };
}
