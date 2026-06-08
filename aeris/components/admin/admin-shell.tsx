import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { signOut } from '@/app/(admin)/admin/actions/admin-auth';
import { supportAr } from '@/lib/i18n/support-ar';
import { analyticsAr } from '@/lib/i18n/analytics-ar';
import { AdminMobileNav } from './admin-mobile-nav';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const navLinks: { href: string; label: string }[] = [
    { href: '/admin/leads', label: 'الطلبات' },
    { href: '/admin/trips', label: 'الرحلات' },
    { href: '/admin/analytics', label: analyticsAr.nav },
    { href: '/admin/support', label: supportAr.nav },
    ...(process.env.ENABLE_EMPTY_LEGS_ADMIN_UI !== 'false'
      ? [
          { href: '/admin/empty-legs', label: 'الرحلات الفارغة' },
          { href: '/admin/empty-legs/outreach-queue', label: 'قائمة المراسلات' },
          { href: '/admin/empty-legs/operators', label: 'سجلّات المشغّلين' },
        ]
      : []),
    ...(process.env.ENABLE_OPERATOR_PORTAL_ADMIN !== 'false'
      ? [
          { href: '/admin/operators', label: 'المشغّلون' },
          { href: '/admin/operators/canary', label: 'لوحة الصحّة' },
        ]
      : []),
    // Round 2 PR #65 P2 #2 — gated cargo nav links so the
    // founder can reach the queue + capability matrix without
    // memorizing hidden URLs. The flag check uses `=== 'true'`
    // (fail-closed) to match the same discipline as /admin/cargo
    // + /admin/cargo/aircraft-capabilities pages, so the links
    // never appear when the cargo surface is off.
    ...(process.env.ENABLE_CARGO === 'true'
      ? [
          { href: '/admin/cargo', label: 'الشحن' },
          { href: '/admin/cargo/aircraft-capabilities', label: 'قدرات الشحن' },
        ]
      : []),
    // Round 1 PR #76 P2 #3 fix — gated MedEvac nav links matching
    // the cargo pattern. Without these the founder has to know
    // hidden URLs to reach the /admin/medevac queue or the cert
    // matrix. Same fail-closed `=== 'true'` check as the pages
    // themselves so links never appear with the flag off.
    ...(process.env.ENABLE_MEDEVAC === 'true'
      ? [
          { href: '/admin/medevac', label: 'الإخلاء الطبي' },
          {
            href: '/admin/medevac/medical-certifications',
            label: 'شهادات الإخلاء الطبي',
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-navy">
      <header className="sticky top-0 z-40 border-b border-border bg-navy-secondary/85 backdrop-blur-luxury">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link
              href="/admin/leads"
              className="flex items-center gap-3"
              aria-label="Aeris Admin"
            >
              <span className="font-display text-xl tracking-[0.28em] text-gold-light">
                AERIS
              </span>
              <span className="font-ar rounded-full border border-border px-2.5 py-0.5 text-xs uppercase tracking-tagged text-ink-muted">
                لوحة الفريق
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {navLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <form action={signOut}>
              <button
                type="submit"
                className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                تسجيل الخروج
              </button>
            </form>
            <AdminMobileNav links={navLinks} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
