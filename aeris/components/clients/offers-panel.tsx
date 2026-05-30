'use client';

import { useState } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import type {
  AircraftCategoryValue,
  OfferSource,
  OfferStatus,
} from '@/types/database';
import { ClientOfferCard } from './offer-card';
import { OfferComparison } from './offer-comparison';

/**
 * Phase 14 — offers surface for `/me/requests/[id]`.
 *
 * Wraps the existing offer cards with a client-side toggle to a
 * read-only side-by-side comparison table. Both views render the
 * SAME already-fetched offers, so the toggle is local state (no
 * server round-trip / no extra query) — unlike `/me/empty-legs`
 * tabs, where each tab fetches a different dataset.
 *
 * Acceptance is unchanged: it lives entirely in `ClientOfferCard`
 * (the "cards" view). The comparison view is purely informational.
 * The toggle only appears when there are ≥2 offers to compare.
 *
 * `PanelOfferRow` is the minimal projection the page sends across
 * the server→client boundary: a structural superset of BOTH
 * `ClientOfferRow` (cards) and `OfferComparisonRow` (table), so a
 * row can be handed to either view directly. It deliberately omits
 * operator_email, operator_phone, and internal dispatch identifiers
 * (target/round ids) that neither view renders — keeping them out
 * of the client payload.
 */

export type PanelOfferRow = {
  source: OfferSource;
  id: string;
  trip_request_id: string;
  operator_name: string;
  total_price_sar: number;
  aircraft_category: AircraftCategoryValue | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  departure_eta: string | null;
  validity_hours: number | null;
  expires_at: string | null;
  notes: string | null;
  status: OfferStatus;
  is_current_round: boolean | null;
};

type OffersView = 'cards' | 'compare';

interface OffersPanelProps {
  offers: PanelOfferRow[];
  tripIsActionable: boolean;
  privilegeEnabled: boolean;
  cashbackBalanceSar: number;
}

export function OffersPanel({
  offers,
  tripIsActionable,
  privilegeEnabled,
  cashbackBalanceSar,
}: OffersPanelProps) {
  const [view, setView] = useState<OffersView>('cards');
  const canCompare = offers.length >= 2;
  // Guard against a stale 'compare' view if the offer count ever
  // drops below 2 (e.g. after a revalidate): fall back to cards.
  const activeView: OffersView = canCompare ? view : 'cards';

  return (
    <div className="space-y-4">
      {canCompare ? (
        <div
          role="group"
          aria-label={clientsAr.offersViewToggleLabel}
          className="inline-flex gap-1 rounded-lg border border-border bg-navy-card/40 p-1"
        >
          <ToggleButton
            active={activeView === 'cards'}
            onClick={() => setView('cards')}
          >
            {clientsAr.offersViewCards}
          </ToggleButton>
          <ToggleButton
            active={activeView === 'compare'}
            onClick={() => setView('compare')}
          >
            {clientsAr.offersViewCompare}
          </ToggleButton>
        </div>
      ) : null}

      {activeView === 'compare' ? (
        <OfferComparison offers={offers} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {offers.map((offer) => (
            <ClientOfferCard
              key={`${offer.source}:${offer.id}`}
              offer={offer}
              tripIsActionable={tripIsActionable}
              privilegeEnabled={privilegeEnabled}
              cashbackBalanceSar={cashbackBalanceSar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-ar rounded-md px-4 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-gold/15 text-gold-light'
          : 'text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
