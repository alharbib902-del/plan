import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicLegDetail } from '@/components/public/empty-legs/leg-detail';
import { getPublicLegByNumber } from '@/lib/empty-legs/public-queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: { leg_number: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  return {
    title: `${emptyLegsAr.publicListTitle} — ${params.leg_number}`,
    description: emptyLegsAr.publicListSubtitle,
  };
}

export default async function PublicEmptyLegDetailPage({
  params,
}: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true') {
    notFound();
  }

  // The detail page surfaces 'sold' and 'expired' rows too
  // so a stale link still renders a meaningful state, not
  // a 404. The reserve CTA on the detail card only appears
  // for 'available'.
  const leg = await getPublicLegByNumber(params.leg_number, {
    allowedStatuses: ['available', 'sold'],
  });
  if (!leg) {
    return (
      <section className="mx-auto max-w-3xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        <p className="font-ar rounded-md border border-border bg-navy-card/30 px-4 py-6 text-center text-sm text-ink-muted">
          {emptyLegsAr.publicLegNotFound}
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <PublicLegDetail leg={leg} />
    </section>
  );
}
