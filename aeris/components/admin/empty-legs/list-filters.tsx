import Link from 'next/link';

import { cn } from '@/lib/utils/cn';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import {
  EMPTY_LEG_STATUSES,
  type EmptyLegListFilter,
  type EmptyLegStatusCounts,
} from '@/lib/admin/empty-legs/queries';
import { emptyLegStatusLabel } from './status-badge';

export function EmptyLegsListFilters({
  current,
  counts,
}: {
  current: EmptyLegListFilter;
  counts: EmptyLegStatusCounts;
}) {
  const tabs: { value: EmptyLegListFilter; label: string; count: number }[] = [
    { value: 'open', label: emptyLegsAr.filterDefault, count: counts.open },
    { value: 'all', label: emptyLegsAr.filterAll, count: counts.total },
    ...EMPTY_LEG_STATUSES.map((s) => ({
      value: s,
      label: emptyLegStatusLabel(s),
      count: counts[s],
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.value === current;
        const href =
          tab.value === 'open'
            ? '/admin/empty-legs'
            : `/admin/empty-legs?status=${tab.value}`;
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
