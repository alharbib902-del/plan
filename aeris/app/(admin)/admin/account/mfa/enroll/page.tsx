import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { requireAdminSession } from '@/lib/admin/auth';
import { loadAdminMfaSecret } from '@/lib/admin/mfa/queries';
import { startMfaEnrollment } from '@/app/(admin)/admin/actions/admin-mfa';
import { signOut } from '@/app/(admin)/admin/actions/admin-auth';
import { AdminMfaEnrollForm } from '@/components/admin/admin-mfa-enroll-form';

/**
 * Admin MFA enrollment page.
 *
 * OUTSIDE the (protected) route group (whose layout would bounce an
 * un-enrolled admin straight back here), but still only reachable
 * by fully-authenticated admins (NOT mfa_pending, NOT
 * must_change_password) via the inline requireAdminSession() gates.
 * MFA is mandatory, so this is where every un-enrolled admin lands;
 * it carries its own sign-out since there is no admin shell here.
 *
 * If the admin is ALREADY fully enrolled, redirect to the manage
 * page (they should disable/regenerate from there, not re-enroll).
 *
 * If a pending-but-unconfirmed secret exists from a prior session,
 * we deliberately reuse it via startMfaEnrollment's upsert: the
 * helper returns `already_enrolled` only when enrolled_at IS NOT
 * NULL. A pending row gets clobbered with a fresh secret on every
 * page load — the previous QR scan is discarded.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفعيل المصادقة الثنائية',
  robots: { index: false, follow: false },
};

export default async function AdminMfaEnrollPage() {
  // MFA is mandatory: requireAdminSession() forwards every
  // un-enrolled admin HERE, so this page must opt out of that gate
  // (it still requires a rotated password + no pending challenge).
  const session = await requireAdminSession({ allowMfaUnenrolled: true });

  // If fully enrolled already, redirect to manage.
  const existing = await loadAdminMfaSecret(session.adminUserId);
  if (existing && existing.enrolled_at !== null) {
    redirect('/admin/account/mfa');
  }

  // Start a fresh enrollment (clobbers any prior pending row).
  const enrollment = await startMfaEnrollment();
  if (!enrollment.ok) {
    // already_enrolled would have been caught above; the remaining
    // failure mode is storage_error.
    return (
      <section className="space-y-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-6">
        <h1 className="font-ar text-lg text-rose-100">
          تعذّر بدء تفعيل المصادقة
        </h1>
        <p className="font-ar text-sm text-rose-100/80">
          حدث خطأ مؤقت في قاعدة البيانات. حاول مرة أخرى أو تواصل مع مسؤول
          النظام.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink">
          تفعيل المصادقة الثنائية
        </h1>
        <p className="font-ar mt-2 text-sm text-ink-muted">
          المصادقة الثنائية إلزامية لجميع حسابات فريق Aeris، ولن تتمكّن من
          الوصول إلى لوحة التحكم قبل تفعيلها. ستحتاج إلى تطبيق مصادقة على
          هاتفك (Google Authenticator، Authy، 1Password…).
        </p>
      </header>

      <AdminMfaEnrollForm
        email={session.email}
        secretBase32={enrollment.secret_base32}
        otpAuthUrl={enrollment.otpauth_url}
      />

      <form action={signOut}>
        <button
          type="submit"
          className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          تسجيل الخروج
        </button>
      </form>
    </section>
  );
}
