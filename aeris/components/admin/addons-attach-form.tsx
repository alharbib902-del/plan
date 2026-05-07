'use client';

import { useState, useTransition } from 'react';

import type { AddonCatalogEntry } from '@/lib/addons/catalog';
import type { TripPreferences } from '@/lib/validators/trip-preferences';
import { attachAddon } from '@/app/(admin)/admin/actions/booking-addons';
import { t } from '@/lib/i18n/operator';

/**
 * Phase 6.2 PR 2b: admin attach form per catalog entry.
 *
 * One card per catalog entry; the admin browses the catalog,
 * adjusts price + quantity + note, and clicks "Attach". The
 * form calls the `attachAddon` Server Action, which is a
 * thin wrapper around PR 2a's `attach_booking_addon` SQL
 * function (atomic INSERT + recompute totals).
 *
 * Per_passenger entries (catering rows) display a hint
 * "تُحسب الكمية تلقائياً من عدد الركاب" and disable the
 * quantity input — the SQL function will derive quantity
 * from `bookings.passengers_count_snapshot` regardless.
 *
 * Free entries (`unit_price_sar = 0`, `free = true`) hide
 * the price-override input entirely; the SQL function
 * rejects any non-zero override on a free addon
 * (`price_override_on_free_addon` error).
 *
 * Suggested entries (matched against trip preferences) get
 * a gold ring + a small "مُقترحة" badge — non-blocking.
 */
