import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { MedevacSubscriptionRow } from '@/lib/medevac/types';

/**
 * Phase 12 PR 2 — read helpers for the /me/medevac/shield
 * surface. Lists subscriptions the client owns + returns the
 * single active subscription used to populate the
 * /me/medevac/new form's "use subscription" toggle.
 */

type LooseSelectClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => {
          limit: (n: number) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        };
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export async function listMyShieldSubscriptions(
  clientId: string,
  limit = 10
): Promise<MedevacSubscriptionRow[]> {
  noStore();
  if (!isUuid(clientId)) return [];
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const { data, error } = await loose
    .from('medevac_subscriptions')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[medevac.me.shield.list] read failed', error);
    return [];
  }
  return (data ?? []) as MedevacSubscriptionRow[];
}

export async function getMyShieldSubscription(
  clientId: string,
  subscriptionId: string
): Promise<MedevacSubscriptionRow | null> {
  noStore();
  if (!isUuid(clientId)) return null;
  if (!isUuid(subscriptionId)) return null;

  const loose = createAdminClient() as unknown as LooseSelectClient;
  const { data, error } = await loose
    .from('medevac_subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (error) {
    console.error('[medevac.me.shield.get] read failed', error);
    return null;
  }
  const sub = data as MedevacSubscriptionRow | null;
  if (!sub) return null;
  if (sub.client_id !== clientId) return null;
  return sub;
}
