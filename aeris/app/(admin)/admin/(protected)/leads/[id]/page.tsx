import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getLeadById } from '@/lib/supabase/queries/leads';
import { LeadDetailCard } from '@/components/admin/lead-detail-card';
import { LeadInternalNotes } from '@/components/admin/lead-internal-notes';
import {
  LeadStatusBadge,
  leadStatusLabel,
} from '@/components/admin/lead-status-badge';
import { LeadStatusSelect } from '@/components/admin/lead-status-select';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل الطلب',
  robots: { index: false, follow: false },
};

interface LeadDetailPageProps {
  params: { id: string };
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const lead = await getLeadById(params.id);
  if (!lead) {
    notFound();
  }

  return (
    <section>
      <Link
        href="/admin/leads"
        className="font-ar group inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-gold"
      >
        <ArrowLeft
          className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180"
          aria-hidden
        />
        العودة لقائمة الطلبات
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr,1fr] lg:items-start">
        <div className="space-y-6">
          <LeadDetailCard lead={lead} />
        </div>

        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-navy-card/40 p-5">
            <h3 className="font-ar text-base font-medium text-ink">حالة الطلب</h3>
            <p className="font-ar mt-1 text-xs text-ink-muted">
              تحديث الحالة يُحدّث ساعة آخر تواصل تلقائياً.
            </p>
            <div className="mt-4 flex flex-col items-start gap-3">
              <LeadStatusBadge status={lead.status} />
              <LeadStatusSelect leadId={lead.id} currentStatus={lead.status} />
              <p className="font-ar text-xs text-ink-muted">
                الحالة الحالية: {leadStatusLabel(lead.status)}
              </p>
            </div>
          </div>

          <LeadInternalNotes
            leadId={lead.id}
            existingNotes={lead.internal_notes}
          />
        </aside>
      </div>
    </section>
  );
}
