'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { LEAD_STATUSES } from '@/lib/validators/admin';
import { leadStatusLabel } from './lead-status-badge';
import { updateLeadStatus } from '@/app/(admin)/admin/actions/leads';
import type { LeadStatus } from '@/types/database';

export function LeadStatusSelect({
  leadId,
  currentStatus,
}: {
  leadId: string;
  currentStatus: LeadStatus;
}) {
  const [pending, startTransition] = useTransition();

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as LeadStatus;
    if (next === currentStatus) return;

    const formData = new FormData();
    formData.append('id', leadId);
    formData.append('status', next);

    startTransition(async () => {
      const result = await updateLeadStatus(formData);
      if (!result.ok) {
        console.error('[lead-status-select] update failed', result.error);
        alert('تعذّر تحديث الحالة. حاول مرة أخرى.');
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <select
        defaultValue={currentStatus}
        onChange={handleChange}
        disabled={pending}
        aria-label="حالة الطلب"
        className={cn(
          'font-ar rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink',
          'hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40',
          'disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-navy">
            {leadStatusLabel(s)}
          </option>
        ))}
      </select>
      {pending && (
        <Loader2 className="h-4 w-4 animate-spin text-gold-light" aria-hidden />
      )}
    </div>
  );
}
