import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { tripStatusLabel } from './trip-status-badge';
import {
  TRIP_STATUSES,
  type TripStatusCounts,
} from '@/lib/supabase/queries/trips';
import type { TripRequestStatus } from '@/types/database';

type FilterValue = TripRequestStatus | 'all';

export function TripStatusFilter({
  current,
  counts,
}: {
  current: FilterValue;
  counts: TripStatusCounts;
}) {
  const tabs: { value: FilterValue; label: string; count: number }[] = [
    { value: 'all', label: 'الكل', count: counts.total },
    ...TRIP_STATUSES.map((s) => ({
      value: s as FilterValue,
      label: tripStatusLabel(s),
      count: counts[s],
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.value === current;
        const href =
          tab.value === 'all'
            ? '/admin/trips'
            : `/admin/trips?status=${tab.value}`;
        return (
          <Link
            key={tab.value}
            href={href}
            className={cn(
              'font-ar inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors',
              active
                ? 'border-gold bg-gold/10 text-gold-light'
                : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40 hover:text-gold-light'
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-2xs',
                active
                  ? 'bg-gold/20 text-gold-light'
                  : 'bg-navy-card/80 text-ink-muted'
              )}
            >
              {tab.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
