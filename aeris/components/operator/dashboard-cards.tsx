import { operatorsAr } from '@/lib/i18n/operators-ar';
import type { OperatorDashboardStats } from '@/lib/operators/session-store';

const ar = operatorsAr.portal.dashboard;

export function OperatorDashboardCards({ stats }: { stats: OperatorDashboardStats }) {
  const cards = [
    { label: ar.cards.activeLegs, value: stats.active_legs, color: 'text-emerald-200' },
    { label: ar.cards.reservedLegs, value: stats.reserved_legs, color: 'text-amber-200' },
    { label: ar.cards.soldLegs, value: stats.sold_legs, color: 'text-sky-200' },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-border bg-navy-card/40 p-5"
        >
          <p className="font-ar text-xs text-ink-muted">{c.label}</p>
          <p className={`mt-2 font-display text-3xl ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
