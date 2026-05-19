import { requireClientSession } from '@/lib/clients/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { tierAtOrAbove } from '@/lib/privilege/tier-helpers';
import type { ClientPrivilegeTier } from '@/lib/privilege/types';

/**
 * Phase 13 PR 2 — D15 2FA banner for Platinum+ clients.
 *
 * Per D15 in spec §2: 2FA is a POLICY FLAG ONLY in v1. No
 * enforcement, no forced setup, no email/SMS. Just an
 * informational banner inviting Platinum/Diamond clients to
 * enable 2FA "soon" (Phase 13.2 will replace with TOTP setup).
 *
 * Server component. Renders nothing (returns null) if:
 *   - ENABLE_PRIVILEGE is not 'true'
 *   - client's tier is below Platinum
 *   - client already has two_factor_enabled = true
 *
 * Drop into `app/(client)/me/page.tsx` or any /me/* layout.
 */

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        single: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
};

export async function TwoFactorBanner() {
  if (process.env.ENABLE_PRIVILEGE !== 'true') return null;

  const session = await requireClientSession();
  const admin = createAdminClient() as unknown as LooseClient;

  const { data, error } = await admin
    .from('clients')
    .select('privilege_tier, two_factor_enabled')
    .eq('id', session.client_id)
    .single();

  if (error || !data) return null;

  const row = data as {
    privilege_tier: ClientPrivilegeTier;
    two_factor_enabled: boolean;
  };

  if (row.two_factor_enabled) return null;
  if (!tierAtOrAbove(row.privilege_tier, 'platinum')) return null;

  const tierLabel = row.privilege_tier === 'diamond' ? 'Diamond' : 'Platinum';

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-amber-300">
          ⚡
        </span>
        <div className="flex-1">
          <p className="font-ar text-sm text-amber-200">
            حسابك من المستوى <strong>{tierLabel}</strong> — يُنصح بشدّة
            بتفعيل المصادقة الثنائية لحماية حسابك.
          </p>
          <p className="font-ar mt-1 text-xs text-amber-300/80">
            ميزة المصادقة الثنائية تُطلق قريباً (Phase 13.2).
          </p>
        </div>
      </div>
    </div>
  );
}
