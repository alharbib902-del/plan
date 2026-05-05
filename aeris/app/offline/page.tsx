import type { Metadata } from 'next';
import { OfflineCard } from '@/components/pwa/offline-card';

export const metadata: Metadata = {
  title: 'غير متصل',
  robots: { index: false, follow: false },
};

/**
 * Phase 4.2 offline fallback. Precached by the service worker so
 * it's always available when both network and cache miss. Static,
 * no data fetches.
 */
export default function OfflinePage() {
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
        <OfflineCard />
      </div>
    </main>
  );
}
