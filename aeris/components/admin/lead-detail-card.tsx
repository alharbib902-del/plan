import { MessageCircle, Phone } from 'lucide-react';
import type { LeadInquiryRow } from '@/types/database';
import { formatPhone } from '@/lib/utils/format';
import { buildLeadWhatsAppLink } from '@/lib/utils/whatsapp-admin';

const TRIP_LABEL_AR: Record<LeadInquiryRow['trip_type'], string> = {
  one_way: 'ذهاب فقط',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد الوجهات',
};

function formatDateAr(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: 'long',
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
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-3 border-t border-border/60 py-3 sm:grid-cols-[160px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{children}</dd>
    </div>
  );
}

export function LeadDetailCard({ lead }: { lead: LeadInquiryRow }) {
  const waUrl = buildLeadWhatsAppLink(lead);
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-sm text-gold-light">
            {lead.request_number}
          </div>
          <h2 className="font-ar mt-1 text-2xl text-ink">
            {lead.customer_name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`tel:${lead.customer_phone}`}
            className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light"
            dir="ltr"
          >
            <Phone className="h-4 w-4" aria-hidden />
            {formatPhone(lead.customer_phone)}
          </a>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            واتساب للعميل
          </a>
        </div>
      </div>

      <dl className="mt-6">
        <Row label="نوع الرحلة">{TRIP_LABEL_AR[lead.trip_type]}</Row>
        <Row label="من">{lead.origin}</Row>
        <Row label="إلى">{lead.destination}</Row>
        <Row label="تاريخ المغادرة">{formatDateAr(lead.departure_date)}</Row>
        {lead.return_date && (
          <Row label="تاريخ العودة">{formatDateAr(lead.return_date)}</Row>
        )}
        <Row label="عدد الركاب">{lead.passengers}</Row>
        <Row label="ملاحظات العميل">
          {lead.notes ? (
            <span className="whitespace-pre-wrap">{lead.notes}</span>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </Row>
        <Row label="المصدر">{lead.source}</Row>
        <Row label="وصل في">{formatDateTimeAr(lead.created_at)}</Row>
        {lead.last_contacted_at && (
          <Row label="آخر تواصل">
            {formatDateTimeAr(lead.last_contacted_at)}
          </Row>
        )}
      </dl>
    </div>
  );
}
