import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { LeadInquiryRow } from '@/types/database';
import { LeadStatusBadge } from './lead-status-badge';
import { formatPhone } from '@/lib/utils/format';
import { buildLeadWhatsAppLink } from '@/lib/utils/whatsapp-admin';

const TRIP_LABEL_AR: Record<LeadInquiryRow['trip_type'], string> = {
  one_way: 'ذهاب',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد',
};

function formatDateAr(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateTimeAr(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function LeadTable({ leads }: { leads: LeadInquiryRow[] }) {
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
        <p className="font-ar text-sm text-ink-muted">
          لا توجد طلبات بهذه الحالة.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-navy-card/40 lg:block">
        <table className="w-full text-right">
          <thead className="border-b border-border bg-navy-secondary/60">
            <tr>
              <th scope="col" className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted">
                الرقم
              </th>
              <th scope="col" className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted">
                العميل
              </th>
              <th scope="col" className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted">
                الرحلة
              </th>
              <th scope="col" className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted">
                المغادرة
              </th>
              <th scope="col" className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted">
                الحالة
              </th>
              <th scope="col" className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted">
                وصل في
              </th>
              <th scope="col" className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className="border-t border-border/60 transition-colors hover:bg-navy-secondary/40"
              >
                <td className="px-4 py-4 font-mono text-sm text-gold-light">
                  {lead.request_number}
                </td>
                <td className="px-4 py-4">
                  <div className="font-ar text-sm text-ink">{lead.customer_name}</div>
                  <a
                    href={buildLeadWhatsAppLink(lead)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-ar mt-1 inline-flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-gold"
                    dir="ltr"
                  >
                    {formatPhone(lead.customer_phone)}
                  </a>
                </td>
                <td className="px-4 py-4">
                  <div className="font-ar text-sm text-ink">
                    {lead.origin} ← {lead.destination}
                  </div>
                  <div className="font-ar mt-1 text-xs text-ink-muted">
                    {TRIP_LABEL_AR[lead.trip_type]} · {lead.passengers} ركاب
                  </div>
                </td>
                <td className="font-ar px-4 py-4 text-sm text-ink-secondary">
                  {formatDateAr(lead.departure_date)}
                </td>
                <td className="px-4 py-4">
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td className="font-ar px-4 py-4 text-xs text-ink-muted">
                  {formatDateTimeAr(lead.created_at)}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/admin/leads/${lead.id}`}
                    className="font-ar inline-flex items-center gap-1 text-sm text-gold-light transition-colors hover:text-gold"
                  >
                    فتح
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet: card stack */}
      <div className="grid gap-3 lg:hidden">
        {leads.map((lead) => (
          <Link
            key={lead.id}
            href={`/admin/leads/${lead.id}`}
            className="block rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-sm text-gold-light">
                  {lead.request_number}
                </div>
                <div className="font-ar mt-1 text-base text-ink">
                  {lead.customer_name}
                </div>
                <div className="font-ar mt-0.5 text-xs text-ink-muted" dir="ltr">
                  {formatPhone(lead.customer_phone)}
                </div>
              </div>
              <LeadStatusBadge status={lead.status} />
            </div>
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="font-ar text-sm text-ink-secondary">
                {lead.origin} ← {lead.destination}
              </div>
              <div className="font-ar mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{TRIP_LABEL_AR[lead.trip_type]}</span>
                <span>· {lead.passengers} ركاب</span>
                <span>· {formatDateAr(lead.departure_date)}</span>
              </div>
            </div>
            <div className="font-ar mt-3 text-xs text-ink-muted">
              وصل في {formatDateTimeAr(lead.created_at)}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
