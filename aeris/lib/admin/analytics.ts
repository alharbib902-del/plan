import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 14 — admin analytics summary read.
 *
 * Calls the SECURITY DEFINER `admin_analytics_summary(p_from, p_to)`
 * RPC via the service-role client. The page gates on
 * requireAdminSession() first; the RPC is service_role-only. Pass null
 * for either bound to let the RPC default to the last 30 days.
 *
 * The RPC is NOT in the hand-maintained `types/database.ts` Functions
 * map (Phase 8 PR 2e lesson — parameterless RPCs collapsed inference),
 * so we call it through a loose accessor.
 */

export type AnalyticsBySource = Record<string, number>;
export type AnalyticsByStatus = Record<string, number>;

export type AnalyticsRoute = {
  departure: string;
  arrival: string;
  count: number;
};

export type AnalyticsOperator = {
  company_name: string;
  paid_total_sar: number;
  paid_count: number;
};

export type AnalyticsSummary =
  | {
      ok: true;
      range: { from: string; to: string };
      revenue: { paid_total_sar: number; paid_count: number };
      bookings: {
        total_count: number;
        cancelled_count: number;
        by_source: AnalyticsBySource;
      };
      requests: {
        total_count: number;
        booked_count: number;
        conversion_pct: number;
        by_status: AnalyticsByStatus;
      };
      top_routes: AnalyticsRoute[];
      top_operators: AnalyticsOperator[];
    }
  | { ok: false; error: string };

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function getAnalyticsSummary(
  fromIso: string | null,
  toIso: string | null
): Promise<AnalyticsSummary> {
  const client = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await client.rpc('admin_analytics_summary', {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) {
    console.error('[admin.analytics] rpc failed', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as AnalyticsSummary;
}