export function AddonsAttachForm({
  tripId,
  entry,
  passengersCount,
  preferences,
}: {
  tripId: string;
  entry: AddonCatalogEntry;
  passengersCount: number;
  preferences: TripPreferences | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isSuggested = isMatchedBySuggestion(entry, preferences);
  const showPriceOverride = !entry.free;

  // Per-passenger derivation: the SQL function ignores any
  // submitted quantity for per_passenger subtypes. We mirror
  // that in the UI by disabling the quantity input + showing
  // a hint. The admin sees what the booking will get.
  const effectiveQuantity = entry.per_passenger
    ? passengersCount
    : 1;
  const expectedTotal = effectiveQuantity * entry.unit_price_sar;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const overrideRaw = formData.get('unit_price_override');
    const quantityRaw = formData.get('quantity');
    const noteRaw = formData.get('note');

    const overrideNum =
      typeof overrideRaw === 'string' && overrideRaw.length > 0
        ? Number(overrideRaw)
        : null;
    const quantityNum =
      typeof quantityRaw === 'string' && quantityRaw.length > 0
        ? Number(quantityRaw)
        : null;
    const note = typeof noteRaw === 'string' ? noteRaw : null;

    startTransition(async () => {
      const result = await attachAddon({
        trip_request_id: tripId,
        addon_subtype: entry.subtype,
        unit_price_override: overrideNum,
        quantity: quantityNum,
        note,
      });
      if (result.ok) {
        setSuccess(true);
        // Reset the form so the admin can attach another row
        // of the same subtype if needed (e.g. multiple
        // limousines).
        e.currentTarget.reset?.();
      } else {
        setError(translateError(result.error));
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-lg border bg-navy-secondary/40 p-4 transition-colors ${
        isSuggested
          ? 'border-gold/60 ring-1 ring-gold/30'
          : 'border-border'
      }`}
      data-subtype={entry.subtype}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="font-ar text-sm text-ink">{entry.label_ar}</h5>
          {entry.description_ar && (
            <p className="font-ar mt-1 text-xs text-ink-muted">
              {entry.description_ar}
            </p>
          )}
        </div>
        {isSuggested && (
          <span className="font-ar shrink-0 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] text-gold-light">
            مُقترحة
          </span>
        )}
      </div>

      {/* Pricing line: shows base price OR free pill */}
      <div className="font-ar mt-3 flex items-center gap-2 text-xs text-ink-muted">
        {entry.free ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
            {t('admin_addons_free_label', 'ar')}
          </span>
        ) : (
          <span>
            {entry.unit_price_min_sar === entry.unit_price_max_sar
              ? `${entry.unit_price_sar.toLocaleString()} ريال`
              : `من ${entry.unit_price_min_sar.toLocaleString()} إلى ${entry.unit_price_max_sar.toLocaleString()} ريال`}
            {entry.per_passenger && <span> / للراكب</span>}
          </span>
        )}
        <span aria-hidden>·</span>
        <span>{entry.commission_rate_pct}%</span>
      </div>

      {/* Quantity input — disabled + auto-filled for per_passenger */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="font-ar text-ink-muted">
            {t('admin_addons_quantity_label', 'ar')}
          </span>
          <input
            name="quantity"
            type="number"
            min={1}
            max={50}
            defaultValue={effectiveQuantity}
            disabled={entry.per_passenger || !entry.allow_quantity}
            className="font-ar mt-1 block w-full rounded-md border border-border bg-navy-card/60 px-2 py-1.5 text-sm text-ink disabled:opacity-50"
          />
        </label>
        {showPriceOverride && (
          <label className="block text-xs">
            <span className="font-ar text-ink-muted">
              {t('admin_addons_price_override_label', 'ar')}
            </span>
            <input
              name="unit_price_override"
              type="number"
              step="0.01"
              min={entry.unit_price_min_sar}
              max={entry.unit_price_max_sar}
              placeholder={String(entry.unit_price_sar)}
              className="font-ar mt-1 block w-full rounded-md border border-border bg-navy-card/60 px-2 py-1.5 text-sm text-ink"
            />
          </label>
        )}
      </div>

      <label className="mt-2 block text-xs">
        <span className="font-ar text-ink-muted">
          {t('admin_addons_note_label', 'ar')}
        </span>
        <input
          name="note"
          type="text"
          maxLength={500}
          className="font-ar mt-1 block w-full rounded-md border border-border bg-navy-card/60 px-2 py-1.5 text-sm text-ink"
        />
      </label>

      {entry.per_passenger && (
        <p className="font-ar mt-2 text-[10px] text-gold-light/80">
          {t('admin_addons_per_passenger_hint', 'ar')}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="font-ar text-xs text-ink-muted">
          {t('admin_addons_total_label', 'ar')}: {expectedTotal.toLocaleString()} ريال
        </span>
        <button
          type="submit"
          disabled={isPending}
          className="font-ar rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-navy disabled:opacity-50"
        >
          {isPending ? '...' : t('admin_addons_attach_button', 'ar')}
        </button>
      </div>

      {error && (
        <p
          className="font-ar mt-3 rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (
        <p className="font-ar mt-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-2 text-xs text-emerald-200">
          تمت الإضافة.
        </p>
      )}
    </form>
  );
}

function isMatchedBySuggestion(
  entry: AddonCatalogEntry,
  preferences: TripPreferences | null
): boolean {
  if (!preferences || entry.suggested_for.length === 0) return false;
  for (const key of entry.suggested_for) {
    if (key === 'halal' && preferences.halal === true) return true;
    if (key === 'prayer_setup' && preferences.prayer_setup === true) return true;
    if (key === 'elderly_assistance' && preferences.elderly_assistance === true)
      return true;
    if (
      key === 'child_seats' &&
      typeof preferences.child_seats === 'number' &&
      preferences.child_seats > 0
    )
      return true;
    if (
      key === 'medical_notes' &&
      typeof preferences.medical_notes === 'string' &&
      preferences.medical_notes.length > 0
    )
      return true;
    if (
      key === 'crew_languages' &&
      preferences.crew_languages &&
      preferences.crew_languages.length > 0
    )
      return true;
    if (
      key === 'crew_nationalities' &&
      preferences.crew_nationalities &&
      preferences.crew_nationalities.length > 0
    )
      return true;
    if (key === 'pilot_nationality' && preferences.pilot_nationality)
      return true;
  }
  return false;
}

function translateError(code: string): string {
  // Map RPC error codes / Server Action codes to i18n
  // strings. Unknown codes fall through to a generic
  // rpc_failed surface.
  const knownCodes: Record<string, string> = {
    addon_subtype_unknown: 'addon_subtype_unknown',
    quantity_not_allowed: 'err_quantity_not_allowed',
    quantity_out_of_range: 'err_quantity_out_of_range',
    unit_price_out_of_range: 'err_unit_price_out_of_range',
    price_override_on_free_addon: 'err_price_override_on_free_addon',
    booking_not_found: 'err_booking_not_found',
    validation_failed: 'err_validation_failed',
  };
  const i18nKey = knownCodes[code] ?? 'err_rpc_failed';
  if (i18nKey === 'addon_subtype_unknown') {
    return 'subtype غير معروف.';
  }
  return t(i18nKey as 'err_rpc_failed', 'ar');
}
