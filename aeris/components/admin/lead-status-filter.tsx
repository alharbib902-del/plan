import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { LEAD_STATUSES, type LeadStatusValue } from '@/lib/validators/admin';
import { leadStatusLabel } from './lead-status-badge';
import type { LeadStatusCounts } from '@/lib/supabase/queries/leads';

type FilterValue = LeadStatusValue | 'all';

export function LeadStatusFilter({
  current,
  counts,
}: {
  current: FilterValue;
  counts: LeadStatusCounts;
}) {
  const tabs: { value: FilterValue; label: string; count: number }[] = [
    { value: 'all', label: 'الكل', count: counts.total },
    ...LEAD_STATUSES.map((s) => ({
      value: s as FilterValue,
      label: leadStatusLabel(s),
      count: counts[s],
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.value === current;
        const href =
          tab.value === 'all' ? '/admin/leads' : `/admin/leads?status=${tab.value}`;
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
