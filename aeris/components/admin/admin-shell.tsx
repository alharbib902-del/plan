import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { signOut } from '@/app/(admin)/admin/actions/admin-auth';

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-navy">
      <header className="sticky top-0 z-40 border-b border-border bg-navy-secondary/85 backdrop-blur-luxury">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
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
              <Link
                href="/admin/leads"
                className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
              >
                الطلبات
              </Link>
              <Link
                href="/admin/trips"
                className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
              >
                الرحلات
              </Link>
              {process.env.ENABLE_EMPTY_LEGS_ADMIN_UI !== 'false' ? (
                <>
                  <Link
                    href="/admin/empty-legs"
                    className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
                  >
                    الرحلات الفارغة
                  </Link>
                  <Link
                    href="/admin/empty-legs/outreach-queue"
                    className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
                  >
                    قائمة المراسلات
                  </Link>
                  <Link
                    href="/admin/empty-legs/operators"
                    className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
                  >
                    سجلّات المشغّلين
                  </Link>
                </>
              ) : null}
            </nav>
          </div>

          <form action={signOut}>
            <button
              type="submit"
              className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              تسجيل الخروج
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
