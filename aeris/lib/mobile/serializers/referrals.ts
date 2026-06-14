import type { MyReferralRow } from '@/lib/clients/referrals';

/**
 * Pure referral serializer + share-url builder (NO 'server-only',
 * tsx-testable).
 *
 * SECURITY/PRIVACY — strict positive allowlist. The referee's identity
 * is deliberately NOT exposed (listMyReferrals already omits it at the
 * query layer; this serializer is the second guard so a future query
 * widening still can't leak who was referred). Only the referrer's own
 * referral records are returned.
 */
export function serializeReferralForMobile(row: MyReferralRow) {
  return {
    id: row.id,
    status: row.status,
    // Mirror the web's display guard (me/referrals/page.tsx only shows the
    // reward when status==='rewarded'): never surface a pre-finalization
    // amount — the mobile contract is now the source of truth, so the gate
    // lives here, not in each client.
    referrer_reward_sar:
      row.status === 'rewarded' ? row.referrer_reward_sar : null,
    created_at: row.created_at,
    rewarded_at: row.rewarded_at,
  };
}

/**
 * Builds the client's share link. Mirrors the web exactly
 * (app/(client)/me/referrals/page.tsx): `${siteUrl}/signup?ref=<code>`
 * with the code URL-encoded.
 */
export function referralShareUrl(siteUrl: string, code: string): string {
  return `${siteUrl}/signup?ref=${encodeURIComponent(code)}`;
}
