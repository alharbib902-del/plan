import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EmptyLegDetail } from '@/components/admin/empty-legs/leg-detail';
import { getEmptyLegById } from '@/lib/admin/empty-legs/queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.pageDetailTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

export default async function AdminEmptyLegDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const leg = await getEmptyLegById(params.id);
  if (!leg) {
    notFound();
  }

  return <EmptyLegDetail leg={leg} />;
}
