import type { Metadata } from 'next';

import { requireAdminSession } from '@/lib/admin/auth';
import { AdminMfaChallengeForm } from '@/components/admin/admin-mfa-challenge-form';

/**
 * Admin MFA challenge page.
 *
 * OUTSIDE the (protected) group on purpose: requireAdminSession()
 * by default redirects mfa_pending sessions to THIS page, so a
 * page inside (protected) would loop on itself. Inline auth
 * with `allowMfaPending: true` is the explicit opt-in.
 *
 * If the user lands here with mfa_pending=false (somehow already
 * completed MFA in another tab), we send them straight to the
 * dashboard.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تحقّق المصادقة الثنائية',
  robots: { index: false, follow: false },
};

export default async function AdminMfaChallengePage() {
  const session = await requireAdminSession({
    allowMfaPending: true,
    allowMustChangePassword: true,
  });

  return (
    <div className="relative min-h-screen bg-navy">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(201,169,97,0.10), transparent 60%), linear-gradient(180deg, #050B14 0%, #0A1628 100%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full">
          <div className="mb-6 text-center">
            <div
              className="font-display text-4xl tracking-[0.28em]"
              style={{
                background:
                  'linear-gradient(180deg, #E8D4A8 0%, #C9A961 50%, #8B7339 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              AERIS
            </div>
            <p className="font-ar mt-2 text-xs uppercase tracking-tagged text-ink-muted">
              التحقّق الثنائي
            </p>
          </div>

          <AdminMfaChallengeForm
            email={session.email}
            mfaAlreadyVerified={!session.mfaPending}
            mustChangePassword={session.mustChangePassword}
          />
        </div>
      </div>
    </div>
  );
}
