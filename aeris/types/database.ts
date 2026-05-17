/**
 * Supabase Database Types
 *
 * Hand-maintained until `npm run db:types` is wired to a real Supabase
 * project. Mirrors the SQL migrations under `supabase/migrations/`.
 */

import type { TripPreferences } from '@/lib/validators/trip-preferences';

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'quoted'
  | 'converted'
  | 'closed';

export type LeadTripType = 'one_way' | 'round_trip' | 'multi_city';

export type LeadInquiryRow = {
  id: string;
  request_number: string;
  customer_name: string;
  customer_phone: string;
  trip_type: LeadTripType;
  origin: string;
  destination: string;
  // Phase 6.0: optional IATA codes when the customer picked
  // from the airports table. NULL when the customer typed a
  // freeform city/airport name (the freeform value lives in
  // `origin` / `destination` above for backwards compat).
  origin_iata: string | null;
  destination_iata: string | null;
  departure_date: string;
  return_date: string | null;
  passengers: number;
  notes: string | null;
  status: LeadStatus;
  source: string;
  internal_notes: string | null;
  last_contacted_at: string | null;
  // Phase 4: set by promote_lead_to_trip_request when the lead is converted.
  converted_at: string | null;
  // Phase 6.1: structured customer preferences. Migration
  // 20260507000006 makes this NOT NULL DEFAULT '{}'::jsonb,
  // so existing rows have `{}` and new code never has to
  // null-check. Shape governed by `lib/validators/trip-preferences.ts`.
  preferences: TripPreferences;
  // Phase 7 PR 1 §9: empty-legs marketing consent (Codex
  // iteration-1 P1 #1 fix: opt-IN, default FALSE — historical
  // leads predate the empty-legs marketing category and have
  // not consented to it). Updated to TRUE only when the
  // customer explicitly ticks the "أبلغوني عند توفر رحلة فارغة"
  // checkbox on /request or /empty-legs/<>/reserve.
  empty_legs_opt_in: boolean;
  // Phase 7 PR 1 §17: atomic write by the
  // empty_leg_notifications_update_last_notified trigger on
  // every queue insert. Application code does NOT touch this
  // column.
  last_empty_leg_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadInquiryInsert = {
  customer_name: string;
  customer_phone: string;
  trip_type: LeadTripType;
  origin: string;
  destination: string;
  // Phase 6.0: optional. Existing callers that pass only
  // freeform `origin` / `destination` continue to compile.
  origin_iata?: string | null;
  destination_iata?: string | null;
  departure_date: string;
  return_date: string | null;
  passengers: number;
  notes: string | null;
  source?: string;
  // Phase 6.1: optional on insert because the DB column has
  // `DEFAULT '{}'::jsonb`. Callers that omit it get `{}`
  // automatically.
  preferences?: TripPreferences;
  // Phase 7 PR 1 §9: optional on insert. The DB column is
  // `BOOLEAN NOT NULL DEFAULT FALSE`, so omitting it stores
  // FALSE (the opt-IN default per Codex iteration-1 P1 #1).
  // PR 2d's `/request` form + reserve form set this to TRUE
  // only when the customer explicitly ticks the
  // empty-legs-notification checkbox. `last_empty_leg_notified_at`
  // is intentionally NOT in the Insert shape — it's owned
  // by the AFTER INSERT trigger on `empty_leg_notifications`
  // (PR 1 §17), application code never writes it.
  empty_legs_opt_in?: boolean;
};

// ============================================================================
// Phase 6.0: Airports reference table
// ============================================================================

export type AirportRow = {
  iata_code: string;
  icao_code: string | null;
  name: string;
  name_ar: string | null;
  city: string;
  city_ar: string | null;
  country: string;
  country_ar: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  is_private_capable: boolean;
  created_at: string;
};

export type AirportInsert = {
  iata_code: string;
  icao_code?: string | null;
  name: string;
  name_ar?: string | null;
  city: string;
  city_ar?: string | null;
  country: string;
  country_ar?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
  is_private_capable?: boolean;
};

export type AirportUpdate = Partial<
  Omit<AirportRow, 'iata_code' | 'created_at'>
>;

// ============================================================================
// Phase 4: Trip requests, offers, RPC contracts
// ============================================================================

export type TripRequestStatus =
  | 'pending'
  | 'distributed'
  | 'offered'
  | 'booked'
  | 'cancelled';

export type TripTypeValue = 'charter' | 'empty_leg' | 'medevac' | 'cargo';

export type AircraftCategoryValue =
  | 'light'
  | 'mid'
  | 'super_mid'
  | 'heavy'
  | 'long_range';

export type OfferStatus =
  | 'pending'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired';

export type TripLeg = {
  /**
   * IATA airport code (3 letters, uppercase). Phase 6.0: NULL
   * when the lead/admin chose the freeform path; the visible
   * value lives in `from_freeform` on the new shape, OR — for
   * legacy rows promoted before Phase 6.0 — `from` itself
   * carries the freeform Arabic city/airport string. The
   * operator portal display helper detects which shape it's
   * looking at via `isIataFormat(from)`.
   */
  from: string | null;
  to: string | null;
  date: string;
  time: string | null;
  // Phase 6.0 (PR 2): freeform fallback for unlisted airports.
  // Optional on the type so legacy `legs[]` JSONB rows
  // (created before this iteration) continue to type-check.
  from_freeform?: string | null;
  to_freeform?: string | null;
};

export type TripRequestRow = {
  id: string;
  request_number: string;
  client_id: string | null;
  // Phase 4 customer-snapshot columns (nullable for Phase 1 client_id rows).
  customer_name: string | null;
  customer_phone: string | null;
  customer_source: string | null;
  trip_type: TripTypeValue;
  legs: TripLeg[];
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_date: string;
  return_date: string | null;
  is_flexible_date: boolean | null;
  passengers_count: number;
  aircraft_category_preference: AircraftCategoryValue | null;
  special_requests: string | null;
  // Phase 6.1: strong-typed (was `Record<string, unknown> | null`).
  // Existing rows in production carry at most
  // `{ lead_trip_type: 'one_way' | 'round_trip' | 'multi_city' }`
  // (the legacy injection from promote_lead_to_trip_request);
  // post-migration shape is governed by `lib/validators/trip-preferences.ts`.
  preferences: TripPreferences | null;
  status: TripRequestStatus;
  distributed_to: string[] | null;
  distributed_at: string | null;
  // Phase 4 dispatch tracking.
  dispatch_nonce: string | null;
  dispatch_expires_at: string | null;
  dispatch_target_phone: string | null;
  dispatched_at: string | null;
  // Phase 5: forward link to the active dispatch round (or NULL
  // before any Phase 5 dispatch has happened on this trip).
  current_dispatch_round_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Phase4OperatorOfferRow = {
  id: string;
  trip_request_id: string;
  operator_name: string;
  operator_phone: string | null;
  operator_email: string | null;
  aircraft_category: AircraftCategoryValue | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  total_price_sar: number;
  departure_eta: string;
  validity_hours: number;
  expires_at: string;
  notes: string | null;
  status: OfferStatus;
  decided_at: string | null;
  source_dispatch_nonce: string | null;
  created_at: string;
  updated_at: string;
};

export type Phase4OperatorOfferInsert = {
  trip_request_id: string;
  operator_name: string;
  operator_phone?: string | null;
  operator_email?: string | null;
  aircraft_category?: AircraftCategoryValue | null;
  aircraft_type?: string | null;
  aircraft_registration?: string | null;
  total_price_sar: number;
  departure_eta: string;
  validity_hours: number;
  expires_at: string;
  notes?: string | null;
  status?: OfferStatus;
  source_dispatch_nonce?: string | null;
};

// RPC argument + return shapes.
// Note: Postgres returns DECIMAL as a string from the wire; the
// supabase-js client surfaces it as a string. Convert at the read
// boundary if you need a number.
export type PromoteLeadArgs = {
  p_lead_id: string;
  p_legs: TripLeg[];
  p_aircraft_category: AircraftCategoryValue;
  p_special_requests: string | null;
  p_lead_trip_type: LeadTripType;
  // Phase 6.1 PR 2: 6-arg canonical signature. The 5-arg
  // compatibility wrapper (still alive on Supabase per
  // PR 1's migration) delegates to this with '{}'::jsonb.
  // PR 2's app code switches to calling 6-arg directly.
  p_preferences: TripPreferences;
};

export type PromoteLeadResult =
  | { ok: true; trip_request_id: string }
  | { ok: false; error: 'lead_not_found' | 'lead_not_promotable' };

export type AcceptPhase4OfferArgs = {
  p_offer_id: string;
};

export type AcceptPhase4OfferResult =
  | { ok: true; trip_request_id: string }
  | {
      ok: false;
      error: 'offer_expired' | 'offer_not_pending' | 'trip_not_open';
    };

export type SubmitPhase4OperatorOfferArgs = {
  p_token_trip_id: string;
  p_token_nonce: string;
  p_operator_name: string;
  p_operator_phone: string | null;
  p_operator_email: string | null;
  p_aircraft_category: AircraftCategoryValue | null;
  p_aircraft_type: string | null;
  p_aircraft_registration: string | null;
  p_total_price_sar: number;
  p_departure_eta: string;
  p_validity_hours: number;
  p_notes: string | null;
};

export type SubmitPhase4OperatorOfferResult =
  | { ok: true; offer_id: string }
  | {
      ok: false;
      error: 'trip_not_found' | 'trip_closed' | 'token_stale';
    };

// ============================================================================
// Phase 5: Trip Distribution Engine — multi-operator dispatch
// ============================================================================
//
// Spec: docs/CLAUDE-TASK.md "Phase 5" iteration 5 (Codex-accepted 100/100,
// held as local draft). Migration: 20260505000004_phase_5_distribution.sql
// (merged in PR #7). Token v=2 helpers: lib/operator/token.ts (PR #8).

export type DispatchTargetStatus =
  | 'pending'
  | 'submitted'
  | 'expired'
  | 'cancelled';

export type DispatchRoundStatus = 'open' | 'closed';

export type TripDispatchRoundRow = {
  id: string;
  trip_request_id: string;
  status: DispatchRoundStatus;
  opened_at: string;
  closed_at: string | null;
  /**
   * Free-text close reason — currently 'offer_accepted' | 'redispatched'
   * | 'admin_cancel' but kept as string in the DB for flexibility.
   */
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TripDispatchTargetRow = {
  id: string;
  dispatch_round_id: string;
  trip_request_id: string;
  target_phone: string;
  /** 32-hex per-target nonce. */
  nonce: string;
  /**
   * Token + row expiry. ISO-8601 timestamp; written as-is by the
   * Phase 5 dispatch RPC from a value the Server Action generated
   * locally (so the rebuild path in issueOperatorTokenFromTarget
   * reproduces the same HMAC byte-for-byte).
   */
  expires_at: string;
  status: DispatchTargetStatus;
  /**
   * Canonical issued_at — must equal the value the Server Action
   * passed to issueOperatorTokenV2 when the token was first emitted.
   * The DB has a DEFAULT NOW() as a safety net but the Phase 5 RPC
   * supplies this column explicitly. (Spec iteration-3 P1 fix.)
   */
  sent_at: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Phase5OperatorOfferRow = {
  id: string;
  trip_request_id: string;
  dispatch_target_id: string;
  operator_name: string;
  operator_phone: string | null;
  operator_email: string | null;
  aircraft_category: AircraftCategoryValue | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  total_price_sar: number;
  departure_eta: string;
  validity_hours: number;
  expires_at: string;
  notes: string | null;
  status: OfferStatus;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

// RPC argument + return shapes for Phase 5.

/**
 * Element of `p_targets` passed to open_phase5_dispatch_round.
 * The Server Action pre-builds these locally (id + nonce + sent_at +
 * expires_at) BEFORE calling the RPC; the RPC inserts them as-is so
 * the persisted target row's sent_at matches the issued_at baked
 * into the v=2 HMAC token byte-for-byte.
 */
export type Phase5DispatchTargetInput = {
  /** dispatch_target_id — UUID generated by the Server Action. */
  id: string;
  /** E.164 operator phone number. */
  target_phone: string;
  /** 32-hex per-target nonce. */
  nonce: string;
  /** ISO-8601 — Server Action's batch_now; persisted as sent_at. */
  sent_at: string;
  /** ISO-8601 — token + row expiry (typically batch_now + 72h). */
  expires_at: string;
};

export type OpenPhase5DispatchRoundArgs = {
  p_trip_id: string;
  p_targets: Phase5DispatchTargetInput[];
};

export type OpenPhase5DispatchRoundResult =
  | { ok: true; round_id: string }
  | {
      ok: false;
      error: 'trip_not_found' | 'trip_not_open' | 'invalid_targets';
    };

export type SubmitPhase5OperatorOfferArgs = {
  p_target_id: string;
  p_target_nonce: string;
  p_operator_name: string;
  p_operator_phone: string | null;
  p_operator_email: string | null;
  p_aircraft_category: AircraftCategoryValue | null;
  p_aircraft_type: string | null;
  p_aircraft_registration: string | null;
  p_total_price_sar: number;
  p_departure_eta: string;
  p_validity_hours: number;
  p_notes: string | null;
};

export type SubmitPhase5OperatorOfferResult =
  | { ok: true; offer_id: string }
  | {
      ok: false;
      error:
        | 'invalid_offer'
        | 'target_not_pending'
        | 'trip_not_open'
        | 'token_stale';
    };

export type OfferSource = 'phase4' | 'phase5';

export type AcceptOfferArgs = {
  p_source: OfferSource;
  p_offer_id: string;
};

export type AcceptOfferResult =
  | {
      ok: true;
      trip_request_id: string;
      // Phase 6.2 PR 2a: accept_offer body extension now
      // creates a bookings row alongside flipping the trip
      // to 'booked'. The new booking_id is returned so
      // callers (admin UI) can navigate to the new row.
      // Existing callers that read only `ok` /
      // `trip_request_id` keep working.
      booking_id: string;
    }
  | {
      ok: false;
      error:
        | 'unknown_source'
        | 'offer_expired'
        | 'offer_not_pending'
        | 'trip_not_open';
    };

/**
 * Unified offers row used by the (future) admin comparison view.
 * The query layer UNIONs phase4_operator_offers with
 * phase5_operator_offers JOINed against trip_dispatch_targets +
 * trip_dispatch_rounds, tagging each row with `source` so the
 * unified accept_offer RPC can be routed to the right table.
 */
export type UnifiedOfferRow = {
  source: OfferSource;
  id: string;
  trip_request_id: string;
  operator_name: string;
  operator_phone: string | null;
  operator_email: string | null;
  aircraft_category: AircraftCategoryValue | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  total_price_sar: number;
  departure_eta: string;
  validity_hours: number;
  expires_at: string;
  notes: string | null;
  status: OfferStatus;
  decided_at: string | null;
  created_at: string;
  /** Phase 4 rows leave this null. */
  dispatch_target_id: string | null;
  /** Phase 4 rows leave this null. */
  target_phone: string | null;
  /** Phase 4 rows leave this null. */
  dispatch_round_id: string | null;
  /**
   * True only for Phase 5 offers whose target belongs to the trip's
   * current_dispatch_round_id. False or null otherwise.
   */
  is_current_round: boolean | null;
};

// ============================================================================
// Phase 6.2: bookings + booking_addons + addon_catalog
//
// Migration files (PR 1):
//   - File A `20260508000007_phase_6_2_addons.sql` — bookings
//     schema reshape (nullability flips, snapshot columns,
//     paired CHECKs, trip-link FK, route + passenger
//     snapshots, partial unique index) + booking_addons
//     subtype CHECK + cancelled_at + booking_payment_status
//     ENUM ADD VALUE 'pending_offline'.
//   - File B `20260508000008_phase_6_2_payment_default.sql`
//     — SET DEFAULT 'pending_offline' on bookings.payment_status.
//   - File C `20260508000009_phase_6_2_addon_catalog.sql` —
//     CREATE TABLE addon_catalog + RLS deny-all + 20-row seed
//     mirroring `lib/addons/catalog.ts` row-for-row.
// ============================================================================

export type BookingPaymentStatus =
  | 'pending'
  | 'paid'
  | 'refunded'
  // Phase 6.2 ADD VALUE. Default for every Phase 6.2 booking
  // until Phase 11 wires HyperPay.
  | 'pending_offline';

export type BookingFlightStatus =
  | 'confirmed'
  | 'boarding'
  | 'in_flight'
  | 'completed'
  | 'cancelled';

export type AddonTypeValue =
  | 'ground_transfer'
  | 'crew'
  | 'catering'
  | 'special';

export type AddonStatusValue =
  | 'pending'
  | 'confirmed'
  | 'delivered'
  | 'cancelled';

/**
 * Discriminator on `bookings.source_offer_table`. Paired with
 * `source_offer_id` (UUID). The `bookings_source_offer_pair_check`
 * constraint enforces that both are NULL or both populated.
 *
 * Phase 7 PR 1 extends the CHECK constraint to also accept
 * `'phase7_empty_leg'` — `confirm_empty_leg_reservation` and
 * `admin_mark_empty_leg_sold` (PR 2a) write that discriminator
 * onto the bookings row they create.
 */
// Codex round 1 PR #65 P2 #2 fix — extended for cargo bookings.
// Phase 11 PR 1 §3.4.2 migration extends bookings_source_offer_check
// CHECK to allow 'cargo_offers'; the local TS union must match
// or PR 2/3 cargo booking code (writing accept_cargo_offer +
// reading /me/bookings) will fight the type system.
export type SourceOfferTable =
  | 'phase4'
  | 'phase5'
  | 'phase7_empty_leg'
  | 'cargo_offers';

export type BookingRow = {
  id: string;
  booking_number: string;
  // Legacy FK to unused `offers` table. Phase 6.2 leaves
  // NULL on every row; the real linkage uses
  // source_offer_table + source_offer_id.
  offer_id: string | null;
  // Phase 4 PR #6 made trip_requests.client_id nullable for
  // guest mode. Phase 6.2 PR 1 File A does the same on
  // bookings.client_id; identity preserved via the snapshot
  // columns + bookings_identity_check constraint.
  client_id: string | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  // Operator FK relaxed to nullable in PR 1 File A. PR 2a's
  // accept_offer body populates the snapshot columns from
  // the chosen Phase 4 / Phase 5 offer row.
  operator_id: string | null;
  operator_name_snapshot: string | null;
  operator_phone_snapshot: string | null;
  operator_email_snapshot: string | null;
  // Aircraft FK relaxed to nullable in PR 1 File A. PR 2a
  // populates aircraft_snapshot from the offer's freeform
  // aircraft fields.
  aircraft_id: string | null;
  aircraft_snapshot: string | null;
  // Trip linkage + route + passenger snapshot fields (PR 1
  // File A step 11). trip_request_id is a real FK with ON
  // DELETE RESTRICT; route_*_iata / freeform pairs cover
  // both Phase 6.0 freeform-fallback and IATA-resolved
  // trips. The bookings_route_*_present_check constraints
  // enforce at-least-one per side once trip_request_id is
  // set.
  trip_request_id: string | null;
  route_origin_iata: string | null;
  route_destination_iata: string | null;
  route_origin_freeform_snapshot: string | null;
  route_destination_freeform_snapshot: string | null;
  passengers_count_snapshot: number | null;
  return_scheduled: string | null;
  // Pricing.
  base_amount: number;
  addons_amount: number;
  // PR 1 File A relaxed these to nullable. PR 2a's
  // accept_offer body leaves them NULL (Phase 11 territory).
  vat_amount: number | null;
  total_amount: number;
  commission_amount: number | null;
  operator_payout: number | null;
  // State.
  payment_status: BookingPaymentStatus;
  flight_status: BookingFlightStatus;
  // ZATCA columns are pre-allocated in the initial schema.
  // Phase 6.2 leaves them NULL on every row; Phase 11 wires
  // them.
  zatca_invoice_url: string | null;
  zatca_qr_code: string | null;
  zatca_uuid: string | null;
  // Schedule.
  departure_scheduled: string;
  departure_actual: string | null;
  arrival_actual: string | null;
  // Source-offer linkage (no FK; one-of-two target tables).
  source_offer_table: SourceOfferTable | null;
  source_offer_id: string | null;
  // Phase 10 PR 1 §3.4 + Phase 11 PR 1 §3.4.1 + Phase 12 PR 1
  // §3.4: discriminator for unified /me/bookings. NOT NULL +
  // DEFAULT 'charter'; populated explicitly by Phase 10
  // §4.3/§4.4 RPCs ('empty_leg'), Phase 11 §4.4 accept_cargo_offer
  // ('cargo'), Phase 12 §4.4 accept_medevac_offer + §4.7
  // consume_aeris_shield_event ('medevac'); falls through to
  // DEFAULT for accept_offer (Phase 9 charter path).
  // Round 1 PR #77 P2 #2 fix added 'medevac' to the TS union.
  source_discriminator: 'charter' | 'empty_leg' | 'cargo' | 'medevac';
  // Customer checkout-prep token. Both NULL by default;
  // founder mints + writes both via the admin "Issue
  // checkout link" action. Paired CHECK enforces both-or-
  // neither.
  checkout_token_hash: string | null;
  checkout_token_expires_at: string | null;
  // Loyalty: Phase 10 territory; stays 0 for Phase 6.2.
  loyalty_points_earned: number;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * `bookings` Insert / Update shapes are not exposed via
 * direct table writes in Phase 6.2 — every mutation goes
 * through the SECURITY DEFINER RPCs in PR 2a (accept_offer,
 * backfill_booking_from_offer, attach_booking_addon, etc.).
 * The Insert shape below is declared for type-checking
 * completeness only; no Server Action calls supabase
 * .from('bookings').insert(...).
 */
export type BookingInsert = Partial<BookingRow> & {
  base_amount: number;
  total_amount: number;
  departure_scheduled: string;
};

export type BookingUpdate = Partial<Omit<BookingRow, 'id' | 'created_at'>>;

export type BookingAddonRow = {
  id: string;
  booking_id: string;
  addon_type: AddonTypeValue;
  addon_subtype: string;
  details: Record<string, unknown>;
  quantity: number;
  unit_price: number;
  total_price: number;
  commission_rate: number;
  supplier_id: string | null;
  status: AddonStatusValue;
  // PR 1 File A added cancelled_at for the soft-cancel path
  // (customer_cancel_booking_addon + admin_cancel_booking_addon).
  cancelled_at: string | null;
  created_at: string;
};

export type BookingAddonInsert = Partial<BookingAddonRow> & {
  booking_id: string;
  addon_type: AddonTypeValue;
  addon_subtype: string;
  unit_price: number;
  total_price: number;
};

export type BookingAddonUpdate = Partial<
  Omit<BookingAddonRow, 'id' | 'created_at'>
>;

/**
 * `addon_catalog` is the seeded reference table from PR 1
 * File C. RLS deny-all; service-role-only reads. Mirrors
 * `lib/addons/catalog.ts` row-for-row; parity enforced at
 * CI by `lib/addons/__tests__/catalog-vs-seed.test.ts` and
 * post-deploy by founder Probe 2b.
 */
export type AddonCatalogRow = {
  subtype: string;
  addon_type: AddonTypeValue;
  label_ar: string;
  label_en: string;
  description_ar: string;
  description_en: string;
  unit_price_sar: number;
  unit_price_min_sar: number;
  unit_price_max_sar: number;
  per_passenger: boolean;
  commission_rate_pct: number;
  allow_quantity: boolean;
  free: boolean;
  advisor_ref: string | null;
};

export type AddonCatalogInsert = AddonCatalogRow;
export type AddonCatalogUpdate = Partial<Omit<AddonCatalogRow, 'subtype'>>;

// ============================================================================
// Phase 6.2 PR 2a: 6 new SECURITY DEFINER RPCs
//
// Migration file: 20260509000008_phase_6_2_accept_offer.sql.
// All seven public functions (the existing accept_offer +
// these six) are SECURITY DEFINER + service-role-only
// EXECUTE; the internal _recompute_booking_totals helper is
// REVOKEd from every role (callable only inside the seven
// SECURITY DEFINER functions).
//
// The six RPC types below are exported so PR 2b's Server
// Actions get strict typing on `supabase.rpc(...)` calls.
// PR 2a itself ships zero callers.
// ============================================================================

// --- backfill_booking_from_offer (Case C escape valve) ---

export type BackfillBookingFromOfferArgs = {
  p_trip_id: string;
};

export type BackfillBookingFromOfferResult =
  | {
      ok: true;
      booking_id: string;
      source: OfferSource;
    }
  | {
      ok: false;
      error: 'trip_not_found' | 'trip_not_booked' | 'booking_already_exists';
    }
  | {
      ok: false;
      error: 'no_accepted_offer';
    }
  | {
      ok: false;
      error: 'ambiguous_accepted_offer';
      accepted_count: number;
    };

// --- attach_booking_addon (admin attach) ---

export type AttachBookingAddonArgs = {
  p_trip_id: string;
  p_addon_subtype: string;
  /**
   * NULL → defaulted to 1 server-side via COALESCE BEFORE
   * any IF check (Codex iteration-7 P1 #1 fix). Per_passenger
   * subtypes ignore this entirely and derive quantity from
   * `bookings.passengers_count_snapshot`.
   */
  p_quantity: number | null;
  /** NULL → use the catalog default. Range-checked when supplied. */
  p_unit_price_override: number | null;
  /** NULL or whitespace-only → stored as `'{}'::jsonb` (no `note` key). */
  p_note: string | null;
};

export type AttachBookingAddonResult =
  | {
      ok: true;
      addon: BookingAddonRow;
    }
  | {
      ok: false;
      error:
        | 'booking_not_found'
        | 'addon_subtype_unknown'
        | 'price_override_on_free_addon'
        | 'unit_price_out_of_range'
        | 'quantity_not_allowed'
        | 'quantity_out_of_range';
    };

// --- customer_cancel_booking_addon (customer remove path) ---
//
// Only allows 'pending' → 'cancelled'. 'confirmed' /
// 'cancelled' / 'delivered' all return
// `addon_not_cancellable` (Codex iteration-6 P1 fix —
// prevents a crafted request from cancelling a confirmed
// row after the customer hit confirm).

export type CustomerCancelBookingAddonArgs = {
  p_booking_addon_id: string;
};

export type CustomerCancelBookingAddonResult =
  | {
      ok: true;
      addon: BookingAddonRow;
    }
  | {
      ok: false;
      error: 'addon_not_found' | 'addon_not_cancellable';
    };

// --- admin_cancel_booking_addon (admin detach path) ---
//
// Allows BOTH 'pending' AND 'confirmed' → 'cancelled' (the
// founder may cancel after a customer confirmation, e.g.
// follow-up WhatsApp). Rejects 'cancelled' /
// 'delivered'.

export type AdminCancelBookingAddonArgs = {
  p_booking_addon_id: string;
};

export type AdminCancelBookingAddonResult =
  | {
      ok: true;
      addon: BookingAddonRow;
    }
  | {
      ok: false;
      error:
        | 'addon_not_found'
        | 'addon_already_cancelled'
        | 'addon_terminal'
        | 'addon_not_cancellable';
    };

// --- update_booking_addon_quantity (admin quantity adjustment) ---
//
// Per_passenger subtypes are quantity-locked to the
// booking's passengers_count_snapshot — any update attempt
// returns `quantity_locked_by_passenger_count` (the only way
// to change catering quantity is to cancel + re-attach).

export type UpdateBookingAddonQuantityArgs = {
  p_booking_addon_id: string;
  p_quantity: number | null;
};

export type UpdateBookingAddonQuantityResult =
  | {
      ok: true;
      addon: BookingAddonRow;
    }
  | {
      ok: false;
      error:
        | 'addon_not_found'
        | 'addon_subtype_unknown'
        | 'quantity_locked_by_passenger_count'
        | 'quantity_not_allowed'
        | 'quantity_out_of_range';
    };

// --- confirm_checkout_prep (customer confirm) ---
//
// Idempotent: flips every 'pending' addon on the booking to
// 'confirmed'. Returns the count + list of confirmed addon
// IDs so the caller can render a "you confirmed N services"
// summary. Does NOT touch payment_status (stays
// `'pending_offline'`).

export type ConfirmCheckoutPrepArgs = {
  p_booking_id: string;
};

export type ConfirmCheckoutPrepResult =
  | {
      ok: true;
      booking_id: string;
      confirmed_count: number;
      confirmed_addon_ids: string[];
      confirmed_at: string;
    }
  | {
      ok: false;
      error: 'booking_not_found';
    };

// ============================================================================
// Phase 7 PR 1: Empty Legs schema reshape
//
// Migration file: 20260509000010_phase_7_empty_legs_reshape.sql.
// PR 1 ships DDL only — no RPCs (those land in PR 2a's
// 20260510000011_phase_7_empty_legs_rpcs.sql) and no runtime
// UI/RPC code. The types below cover every new/changed table
// + every new column on existing tables, mirroring the SQL
// migration row-for-row.
//
// `types/database.ts` is regenerated after the full PR 1
// migration applies (Codex iteration-14 P2 #1 fix). Until
// `npm run db:types` is wired to a real Supabase project,
// this file is hand-maintained and must stay in sync with
// the migration.
// ============================================================================

export type EmptyLegStatus =
  | 'available'
  | 'reserved'
  | 'sold'
  | 'expired'
  // Phase 7 PR 1 §4 ADD VALUE.
  | 'cancelled';

export type EmptyLegAuctionCurve = 'linear' | 'accelerating';

export type EmptyLegRow = {
  id: string;
  leg_number: string;
  parent_booking_id: string | null;
  // Phase 7 PR 1 §1: relaxed to nullable + 3 operator
  // snapshot columns + operator_stub_id for Phase-7
  // ownership.
  operator_id: string | null;
  operator_name_snapshot: string | null;
  operator_phone_snapshot: string | null;
  operator_email_snapshot: string | null;
  operator_stub_id: string | null;
  // Phase 7 PR 1 §2: relaxed to nullable + freeform snapshot.
  aircraft_id: string | null;
  aircraft_snapshot: string | null;
  // Phase 7 PR 1 §3: relaxed both IATA columns to nullable +
  // added freeform fallback columns + presence CHECKs.
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_airport_freeform_snapshot: string | null;
  arrival_airport_freeform_snapshot: string | null;
  departure_window_start: string;
  departure_window_end: string;
  flexibility_hours: number;
  original_price: number;
  current_discount_pct: number;
  current_price: number;
  max_passengers: number;
  status: EmptyLegStatus;
  views_count: number;
  notifications_sent: number;
  // Phase 7 PR 1 §6: reservation-hold columns + paired CHECK
  // (all-NULL-or-all-non-NULL).
  reservation_token_hash: string | null;
  reservation_expires_at: string | null;
  reservation_customer_name_snapshot: string | null;
  reservation_customer_phone_snapshot: string | null;
  // Phase 10 PR 1 §3.1: State C (CLIENT) reservation column.
  // ON DELETE RESTRICT FK; populated by reserve_empty_leg_authenticated
  // RPC, cleared by §4.5 reservation-clearing patches + §4.6 client release.
  reservation_client_id: string | null;
  // Phase 7 PR 1 §7: customer-booking link, set by
  // confirm_empty_leg_reservation (PR 2a).
  customer_booking_id: string | null;
  // Phase 7 PR 1 §8: Dutch-auction columns.
  auction_initial_discount_pct: number;
  auction_floor_discount_pct: number;
  auction_curve: EmptyLegAuctionCurve;
  auction_window_start_at: string;
  auction_window_end_at: string | null;
  last_price_drop_at: string | null;
  // Phase 7 PR 1 §11: Phase-7-canary marker (Codex
  // iteration-7 P1 #3 fix).
  suppress_notifications: boolean;
  created_at: string;
  expires_at: string | null;
  updated_at: string;
};

export type EmptyLegInsert = Partial<EmptyLegRow> & {
  original_price: number;
  current_price: number;
  max_passengers: number;
  departure_window_start: string;
  departure_window_end: string;
};

export type EmptyLegUpdate = Partial<Omit<EmptyLegRow, 'id' | 'created_at'>>;

// --- empty_leg_notifications (PR 1 §13) ---

export type EmptyLegNotificationEventType = 'published' | 'price_dropped';
// Phase 10 PR 1 §3.2 round 4 P1 #1: multi-channel row model.
// 'email' + 'email_and_wa' added; per-channel URL pair CHECK enforces
// which URL columns are populated.
export type EmptyLegNotificationChannel =
  | 'whatsapp_link'
  | 'email'
  | 'email_and_wa';

export type EmptyLegNotificationRow = {
  id: string;
  // Phase 10 PR 1 §3.2: lead_inquiry_id NOT NULL was dropped;
  // recipient XOR check enforces exactly-one-of {client, lead}.
  lead_inquiry_id: string | null;
  // Phase 10 PR 1 §3.2: client-keyed match row.
  client_id: string | null;
  leg_id: string;
  event_type: EmptyLegNotificationEventType;
  channel: EmptyLegNotificationChannel;
  // Phase 10 PR 1 §3.2: NOT NULL on wa_url dropped; per-channel
  // URL pair CHECK requires wa_url for whatsapp_link/email_and_wa
  // channels (and forbids it for email-only rows).
  wa_url: string | null;
  // Phase 10 PR 1 §3.2: new email_url column. Populated for
  // email/email_and_wa channels; NULL for whatsapp_link.
  email_url: string | null;
  sent_at: string;
  // NULL = pending founder dispatch; non-NULL = founder
  // marked the wa.me URL as sent via the outreach queue.
  outreach_sent_at: string | null;
  // wa.me has no provider message id; populated for future
  // Resend / WhatsApp Business API channels (Phase 8+).
  external_message_id: string | null;
  created_at: string;
};

export type EmptyLegNotificationInsert = Partial<EmptyLegNotificationRow> & {
  leg_id: string;
  event_type: EmptyLegNotificationEventType;
  channel: EmptyLegNotificationChannel;
  // recipient XOR enforced at DB level; either client_id OR
  // lead_inquiry_id must be populated, never both / never neither.
};

export type EmptyLegNotificationUpdate = Partial<
  Omit<EmptyLegNotificationRow, 'id' | 'created_at'>
>;

// --- phase7_operator_stubs (PR 1 §14) ---

export type Phase7OperatorStubStatus = 'active' | 'archived';

// PR 2c review note (Codex round 1, P2 #2): the production
// migration declares `contact_email` and `contact_phone` as
// NOT NULL on `phase7_operator_stubs`, so the row + insert
// types must NOT relax those columns to `string | null`.
// Both the Zod schema and the admin form keep the columns
// required end-to-end; a future relaxation would need an
// explicit migration first.
export type Phase7OperatorStubRow = {
  id: string;
  company_name: string;
  contact_email: string;
  contact_phone: string;
  status: Phase7OperatorStubStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Phase7OperatorStubInsert = Partial<Phase7OperatorStubRow> & {
  company_name: string;
  contact_email: string;
  contact_phone: string;
};

export type Phase7OperatorStubUpdate = Partial<
  Omit<Phase7OperatorStubRow, 'id' | 'created_at'>
>;

// --- operator_empty_leg_sessions (PR 1 §15) ---

export type OperatorEmptyLegSessionRow = {
  id: string;
  // FK target is phase7_operator_stubs(id) (Codex
  // iteration-11 P1 #1 + iteration-12 P1 #2 fixes).
  operator_stub_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type OperatorEmptyLegSessionInsert =
  Partial<OperatorEmptyLegSessionRow> & {
    operator_stub_id: string;
    token_hash: string;
    expires_at: string;
  };

export type OperatorEmptyLegSessionUpdate = Partial<
  Omit<OperatorEmptyLegSessionRow, 'id' | 'created_at'>
>;

// --- empty_leg_outreach_alert_status (PR 1 §16) ---

export type EmptyLegOutreachAlertStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed';

export type EmptyLegOutreachAlertStatusRow = {
  // Singleton row: id is always 1 (CHECK enforced).
  id: 1;
  status: EmptyLegOutreachAlertStatusValue;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
};

export type EmptyLegOutreachAlertStatusUpdate = Partial<
  Omit<EmptyLegOutreachAlertStatusRow, 'id'>
>;

// --- empty_leg_events_outbox (PR 2e migration §1) ---

export type EmptyLegEventType = 'published' | 'price_dropped';

export type EmptyLegEventsOutboxRow = {
  id: string;
  leg_id: string;
  event_type: EmptyLegEventType;
  emitted_at: string;
  processed_at: string | null;
};

export type EmptyLegEventsOutboxInsert = {
  leg_id: string;
  event_type: EmptyLegEventType;
};

export type EmptyLegEventsOutboxUpdate = Partial<
  Pick<EmptyLegEventsOutboxRow, 'processed_at'>
>;

// ============================================================================
// Phase 8 PR 1 — Operator account onboarding
//
// Migration file: 20260512000020_phase_8_operator_accounts.sql
//
// PR 1 ships:
//   - Relax operators.user_id + 3 regulatory columns to nullable
//   - 12 new auth/lifecycle columns on operators (auth_email,
//     password_hash, password_set_at, password_must_change,
//     last_login_at, approved_by_admin_at, rejected_at,
//     suspended_at, suspension_reason, welcome_token_hash,
//     welcome_token_expires_at, welcome_token_used_at) +
//     auth_email NOT NULL invariant + unique LOWER() index
//   - operator_status ENUM extended with 'rejected' (4th value)
//     + column renamed status → signup_status
//   - 6 new tables: operator_sessions, operator_password_reset_tokens,
//     operator_otp_codes, operator_documents,
//     operator_signup_attempts, operator_notification_alert_status
//   - audit trigger on operators (signup_status + password_hash
//     transitions write to audit_logs)
//
// Codex round-6 implementation reality fix: rounds 0-5 of the
// spec said "14 new columns" but two (approved_at,
// rejection_reason) already exist in 20260422000001_initial_schema.sql
// and are reused. Rounds 0-5 also described status as TEXT + CHECK;
// production uses the operator_status ENUM type, so the OperatorRow
// shape below uses the ENUM-backed OperatorSignupStatus union.
// ============================================================================

// --- ENUMs ---

// Phase 8 extends the existing operator_status ENUM with 'rejected'.
// Order matches the PostgreSQL ALTER TYPE ADD VALUE order: original
// 3 values first, then 'rejected' appended last.
export type OperatorSignupStatus =
  | 'pending'
  | 'approved'
  | 'suspended'
  | 'rejected';

export type OperatorOtpChannel = 'whatsapp';

export type OperatorOtpPurpose = 'login' | 'recovery';

export type OperatorDocumentType =
  | 'commercial_registration'
  | 'gaca_license'
  | 'license_expiry_proof';

export type OperatorSignupAttemptResult =
  | 'success'
  | 'duplicate_email'
  | 'rate_limited'
  | 'validation_failed';

export type OperatorNotificationAlertStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed';

// Phase 8.1 — wider enum for the WhatsApp channel: includes
// 'rate_limited' because the wasender trial enforces a
// 1 msg/min cap that email does not have. The provider's
// in-memory guard short-circuits with this status without
// calling the API.
export type OperatorNotificationWhatsAppStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed'
  | 'rate_limited';

// Phase 8 PR 2e — operator_cron_tick_history is the
// observability table the four cleanup-cron routes write to
// after each run. The admin canary page queries the latest
// row per job_name to surface stale / failing cron jobs.
//
// job_name is constrained to the four cleanup job names by a
// CHECK in the migration; a future 5th job needs both a
// schema migration to widen the CHECK and a string literal
// added to this union.
export type OperatorCronJobName =
  | 'cleanup_expired_operator_sessions'
  | 'cleanup_expired_password_reset_tokens'
  | 'cleanup_expired_otp_codes'
  | 'cleanup_old_signup_attempts';

export type OperatorCronTickHistoryRow = {
  id: number;
  job_name: OperatorCronJobName;
  ran_at: string;
  deleted_count: number;
  success: boolean;
  error_label: string | null;
};

export type OperatorCronTickHistoryInsert = {
  id?: number;
  job_name: OperatorCronJobName;
  ran_at?: string;
  deleted_count?: number;
  success?: boolean;
  error_label?: string | null;
};

export type OperatorCronTickHistoryUpdate = Partial<
  Omit<OperatorCronTickHistoryRow, 'id'>
>;

// --- operators (existing table; Phase 8 extends) ---

// Full row shape after Phase 8 PR 1 migration. Combines the
// initial-schema columns (20260422000001_initial_schema.sql:141-167)
// with the 12 new columns added by 20260512000020_phase_8_operator_accounts.sql.
//
// Notes:
//   - signup_status was renamed from `status` (Phase 8 §3.4)
//   - approved_at + rejection_reason are PRE-EXISTING — Phase 8
//     reuses them rather than re-adding (Codex round-6 fix)
//   - approved_by (UUID FK to users(id)) is unchanged from
//     Phase 1 — admin's approve flow does not write to it;
//     `approved_by_admin_at` is the Phase 8 timestamp
//   - documents_urls JSONB array is the Phase-1-era shape;
//     Phase 8 prefers the new `operator_documents` table for
//     structured document storage but does NOT remove the JSONB
//     column for backwards compat
export type OperatorRow = {
  id: string;
  // Phase 8 §3.1: relaxed to nullable for custom-auth operators
  // that don't have a corresponding users(id) row.
  user_id: string | null;
  company_name: string;
  company_name_ar: string | null;
  // Phase 8 §3.2: relaxed to nullable. Admin uploads the
  // document later via /admin/operators/<id>/documents and
  // populates the operator_documents table; this column may
  // stay null indefinitely after Phase 8.
  commercial_registration: string | null;
  vat_number: string | null;
  gaca_license: string | null;
  license_expiry: string | null;
  base_airport: string | null;
  operating_airports: string[];
  contact_email: string;
  contact_phone: string;
  bank_iban: string | null;
  bank_name: string | null;
  commission_rate: number;
  rating: number;
  total_trips: number;
  response_time_avg: number | null;
  documents_urls: unknown;
  // Phase 8 §3.4: renamed from `status`. Typed as the
  // operator_status ENUM with 4 values after Phase 8 extends it.
  signup_status: OperatorSignupStatus;
  // Pre-existing (Phase 1) — reused by Phase 8's admin-approve
  // / admin-reject RPCs.
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  // --- Phase 8 §3.3: 12 new columns ---
  auth_email: string;
  password_hash: string | null;
  password_set_at: string | null;
  password_must_change: boolean;
  last_login_at: string | null;
  approved_by_admin_at: string | null;
  rejected_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  welcome_token_hash: string | null;
  welcome_token_expires_at: string | null;
  welcome_token_used_at: string | null;
  created_at: string;
  updated_at: string;
};

// PR 1 ships zero direct INSERT call sites — all writes to
// operators go through PR 2a's SECURITY DEFINER RPCs
// (operator_signup, admin_create_operator,
// convert_phase7_stub_to_operator). The Insert / Update
// shapes are declared for type-checking completeness so
// list / get queries type-check.
export type OperatorInsert = Partial<OperatorRow> & {
  company_name: string;
  contact_email: string;
  contact_phone: string;
  auth_email: string;
};

export type OperatorUpdate = Partial<
  Omit<OperatorRow, 'id' | 'created_at'>
>;

// --- operator_sessions (Phase 8 §3.5) ---

export type OperatorSessionRow = {
  id: string;
  operator_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  remember_me: boolean;
  ip_address: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type OperatorSessionInsert =
  Partial<OperatorSessionRow> & {
    operator_id: string;
    token_hash: string;
    expires_at: string;
  };

export type OperatorSessionUpdate = Partial<
  Omit<OperatorSessionRow, 'id' | 'created_at'>
>;

// --- operator_password_reset_tokens (Phase 8 §3.6) ---

export type OperatorPasswordResetTokenRow = {
  id: string;
  operator_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  ip_address: string | null;
  created_at: string;
};

export type OperatorPasswordResetTokenInsert =
  Partial<OperatorPasswordResetTokenRow> & {
    operator_id: string;
    token_hash: string;
    expires_at: string;
  };

export type OperatorPasswordResetTokenUpdate = Partial<
  Omit<OperatorPasswordResetTokenRow, 'id' | 'created_at'>
>;

// --- operator_otp_codes (Phase 8 §3.7) ---

export type OperatorOtpCodeRow = {
  id: string;
  operator_id: string;
  code_hash: string;
  channel: OperatorOtpChannel;
  purpose: OperatorOtpPurpose;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  attempt_count: number;
  created_at: string;
};

export type OperatorOtpCodeInsert =
  Partial<OperatorOtpCodeRow> & {
    operator_id: string;
    code_hash: string;
    channel: OperatorOtpChannel;
    purpose: OperatorOtpPurpose;
    expires_at: string;
  };

export type OperatorOtpCodeUpdate = Partial<
  Omit<OperatorOtpCodeRow, 'id' | 'created_at'>
>;

// --- operator_documents (Phase 8 §3.8) ---

export type OperatorDocumentRow = {
  id: string;
  operator_id: string;
  document_type: OperatorDocumentType;
  storage_path: string;
  file_name: string;
  file_size: number;
  content_type: string;
  uploaded_at: string;
  uploaded_by_admin: boolean;
  created_at: string;
};

export type OperatorDocumentInsert =
  Partial<OperatorDocumentRow> & {
    operator_id: string;
    document_type: OperatorDocumentType;
    storage_path: string;
    file_name: string;
    file_size: number;
    content_type: string;
  };

export type OperatorDocumentUpdate = Partial<
  Omit<OperatorDocumentRow, 'id' | 'created_at'>
>;

// --- operator_signup_attempts (Phase 8 §3.9) ---

export type OperatorSignupAttemptRow = {
  id: string;
  ip_address: string;
  attempted_at: string;
  email_attempted: string | null;
  result: OperatorSignupAttemptResult;
  created_at: string;
};

export type OperatorSignupAttemptInsert =
  Partial<OperatorSignupAttemptRow> & {
    ip_address: string;
    result: OperatorSignupAttemptResult;
  };

export type OperatorSignupAttemptUpdate = Partial<
  Omit<OperatorSignupAttemptRow, 'id' | 'created_at'>
>;

// ============================================================================
// Phase 9 PR 1 — client portal tables
//
// Migration file: 20260520000026_phase_9_pr_1_client_auth.sql
// Same posture as Phase 8 PR 1 operators: service_role only,
// RLS enabled with no policies. Functions map intentionally
// excludes the new RPCs (Phase 8 PR 2e #48 lesson — adding
// parameterless RPCs to the Functions map collapsed inference
// across the entire codebase).
// ============================================================================

export type ClientSignupStatus = 'active' | 'suspended' | 'deleted';

export type ClientRow = {
  id: string;
  auth_email: string;
  full_name: string;
  contact_phone: string;
  password_hash: string;
  password_must_change: boolean;
  signup_status: ClientSignupStatus;
  last_login_at: string | null;
  marketing_opt_in: boolean;
  // Phase 10 PR 1 §3.3: per-client opt-in JSONB. Default '{}'.
  // Missing keys → opt-in (see lib/clients/notification-preferences.ts).
  notification_preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ClientInsert = Partial<ClientRow> & {
  auth_email: string;
  full_name: string;
  contact_phone: string;
  password_hash: string;
};

export type ClientUpdate = Partial<Omit<ClientRow, 'id' | 'created_at'>>;

export type ClientSessionRow = {
  id: string;
  client_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  remember_me: boolean;
  ip_address: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ClientSessionInsert = Partial<ClientSessionRow> & {
  client_id: string;
  token_hash: string;
  expires_at: string;
};

export type ClientSessionUpdate = Partial<
  Omit<ClientSessionRow, 'id' | 'created_at'>
>;

export type ClientPasswordResetTokenRow = {
  id: string;
  client_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  ip_address: string | null;
  created_at: string;
};

export type ClientPasswordResetTokenInsert =
  Partial<ClientPasswordResetTokenRow> & {
    client_id: string;
    token_hash: string;
    expires_at: string;
  };

export type ClientPasswordResetTokenUpdate = Partial<
  Omit<ClientPasswordResetTokenRow, 'id' | 'created_at'>
>;

export type ClientSignupAttemptResult =
  | 'success'
  | 'duplicate_email'
  | 'rate_limited'
  | 'validation_failed';

export type ClientSignupAttemptRow = {
  id: string;
  ip_address: string;
  attempted_at: string;
  email_attempted: string | null;
  result: ClientSignupAttemptResult;
  created_at: string;
};

export type ClientSignupAttemptInsert =
  Partial<ClientSignupAttemptRow> & {
    ip_address: string;
    result: ClientSignupAttemptResult;
  };

export type ClientSignupAttemptUpdate = Partial<
  Omit<ClientSignupAttemptRow, 'id' | 'created_at'>
>;

export type ClientNotificationAlertStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed';

export type ClientNotificationAlertStatusRow = {
  id: 1;
  status: ClientNotificationAlertStatusValue;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
};

export type ClientNotificationAlertStatusUpdate = Partial<
  Omit<ClientNotificationAlertStatusRow, 'id'>
>;

// --- client_empty_leg_alert_status (Phase 10 PR 1 §3.6) ---
//
// Singleton (id=1). Tracks Resend health for client empty-leg
// match emails AND client empty-leg reservation-confirmation
// emails (round 7 P1 #2 — single canary card covers both).
// Mirrors the Phase 9 ClientNotificationAlertStatusRow shape;
// distinct singleton + distinct table + distinct canary card so
// a degraded empty-leg email channel doesn't mislabel client
// auth as unhealthy.

export type ClientEmptyLegAlertStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed';

export type ClientEmptyLegAlertStatusRow = {
  id: 1;
  status: ClientEmptyLegAlertStatusValue;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
};

export type ClientEmptyLegAlertStatusUpdate = Partial<
  Omit<ClientEmptyLegAlertStatusRow, 'id'>
>;

// ============================================================================
// PHASE 11 PR 1 — Aeris Cargo (Special Cargo Charter)
// Spec: aeris/docs/PHASE-11-CARGO-SPEC.md (Codex 100/100, round 10)
// ============================================================================

export type CargoType = 'horse' | 'luxury_car' | 'valuables' | 'other';

export type CargoRequestStatus =
  | 'pending'
  | 'offers_received'
  | 'accepted'
  | 'cancelled'
  | 'expired';

export type CargoOfferStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired';

export type CargoEmailAlertStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed';

export type CargoRequestRow = {
  id: string;
  cargo_request_number: string;
  client_id: string | null;
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  customer_email_snapshot: string | null;
  cargo_type: CargoType;
  origin_iata: string | null;
  origin_freeform: string | null;
  destination_iata: string | null;
  destination_freeform: string | null;
  pickup_date: string;
  delivery_date_target: string | null;
  flexibility_days: number;
  estimated_value_sar: number;
  insurance_required: boolean;
  handling_notes: string | null;
  // horse
  horse_count: number | null;
  horse_groom_required: boolean | null;
  horse_cites_status: string | null;
  horse_stall_requirements: string | null;
  // luxury_car
  car_make: string | null;
  car_model: string | null;
  car_year: number | null;
  car_running_condition: boolean | null;
  car_enclosed_required: boolean | null;
  // valuables
  valuables_declared_value_sar: number | null;
  valuables_security_level: string | null;
  valuables_climate_controlled: boolean | null;
  valuables_item_description: string | null;
  // other
  other_description: string | null;
  other_dimensions_lwh_cm: string | null;
  other_weight_kg: number | null;
  other_special_handling: string | null;
  // status + audit
  status: CargoRequestStatus;
  expires_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  accepted_offer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CargoRequestInsert = Partial<CargoRequestRow> & {
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  cargo_type: CargoType;
  pickup_date: string;
  estimated_value_sar: number;
};

export type CargoRequestUpdate = Partial<
  Omit<CargoRequestRow, 'id' | 'created_at' | 'cargo_request_number'>
>;

export type CargoOfferRow = {
  id: string;
  cargo_request_id: string;
  operator_id: string;
  aircraft_id: string;
  operator_name_snapshot: string;
  operator_phone_snapshot: string;
  operator_email_snapshot: string;
  aircraft_snapshot: string | null;
  base_price_sar: number;
  insurance_price_sar: number;
  customs_handling_price_sar: number;
  total_price_sar: number; // GENERATED
  proposed_pickup_date: string;
  proposed_delivery_date: string;
  operator_notes: string | null;
  status: CargoOfferStatus;
  expires_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CargoOfferInsert = Partial<CargoOfferRow> & {
  cargo_request_id: string;
  operator_id: string;
  aircraft_id: string;
  operator_name_snapshot: string;
  operator_phone_snapshot: string;
  operator_email_snapshot: string;
  base_price_sar: number;
  proposed_pickup_date: string;
  proposed_delivery_date: string;
};

export type CargoOfferUpdate = Partial<
  Omit<CargoOfferRow, 'id' | 'created_at' | 'total_price_sar'>
>;

export type CargoAircraftCapabilityRow = {
  aircraft_id: string;
  supports_horse: boolean;
  supports_luxury_car: boolean;
  supports_valuables: boolean;
  supports_other: boolean;
  max_horse_count: number | null;
  max_car_count: number | null;
  max_payload_kg: number | null;
  notes: string | null;
  updated_at: string;
};

export type CargoAircraftCapabilityInsert = Partial<CargoAircraftCapabilityRow> & {
  aircraft_id: string;
};

export type CargoAircraftCapabilityUpdate = Partial<
  Omit<CargoAircraftCapabilityRow, 'aircraft_id'>
>;

export type CargoEmailAlertStatusRow = {
  id: 1;
  status: CargoEmailAlertStatusValue;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
};

export type CargoEmailAlertStatusUpdate = Partial<
  Omit<CargoEmailAlertStatusRow, 'id'>
>;

// --- operator_notification_alert_status (Phase 8 §3.10) ---

// Singleton — id is always 1 (CHECK enforced by migration).
// Mirrors the EmptyLegOutreachAlertStatusRow pattern from
// Phase 7 §16. The seed row is INSERTed by the migration;
// runtime code (PR 2d notification module) only UPDATEs.
export type OperatorNotificationAlertStatusRow = {
  id: 1;
  status: OperatorNotificationAlertStatusValue;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  // Phase 8.1 — added by
  // 20260514000023_phase_8_1_whatsapp_alert_status.sql
  whatsapp_status: OperatorNotificationWhatsAppStatusValue;
  whatsapp_last_failure_at: string | null;
  whatsapp_last_failure_reason: string | null;
  updated_at: string;
};

export type OperatorNotificationAlertStatusUpdate = Partial<
  Omit<OperatorNotificationAlertStatusRow, 'id'>
>;

// ============================================================================
// Phase 8 PR 2a — Operator RPC layer (17 publics + 2 helpers)
//
// Migration file: 20260513000021_phase_8_operator_rpcs.sql
//
// All publics: SECURITY DEFINER + service-role-only EXECUTE +
// structured-error contract on every validation failure (no
// raises). Both internal helpers are REVOKEd from every role
// and NOT exposed via the Functions map below (callable only
// from inside the publics):
//   - `_normalize_operator_email(TEXT)` → LOWER(BTRIM(...))
//   - `_is_sha256_hex(TEXT)`            → NULL+length+lowercase-hex
//     (added in Codex round-3 P2 #1 fix; round-4 P2 brought
//     this header in line)
//
// Args/Result types below are exported so PR 2b/2c/2d Server
// Actions get strict typing on `supabase.rpc(...)` calls.
// ============================================================================

// --- 1. operator_signup ---

export type OperatorSignupArgs = {
  p_email: string;
  p_password_hash: string;
  p_company_name: string;
  p_contact_email: string;
  p_contact_phone: string;
  p_notes: string | null;
  p_ip: string;
};

export type OperatorSignupError =
  | 'ip_required'
  | 'email_invalid'
  | 'email_in_use'
  | 'rate_limited'
  | 'password_hash_malformed'
  | 'company_name_invalid'
  | 'contact_email_invalid'
  | 'contact_phone_invalid';

export type OperatorSignupResult =
  | { ok: true; operator_id: string; signup_status: 'pending' }
  | { ok: false; error: OperatorSignupError };

// --- 2. operator_login_lookup (Step 1 of 2-step login) ---

export type OperatorLoginLookupArgs = { p_email: string };

export type OperatorLoginLookupError =
  | 'invalid_credentials'
  | 'signup_pending'
  | 'signup_rejected'
  | 'account_suspended';

export type OperatorLoginLookupResult =
  | {
      ok: true;
      operator_id: string;
      password_hash: string;
      password_must_change: boolean;
    }
  | { ok: false; error: OperatorLoginLookupError };

// --- 3. operator_login_create_session (Step 2 of 2-step login) ---

export type OperatorLoginCreateSessionArgs = {
  p_operator_id: string;
  p_session_token_hash: string;
  p_remember_me: boolean;
  p_ip: string | null;
  p_user_agent: string | null;
};

export type OperatorLoginCreateSessionError =
  | 'operator_not_found'
  | 'account_not_approved'
  | 'session_token_hash_invalid';

export type OperatorLoginCreateSessionResult =
  | {
      ok: true;
      session_id: string;
      expires_at: string;
      password_must_change: boolean;
    }
  | { ok: false; error: OperatorLoginCreateSessionError };

// --- 4. operator_logout ---

export type OperatorLogoutArgs = { p_session_token_hash: string };

export type OperatorLogoutResult =
  | { ok: true; session_id: string }
  | { ok: true; no_op: true };

// --- 5. operator_session_validate ---

export type OperatorSessionValidateArgs = { p_token_hash: string };

export type OperatorSessionValidateError =
  | 'invalid_session'
  | 'account_not_approved';

export type OperatorSessionValidateResult =
  | {
      ok: true;
      operator_id: string;
      expires_at: string;
      password_must_change: boolean;
    }
  | { ok: false; error: OperatorSessionValidateError };

// --- 6. admin_approve_operator ---

export type AdminApproveOperatorArgs = {
  p_operator_id: string;
  p_welcome_token_hash: string;
  p_welcome_token_expires_at: string;
};

export type AdminApproveOperatorError =
  | 'operator_not_found'
  | 'not_pending'
  | 'welcome_token_hash_invalid'
  | 'welcome_token_expires_at_invalid';

export type AdminApproveOperatorResult =
  | { ok: true; operator_id: string }
  | { ok: false; error: AdminApproveOperatorError };

// --- 7. admin_reject_operator ---

export type AdminRejectOperatorArgs = {
  p_operator_id: string;
  p_reason: string;
};

export type AdminRejectOperatorError =
  | 'operator_not_found'
  | 'not_pending'
  | 'reason_required';

export type AdminRejectOperatorResult =
  | { ok: true; operator_id: string }
  | { ok: false; error: AdminRejectOperatorError };

// --- 8. admin_suspend_operator ---

export type AdminSuspendOperatorArgs = {
  p_operator_id: string;
  p_reason: string;
};

export type AdminSuspendOperatorError =
  | 'operator_not_found'
  | 'not_approved'
  | 'reason_required';

export type AdminSuspendOperatorResult =
  | { ok: true; operator_id: string; sessions_revoked: number }
  | { ok: false; error: AdminSuspendOperatorError };

// --- 9. admin_unsuspend_operator ---

export type AdminUnsuspendOperatorArgs = { p_operator_id: string };

export type AdminUnsuspendOperatorError =
  | 'operator_not_found'
  | 'not_suspended';

export type AdminUnsuspendOperatorResult =
  | { ok: true; operator_id: string }
  | { ok: false; error: AdminUnsuspendOperatorError };

// --- 10. admin_set_operator_documents ---

export type AdminSetOperatorDocumentsArgs = {
  p_operator_id: string;
  p_commercial_registration: string | null;
  p_gaca_license: string | null;
  p_license_expiry: string | null;
};

export type AdminSetOperatorDocumentsError =
  | 'operator_not_found'
  | 'not_writable';

export type AdminSetOperatorDocumentsResult =
  | { ok: true; operator_id: string }
  | { ok: false; error: AdminSetOperatorDocumentsError };

// --- 11. admin_reset_operator_password ---

export type AdminResetOperatorPasswordArgs = {
  p_operator_id: string;
  p_new_password_hash: string;
};

export type AdminResetOperatorPasswordError =
  | 'operator_not_found'
  | 'not_resettable'
  | 'password_hash_malformed';

export type AdminResetOperatorPasswordResult =
  | { ok: true; operator_id: string; sessions_revoked: number }
  | { ok: false; error: AdminResetOperatorPasswordError };

// --- 12. mint_operator_password_reset_token ---

export type MintOperatorPasswordResetTokenArgs = {
  p_email: string;
  p_token_hash: string;
  p_expires_at: string;
  p_ip: string | null;
};

// Missing email returns no_op:true to prevent email enumeration
// (same posture as operator_login_lookup's 'invalid_credentials'
// opacity). Codex round-1 P2 #1 fix on PR 2a: malformed input
// (NULL hash, out-of-bounds expiry) returns a structured error
// up-front BEFORE the email lookup, so a Server Action bug
// surfaces deterministically without leaking email-existence
// information.
export type MintOperatorPasswordResetTokenError =
  | 'token_hash_invalid'
  | 'expires_at_invalid';

export type MintOperatorPasswordResetTokenResult =
  | { ok: true; token_id: string }
  | { ok: true; no_op: true }
  | { ok: false; error: MintOperatorPasswordResetTokenError };

// --- 13. verify_operator_password_reset ---

export type VerifyOperatorPasswordResetArgs = {
  p_token_hash: string;
  p_new_password_hash: string;
};

export type VerifyOperatorPasswordResetError =
  | 'token_not_found'
  | 'token_already_used'
  | 'token_expired'
  | 'password_hash_malformed';

export type VerifyOperatorPasswordResetResult =
  | { ok: true; operator_id: string; sessions_revoked: number }
  | { ok: false; error: VerifyOperatorPasswordResetError };

// --- 14. mint_operator_otp ---

export type MintOperatorOtpArgs = {
  p_operator_id: string;
  p_code_hash: string;
  p_purpose: OperatorOtpPurpose;
  p_expires_at: string;
};

export type MintOperatorOtpError =
  | 'operator_not_found'
  | 'invalid_purpose'
  | 'not_otp_eligible'
  | 'code_hash_invalid'
  | 'expires_at_invalid';

export type MintOperatorOtpResult =
  | { ok: true; otp_id: string }
  | { ok: false; error: MintOperatorOtpError };

// --- 15. verify_operator_otp ---

export type VerifyOperatorOtpArgs = {
  p_operator_id: string;
  p_code_hash: string;
};

export type VerifyOperatorOtpError =
  | 'operator_not_found'
  | 'no_active_otp'
  | 'code_mismatch'
  | 'expired'
  | 'locked';

export type VerifyOperatorOtpResult =
  | { ok: true; otp_id: string; purpose: OperatorOtpPurpose }
  | { ok: false; error: VerifyOperatorOtpError };

// --- 16. convert_phase7_stub_to_operator ---

export type ConvertPhase7StubToOperatorArgs = {
  p_stub_id: string;
  p_operator_id: string;
};

export type ConvertPhase7StubToOperatorError =
  | 'stub_not_found'
  | 'operator_not_found'
  | 'stub_already_archived'
  | 'operator_not_writable';

export type ConvertPhase7StubToOperatorResult =
  | {
      ok: true;
      stub_id: string;
      operator_id: string;
      legs_reassigned: number;
    }
  | { ok: false; error: ConvertPhase7StubToOperatorError };

// --- 17. consume_operator_welcome_token ---

export type ConsumeOperatorWelcomeTokenArgs = {
  p_token_hash: string;
  p_session_token_hash: string;
  p_remember_me: boolean;
  p_ip: string | null;
  p_user_agent: string | null;
};

export type ConsumeOperatorWelcomeTokenError =
  | 'token_not_found'
  | 'already_used'
  | 'expired'
  | 'account_not_approved'
  | 'session_token_hash_invalid';

export type ConsumeOperatorWelcomeTokenResult =
  | {
      ok: true;
      operator_id: string;
      session_id: string;
      expires_at: string;
      password_must_change: boolean;
    }
  | { ok: false; error: ConsumeOperatorWelcomeTokenError };

// --- Phase 8 PR 2e — cleanup-cron RPC contract types ---
//
// Every cleanup RPC returns the same shape, so a single
// type-alias serves all four. Result is always `ok: true`
// — there is no validation surface and the cleanup RPCs
// do not have a structured failure path; a Postgres-level
// failure surfaces as the .rpc() error to the route handler.
export type OperatorCleanupRpcResult = {
  ok: true;
  deleted_count: number;
};

export interface RecordOperatorCronTickArgs {
  p_job_name: OperatorCronJobName;
  p_deleted_count: number;
  p_success: boolean;
  p_error_label: string | null;
}

export type RecordOperatorCronTickResult = {
  ok: true;
  history_id: number;
};

// ============================================================================
// Phase 7 PR 2a: SECURITY DEFINER RPC layer
//
// Migration file: 20260510000011_phase_7_empty_legs_rpcs.sql.
// 11 public functions + 1 internal helper + 1 no-op stub.
// All publics: SECURITY DEFINER + service-role-only EXECUTE +
// structured-error contract on every validation failure (no
// raises). Helper `_recompute_empty_leg_price` is REVOKEd
// from every role and not exposed via the Functions map
// below (callable only from inside the publics).
//
// Args/Result types below are exported so PR 2b–2e Server
// Actions get strict typing on `supabase.rpc(...)` calls.
// PR 2a itself ships zero callers — only the SQL migration +
// these types + the parity-test extension.
// ============================================================================

// --- 1. publish_empty_leg ---

export type PublishEmptyLegArgs = {
  p_operator_id: string | null;
  p_operator_stub_id: string | null;
  p_operator_name: string | null;
  p_operator_phone: string | null;
  p_operator_email: string | null;
  p_aircraft_id: string | null;
  p_aircraft_text: string | null;
  p_parent_booking_id: string | null;
  p_departure_airport_iata: string | null;
  p_departure_airport_freeform: string | null;
  p_arrival_airport_iata: string | null;
  p_arrival_airport_freeform: string | null;
  p_departure_window_start: string;
  p_departure_window_end: string;
  p_flexibility_hours: number | null;
  p_original_price: number;
  p_max_passengers: number;
  p_auction_initial_discount_pct: number | null;
  p_auction_floor_discount_pct: number | null;
  p_auction_curve: EmptyLegAuctionCurve | null;
  p_auction_window_lead_hours: number | null;
  p_suppress_notifications: boolean | null;
};

export type PublishEmptyLegError =
  | 'departure_route_missing'
  | 'arrival_route_missing'
  | 'departure_airport_unknown'
  | 'arrival_airport_unknown'
  | 'parent_booking_not_found'
  | 'operator_not_found'
  | 'operator_stub_not_found'
  | 'aircraft_not_found'
  | 'departure_window_invalid'
  | 'original_price_invalid'
  | 'max_passengers_invalid'
  | 'auction_initial_discount_out_of_range'
  | 'auction_floor_discount_out_of_range'
  | 'auction_floor_below_initial'
  | 'auction_curve_invalid'
  | 'auction_window_lead_hours_invalid'
  | 'auction_window_already_closed';

export type PublishEmptyLegResult =
  | {
      ok: true;
      leg_id: string;
      leg_number: string;
      current_price: number;
    }
  | { ok: false; error: PublishEmptyLegError };

// --- 2. update_empty_leg_price ---

export type UpdateEmptyLegPriceArgs = {
  p_leg_id: string;
  p_new_price: number;
};

export type UpdateEmptyLegPriceError =
  | 'leg_not_found'
  | 'leg_not_available'
  | 'new_price_invalid'
  | 'new_price_above_original'
  | 'new_price_below_floor';

export type UpdateEmptyLegPriceResult =
  | {
      ok: true;
      leg_id: string;
      current_price: number;
      current_discount_pct: number;
      fired_event: boolean;
    }
  | { ok: false; error: UpdateEmptyLegPriceError };

// --- 3. reserve_empty_leg ---

export type ReserveEmptyLegArgs = {
  p_leg_id: string;
  p_token_hash: string;
  p_expires_at: string;
  p_customer_name: string;
  p_customer_phone: string;
};

export type ReserveEmptyLegError =
  | 'leg_not_found'
  | 'leg_not_available'
  | 'leg_window_closed'
  | 'reservation_token_invalid'
  | 'reservation_expiry_invalid'
  | 'reservation_expiry_too_far'
  | 'customer_name_missing'
  | 'customer_phone_missing';

export type ReserveEmptyLegResult =
  | {
      ok: true;
      leg_id: string;
      reservation_expires_at: string;
    }
  | { ok: false; error: ReserveEmptyLegError };

// --- 4. confirm_empty_leg_reservation ---

export type ConfirmEmptyLegReservationArgs = {
  p_leg_id: string;
  p_token_hash: string;
};

export type ConfirmEmptyLegReservationError =
  | 'leg_not_found'
  | 'leg_not_reserved'
  | 'reservation_expired'
  | 'reservation_token_mismatch'
  | 'reservation_state_invalid'
  | 'leg_route_origin_missing'
  | 'leg_route_destination_missing';

export type ConfirmEmptyLegReservationResult =
  | {
      ok: true;
      leg_id: string;
      booking_id: string;
    }
  | { ok: false; error: ConfirmEmptyLegReservationError };

// --- 5. release_empty_leg_reservation ---

export type ReleaseEmptyLegReservationArgs = {
  p_leg_id: string;
  p_token_hash: string;
};

export type ReleaseEmptyLegReservationError =
  | 'leg_not_found'
  | 'leg_not_reserved'
  | 'reservation_token_mismatch';

export type ReleaseEmptyLegReservationResult =
  | { ok: true; leg_id: string }
  | { ok: false; error: ReleaseEmptyLegReservationError };

// --- 6. admin_release_empty_leg_reservation ---

export type AdminReleaseEmptyLegReservationArgs = {
  p_leg_id: string;
};

export type AdminReleaseEmptyLegReservationError =
  | 'leg_not_found'
  | 'leg_not_reserved';

export type AdminReleaseEmptyLegReservationResult =
  | { ok: true; leg_id: string }
  | { ok: false; error: AdminReleaseEmptyLegReservationError };

// --- 7. cancel_empty_leg ---

export type CancelEmptyLegArgs = {
  p_leg_id: string;
  p_reason: string | null;
};

export type CancelEmptyLegError =
  | 'leg_not_found'
  | 'leg_sold_use_booking_flow'
  | 'leg_terminal';

export type CancelEmptyLegResult =
  | { ok: true; leg_id: string }
  | { ok: false; error: CancelEmptyLegError };

// --- 8. expire_empty_leg_reservation ---

export type ExpireEmptyLegReservationArgs = {
  p_leg_id: string;
};

export type ExpireEmptyLegReservationResult =
  | { ok: true; leg_id?: string; no_op?: boolean }
  | { ok: false; error: 'leg_not_found' };

// --- 9. tick_empty_leg_dutch_auction ---

export type TickEmptyLegDutchAuctionArgs = {
  p_leg_id: string;
};

export type TickEmptyLegDutchAuctionResult =
  | {
      ok: true;
      leg_id?: string;
      old_pct?: number;
      new_pct?: number;
      fired_event?: boolean;
      no_op?: boolean;
    }
  | { ok: false; error: 'leg_not_found' };

// --- 10. admin_mark_empty_leg_sold ---

export type AdminMarkEmptyLegSoldArgs = {
  p_leg_id: string;
  p_customer_name: string;
  p_customer_phone: string;
};

export type AdminMarkEmptyLegSoldError =
  | 'leg_not_found'
  | 'leg_not_available'
  | 'leg_window_closed'
  | 'customer_name_missing'
  | 'customer_phone_missing'
  | 'leg_route_origin_missing'
  | 'leg_route_destination_missing';

export type AdminMarkEmptyLegSoldResult =
  | {
      ok: true;
      leg_id: string;
      booking_id: string;
    }
  | { ok: false; error: AdminMarkEmptyLegSoldError };

// --- 11. publish_empty_leg_event (no-op stub in PR 2a) ---

export type PublishEmptyLegEventArgs = {
  p_leg_id: string;
  p_event_type: 'published' | 'price_dropped';
};

// `RETURNS VOID` in plpgsql; supabase-js types these as
// `null`. PR 2e replaces the body with the outbox-write
// logic but keeps the same signature + return type.
//
// Phase 7 PR 2e UPDATE: the body is now a real INSERT into
// `empty_leg_events_outbox`. Args/result shapes unchanged for
// backwards compatibility with PR 2a callers
// (publish_empty_leg, update_empty_leg_price,
// tick_empty_leg_dutch_auction). Result is now a structured
// json object instead of `null`.
export type PublishEmptyLegEventResult =
  | { ok: true; leg_id: string }
  | { ok: false; error: 'event_type_invalid' | 'leg_not_found' };

// --- 12. expire_empty_leg_window (PR 2e migration §3) ---

export type ExpireEmptyLegWindowArgs = {
  p_leg_id: string;
};

export type ExpireEmptyLegWindowResult =
  | { ok: true; leg_id: string; no_op?: boolean }
  | { ok: false; error: 'leg_not_found' };

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      airports: {
        Row: AirportRow;
        Insert: AirportInsert;
        Update: AirportUpdate;
        Relationships: [];
      };
      lead_inquiries: {
        Row: LeadInquiryRow;
        Insert: LeadInquiryInsert;
        Update: Partial<Omit<LeadInquiryRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      trip_requests: {
        Row: TripRequestRow;
        // Phase 4 does NOT insert into trip_requests directly from the
        // app — promotion goes through the RPC. The Insert shape is
        // declared for completeness but not used by Server Actions.
        Insert: Partial<TripRequestRow> & {
          legs: TripLeg[];
          departure_date: string;
          passengers_count: number;
        };
        Update: Partial<Omit<TripRequestRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      phase4_operator_offers: {
        Row: Phase4OperatorOfferRow;
        Insert: Phase4OperatorOfferInsert;
        Update: Partial<Omit<Phase4OperatorOfferRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      // Phase 5 — multi-operator dispatch. The app inserts/updates
      // these tables ONLY through the SECURITY DEFINER RPCs
      // (open_phase5_dispatch_round, submit_phase5_operator_offer,
      // accept_offer). Direct table writes from app code are
      // unsupported; the Insert / Update shapes are declared for
      // completeness so list/get queries type-check.
      trip_dispatch_rounds: {
        Row: TripDispatchRoundRow;
        Insert: Partial<TripDispatchRoundRow> & { trip_request_id: string };
        Update: Partial<Omit<TripDispatchRoundRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      trip_dispatch_targets: {
        Row: TripDispatchTargetRow;
        Insert: Partial<TripDispatchTargetRow> & {
          dispatch_round_id: string;
          trip_request_id: string;
          target_phone: string;
          nonce: string;
          sent_at: string;
          expires_at: string;
        };
        Update: Partial<Omit<TripDispatchTargetRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      phase5_operator_offers: {
        Row: Phase5OperatorOfferRow;
        Insert: Partial<Phase5OperatorOfferRow> & {
          trip_request_id: string;
          dispatch_target_id: string;
          operator_name: string;
          total_price_sar: number;
          departure_eta: string;
          validity_hours: number;
          expires_at: string;
        };
        Update: Partial<Omit<Phase5OperatorOfferRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      // Phase 6.2 PR 1: bookings + booking_addons +
      // addon_catalog. Direct table writes from app code are
      // intentionally not used in Phase 6.2; every mutation
      // goes through PR 2a's SECURITY DEFINER RPCs. The
      // Insert / Update shapes are declared for type-checking
      // completeness so list / get queries type-check.
      bookings: {
        Row: BookingRow;
        Insert: BookingInsert;
        Update: BookingUpdate;
        Relationships: [];
      };
      booking_addons: {
        Row: BookingAddonRow;
        Insert: BookingAddonInsert;
        Update: BookingAddonUpdate;
        Relationships: [];
      };
      addon_catalog: {
        Row: AddonCatalogRow;
        Insert: AddonCatalogInsert;
        Update: AddonCatalogUpdate;
        Relationships: [];
      };
      // Phase 7 PR 1: empty_legs is reshaped (operator_id /
      // aircraft_id / IATA columns relaxed; new snapshot,
      // reservation, customer-booking, Dutch-auction,
      // suppress_notifications, operator_stub_id columns +
      // audit trigger). Direct table writes are intentionally
      // not used — every mutation goes through PR 2a's
      // SECURITY DEFINER RPCs.
      empty_legs: {
        Row: EmptyLegRow;
        Insert: EmptyLegInsert;
        Update: EmptyLegUpdate;
        Relationships: [];
      };
      // Phase 7 PR 1 §13: dedicated audit + outreach-queue
      // table for guest lead_inquiries recipients.
      // application reads via PR 2b's outreach queue +
      // PR 2e's frequency-cap module. INSERTs come from
      // PR 2e's matching engine; the AFTER INSERT trigger
      // (§17) atomically updates lead_inquiries.last_empty_leg_notified_at.
      empty_leg_notifications: {
        Row: EmptyLegNotificationRow;
        Insert: EmptyLegNotificationInsert;
        Update: EmptyLegNotificationUpdate;
        Relationships: [];
      };
      // Phase 7 PR 1 §14: lightweight Phase-7 operator stub
      // table (Codex iteration-11 P1 #1 fix). The real
      // `operators` table requires `user_id NOT NULL` +
      // `commercial_registration` + `gaca_license` +
      // `license_expiry` — Phase 7 cannot populate those
      // without the full Phase 8 onboarding flow, so the
      // stub table is the operator namespace for Phase 7.
      phase7_operator_stubs: {
        Row: Phase7OperatorStubRow;
        Insert: Phase7OperatorStubInsert;
        Update: Phase7OperatorStubUpdate;
        Relationships: [];
      };
      // Phase 7 PR 1 §15: HMAC-token sessions for the
      // operator portal (PR 2c). FK to phase7_operator_stubs
      // (Codex iteration-11 P1 #1 + iteration-12 P1 #2).
      operator_empty_leg_sessions: {
        Row: OperatorEmptyLegSessionRow;
        Insert: OperatorEmptyLegSessionInsert;
        Update: OperatorEmptyLegSessionUpdate;
        Relationships: [];
      };
      // Phase 7 PR 1 §16: singleton health row for the
      // founder batch alert email (Codex iteration-5 P2 #2
      // fix). The founder-batch-email module UPDATEs this
      // row on every send attempt; PR 2b's outreach queue
      // page reads it + renders a banner when status
      // <> 'healthy'.
      empty_leg_outreach_alert_status: {
        Row: EmptyLegOutreachAlertStatusRow;
        // Singleton — INSERT only happens once via the
        // migration's seed; runtime code only UPDATEs.
        Insert: EmptyLegOutreachAlertStatusRow;
        Update: EmptyLegOutreachAlertStatusUpdate;
        Relationships: [];
      };
      // Phase 7 PR 2e: durable per-event outbox so the
      // synchronous match-trigger and the cron drain
      // converge to the same processed/unprocessed state.
      empty_leg_events_outbox: {
        Row: EmptyLegEventsOutboxRow;
        Insert: EmptyLegEventsOutboxInsert;
        Update: EmptyLegEventsOutboxUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1: operators table — existed since Phase 1
      // initial schema but was not exposed via Database['Tables']
      // until Phase 8 added the auth columns + 6 companion
      // tables. Direct table writes from app code are unsupported;
      // every mutation goes through PR 2a's SECURITY DEFINER RPCs
      // (operator_signup, admin_approve_operator, etc.). The
      // Insert / Update shapes are declared so list / get queries
      // type-check.
      operators: {
        Row: OperatorRow;
        Insert: OperatorInsert;
        Update: OperatorUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1 §3.5: cookie-based session storage for
      // the operator portal. token_hash = sha256(rawToken).
      operator_sessions: {
        Row: OperatorSessionRow;
        Insert: OperatorSessionInsert;
        Update: OperatorSessionUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1 §3.6: 30-min single-use email reset
      // tokens. token_hash = sha256(rawToken).
      operator_password_reset_tokens: {
        Row: OperatorPasswordResetTokenRow;
        Insert: OperatorPasswordResetTokenInsert;
        Update: OperatorPasswordResetTokenUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1 §3.7: 10-min single-use WhatsApp OTP
      // codes for the recovery flow. code_hash =
      // sha256(plaintext-6-digit). Max 5 verify attempts
      // before the row locks.
      operator_otp_codes: {
        Row: OperatorOtpCodeRow;
        Insert: OperatorOtpCodeInsert;
        Update: OperatorOtpCodeUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1 §3.8: Supabase Storage object metadata
      // for regulatory documents admin uploads on the
      // operator's behalf.
      operator_documents: {
        Row: OperatorDocumentRow;
        Insert: OperatorDocumentInsert;
        Update: OperatorDocumentUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1 §3.9: anti-spam log for self-signup
      // (3 attempts / IP / day rate limit per locked
      // decision §12).
      operator_signup_attempts: {
        Row: OperatorSignupAttemptRow;
        Insert: OperatorSignupAttemptInsert;
        Update: OperatorSignupAttemptUpdate;
        Relationships: [];
      };
      // Phase 8 PR 1 §3.10: singleton health row mirroring
      // the Phase 7 §16 outreach-alert pattern. PR 2d
      // notification module UPDATEs on every send attempt;
      // PR 2b's /admin/operators page renders a banner when
      // status <> 'healthy'. Insert is the same shape as Row
      // because the migration seeds id=1 and runtime code
      // never INSERTs.
      operator_notification_alert_status: {
        Row: OperatorNotificationAlertStatusRow;
        Insert: OperatorNotificationAlertStatusRow;
        Update: OperatorNotificationAlertStatusUpdate;
        Relationships: [];
      };
      // Phase 8 PR 2e — observability table for the
      // operator-side cleanup cron routes. Service-role
      // only; RLS is enabled with no policies.
      operator_cron_tick_history: {
        Row: OperatorCronTickHistoryRow;
        Insert: OperatorCronTickHistoryInsert;
        Update: OperatorCronTickHistoryUpdate;
        Relationships: [];
      };
      // Phase 9 PR 1 — client portal tables (mirror of
      // operator portal in Phase 8 PR 2c). Same posture:
      // service_role only, RLS enabled with no policies.
      clients: {
        Row: ClientRow;
        Insert: ClientInsert;
        Update: ClientUpdate;
        Relationships: [];
      };
      client_sessions: {
        Row: ClientSessionRow;
        Insert: ClientSessionInsert;
        Update: ClientSessionUpdate;
        Relationships: [];
      };
      client_password_reset_tokens: {
        Row: ClientPasswordResetTokenRow;
        Insert: ClientPasswordResetTokenInsert;
        Update: ClientPasswordResetTokenUpdate;
        Relationships: [];
      };
      client_signup_attempts: {
        Row: ClientSignupAttemptRow;
        Insert: ClientSignupAttemptInsert;
        Update: ClientSignupAttemptUpdate;
        Relationships: [];
      };
      client_notification_alert_status: {
        Row: ClientNotificationAlertStatusRow;
        Insert: ClientNotificationAlertStatusRow;
        Update: ClientNotificationAlertStatusUpdate;
        Relationships: [];
      };
      // Phase 10 PR 1 §3.6 — empty-leg client email alert singleton.
      // Distinct from Phase 9's client_notification_alert_status so a
      // failed empty-leg email doesn't mislabel client auth as unhealthy.
      client_empty_leg_alert_status: {
        Row: ClientEmptyLegAlertStatusRow;
        Insert: ClientEmptyLegAlertStatusRow;
        Update: ClientEmptyLegAlertStatusUpdate;
        Relationships: [];
      };
      // Phase 11 PR 1 §3.1-§3.6 — Cargo (Special Charter) tables.
      cargo_requests: {
        Row: CargoRequestRow;
        Insert: CargoRequestInsert;
        Update: CargoRequestUpdate;
        Relationships: [];
      };
      cargo_offers: {
        Row: CargoOfferRow;
        Insert: CargoOfferInsert;
        Update: CargoOfferUpdate;
        Relationships: [];
      };
      cargo_aircraft_capabilities: {
        Row: CargoAircraftCapabilityRow;
        Insert: CargoAircraftCapabilityInsert;
        Update: CargoAircraftCapabilityUpdate;
        Relationships: [];
      };
      cargo_email_alert_status: {
        Row: CargoEmailAlertStatusRow;
        Insert: CargoEmailAlertStatusRow;
        Update: CargoEmailAlertStatusUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      promote_lead_to_trip_request: {
        Args: PromoteLeadArgs;
        Returns: PromoteLeadResult;
      };
      accept_phase4_offer: {
        Args: AcceptPhase4OfferArgs;
        Returns: AcceptPhase4OfferResult;
      };
      submit_phase4_operator_offer: {
        Args: SubmitPhase4OperatorOfferArgs;
        Returns: SubmitPhase4OperatorOfferResult;
      };
      // Phase 5 RPCs. accept_offer is the unified accept that
      // handles both phase4_operator_offers and
      // phase5_operator_offers; the legacy accept_phase4_offer
      // stays in the DB for the deprecation window but the app
      // calls accept_offer going forward.
      open_phase5_dispatch_round: {
        Args: OpenPhase5DispatchRoundArgs;
        Returns: OpenPhase5DispatchRoundResult;
      };
      submit_phase5_operator_offer: {
        Args: SubmitPhase5OperatorOfferArgs;
        Returns: SubmitPhase5OperatorOfferResult;
      };
      accept_offer: {
        Args: AcceptOfferArgs;
        Returns: AcceptOfferResult;
      };
      // Phase 6.2 PR 2a — booking + add-ons mutation RPCs.
      // All SECURITY DEFINER + service-role-only EXECUTE.
      // PR 2b's Server Actions are thin wrappers that call
      // these via supabase.rpc(...). The internal helper
      // _recompute_booking_totals is REVOKEd from every
      // role (callable only inside these seven public
      // functions, which run as the function-owner role)
      // and therefore not exposed in this Functions map.
      backfill_booking_from_offer: {
        Args: BackfillBookingFromOfferArgs;
        Returns: BackfillBookingFromOfferResult;
      };
      attach_booking_addon: {
        Args: AttachBookingAddonArgs;
        Returns: AttachBookingAddonResult;
      };
      customer_cancel_booking_addon: {
        Args: CustomerCancelBookingAddonArgs;
        Returns: CustomerCancelBookingAddonResult;
      };
      admin_cancel_booking_addon: {
        Args: AdminCancelBookingAddonArgs;
        Returns: AdminCancelBookingAddonResult;
      };
      update_booking_addon_quantity: {
        Args: UpdateBookingAddonQuantityArgs;
        Returns: UpdateBookingAddonQuantityResult;
      };
      confirm_checkout_prep: {
        Args: ConfirmCheckoutPrepArgs;
        Returns: ConfirmCheckoutPrepResult;
      };
      // Phase 7 PR 2a: 11 SECURITY DEFINER public functions
      // covering every empty_legs mutation (publish, reprice,
      // reserve, confirm, release × 2, cancel, expire, tick,
      // mark-sold) + the no-op publish_empty_leg_event stub
      // that PR 2e replaces. All service-role-only EXECUTE.
      // The internal helper `_recompute_empty_leg_price` is
      // REVOKEd from every role and not exposed here.
      publish_empty_leg: {
        Args: PublishEmptyLegArgs;
        Returns: PublishEmptyLegResult;
      };
      update_empty_leg_price: {
        Args: UpdateEmptyLegPriceArgs;
        Returns: UpdateEmptyLegPriceResult;
      };
      reserve_empty_leg: {
        Args: ReserveEmptyLegArgs;
        Returns: ReserveEmptyLegResult;
      };
      confirm_empty_leg_reservation: {
        Args: ConfirmEmptyLegReservationArgs;
        Returns: ConfirmEmptyLegReservationResult;
      };
      release_empty_leg_reservation: {
        Args: ReleaseEmptyLegReservationArgs;
        Returns: ReleaseEmptyLegReservationResult;
      };
      admin_release_empty_leg_reservation: {
        Args: AdminReleaseEmptyLegReservationArgs;
        Returns: AdminReleaseEmptyLegReservationResult;
      };
      cancel_empty_leg: {
        Args: CancelEmptyLegArgs;
        Returns: CancelEmptyLegResult;
      };
      expire_empty_leg_reservation: {
        Args: ExpireEmptyLegReservationArgs;
        Returns: ExpireEmptyLegReservationResult;
      };
      tick_empty_leg_dutch_auction: {
        Args: TickEmptyLegDutchAuctionArgs;
        Returns: TickEmptyLegDutchAuctionResult;
      };
      admin_mark_empty_leg_sold: {
        Args: AdminMarkEmptyLegSoldArgs;
        Returns: AdminMarkEmptyLegSoldResult;
      };
      publish_empty_leg_event: {
        Args: PublishEmptyLegEventArgs;
        Returns: PublishEmptyLegEventResult;
      };
      // Phase 7 PR 2e: 12th SECURITY DEFINER public, called
      // exclusively by /api/cron/empty-legs/expire-windows.
      expire_empty_leg_window: {
        Args: ExpireEmptyLegWindowArgs;
        Returns: ExpireEmptyLegWindowResult;
      };
      // Phase 8 PR 2a: 17 operator-account RPCs (all SECURITY
      // DEFINER + service-role-only EXECUTE; structured-error
      // contract). The 2 internal helpers
      // (_normalize_operator_email, _is_sha256_hex — the latter
      // added in Codex round-3 P2 #1 fix) are REVOKEd from every
      // role and intentionally NOT exposed here.
      operator_signup: {
        Args: OperatorSignupArgs;
        Returns: OperatorSignupResult;
      };
      operator_login_lookup: {
        Args: OperatorLoginLookupArgs;
        Returns: OperatorLoginLookupResult;
      };
      operator_login_create_session: {
        Args: OperatorLoginCreateSessionArgs;
        Returns: OperatorLoginCreateSessionResult;
      };
      operator_logout: {
        Args: OperatorLogoutArgs;
        Returns: OperatorLogoutResult;
      };
      operator_session_validate: {
        Args: OperatorSessionValidateArgs;
        Returns: OperatorSessionValidateResult;
      };
      admin_approve_operator: {
        Args: AdminApproveOperatorArgs;
        Returns: AdminApproveOperatorResult;
      };
      admin_reject_operator: {
        Args: AdminRejectOperatorArgs;
        Returns: AdminRejectOperatorResult;
      };
      admin_suspend_operator: {
        Args: AdminSuspendOperatorArgs;
        Returns: AdminSuspendOperatorResult;
      };
      admin_unsuspend_operator: {
        Args: AdminUnsuspendOperatorArgs;
        Returns: AdminUnsuspendOperatorResult;
      };
      admin_set_operator_documents: {
        Args: AdminSetOperatorDocumentsArgs;
        Returns: AdminSetOperatorDocumentsResult;
      };
      admin_reset_operator_password: {
        Args: AdminResetOperatorPasswordArgs;
        Returns: AdminResetOperatorPasswordResult;
      };
      mint_operator_password_reset_token: {
        Args: MintOperatorPasswordResetTokenArgs;
        Returns: MintOperatorPasswordResetTokenResult;
      };
      verify_operator_password_reset: {
        Args: VerifyOperatorPasswordResetArgs;
        Returns: VerifyOperatorPasswordResetResult;
      };
      mint_operator_otp: {
        Args: MintOperatorOtpArgs;
        Returns: MintOperatorOtpResult;
      };
      verify_operator_otp: {
        Args: VerifyOperatorOtpArgs;
        Returns: VerifyOperatorOtpResult;
      };
      convert_phase7_stub_to_operator: {
        Args: ConvertPhase7StubToOperatorArgs;
        Returns: ConvertPhase7StubToOperatorResult;
      };
      consume_operator_welcome_token: {
        Args: ConsumeOperatorWelcomeTokenArgs;
        Returns: ConsumeOperatorWelcomeTokenResult;
      };
      // Phase 8 PR 2e — cleanup-cron RPCs are intentionally
      // NOT registered here. The Supabase generated type
      // shape for parameterless Args (Record<string, never>
      // OR `{ [_ in never]: never }`) collapses inference for
      // every other RPC's Args to `undefined`, breaking
      // type-check across booking-addons / checkout-prep /
      // empty-legs / operators surfaces. Until the project
      // regenerates database.ts via `npm run db:types` against
      // the live schema, the cron-cleanup helper casts its
      // .rpc() args via `as unknown as undefined` to match the
      // project-wide pattern used by every Phase 7/8 .rpc()
      // call site that lacks an Args entry here.
    };
    CompositeTypes: { [_ in never]: never };
    Enums: {
      user_role: 'client' | 'operator' | 'admin' | 'support';
      loyalty_tier: 'silver' | 'gold' | 'platinum' | 'diamond';
      user_status: 'active' | 'suspended' | 'deleted';
      trip_type: TripTypeValue;
      // Phase 6.2 PR 1 File A: ADD VALUE 'pending_offline'.
      // 'partial_paid' and 'failed' are explicitly NOT
      // added — they ship in Phase 11 alongside the webhook
      // handlers that consume them.
      booking_payment_status: BookingPaymentStatus;
      booking_flight_status: BookingFlightStatus;
      aircraft_category: AircraftCategoryValue;
      aircraft_status: 'active' | 'maintenance' | 'retired';
      crew_role: 'captain' | 'first_officer' | 'flight_attendant';
      offer_status: OfferStatus;
      // Phase 8 PR 1 §3.4: extended with 'rejected' (4th value)
      // via ALTER TYPE operator_status ADD VALUE IF NOT EXISTS.
      // The associated column was renamed from `status` to
      // `signup_status` in the same migration. Use the
      // `OperatorSignupStatus` alias (defined above) to refer
      // to this union from application code.
      operator_status: OperatorSignupStatus;
      trip_request_status: TripRequestStatus;
      // Phase 5
      dispatch_target_status: DispatchTargetStatus;
      dispatch_round_status: DispatchRoundStatus;
      // Phase 7 PR 1 §4: ADD VALUE 'cancelled' (admin /
      // operator-initiated, distinct from 'expired' which is
      // window-elapsed).
      empty_leg_status: EmptyLegStatus;
      addon_type: AddonTypeValue;
      addon_status: AddonStatusValue;
      medevac_service_level: 'BMT' | 'ALS' | 'CCT' | 'repatriation';
      medevac_severity: 'stable' | 'moderate' | 'critical';
      medevac_status:
        | 'received'
        | 'dispatched'
        | 'in_transit'
        | 'delivered'
        | 'cancelled';
      cargo_type: 'equine' | 'automotive' | 'high_value' | 'time_critical';
      cargo_status:
        | 'inquiry'
        | 'quoted'
        | 'confirmed'
        | 'in_transit'
        | 'delivered';
      notification_type:
        | 'booking'
        | 'offer'
        | 'empty_leg'
        | 'payment'
        | 'loyalty'
        | 'marketing';
      notification_channel: 'in_app' | 'email' | 'sms' | 'whatsapp';
      subscription_plan: 'individual' | 'family' | 'vip_family' | 'diamond';
      subscription_status: 'pending' | 'active' | 'expired' | 'cancelled';
      loyalty_transaction_type:
        | 'earn'
        | 'redeem'
        | 'bonus'
        | 'referral'
        | 'expire';
      support_category:
        | 'booking'
        | 'payment'
        | 'refund'
        | 'complaint'
        | 'other';
      support_priority: 'low' | 'medium' | 'high' | 'urgent';
      support_status: 'open' | 'in_progress' | 'resolved' | 'closed';
      payment_method: 'apple_pay' | 'mada' | 'visa' | 'mastercard' | 'stc_pay';
      payment_status: 'initiated' | 'success' | 'failed' | 'refunded';
      lead_status: LeadStatus;
      lead_trip_type: LeadTripType;
    };
  };
};

export type UserRole = Database['public']['Enums']['user_role'];
export type LoyaltyTier = Database['public']['Enums']['loyalty_tier'];
export type TripType = Database['public']['Enums']['trip_type'];
export type AircraftCategory = Database['public']['Enums']['aircraft_category'];
