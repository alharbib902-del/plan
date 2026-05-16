/**
 * Phase 11 PR 3 §3 — pure scoring + classification helpers.
 *
 * No DB / server-only imports — so the Layer-1 tests can import
 * this file under tsx outside Next.js. The DB-backed wrapper
 * `dispatchCargoRequest` lives in `./distribution.ts` and pulls
 * in `createAdminClient` separately.
 */

export type CargoDispatchSkipReason =
  | 'no_capability'
  | 'recently_dispatched'
  | 'lower_score'
  | 'not_approved'
  | 'notify_failed';

export interface CargoCandidate {
  operator_id: string;
  contact_email: string | null;
  contact_phone: string | null;
  company_name: string;
  has_capability: boolean;
  last_dispatched_at: string | null;
  rating: number | null;
}

export interface CargoDispatchOperator {
  operator_id: string;
  contact_email: string | null;
  contact_phone: string | null;
  company_name: string;
}

export interface ClassifyResult {
  dispatched: CargoDispatchOperator[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, CargoDispatchSkipReason>;
}

const DISPATCH_CAP = 5;
const RECENCY_BUCKETS_DAYS = { hot: 3, warm: 7 } as const;
const DEFAULT_RATING = 3.0;

/**
 * recency_score per spec §3.2:
 *   NULL          → 1.0  (first-time operator gets max boost)
 *   > 7 days ago  → 1.0
 *   3-7 days ago  → 0.5
 *   < 3 days ago  → 0.0  (rate-limit short-circuit)
 */
export function recencyScore(
  lastDispatchedAt: string | null | undefined,
  nowMs = Date.now()
): number {
  if (!lastDispatchedAt) return 1.0;
  const ageMs = nowMs - new Date(lastDispatchedAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays > RECENCY_BUCKETS_DAYS.warm) return 1.0;
  if (ageDays >= RECENCY_BUCKETS_DAYS.hot) return 0.5;
  return 0.0;
}

/** score = 0.4 * 1.0 + 0.3 * recency + 0.3 * rating */
export function operatorScore(args: {
  recencyScore: number;
  ratingScore: number;
}): number {
  return 0.4 * 1.0 + 0.3 * args.recencyScore + 0.3 * args.ratingScore;
}

/**
 * §3.1 steps 2 + 3 — classify candidates into dispatched | skipped.
 * Pure function (deterministic given inputs + nowMs).
 */
export function classifyCandidates(
  candidates: CargoCandidate[],
  nowMs = Date.now()
): ClassifyResult {
  const skip_reasons: Record<string, CargoDispatchSkipReason> = {};
  const eligible: Array<{ candidate: CargoCandidate; score: number }> = [];

  for (const c of candidates) {
    if (!c.has_capability) {
      skip_reasons[c.operator_id] = 'no_capability';
      continue;
    }
    const r = recencyScore(c.last_dispatched_at, nowMs);
    if (r === 0) {
      skip_reasons[c.operator_id] = 'recently_dispatched';
      continue;
    }
    const ratingNormalized = (c.rating ?? DEFAULT_RATING) / 5.0;
    const score = operatorScore({
      recencyScore: r,
      ratingScore: ratingNormalized,
    });
    eligible.push({ candidate: c, score });
  }

  eligible.sort((a, b) => b.score - a.score);
  const dispatched: CargoDispatchOperator[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const c = eligible[i]!.candidate;
    if (i < DISPATCH_CAP) {
      dispatched.push({
        operator_id: c.operator_id,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
        company_name: c.company_name,
      });
    } else {
      skip_reasons[c.operator_id] = 'lower_score';
    }
  }

  const skipped_operator_ids = Object.keys(skip_reasons);
  return { dispatched, skipped_operator_ids, skip_reasons };
}
