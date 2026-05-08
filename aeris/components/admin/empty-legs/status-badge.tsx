import { cn } from '@/lib/utils/cn';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import type { EmptyLegStatus } from '@/lib/empty-legs/types';

const STATUS_LABEL_AR: Record<EmptyLegStatus, string> = {
  available: emptyLegsAr.statusAvailable,
  reserved: emptyLegsAr.statusReserved,
  sold: emptyLegsAr.statusSold,
  expired: emptyLegsAr.statusExpired,
  cancelled: emptyLegsAr.statusCancelled,
};

const STATUS_STYLE: Record<EmptyLegStatus, string> = {
  available: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  reserved: 'border-gold/40 bg-gold/10 text-gold-light',
  sold: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  expired: 'border-border bg-navy-secondary/60 text-ink-muted',
  cancelled: 'border-border bg-navy-secondary/60 text-ink-muted',
};

export function emptyLegStatusLabel(status: EmptyLegStatus): string {
  return STATUS_LABEL_AR[status];
}

export function EmptyLegStatusBadge({ status }: { status: EmptyLegStatus }) {
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
