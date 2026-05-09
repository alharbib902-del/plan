'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Repeat } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { adminConvertPhase7Stub } from '@/app/actions/operators';
import type {
  Phase7OperatorStubRow,
  OperatorRow,
} from '@/types/database';
import type { StubLegPreview } from '@/lib/admin/operators/queries';

type Toast =
  | { kind: 'success'; message: string; details?: string }
  | { kind: 'error'; message: string }
  | null;

function errorMessage(code?: string): string {
  if (!code) return operatorsAr.errors.unknown;
  const map = operatorsAr.errors as Record<string, string>;
  return map[code] ?? `${operatorsAr.errors.unknown} (${code})`;
}

interface StubConvertFormProps {
  stub: Phase7OperatorStubRow;
  candidateOperators: OperatorRow[];
  legsPreview: StubLegPreview[];
  initialOperatorId?: string | null;
}

export function StubConvertForm({
  stub,
  candidateOperators,
  legsPreview,
  initialOperatorId,
}: StubConvertFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [operatorId, setOperatorId] = useState<string>(initialOperatorId ?? '');
  const [toast, setToast] = useState<Toast>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorId) {
      setToast({ kind: 'error', message: 'الرجاء اختيار مشغّل هدف.' });
      return;
    }
    if (
      !confirm(operatorsAr.conversion.confirmPrompt + '\n\nهل تريد المتابعة؟')
    ) {
      return;
    }
    setToast(null);
    startTransition(async () => {
      const result = await adminConvertPhase7Stub({
        stub_id: stub.id,
        operator_id: operatorId,
      });
      if (result.ok) {
        setToast({
          kind: 'success',
          message: operatorsAr.toasts.stubConverted,
          details: `أُعيد ربط ${result.legs_reassigned} رحلة بالمشغّل.`,
        });
        // After a successful conversion, the stub is archived
        // and shouldn't be revisited; route to the target
        // operator's detail page instead.
        setTimeout(() => router.push(`/admin/operators/${operatorId}`), 1500);
      } else {
        setToast({ kind: 'error', message: errorMessage(result.error) });
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {toast ? (
        <div
          className={`font-ar rounded-xl border px-4 py-3 text-sm ${
            toast.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          <p>{toast.message}</p>
          {toast.kind === 'success' && toast.details ? (
            <p className="mt-1 text-xs text-emerald-200">{toast.details}</p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-navy-card/40 p-5">
        <h3 className="font-ar mb-3 text-base font-medium text-ink-primary">
          سجلّ Phase 7
        </h3>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="font-ar text-xs text-ink-muted">الشركة</dt>
            <dd className="font-ar text-ink-primary">{stub.company_name}</dd>
          </div>
          <div>
            <dt className="font-ar text-xs text-ink-muted">{operatorsAr.fields.contact_email}</dt>
            <dd dir="ltr" className="text-ink-primary">{stub.contact_email}</dd>
          </div>
          <div>
            <dt className="font-ar text-xs text-ink-muted">{operatorsAr.fields.contact_phone}</dt>
            <dd dir="ltr" className="text-ink-primary">{stub.contact_phone}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-navy-card/40 p-5">
        <label htmlFor="target-op" className="font-ar mb-2 block text-sm font-medium text-ink-primary">
          {operatorsAr.forms.targetOperatorLabel}
        </label>
        <select
          id="target-op"
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
          disabled={isPending}
        >
          <option value="">{operatorsAr.forms.targetOperatorPlaceholder}</option>
          {candidateOperators.map((op) => (
            <option key={op.id} value={op.id}>
              {op.company_name} · {op.auth_email}
            </option>
          ))}
        </select>
        {candidateOperators.length === 0 ? (
          <p className="font-ar mt-2 text-xs text-amber-200">
            لا يوجد مشغّلون مفعّلون أو موقوفون. يجب قبول مشغّل أوّلاً.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-navy-card/40 p-5">
        <h3 className="font-ar mb-3 text-base font-medium text-ink-primary">
          {operatorsAr.forms.legsToReassignLabel}
        </h3>
        {legsPreview.length === 0 ? (
          <p className="font-ar text-sm text-ink-muted">
            {operatorsAr.conversion.noLegs}
          </p>
        ) : (
          <>
            <p className="font-ar mb-3 text-sm text-gold-light">
              {operatorsAr.conversion.legsCount(legsPreview.length)}
            </p>
            <ul className="divide-y divide-border/50">
              {legsPreview.map((leg) => (
                <li key={leg.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-xs text-ink-secondary">{leg.leg_number}</span>
                  <span className="font-ar text-xs text-ink-muted">
                    {leg.departure_airport ?? '—'} → {leg.arrival_airport ?? '—'}
                  </span>
                  <span className="font-ar text-xs text-ink-muted">{leg.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <button
        type="submit"
        disabled={isPending || !operatorId || candidateOperators.length === 0}
        className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        <Repeat className="h-4 w-4" aria-hidden />
        {isPending ? '…' : operatorsAr.actions.convertStub}
      </button>
    </form>
  );
}
