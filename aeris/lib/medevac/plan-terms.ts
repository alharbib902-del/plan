import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import type { MedevacSubscriptionPlanTermsRow } from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — service-role helper for the
 * `medevac_subscription_plan_terms` lookup.
 *
 * RLS is enabled on the table with NO public/anon/
 * authenticated policies (Round 4 PR #75 P2 #3 fix), so the
 * marketing page reads via THIS helper using the service-role
 * client — never via a direct REST query. The projection
 * below is the public commercial offering: plan + price + caps
 * + repatriation flag + description. No internal fields are
 * exposed.
 *
 * Admin price updates go through a future Phase 14
 * `admin_update_plan_terms` Server Action (also service-role);
 * clients cannot touch this table directly at any tier.
 */

export interface AerisShieldPlanTerms {
  plan: 'individual' | 'family' | 'vip_family' | 'diamond';
  annual_fee_sar: number;
  covered_events: number; // -1 = unlimited (diamond)
  service_level: 'BMT' | 'ALS' | 'CCT' | 'repatriation';
  includes_repatriation: boolean;
  max_covered_members: number;
  description: string | null;
}

const PLAN_ORDER: ReadonlyArray<AerisShieldPlanTerms['plan']> = [
  'individual',
  'family',
  'vip_family',
  'diamond',
];

/**
 * Returns the 4 seeded plan terms ordered for marketing
 * display (cheapest → most premium). Returns an empty array
 * on any read error so the marketing page can render an
 * "unavailable" branch rather than crash.
 */
export async function getAerisShieldPlanTerms(): Promise<
  AerisShieldPlanTerms[]
> {
  noStore();
  try {
    type LooseSelectClient = {
      from: (table: string) => {
        select: (cols: string) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
    const looseClient = createAdminClient() as unknown as LooseSelectClient;
    const { data, error } = await looseClient
      .from('medevac_subscription_plan_terms')
      .select(
        [
          'plan',
          'annual_fee_sar',
          'covered_events',
          'service_level',
          'includes_repatriation',
          'max_covered_members',
          'description',
        ].join(',')
      );
    if (error) {
      console.error('[medevac.plan-terms] read failed', error);
      return [];
    }
    const rows = (data ?? []) as MedevacSubscriptionPlanTermsRow[];

    // Order rows by PLAN_ORDER + coerce numeric strings to numbers
    // for the marketing surface.
    const indexMap = new Map<string, number>(
      PLAN_ORDER.map((p, i) => [p, i])
    );
    return [...rows]
      .sort(
        (a, b) =>
          (indexMap.get(a.plan) ?? 99) - (indexMap.get(b.plan) ?? 99)
      )
      .map<AerisShieldPlanTerms>((r) => ({
        plan: r.plan,
        annual_fee_sar: Number(r.annual_fee_sar),
        covered_events: r.covered_events,
        service_level: r.service_level,
        includes_repatriation: r.includes_repatriation,
        max_covered_members: r.max_covered_members,
        description: r.description,
      }));
  } catch (err) {
    console.error('[medevac.plan-terms] read threw', err);
    return [];
  }
}
