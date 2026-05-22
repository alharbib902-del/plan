import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

const TABLE = 'operators';

/**
 * Semi-Auto Operator Picker — listing helper.
 *
 * Reads every approved operator from the operators table (Phase 8
 * §3.4 renamed status → signup_status; we filter on that). There
 * is no `disabled_at` column on operators — the lifecycle terminal
 * states are tracked via signup_status ('suspended' / 'rejected'),
 * `suspended_at`, and `rejected_at`. Filtering by
 * signup_status='approved' alone is sufficient to exclude every
 * non-active state.
 *
 * The result includes a computed `score` (0..100) derived from the
 * data we actually have today:
 *   - 50 baseline (everyone approved gets it)
 *   - +20 if approved_at is older than 30 days (tenure)
 *   - +20 if last_login_at is within the last 7 days (engagement)
 *   - +10 if password_set_at is not null (account fully set up)
 *
 * Sort order: score DESC, then company_name ASC (Arabic-locale-safe
 * compare). The list page passes this array straight to the picker;
 * the picker's "select top 5" shortcut relies on the score order.
 *
 * Phase 7+ will replace this score with the real rating +
 * response_time + completed_bookings count once those signals
 * accumulate enough data to be meaningful.
 */
export interface DispatchOperator {
  id: string;
  company_name: string;
  contact_phone: string;
  contact_email: string;
  auth_email: string;
  approved_at: string | null;
  last_login_at: string | null;
  password_set_at: string | null;
  score: number;
}

const BASE_SCORE = 50;
const TENURE_BONUS = 20;
const ENGAGEMENT_BONUS = 20;
const SETUP_BONUS = 10;
const TENURE_THRESHOLD_DAYS = 30;
const ENGAGEMENT_THRESHOLD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function computeScore(input: {
  approved_at: string | null;
  last_login_at: string | null;
  password_set_at: string | null;
}): number {
  const now = Date.now();
  let score = BASE_SCORE;

  if (input.approved_at) {
    const approvedMs = Date.parse(input.approved_at);
    if (
      Number.isFinite(approvedMs) &&
      now - approvedMs >= TENURE_THRESHOLD_DAYS * DAY_MS
    ) {
      score += TENURE_BONUS;
    }
  }

  if (input.last_login_at) {
    const lastLoginMs = Date.parse(input.last_login_at);
    if (
      Number.isFinite(lastLoginMs) &&
      now - lastLoginMs <= ENGAGEMENT_THRESHOLD_DAYS * DAY_MS
    ) {
      score += ENGAGEMENT_BONUS;
    }
  }

  if (input.password_set_at) {
    score += SETUP_BONUS;
  }

  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
}

export async function listApprovedOperatorsForDispatch(): Promise<
  DispatchOperator[]
> {
  noStore();
  const client = createAdminClient();

  const { data, error } = await client
    .from(TABLE)
    .select(
      'id, company_name, contact_phone, contact_email, auth_email, approved_at, last_login_at, password_set_at'
    )
    .eq('signup_status', 'approved');

  if (error) {
    console.error('[operators-list] listApprovedOperatorsForDispatch failed', error);
    throw new Error(
      `listApprovedOperatorsForDispatch failed: ${error.message}`
    );
  }

  const rows = (data ?? []) as Array<{
    id: string;
    company_name: string;
    contact_phone: string;
    contact_email: string;
    auth_email: string;
    approved_at: string | null;
    last_login_at: string | null;
    password_set_at: string | null;
  }>;

  const scored: DispatchOperator[] = rows.map((row) => ({
    id: row.id,
    company_name: row.company_name,
    contact_phone: row.contact_phone,
    contact_email: row.contact_email,
    auth_email: row.auth_email,
    approved_at: row.approved_at,
    last_login_at: row.last_login_at,
    password_set_at: row.password_set_at,
    score: computeScore({
      approved_at: row.approved_at,
      last_login_at: row.last_login_at,
      password_set_at: row.password_set_at,
    }),
  }));

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.company_name.localeCompare(b.company_name, 'ar');
  });

  return scored;
}
