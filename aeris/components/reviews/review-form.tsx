'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createReviewAction, type ReviewActionState } from '@/app/actions/reviews';
import { clientsAr } from '@/lib/i18n/clients-ar';

const initialState: ReviewActionState = { ok: false, message: '' };

function StarPicker({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-navy">{label}</span>
      <input type="hidden" name={name} value={value || ''} />
      <div className="mt-1 flex flex-row-reverse justify-end gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} ${clientsAr.reviewStarSuffix}`}
            aria-pressed={value === star}
            onClick={() => onChange(star)}
            className={
              star <= value
                ? 'text-2xl text-gold'
                : 'text-2xl text-muted hover:text-gold-light'
            }
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gold px-4 py-2 font-medium text-navy transition hover:bg-gold-dark hover:text-white disabled:opacity-50"
    >
      {pending ? clientsAr.reviewFormSubmitting : clientsAr.reviewFormSubmit}
    </button>
  );
}

export function ReviewForm({ bookingId, label }: { bookingId: string; label?: string }) {
  const [state, formAction] = useActionState(createReviewAction, initialState);
  const [overall, setOverall] = useState(0);
  const [aircraft, setAircraft] = useState(0);
  const [crew, setCrew] = useState(0);
  const [service, setService] = useState(0);

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      <input type="hidden" name="booking_id" value={bookingId} />

      {label ? <p className="text-sm text-muted">{label}</p> : null}

      <StarPicker name="overall_rating" label={clientsAr.reviewFormOverall} value={overall} onChange={setOverall} />
      {state.errors?.overall_rating ? (
        <p className="text-sm text-red-600">{state.errors.overall_rating[0]}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StarPicker name="aircraft_rating" label={clientsAr.reviewFormAircraft} value={aircraft} onChange={setAircraft} />
        <StarPicker name="crew_rating" label={clientsAr.reviewFormCrew} value={crew} onChange={setCrew} />
        <StarPicker name="service_rating" label={clientsAr.reviewFormService} value={service} onChange={setService} />
      </div>

      <div>
        <label htmlFor={`comment-${bookingId}`} className="block text-sm font-medium text-navy">
          {clientsAr.reviewFormCommentLabel}
        </label>
        <textarea
          id={`comment-${bookingId}`}
          name="comment"
          rows={3}
          className="mt-1 w-full rounded-md border border-secondary px-3 py-2 text-navy"
        />
        {state.errors?.comment ? (
          <p className="mt-1 text-sm text-red-600">{state.errors.comment[0]}</p>
        ) : null}
      </div>

      {state.message ? (
        <p className={state.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
