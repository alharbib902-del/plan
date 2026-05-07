'use client';

import { useState, useTransition } from 'react';

import { issueCheckoutLink } from '@/app/(admin)/admin/actions/checkout-token';
import { t } from '@/lib/i18n/operator';

/**
 * Phase 6.2 PR 2b: admin "Issue customer checkout link"
 * button. Sits on the admin trip add-ons page (Case B).
 *
 * Per spec S5: the customer checkout token is issued
 * **separately** by the founder via this button after the
 * WhatsApp coordination call — NOT synchronously with
 * accept_offer. Clicking mints a v=2 token, persists its
 * SHA-256 hash + expiry to the bookings row, and returns
 * the raw token + URL once. The founder copies the URL into
 * a WhatsApp message; the token is never shown again.
 *
 * Re-issuance: clicking the button again on the same
 * booking mints a NEW token. The OLD token's signature
 * still verifies but the DB hash check fails (Layer 2 of
 * the three-layer customer-side validation), so it's
 * effectively revoked.
 *
 * Fail-closed: if `CUSTOMER_CHECKOUT_SECRET` is missing,
 * `mintCheckoutToken` throws inside the Server Action,
 * which catches it and returns `secret_not_set`. The
 * bookings row's `checkout_token_*` columns stay NULL — no
 * half-issued state.
 */
export function IssueCheckoutLinkButton({
  bookingId,
}: {
  bookingId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    url: string;
    expires_at: string;
  } | null>(null);

  function onClick() {
    setError(null);
    setIssued(null);

    startTransition(async () => {
      const result = await issueCheckoutLink({ booking_id: bookingId });
      if (result.ok) {
        setIssued({
          url: result.checkout_url,
          expires_at: result.expires_at,
        });
      } else {
        setError(translateError(result.error));
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar rounded-md border border-gold/60 bg-gold/10 px-4 py-2 text-sm text-gold-light disabled:opacity-50"
      >
        {isPending
          ? '...'
          : t('admin_addons_issue_checkout_link_button', 'ar')}
      </button>

      {issued && (
        <div className="mt-4 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4">
          <p className="font-ar text-sm font-medium text-emerald-200">
            {t('admin_checkout_link_issued_heading', 'ar')}
          </p>
          <p className="font-ar mt-1 text-xs text-emerald-100/80">
            {t('admin_checkout_link_copy_hint', 'ar')}
          </p>
          <input
            type="text"
            value={issued.url}
            readOnly
            onClick={(e) => e.currentTarget.select()}
            className="font-mono mt-3 block w-full select-all rounded-md border border-emerald-400/30 bg-navy-card/40 px-3 py-2 text-xs text-emerald-100"
          />
          <p className="font-ar mt-3 text-xs text-emerald-100/80">
            {t('admin_checkout_link_expires_at_label', 'ar')}:{' '}
            {new Date(issued.expires_at).toLocaleString('ar-SA')}
          </p>
        </div>
      )}

      {error && (
        <p
          className="font-ar mt-3 rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function translateError(code: string): string {
  if (code === 'secret_not_set') {
    return t('admin_addons_secret_not_set_error', 'ar');
  }
  const knownCodes: Record<string, string> = {
    booking_not_found: 'err_booking_not_found',
    validation_failed: 'err_validation_failed',
    rpc_failed: 'err_rpc_failed',
  };
  const i18nKey = knownCodes[code] ?? 'err_rpc_failed';
  return t(i18nKey as 'err_rpc_failed', 'ar');
}
