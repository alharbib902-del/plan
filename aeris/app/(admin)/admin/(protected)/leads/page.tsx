import type { Metadata } from 'next';
import { LeadStatusFilter } from '@/components/admin/lead-status-filter';
import { LeadTable } from '@/components/admin/lead-table';
import { countLeadsByStatus, listLeads } from '@/lib/supabase/queries/leads';
import { LEAD_STATUSES, type LeadStatusValue } from '@/lib/validators/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'الطلبات',
  robots: { index: false, follow: false },
};

interface LeadsPageProps {
  searchParams?: Promise<{ status?: string }>;
}

function parseStatus(raw: string | undefined): LeadStatusValue | 'all' {
  if (!raw) return 'all';
  const lowered = raw.toLowerCase();
  if (lowered === 'all') return 'all';
  if ((LEAD_STATUSES as readonly string[]).includes(lowered)) {
    return lowered as LeadStatusValue;
  }
  return 'all';
}

export default async function AdminLeadsPage({ searchParams }: LeadsPageProps) {
  const status = parseStatus(((await searchParams) ?? {}).status);
  const [leads, counts] = await Promise.all([
    listLeads({ status, limit: 200 }),
    countLeadsByStatus(),
  ]);

  return (
    <section>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink sm:text-3xl">طلبات الرحلات</h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            جميع الطلبات الواردة من النموذج العام، مرتّبة حسب الأحدث.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <LeadStatusFilter current={status} counts={counts} />
      </div>

      <LeadTable leads={leads} />
    </section>
  );
}
