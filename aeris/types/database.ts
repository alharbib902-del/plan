/**
 * Supabase Database Types
 *
 * Hand-maintained until `npm run db:types` is wired to a real Supabase
 * project. Mirrors the SQL migrations under `supabase/migrations/`.
 */

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
  preferences: Record<string, unknown> | null;
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
  | { ok: true; trip_request_id: string }
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
    };
    CompositeTypes: { [_ in never]: never };
    Enums: {
      user_role: 'client' | 'operator' | 'admin' | 'support';
      loyalty_tier: 'silver' | 'gold' | 'platinum' | 'diamond';
      user_status: 'active' | 'suspended' | 'deleted';
      trip_type: TripTypeValue;
      booking_payment_status: 'pending' | 'paid' | 'refunded';
      booking_flight_status:
        | 'confirmed'
        | 'boarding'
        | 'in_flight'
        | 'completed'
        | 'cancelled';
      aircraft_category: AircraftCategoryValue;
      aircraft_status: 'active' | 'maintenance' | 'retired';
      crew_role: 'captain' | 'first_officer' | 'flight_attendant';
      offer_status: OfferStatus;
      operator_status: 'pending' | 'approved' | 'suspended';
      trip_request_status: TripRequestStatus;
      // Phase 5
      dispatch_target_status: DispatchTargetStatus;
      dispatch_round_status: DispatchRoundStatus;
      empty_leg_status: 'available' | 'reserved' | 'sold' | 'expired';
      addon_type: 'ground_transfer' | 'crew' | 'catering' | 'special';
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
