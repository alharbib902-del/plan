import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { OperatorStatusBadge } from './status-badge';
import type { OperatorRow as OperatorRowType } from '@/types/database';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function OperatorRow({ operator }: { operator: OperatorRowType }) {
  return (
    <Link
      href={`/admin/operators/${operator.id}`}
      className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40 hover:bg-navy-card/60"
    >
      <div className="flex flex-1 items-start gap-4">
        <div className="flex-1">
          <h3 className="font-ar text-base font-medium text-ink-primary group-hover:text-gold-light">
            {operator.company_name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span dir="ltr">{operator.auth_email}</span>
            <span>·</span>
            <span dir="ltr">{operator.contact_phone}</span>
            <span>·</span>
            <span className="font-ar">
              {operatorsAr.fields.created_at}: {formatDate(operator.created_at)}
            </span>
          </div>
        </div>
        <OperatorStatusBadge status={operator.signup_status} />
      </div>
      <ChevronLeft
        className="h-5 w-5 text-ink-muted transition-transform group-hover:-translate-x-0.5 group-hover:text-gold-light rtl:rotate-180"
        aria-hidden
      />
    </Link>
  );
}
