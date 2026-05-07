'use client';

import { useState, useTransition } from 'react';

import type { BookingAddonRow } from '@/types/database';
import {
  detachAddon,
  updateAddonQuantity,
} from '@/app/(admin)/admin/actions/booking-addons';
import { ADDONS_BY_SUBTYPE } from '@/lib/addons/catalog';
import { t } from '@/lib/i18n/operator';

/**
 * Phase 6.2 PR 2b: read+mutate table of attached addons on
 * the admin trip add-ons page.
 *
 * Shows every booking_addons row (including cancelled ones,
 * with subdued styling). Provides:
 *   - Cancel button → calls `detachAddon` Server Action
 *     (admin_cancel_booking_addon RPC; allows BOTH 'pending'
 *     AND 'confirmed').
 *   - Quantity edit → calls `updateAddonQuantity` Server
 *     Action (rejects per_passenger with
 *     `quantity_locked_by_passenger_count`).
 *
 * The cancel + update buttons are disabled for cancelled /
 * delivered rows.
 */
export function AttachedAddonsTable({
  tripId,
  addons,
}: {
  tripId: string;
  addons: BookingAddonRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/30 p-6">
      <h3 className="font-ar text-base font-medium text-ink">
        {t('admin_addons_attached_heading', 'ar')}
      </h3>
      {addons.length === 0 ? (
        <p className="font-ar mt-3 text-sm text-ink-muted">
          {t('admin_addons_no_attached', 'ar')}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/40">
          {addons.map((addon) => (
            <AttachedAddonRow
              key={addon.id}
              tripId={tripId}
              addon={addon}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachedAddonRow({
  tripId,
  addon,
}: {
  tripId: string;
  addon: BookingAddonRow;
}) {
  const catalogEntry = ADDONS_BY_SUBTYPE.get(addon.addon_subtype);
  const label = catalogEntry?.label_ar ?? addon.addon_subtype;
  const isTerminal =
    addon.status === 'cancelled' || addon.status === 'delivered';

  const [isPending, startTransition] = useTransition();
  const [editingQty, setEditingQty] = useState(false);
  const [qtyValue, setQtyValue] = useState(addon.quantity);
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const result = await detachAddon({
        booking_addon_id: addon.id,
        trip_request_id: tripId,
      });
      if (!result.ok) {
        setError(translateError(result.error));
      }
    });
  }

  function onSaveQty() {
    setError(null);
    startTransition(async () => {
      const result = await updateAddonQuantity({
        booking_addon_id: addon.id,
        quantity: qtyValue,
        trip_request_id: tripId,
      });
      if (result.ok) {
        setEditingQty(false);
      } else {
        setError(translateError(result.error));
      }
    });
  }

  return (
    <li className={`py-3 ${isTerminal ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="font-ar text-sm text-ink">{label}</div>
          {addon.details &&
            typeof addon.details === 'object' &&
            'note' in addon.details &&
            typeof addon.details.note === 'string' && (
              <div className="font-ar mt-1 text-xs text-ink-muted">
                {addon.details.note}
              </div>
            )}
        </div>

        {/* Quantity */}
        <div className="font-ar shrink-0 text-xs text-ink-muted">
          {editingQty && !isTerminal ? (
            <span className="inline-flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={qtyValue}
                onChange={(e) => setQtyValue(Number(e.target.value))}
                className="font-ar w-16 rounded-md border border-border bg-navy-card/60 px-2 py-1 text-xs text-ink"
                disabled={isPending}
              />
              <button
                type="button"
                onClick={onSaveQty}
                disabled={isPending}
                className="font-ar rounded-md bg-gold px-2 py-1 text-[10px] font-medium text-navy disabled:opacity-50"
              >
                {t('admin_addons_save_quantity_button', 'ar')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setQtyValue(addon.quantity);
                setEditingQty(true);
              }}
              disabled={isTerminal || isPending}
              className="font-ar text-ink hover:text-gold disabled:opacity-50"
            >
              ×{addon.quantity}
            </button>
          )}
        </div>

        {/* Total + status */}
        <div className="font-ar shrink-0 text-sm text-ink">
          {Number(addon.total_price).toLocaleString()} ريال
        </div>
        <span
          className={`font-ar shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusBadgeClass(
            addon.status
          )}`}
        >
          {t(`addon_status_${addon.status}` as 'addon_status_pending', 'ar')}
        </span>

        {/* Cancel button */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isTerminal || isPending}
          className="font-ar shrink-0 rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200 disabled:opacity-50"
        >
          {t('admin_addons_remove_button', 'ar')}
        </button>
      </div>
      {error && (
        <p
          className="font-ar mt-2 rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}
    </li>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'border border-amber-400/40 bg-amber-500/10 text-amber-200';
    case 'confirmed':
      return 'border border-emerald-400/40 bg-emerald-500/10 text-emerald-200';
    case 'cancelled':
      return 'border border-border bg-navy-secondary/40 text-ink-muted';
    case 'delivered':
      return 'border border-blue-400/40 bg-blue-500/10 text-blue-200';
    default:
      return 'border border-border bg-navy-secondary/40 text-ink-muted';
  }
}

function translateError(code: string): string {
  const knownCodes: Record<string, string> = {
    addon_already_cancelled: 'err_addon_already_cancelled',
    addon_terminal: 'err_addon_terminal',
    addon_not_cancellable: 'err_addon_not_cancellable',
    addon_not_found: 'err_addon_not_found',
    quantity_locked_by_passenger_count:
      'err_quantity_locked_by_passenger_count',
    quantity_not_allowed: 'err_quantity_not_allowed',
    quantity_out_of_range: 'err_quantity_out_of_range',
    addon_subtype_unknown: 'err_validation_failed',
    validation_failed: 'err_validation_failed',
  };
  const i18nKey = knownCodes[code] ?? 'err_rpc_failed';
  return t(i18nKey as 'err_rpc_failed', 'ar');
}
