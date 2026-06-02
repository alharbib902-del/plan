import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

export const metadata: Metadata = {
  title: 'صلاحية غير كافية',
  robots: { index: false, follow: false },
};

/**
 * Shown when an authenticated admin whose role lacks permission hits a
 * gated write action (requireAdminSession({ roles }) redirects here).
 * Server component; the (protected) layout already gates the session,
 * and this page passes no `roles` so every admin can render it (no loop).
 */
export default function AdminForbidden() {
  return (
    <main className="relative min-h-screen bg-navy">
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
          <h1 className="font-ar text-xl text-ink">صلاحية غير كافية</h1>
          <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
            هذا الإجراء مقصور على فريق الإدارة (owner / admin). دور الدعم
            مخوّل للاطّلاع وتذاكر الدعم وفرز الطلبات فقط. إن كنت تحتاج هذه
            الصلاحية، تواصل مع مالك الحساب.
          </p>
          <Link
            href="/admin/trips"
            className="font-ar mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
          >
            العودة إلى لوحة الإدارة
          </Link>
        </div>
      </div>
    </main>
  );
}
