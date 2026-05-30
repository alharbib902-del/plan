/**
 * Phase 14 — shared offer presentation helpers.
 *
 * Extracted from `offer-card.tsx` so the client-side offer card
 * AND the new offer comparison table render identical money /
 * date / aircraft / status / source strings without drifting.
 *
 * Isomorphic (pure functions + label maps over `clientsAr`); no
 * `'use client'` / `'server-only'` directive so both client and
 * server components can import it.
 */

import { clientsAr } from '@/lib/i18n/clients-ar';
import type {
  AircraftCategoryValue,
  OfferSource,
  OfferStatus,
} from '@/types/database';

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pending: clientsAr.offerStatusPending,
  viewed: clientsAr.offerStatusViewed,
  accepted: clientsAr.offerStatusAccepted,
  rejected: clientsAr.offerStatusRejected,
  expired: clientsAr.offerStatusExpired,
};

export const OFFER_STATUS_TONE: Record<OfferStatus, string> = {
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  viewed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  accepted: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  rejected: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  expired: 'border-border bg-navy-secondary/60 text-ink-muted',
};

const AIRCRAFT_CATEGORY_LABEL: Record<AircraftCategoryValue, string> = {
  light: clientsAr.charterAircraftPrefLight,
  mid: clientsAr.charterAircraftPrefMid,
  super_mid: clientsAr.charterAircraftPrefSuperMid,
  heavy: clientsAr.charterAircraftPrefHeavy,
  long_range: clientsAr.charterAircraftPrefLongRange,
};

/** Friendly Arabic label for an aircraft category, or — when null. */
export function aircraftCategoryLabel(
  value: AircraftCategoryValue | null
): string {
  if (!value) return '—';
  return AIRCRAFT_CATEGORY_LABEL[value] ?? value;
}

/** Which dispatch source produced this offer (for a small badge). */
export function offerSourceLabel(
  source: OfferSource,
  isCurrentRound: boolean
): string {
  if (source === 'phase5' && isCurrentRound) {
    return clientsAr.offerSourceCurrentRound;
  }
  if (source === 'phase5') return clientsAr.offerSourcePhase5;
  return clientsAr.offerSourcePhase4;
}

/** Integer SAR with thousands separators (latin digits), no symbol. */
export function formatSAR(amount: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

/** Formatted SAR amount followed by the Arabic currency word. */
export function formatSARLabel(amount: number): string {
  return `${formatSAR(amount)} ${clientsAr.currencySAR}`;
}

/** Riyadh-zoned Arabic date+time (gregorian, latin digits), or —. */
export function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/** "Type (REGISTRATION)" with graceful fallbacks, or — when both empty. */
export function aircraftLabel(aircraft: {
  aircraft_type: string | null;
  aircraft_registration: string | null;
}): string {
  const t = aircraft.aircraft_type?.trim() ?? '';
  const r = aircraft.aircraft_registration?.trim() ?? '';
  if (t && r) return `${t} (${r})`;
  if (t) return t;
  if (r) return r;
  return '—';
}
