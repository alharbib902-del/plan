'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createAlertAction, type AlertActionState } from '@/app/actions/empty-leg-alerts';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

const initialState: AlertActionState = { ok: false, message: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gold px-4 py-2 font-medium text-navy transition hover:bg-gold-dark hover:text-white disabled:opacity-50"
    >
      {pending ? emptyLegsAr.alertSubmitting : emptyLegsAr.alertSubmit}
    </button>
  );
}

const inputCls = 'mt-1 w-full rounded-md border border-secondary px-3 py-2 text-navy';
const labelCls = 'block text-sm font-medium text-navy';
const errCls = 'mt-1 text-sm text-red-600';

export function EmptyLegAlertForm() {
  const [state, formAction] = useActionState(createAlertAction, initialState);

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="origin_iata" className={labelCls}>{emptyLegsAr.alertFieldOrigin}</label>
          <input id="origin_iata" name="origin_iata" maxLength={3} required placeholder="RUH" className={inputCls} />
          {state.errors?.origin_iata ? <p className={errCls}>{state.errors.origin_iata[0]}</p> : null}
        </div>
        <div>
          <label htmlFor="destination_iata" className={labelCls}>{emptyLegsAr.alertFieldDest}</label>
          <input id="destination_iata" name="destination_iata" maxLength={3} required placeholder="JED" className={inputCls} />
          {state.errors?.destination_iata ? <p className={errCls}>{state.errors.destination_iata[0]}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="max_price_sar" className={labelCls}>{emptyLegsAr.alertFieldMaxPrice}</label>
          <input id="max_price_sar" name="max_price_sar" type="number" min="0" step="1" className={inputCls} />
          {state.errors?.max_price_sar ? <p className={errCls}>{state.errors.max_price_sar[0]}</p> : null}
        </div>
        <div>
          <label htmlFor="date_from" className={labelCls}>{emptyLegsAr.alertFieldDateFrom}</label>
          <input id="date_from" name="date_from" type="date" className={inputCls} />
        </div>
        <div>
          <label htmlFor="date_to" className={labelCls}>{emptyLegsAr.alertFieldDateTo}</label>
          <input id="date_to" name="date_to" type="date" className={inputCls} />
          {state.errors?.date_to ? <p className={errCls}>{state.errors.date_to[0]}</p> : null}
        </div>
      </div>

      {state.message ? (
        <p className={state.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>{state.message}</p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
