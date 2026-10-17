import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';
import { signOut } from '@/app/(admin)/admin/actions/admin-auth';
import { supportAr } from '@/lib/i18n/support-ar';
import { analyticsAr } from '@/lib/i18n/analytics-ar';
import {
  ShellNavLinks,
  type ShellNavItem,
} from '@/components/layout/shell-nav-links';
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
    ...(process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'true'
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
      <header className="sticky top-0 z-40 border-b border-border bg-navy-secondary/85 pt-[env(safe-area-inset-top)] backdrop-blur-luxury">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            <Link
              href="/admin/leads"
              className="flex shrink-0 items-center gap-3"
              aria-label="Aeris Admin"
            >
              <span className="font-display text-xl tracking-[0.28em] text-gold-light">
                AERIS
              </span>
              <span className="font-ar hidden rounded-full border border-border px-2.5 py-0.5 text-xs uppercase tracking-tagged text-ink-muted sm:inline">
                لوحة الفريق
              </span>
            </Link>
            <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto lg:flex">
              <ShellNavLinks links={navLinks} variant="bar" />
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <AdminAccountMenu />
            <form action={signOut}>
              <button
                type="submit"
                title="تسجيل الخروج"
                className="font-ar inline-flex h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-navy-card/60 px-3 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="sr-only sm:not-sr-only lg:sr-only">
                  تسجيل الخروج
                </span>
              </button>
            </form>
            <AdminMobileNav links={navLinks} accountLinks={ACCOUNT_LINKS} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

// There is no /admin/account index route: password and MFA are two
// standalone pages (outside the shell), so the menu links each one.
const ACCOUNT_LINKS: ShellNavItem[] = [
  { href: '/admin/account/password', label: 'تغيير كلمة المرور' },
  { href: '/admin/account/mfa', label: 'المصادقة الثنائية' },
];

// Native <details> keeps the shell a Server Component; both targets
// leave the shell, so the open state never outlives a navigation.
// Below lg the same links live in AdminMobileNav.
function AdminAccountMenu() {
  return (
    <details className="group relative hidden lg:block">
      <summary
        title="حسابي"
        className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-navy-card/60 text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light group-open:border-gold/40 group-open:text-gold-light [&::-webkit-details-marker]:hidden"
      >
        <UserRound className="h-4 w-4" aria-hidden />
        <span className="sr-only">حسابي</span>
      </summary>
      <div className="absolute end-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-navy-secondary/95 p-2 shadow-luxury backdrop-blur-luxury">
        {ACCOUNT_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="font-ar flex min-h-11 items-center rounded-md px-3 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
