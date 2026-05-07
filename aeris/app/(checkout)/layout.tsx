import type { ReactNode } from 'react';

/**
 * Phase 6.2 PR 2b: customer checkout-prep route group layout.
 *
 * Spec S5: customer-side surface, RTL-first Arabic, brand
 * tokens (gold + navy + IBM Plex Sans Arabic). The
 * `(checkout)` route group sits parallel to `(admin)` and
 * `(client)` so its public path is `/booking/<token>/...`
 * without `(checkout)` in the URL.
 *
 * Layout intentionally minimal: header band with the brand
 * mark, single-column content, no global nav. The page
 * itself renders the flight summary + add-ons table +
 * confirm/WhatsApp buttons OR the "expired or not-issued"
 * surface — depending on the three-layer token validation.
 */
export const metadata = {
  // The page-level metadata override sets a per-token title.
  title: 'مراجعة الحجز',
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      lang="ar"
      dir="rtl"
      className="min-h-screen bg-navy text-ink"
    >
      <header className="border-b border-border/40 bg-navy-secondary/40">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <div className="font-ar text-base font-medium text-gold-light">
              Aeris
            </div>
            <div className="font-ar text-xs text-ink-muted">
              مراجعة الحجز
            </div>
          </div>
          <div className="font-ar hidden text-xs text-ink-muted sm:block">
            هذا الرابط شخصي. لا تشاركه مع أحد.
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
