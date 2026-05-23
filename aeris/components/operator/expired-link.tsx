import { CheckCircle2, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { AERIS_CONTACT } from '@/lib/config/contact';
import { resolveSiteUrl } from '@/lib/checkout/site-url';
import {
  aircraftCategoryLabel,
  type Lang,
  type StringKey,
  t,
} from '@/lib/i18n/operator';
import type { SubmittedOfferDetails } from '@/lib/supabase/queries/phase5-offers';

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
 *
 * Enriched-confirmation enhancement: when reason='link_already_used'
 * AND a SubmittedOfferDetails payload is supplied, the page renders
 * a positive confirmation card with the operator's submitted offer
 * (price, aircraft, departure, etc.) so an operator returning to
 * the link sees what they sent rather than a generic "used" message.
 * This branch is ONLY reached after the page's per-target state
 * checks confirmed `target.status === 'submitted'`, so passing the
 * offer payload does not leak any signal not already implied by the
 * generic "already used" copy. HMAC-fail still routes to the no-reason
 * generic page above and never reaches this branch.
 */
export type ExpiredReason = 'link_expired' | 'link_cancelled' | 'link_already_used';

export function ExpiredLink({
  reason,
  lang = 'ar',
  submittedOffer,
}: {
  reason?: ExpiredReason;
  lang?: Lang;
  submittedOffer?: SubmittedOfferDetails | null;
}) {
  const founderWaUrl = `https://wa.me/${AERIS_CONTACT.whatsappNumber}`;
  const enriched = reason === 'link_already_used' && submittedOffer != null;

  if (enriched) {
    return (
      <EnrichedAlreadyUsed
        lang={lang}
        offer={submittedOffer}
        founderWaUrl={founderWaUrl}
      />
    );
  }

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

function EnrichedAlreadyUsed({
  lang,
  offer,
  founderWaUrl,
}: {
  lang: Lang;
  offer: SubmittedOfferDetails;
  founderWaUrl: string;
}) {
  const marketingUrl = resolveSiteUrl();

  return (
    <div
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="mx-auto max-w-md"
    >
      <div className="w-full rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
        <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-300">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </div>

        <h1 className="font-ar text-xl text-ink">
          {t('expired_link_already_used_enriched_title', lang)}
        </h1>
        <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
          {t('expired_link_already_used_enriched_subtitle', lang)}
        </p>

        <div className="mt-6 rounded-xl border border-gold/30 bg-navy/60 p-5 text-start">
          <h2 className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
            {t('expired_link_offer_summary_title', lang)}
          </h2>
          <dl className="mt-3 space-y-2">
            <SummaryRow
              label={t('expired_link_summary_price', lang)}
              value={
                <>
                  {offer.total_price_sar.toLocaleString('en-US')}{' '}
                  <span className="text-ink-muted">{t('sar_unit', lang)}</span>
                </>
              }
            />
            {offer.aircraft_category && (
              <SummaryRow
                label={t('expired_link_summary_aircraft_category', lang)}
                value={aircraftCategoryLabel(offer.aircraft_category, lang)}
              />
            )}
            {offer.aircraft_type && (
              <SummaryRow
                label={t('expired_link_summary_aircraft_type', lang)}
                value={offer.aircraft_type}
              />
            )}
            {offer.aircraft_registration && (
              <SummaryRow
                label={t('expired_link_summary_aircraft_registration', lang)}
                value={
                  <span className="font-mono">{offer.aircraft_registration}</span>
                }
              />
            )}
            <SummaryRow
              label={t('expired_link_summary_departure', lang)}
              value={formatArabicDateTime(offer.departure_eta, lang)}
            />
            <SummaryRow
              label={t('expired_link_summary_submitted_at', lang)}
              value={formatArabicDateTime(offer.submitted_at, lang)}
            />
            {offer.validity_hours != null && (
              <SummaryRow
                label={t('expired_link_summary_validity', lang)}
                value={
                  <>
                    {offer.validity_hours}{' '}
                    <span className="text-ink-muted">
                      {t('success_validity_hours_unit', lang)}
                    </span>
                  </>
                }
              />
            )}
            {offer.notes && offer.notes.trim().length > 0 && (
              <SummaryRow
                label={t('expired_link_summary_notes', lang)}
                value={
                  <span className="whitespace-pre-line">{offer.notes}</span>
                }
              />
            )}
          </dl>
        </div>

        <p className="font-ar mt-5 text-xs leading-6 text-ink-muted">
          {t('expired_link_already_used_enriched_footer', lang)}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href={founderWaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar inline-flex items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light hover:border-gold hover:bg-gold/20"
          >
            {t('whatsapp_contact_button', lang)}
          </Link>
          <a
            href={marketingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar inline-flex items-center justify-center rounded-md border border-gold/20 bg-transparent px-5 py-2 text-sm text-ink-secondary hover:border-gold/40 hover:text-ink"
          >
            {t('aeris_marketing_link_label', lang)}
          </a>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px,1fr] gap-3 sm:grid-cols-[140px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{value}</dd>
    </div>
  );
}

function formatArabicDateTime(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'Asia/Riyadh',
  }).format(date);
}
