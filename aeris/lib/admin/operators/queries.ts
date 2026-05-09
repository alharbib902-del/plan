import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  OperatorRow,
  OperatorSignupStatus,
  OperatorDocumentRow,
  Phase7OperatorStubRow,
} from '@/types/database';

/**
 * Phase 8 PR 2b — admin read queries for the operators
 * surface. Mirrors the Phase 7 `lib/admin/empty-legs/queries.ts`
 * shape: every query opens a fresh service-role client, calls
 * `noStore()` so Next.js doesn't memoize, and surfaces a typed
 * error on failure.
 */

const TABLE = 'operators';
const DOCUMENTS_TABLE = 'operator_documents';
const STUBS_TABLE = 'phase7_operator_stubs';

// ============================================================
// Status filter chips (PR 2b §5 list page)
// ============================================================

export const OPERATOR_SIGNUP_STATUSES: readonly OperatorSignupStatus[] = [
  'pending',
  'approved',
  'suspended',
  'rejected',
] as const;

export type OperatorListFilter = OperatorSignupStatus | 'all';

export interface ListOperatorsParams {
  filter?: OperatorListFilter;
  limit?: number;
}

export interface OperatorStatusCounts {
  total: number;
  pending: number;
  approved: number;
  suspended: number;
  rejected: number;
}

// ============================================================
// listOperators
//
// Default filter: 'all' (the list page surfaces everyone +
// the count chips let admin filter). Phase 7's empty-legs list
// defaulted to 'open' because most legs are short-lived; the
// operators list has long-lived rows and admin usually wants
// to see everyone.
// ============================================================

export async function listOperators(
  params: ListOperatorsParams = {}
): Promise<OperatorRow[]> {
  noStore();
  const { filter = 'all', limit = 200 } = params;
  const client = createAdminClient();

  let query = client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter !== 'all') {
    query = query.eq('signup_status', filter);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[operators] listOperators failed', error);
    throw new Error(`listOperators failed: ${error.message}`);
  }
  return (data ?? []) as OperatorRow[];
}

// ============================================================
// countOperatorsByStatus
//
// One round-trip; counts are aggregated in-memory. The list
// page renders 5 filter chips (all + 4 statuses) so we compute
// all 4 counts at once.
// ============================================================

export async function countOperatorsByStatus(): Promise<OperatorStatusCounts> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('signup_status', { count: 'exact', head: false });

  if (error) {
    console.error('[operators] countOperatorsByStatus failed', error);
    throw new Error(`countOperatorsByStatus failed: ${error.message}`);
  }

  const counts: OperatorStatusCounts = {
    total: data?.length ?? 0,
    pending: 0,
    approved: 0,
    suspended: 0,
    rejected: 0,
  };

  for (const row of data ?? []) {
    const status = row.signup_status as OperatorSignupStatus;
    if (status in counts) {
      counts[status as keyof Omit<OperatorStatusCounts, 'total'>] += 1;
    }
  }

  return counts;
}

// ============================================================
// getOperatorById
// ============================================================

export async function getOperatorById(
  id: string
): Promise<OperatorRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[operators] getOperatorById failed', error);
    throw new Error(`getOperatorById failed: ${error.message}`);
  }
  return (data ?? null) as OperatorRow | null;
}

// ============================================================
// listOperatorDocuments
//
// Returns documents ordered by uploaded_at DESC. The page
// renders signed-URL preview links per row.
// ============================================================

export async function listOperatorDocuments(
  operatorId: string
): Promise<OperatorDocumentRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(DOCUMENTS_TABLE)
    .select('*')
    .eq('operator_id', operatorId)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error('[operators] listOperatorDocuments failed', error);
    throw new Error(`listOperatorDocuments failed: ${error.message}`);
  }
  return (data ?? []) as OperatorDocumentRow[];
}

// ============================================================
// listActiveStubsForConversion
//
// Lists `active` Phase 7 stubs that admin may convert to a
// real operator. Used by the convert page's "pick a stub"
// dropdown (when admin enters from /admin/operators/<id> and
// wants to attach existing stub legs to a freshly-approved
// operator).
// ============================================================

export async function listActiveStubsForConversion(): Promise<Phase7OperatorStubRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(STUBS_TABLE)
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[operators] listActiveStubsForConversion failed', error);
    throw new Error(`listActiveStubsForConversion failed: ${error.message}`);
  }
  return (data ?? []) as Phase7OperatorStubRow[];
}

// ============================================================
// getStubById — used by the convert page when admin enters via
// /admin/empty-legs/operators/<stub_id>/convert
// ============================================================

export async function getStubById(
  id: string
): Promise<Phase7OperatorStubRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(STUBS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[operators] getStubById failed', error);
    throw new Error(`getStubById failed: ${error.message}`);
  }
  return (data ?? null) as Phase7OperatorStubRow | null;
}

// ============================================================
// listLegsForStub — preview list shown on the convert page
// before admin clicks "confirm". Returns the legs that WILL
// be reassigned by `convert_phase7_stub_to_operator`.
// ============================================================

export interface StubLegPreview {
  id: string;
  leg_number: string;
  status: string;
  departure_window_start: string;
  departure_airport: string | null;
  arrival_airport: string | null;
}

export async function listLegsForStub(
  stubId: string
): Promise<StubLegPreview[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select(
      'id, leg_number, status, departure_window_start, departure_airport, arrival_airport'
    )
    .eq('operator_stub_id', stubId)
    .order('departure_window_start', { ascending: true });

  if (error) {
    console.error('[operators] listLegsForStub failed', error);
    throw new Error(`listLegsForStub failed: ${error.message}`);
  }
  return (data ?? []) as StubLegPreview[];
}

// ============================================================
// listApprovedOperators — for the convert page's "target
// operator" dropdown. Suspended operators are also eligible
// (the RPC accepts approved | suspended).
// ============================================================

export async function listApprovedOperators(): Promise<OperatorRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .in('signup_status', ['approved', 'suspended'])
    .order('company_name', { ascending: true });

  if (error) {
    console.error('[operators] listApprovedOperators failed', error);
    throw new Error(`listApprovedOperators failed: ${error.message}`);
  }
  return (data ?? []) as OperatorRow[];
}
