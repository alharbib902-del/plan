import { cn } from '@/lib/utils/cn';
import type { TripRequestStatus } from '@/types/database';

const STATUS_LABEL_AR: Record<TripRequestStatus, string> = {
  pending: 'بانتظار الإرسال',
  distributed: 'أُرسل للمشغّل',
  offered: 'وصل عرض',
  booked: 'محجوز',
  cancelled: 'ملغى',
};

const STATUS_STYLE: Record<TripRequestStatus, string> = {
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  distributed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  offered: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
  booked: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  cancelled: 'border-border bg-navy-secondary/60 text-ink-muted',
};

export function tripStatusLabel(status: TripRequestStatus): string {
  return STATUS_LABEL_AR[status];
}

export function TripStatusBadge({ status }: { status: TripRequestStatus }) {
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
