import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type {
  MedevacSubscriptionRow,
  AerisShieldConfigRow,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 2 — admin read helpers for Aeris Shield
 * subscriptions + the shield-config singleton.
 *
 * `listAdminSubscriptions` returns ALL subscription rows
 * with status filter, sorted by created_at DESC. No PII
 * concern here — covered_members JSONB shows member names
 * but admin tier is allowed (D5: admin Server Action is the
 * only mutator; admin reads are implicit).
 */

type LooseSelectClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string | number
      ) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
      in: (
        col: string,
        vals: string[]
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
};

export async function listAdminMedevacSubscriptions(
  statusFilter?: ReadonlyArray<MedevacSubscriptionRow['status']>
): Promise<MedevacSubscriptionRow[]> {
  noStore();
  const loose = createAdminClient() as unknown as LooseSelectClient;
  if (statusFilter && statusFilter.length > 0) {
    const { data, error } = await loose
      .from('medevac_subscriptions')
      .select('*')
      .in('status', [...statusFilter])
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[medevac.admin.subs.list] read failed', error);
      return [];
    }
    return (data ?? []) as MedevacSubscriptionRow[];
  }
  const { data, error } = await loose
    .from('medevac_subscriptions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[medevac.admin.subs.list] read failed', error);
    return [];
  }
  return (data ?? []) as MedevacSubscriptionRow[];
}

export async function getAdminMedevacSubscription(
  subscriptionId: string
): Promise<MedevacSubscriptionRow | null> {
  noStore();
  if (!isUuid(subscriptionId)) return null;
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const { data, error } = await loose
    .from('medevac_subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (error) {
    console.error('[medevac.admin.sub.get] read failed', error);
    return null;
  }
  return (data as MedevacSubscriptionRow | null) ?? null;
}

export async function getShieldConfig(): Promise<AerisShieldConfigRow | null> {
  noStore();
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const { data, error } = await loose
    .from('aeris_shield_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    console.error('[medevac.admin.shield-config.get] read failed', error);
    return null;
  }
  return (data as AerisShieldConfigRow | null) ?? null;
}
