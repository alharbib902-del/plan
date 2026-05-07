'use client';

import { useState, useTransition } from 'react';

import {
  confirmCheckoutPrep,
  removeCustomerAddon,
} from '@/app/actions/checkout-prep';
import { ADDONS_BY_SUBTYPE } from '@/lib/addons/catalog';
import { t } from '@/lib/i18n/operator';
import type { BookingAddonRow } from '@/types/database';

/**
 * Phase 6.2 PR 2b: client component wrapping the customer
 * actions on the checkout-prep page.
 *
 * Renders:
 *   - One "Remove" button per `'pending'` addon (calls
 *     `removeCustomerAddon(token, booking_addon_id)`).
 *   - The "أكّد الحجز عبر واتساب" deep link (server-rendered
 *     URL passed as prop).
 *   - The "I have reviewed and confirm" button (calls
 *     `confirmCheckoutPrep(token)`; flips every `'pending'`
 *     addon to `'confirmed'`; idempotent; does NOT touch
 *     `payment_status`).
 *
 * All Server Actions take only the token as their auth-
 * relevant input — never a separate `booking_id` (Codex
 * iteration-3 P1 #2 fix). The Server Action extracts
 * `booking_id` from the verified payload itself.
 */
export function CheckoutPrepClient({
  token,
  bookingNumber,
  addons,
  whatsappUrl,
}: {
  token: string;
  bookingNumber: string;
  addons: BookingAddonRow[];
  whatsappUrl: string;
}) {
  const lang = 'ar' as const;
  const pendingAddons = addons.filter((a) => a.status === 'pending');

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function onRemove(addonId: string) {
    setError(null);
    setRemovingId(addonId);
    startTransition(async () => {
      const result = await removeCustomerAddon({
        token,
        booking_addon_id: addonId,
      });
      setRemovingId(null);
      if (!result.ok) {
        setError(translateError(result.error));
      }
    });
  }

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmCheckoutPrep({ token });
      if (result.ok) {
        setConfirmedAt(result.confirmed_at);
      } else {
        setError(translateError(result.error));
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-navy-card/40 p-6">
      {/* Per-addon remove buttons (only for pending) */}
      {pendingAddons.length > 0 && !confirmedAt && (
        <div className="mb-6">
          <h3 className="font-ar text-sm font-medium text-ink">
            إدارة الخدمات المُلحقة
          </h3>
          <ul className="mt-3 space-y-2">
            {pendingAddons.map((addon) => {
              const catalogEntry = ADDONS_BY_SUBTYPE.get(addon.addon_subtype);
              const label = catalogEntry?.label_ar ?? addon.addon_subtype;
              const isThisRowRemoving = removingId === addon.id && isPending;
              return (
                <li
                  key={addon.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-navy-secondary/40 p-3"
                >
                  <span className="font-ar text-sm text-ink">{label}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(addon.id)}
                    disabled={isPending}
                    className="font-ar shrink-0 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50"
                  >
                    {isThisRowRemoving
                      ? '...'
                      : t('checkout_prep_remove_button', lang)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ar inline-flex items-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100"
          aria-label={`واتساب الحجز ${bookingNumber}`}
        >
          {t('checkout_prep_whatsapp_button', lang)}
        </a>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending || confirmedAt !== null}
          className="font-ar inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy disabled:opacity-50"
        >
          {isPending && !removingId
            ? '...'
            : confirmedAt !== null
              ? '✓ تم التأكيد'
              : t('checkout_prep_confirm_button', lang)}
        </button>
      </div>

      {confirmedAt && (
        <p
          className="font-ar mt-4 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100"
          role="status"
        >
          {t('checkout_prep_confirm_success_message', lang)}
        </p>
      )}

      {error && (
        <p
          className="font-ar mt-4 rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}

function translateError(code: string): string {
  // Customer surface: every failure mode collapses into a
  // single user-facing copy ("invalid link" or per-error
  // i18n). The 3-layer token validation in particular
  // returns `invalid_token` for any of: signature failure,
  // expiry, hash rotation, DB expiry, missing-secret.
  if (code === 'invalid_token') {
    return t('err_invalid_token', 'ar');
  }
  const knownCodes: Record<string, string> = {
    addon_not_found: 'err_addon_not_found',
    addon_not_in_booking: 'err_addon_not_in_booking',
    addon_not_cancellable: 'err_addon_not_cancellable',
    booking_not_found: 'err_booking_not_found',
    invalid_input: 'err_validation_failed',
    rpc_failed: 'err_rpc_failed',
  };
  const i18nKey = knownCodes[code] ?? 'err_rpc_failed';
  return t(i18nKey as 'err_rpc_failed', 'ar');
}
