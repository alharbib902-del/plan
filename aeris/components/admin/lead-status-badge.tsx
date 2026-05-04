import { cn } from '@/lib/utils/cn';
import type { LeadStatus } from '@/types/database';

const STATUS_LABEL_AR: Record<LeadStatus, string> = {
  new: 'جديد',
  contacted: 'تم التواصل',
  quoted: 'تم التسعير',
  converted: 'تحوّل لحجز',
  closed: 'مغلق',
};

const STATUS_STYLE: Record<LeadStatus, string> = {
  new: 'border-gold/40 bg-gold/10 text-gold-light',
  contacted: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  quoted: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
  converted: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  closed: 'border-border bg-navy-secondary/60 text-ink-muted',
};

export function leadStatusLabel(status: LeadStatus): string {
  return STATUS_LABEL_AR[status];
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn(
        'font-ar inline-flex items-center rounded-full border px-3 py-1 text-xs',
        STATUS_STYLE[status]
      )}
    >
      {STATUS_LABEL_AR[status]}
    </span>
  );
}
