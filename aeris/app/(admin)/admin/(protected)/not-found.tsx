import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from 'lucide-react';

export const metadata: Metadata = {
  title: 'الصفحة غير موجودة',
  robots: { index: false, follow: false },
};

/**
 * Branded Arabic 404 for the admin dashboard. Contextual back-link
 * returns to the leads queue instead of the public site, so a
 * signed-in team member stays inside the dashboard. Server
 * component — no interactivity beyond a link.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
        <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
          <Compass className="h-6 w-6" aria-hidden />
        </div>
        <p className="font-display text-4xl text-gold">404</p>
        <h1 className="font-ar mt-2 text-xl text-ink">الصفحة غير موجودة</h1>
        <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
          قد يكون الرابط قديمًا أو غير صحيح. عُد إلى قائمة الطلبات لمتابعة عمل
          الفريق.
        </p>
        <Link
          href="/admin/leads"
          className="font-ar mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
        >
          العودة إلى الطلبات
        </Link>
      </div>
    </div>
  );
}
