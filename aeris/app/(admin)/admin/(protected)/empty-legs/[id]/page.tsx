import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EmptyLegDetail } from '@/components/admin/empty-legs/leg-detail';
import { getEmptyLegById } from '@/lib/admin/empty-legs/queries';
import { createAdminClient } from '@/lib/supabase/admin';
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

async function loadReservationClient(
  clientId: string
): Promise<{ full_name: string; contact_phone: string } | null> {
  // Phase 10 PR 2 — when a leg is in State C
  // (reservation_client_id IS NOT NULL), pre-load the client
  // display fields so the admin reservation card shows who's
  // holding the leg. State C reservations don't carry snapshot
  // columns on the leg itself.
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('clients')
      .select('full_name, contact_phone')
      .eq('id', clientId)
      .maybeSingle();
    if (error) {
      console.error(
        '[admin-empty-leg-detail] reservation client lookup failed',
        error
      );
      return null;
    }
    return (data ?? null) as
      | { full_name: string; contact_phone: string }
      | null;
  } catch (err) {
    console.error('[admin-empty-leg-detail] threw', err);
    return null;
  }
}

export default async function AdminEmptyLegDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const leg = await getEmptyLegById(params.id);
  if (!leg) {
    notFound();
  }

  // State C reservation → pre-load the client display fields.
  // Other states leave reservationClient null (the component
  // falls back to the snapshot columns or skips the section).
  const reservationClient =
    leg.status === 'reserved' && leg.reservation_client_id
      ? await loadReservationClient(leg.reservation_client_id)
      : null;

  return (
    <EmptyLegDetail leg={leg} reservationClient={reservationClient} />
  );
}
