import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, ShieldOff } from 'lucide-react';

import { requireAdminSession } from '@/lib/admin/auth';
import { loadAdminMfaSecret } from '@/lib/admin/mfa/queries';
import { AdminMfaDisableForm } from '@/components/admin/admin-mfa-disable-form';

/**
 * Admin MFA management page.
 *
 * Inside the (protected) group — needs a fully-authenticated
 * session (not mfa_pending, not must_change_password).
 *
 * Shows current MFA status. If enrolled, exposes the disable
 * form (re-verifies password + live OTP before wiping). If not
 * enrolled, links to the enrollment page.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'إدارة المصادقة الثنائية',
  robots: { index: false, follow: false },
};

function formatDateAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function AdminMfaManagePage() {
  const session = await requireAdminSession();
  const row = await loadAdminMfaSecret(session.adminUserId);
  const enrolled = row !== null && row.enrolled_at !== null;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-ar text-2xl text-ink">إدارة المصادقة الثنائية</h1>
        <p className="font-ar text-sm text-ink-muted">
          المصادقة الثنائية تضيف طبقة حماية ثانية لحسابك. تُطلب عند كل تسجيل
          دخول بعد كلمة المرور.
        </p>
      </header>

      <div
        className={`rounded-2xl border p-6 ${
          enrolled
            ? 'border-emerald-400/40 bg-emerald-500/5'
            : 'border-amber-400/40 bg-amber-500/5'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
              enrolled
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-400/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            {enrolled ? (
              <ShieldCheck className="h-5 w-5" aria-hidden />
            ) : (
              <ShieldOff className="h-5 w-5" aria-hidden />
            )}
          </div>
          <div className="flex-1">
            <p className="font-ar text-base text-ink">
              {enrolled
                ? 'المصادقة الثنائية مفعّلة'
                : 'المصادقة الثنائية غير مفعّلة'}
            </p>
            <p className="font-ar mt-1 text-xs text-ink-muted">
              {enrolled
                ? `تم التفعيل في ${formatDateAr(row?.enrolled_at ?? null)}`
                : 'يُنصح بشدّة بتفعيلها لحماية حسابك.'}
            </p>
          </div>
          {!enrolled && (
            <Link
              href="/admin/account/mfa/enroll"
              className="font-ar inline-flex items-center justify-center rounded-md bg-gold-shine px-4 py-2 text-sm font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow"
            >
              تفعيل الآن
            </Link>
          )}
        </div>
      </div>

      {enrolled && <AdminMfaDisableForm />}
    </section>
  );
}
