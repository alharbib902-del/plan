import Link from 'next/link';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import type {
  OperatorListFilter,
  OperatorStatusCounts,
} from '@/lib/admin/operators/queries';

interface ListFiltersProps {
  active: OperatorListFilter;
  counts: OperatorStatusCounts;
}

interface ChipDef {
  key: OperatorListFilter;
  label: string;
  count: number;
}

export function OperatorListFilters({ active, counts }: ListFiltersProps) {
  const chips: ChipDef[] = [
    { key: 'all', label: operatorsAr.filters.all, count: counts.total },
    { key: 'pending', label: operatorsAr.filters.pending, count: counts.pending },
    { key: 'approved', label: operatorsAr.filters.approved, count: counts.approved },
    { key: 'suspended', label: operatorsAr.filters.suspended, count: counts.suspended },
    { key: 'rejected', label: operatorsAr.filters.rejected, count: counts.rejected },
  ];

  return (
    <nav
      className="flex flex-wrap items-center gap-2"
      aria-label={operatorsAr.filters.all}
    >
      {chips.map((chip) => {
        const isActive = chip.key === active;
        const href =
          chip.key === 'all' ? '/admin/operators' : `/admin/operators?filter=${chip.key}`;
        return (
          <Link
            key={chip.key}
            href={href}
            className={`font-ar inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors ${
              isActive
                ? 'border-gold/60 bg-gold/15 text-gold-light'
                : 'border-border bg-navy-card/40 text-ink-secondary hover:border-gold/30 hover:text-gold-light'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span>{chip.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isActive ? 'bg-navy-secondary/60 text-gold-light' : 'bg-navy-secondary/60 text-ink-muted'
              }`}
            >
              {chip.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
