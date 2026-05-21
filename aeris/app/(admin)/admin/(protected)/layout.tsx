import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';

import { AdminEnvError, requireAdminSession } from '@/lib/admin/auth';
import { AdminShell } from '@/components/admin/admin-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    const session = await requireAdminSession();
    // PR #89 round 1 P1 fix — server-side gate. An admin with
    // must_change_password=true (founder seed or owner-driven
    // reset) cannot reach ANY protected page until they rotate.
    // The rotation page lives at /admin/account/password OUTSIDE
    // this (protected) group, so it doesn't loop on this gate.
    if (session.mustChangePassword) {
      redirect('/admin/account/password');
    }
  } catch (err) {
    if (err instanceof AdminEnvError) {
      // Log full detail server-side so the operator can act on it,
      // but never expose env var names or values to the browser.
      console.error('[admin-layout] env misconfiguration', err);
      return <AdminEnvNotice />;
    }
    // Re-throw NEXT_REDIRECT and any other unknown error so Next can
    // handle it normally (redirect to /admin/login, error boundary, etc.).
    throw err;
  }

  return <AdminShell>{children}</AdminShell>;
}

function AdminEnvNotice() {
  return (
    <div className="relative min-h-screen bg-navy">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(201,169,97,0.08), transparent 60%), linear-gradient(180deg, #050B14 0%, #0A1628 100%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
          <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="font-ar text-xl text-ink">الإعدادات غير مكتملة</h1>
          <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
            لوحة الفريق ليست جاهزة للاستخدام حالياً. يحتاج النظام إلى
            إعداد إضافي من قِبل المسؤول قبل أن يصبح الدخول متاحاً.
          </p>
          <p className="font-ar mt-3 text-xs text-ink-muted">
            راجع التفاصيل في سجلات الخادم وتواصل مع مسؤول النظام.
          </p>
        </div>
      </div>
    </div>
  );
}
