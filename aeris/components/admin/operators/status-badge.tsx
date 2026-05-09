import { operatorsAr } from '@/lib/i18n/operators-ar';
import type { OperatorSignupStatus } from '@/types/database';

const STYLES: Record<OperatorSignupStatus, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  suspended: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  rejected: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
};

export function OperatorStatusBadge({
  status,
}: {
  status: OperatorSignupStatus;
}) {
  return (
    <span
      className={`font-ar inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {operatorsAr.status[status]}
    </span>
  );
}
