import type { Metadata } from 'next';

import { OperatorPortalHeader } from '@/components/operator/operator-portal-header';

export const metadata: Metadata = {
  title: 'عرض رحلة',
  robots: { index: false, follow: false },
};

export default function OperatorOfferLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <div className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <OperatorPortalHeader />
        {children}
      </div>
    </div>
  );
}
