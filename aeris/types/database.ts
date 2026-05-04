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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
    Enums: {
      user_role: 'client' | 'operator' | 'admin' | 'support';
      loyalty_tier: 'silver' | 'gold' | 'platinum' | 'diamond';
      user_status: 'active' | 'suspended' | 'deleted';
      trip_type: 'charter' | 'empty_leg' | 'medevac' | 'cargo';
      booking_payment_status: 'pending' | 'paid' | 'refunded';
      booking_flight_status:
        | 'confirmed'
        | 'boarding'
        | 'in_flight'
        | 'completed'
        | 'cancelled';
      aircraft_category: 'light' | 'mid' | 'super_mid' | 'heavy' | 'long_range';
      aircraft_status: 'active' | 'maintenance' | 'retired';
      crew_role: 'captain' | 'first_officer' | 'flight_attendant';
      offer_status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
      operator_status: 'pending' | 'approved' | 'suspended';
      trip_request_status:
        | 'pending'
        | 'distributed'
        | 'offered'
        | 'booked'
        | 'cancelled';
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
