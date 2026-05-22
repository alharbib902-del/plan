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
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  const leg = await getEmptyLegById(id);
  if (!leg) {
    notFound();
  }

  // State C reservation → pre-load the client display fields.
  // Other states leave reservationClient null (the component
  // falls back to the snapshot columns or skips the section).
  //
  // Codex round 1 PR #63 P1 #1 fix — positive string check.
  // The Phase 10 §3.1 migration adds reservation_client_id as a
  // new column; before it's applied, `select('*')` returns leg
  // rows WITHOUT the property and the truthy check on
  // `leg.reservation_client_id` (= undefined) is false here so
  // the bug surface is narrower than the leg-detail.tsx case,
  // but we still apply the same positive-string guard for
  // discipline + future-proofing (a downstream change that
  // accidentally short-circuits could re-introduce the misread).
  const reservationClientId =
    typeof leg.reservation_client_id === 'string' &&
    leg.reservation_client_id.length > 0
      ? leg.reservation_client_id
      : null;
  const reservationClient =
    leg.status === 'reserved' && reservationClientId !== null
      ? await loadReservationClient(reservationClientId)
      : null;

  return (
    <EmptyLegDetail leg={leg} reservationClient={reservationClient} />
  );
}
