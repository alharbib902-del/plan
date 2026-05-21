import type { Metadata } from 'next';

import { requireAdminSession } from '@/lib/admin/auth';
import { AdminChangePasswordForm } from '@/components/admin/admin-change-password-form';

/**
 * Admin password rotation page.
 *
 * Lives OUTSIDE the (protected) route group on purpose:
 * (protected)/layout.tsx has the must_change_password gate that
 * redirects authenticated admins with the flag set HERE. If
 * this page were inside that group, the gate would create a
 * redirect loop.
 *
 * Auth is enforced inline via requireAdminSession() — that gives
 * us redirect-on-no-session + the AdminSessionInfo we need for
 * the form's `mustChangePassword` banner styling.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تغيير كلمة المرور',
  robots: { index: false, follow: false },
};

export default async function AdminChangePasswordPage() {
  const session = await requireAdminSession();

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
              تغيير كلمة المرور
            </p>
          </div>

          <AdminChangePasswordForm
            email={session.email}
            mustChangePassword={session.mustChangePassword}
          />
        </div>
      </div>
    </div>
  );
}
