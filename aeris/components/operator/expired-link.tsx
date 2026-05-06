import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { AERIS_CONTACT } from '@/lib/config/contact';
import { type Lang, type StringKey, t } from '@/lib/i18n/operator';

/**
 * Friendly "this link is no longer usable" page.
 *
 * Phase 5.1 (S2) introduces a `reason` discriminator. Variants
 * fire only for tokens that PASSED HMAC verification but failed
 * a downstream state check (target cancelled / expired / already
 * submitted). HMAC-fail still funnels here with `reason`
 * undefined to preserve the no-oracle property documented in
 * the Phase 5 activation entry: probing an enumerated link
 * gives no signal distinguishing "wrong signature" from "valid
 * signature on a stale row".
 *
 * If you ever pass `reason` from an HMAC-fail branch, you've
 * broken the security property — see app/operator/offer/[token]/page.tsx
 * lines 49-51 for the early-return that must stay generic.
 */
export type ExpiredReason = 'link_expired' | 'link_cancelled' | 'link_already_used';

export function ExpiredLink({
  reason,
  lang = 'ar',
}: {
  reason?: ExpiredReason;
  lang?: Lang;
}) {
  const founderWaUrl = `https://wa.me/${AERIS_CONTACT.whatsappNumber}`;

  const titleKey: StringKey = reason
    ? (`expired_${reason}_title` as StringKey)
    : 'expired_generic_title';
  const bodyKey: StringKey = reason
    ? (`expired_${reason}_body` as StringKey)
    : 'expired_generic_body';

  return (
    <div
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="mx-auto max-w-md"
    >
      <div className="w-full rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
        <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="font-ar text-xl text-ink">{t(titleKey, lang)}</h1>
        <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
          {t(bodyKey, lang)}
        </p>
        <p className="font-ar mt-3 text-xs text-ink-muted">
          {t('expired_generic_subtext', lang)}
        </p>
        <Link
          href={founderWaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ar mt-6 inline-flex items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light hover:border-gold hover:bg-gold/20"
        >
          {t('whatsapp_contact_button', lang)}
        </Link>
      </div>
    </div>
  );
}
