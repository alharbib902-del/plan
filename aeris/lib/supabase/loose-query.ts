import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Structurally-typed view of the service-role Supabase client for tables and
 * RPCs that are NOT present in the generated `types/database.ts` (e.g. `reviews`
 * + its RPCs; the Support tables/RPCs join this list when the Support PR lands).
 *
 * This mirrors the `LooseRpcClient` escape hatch already used across
 * `app/actions/*` for the Phase 9+ RPCs: the generated Database type is
 * hand-maintained and intentionally lags new tables, so we bypass its
 * narrowing here. The service-role client bypasses RLS; all ownership scoping
 * is enforced in application code by the callers (e.g. `.eq('client_id', …)`
 * with the session id).
 *
 * `LooseQueryBuilder` is a thenable that returns the same shape from every
 * chained method, matching the PostgREST builder ergonomics we rely on
 * (`select` / `eq` / `order` / `maybeSingle`), and resolves to the standard
 * `{ data, error }` envelope.
 */
export type LooseResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

export interface LooseQueryBuilder extends PromiseLike<LooseResult> {
  select: (columns?: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  order: (column: string, opts: { ascending: boolean }) => LooseQueryBuilder;
  maybeSingle: () => PromiseLike<LooseResult>;
}

export interface LooseDbClient {
  from: (table: string) => LooseQueryBuilder;
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<LooseResult>;
}

export function createLooseClient(): LooseDbClient {
  return createAdminClient() as unknown as LooseDbClient;
}
