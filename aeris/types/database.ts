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
  departure_date: string;
  return_date: string | null;
  passengers: number;
  notes: string | null;
  source?: string;
};

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
  from: string;
  to: string;
  date: string;
  time: string | null;
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

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
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
