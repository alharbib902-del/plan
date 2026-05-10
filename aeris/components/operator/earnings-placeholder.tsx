import { Wallet } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export function OperatorEarningsPlaceholder() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
      <Wallet className="mx-auto mb-3 h-8 w-8 text-ink-muted" aria-hidden />
      <p className="font-ar text-base text-gold-light">قريباً</p>
      <p className="font-ar mt-2 text-sm text-ink-muted">
        {operatorsAr.portal.earnings.placeholder}
      </p>
    </div>
  );
}
