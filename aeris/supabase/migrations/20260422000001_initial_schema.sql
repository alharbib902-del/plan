-- ============================================
-- AERIS — Initial Database Schema
-- Migration: 20260422000001
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE user_role AS ENUM ('client', 'operator', 'admin', 'support');
CREATE TYPE loyalty_tier AS ENUM ('silver', 'gold', 'platinum', 'diamond');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');

CREATE TYPE operator_status AS ENUM ('pending', 'approved', 'suspended');
CREATE TYPE aircraft_category AS ENUM ('light', 'mid', 'super_mid', 'heavy', 'long_range');
CREATE TYPE aircraft_status AS ENUM ('active', 'maintenance', 'retired');
CREATE TYPE crew_role AS ENUM ('captain', 'first_officer', 'flight_attendant');

CREATE TYPE trip_type AS ENUM ('charter', 'empty_leg', 'medevac', 'cargo');
CREATE TYPE trip_request_status AS ENUM ('pending', 'distributed', 'offered', 'booked', 'cancelled');
CREATE TYPE offer_status AS ENUM ('pending', 'viewed', 'accepted', 'rejected', 'expired');
CREATE TYPE booking_payment_status AS ENUM ('pending', 'paid', 'refunded');
CREATE TYPE booking_flight_status AS ENUM ('confirmed', 'boarding', 'in_flight', 'completed', 'cancelled');

CREATE TYPE empty_leg_status AS ENUM ('available', 'reserved', 'sold', 'expired');
CREATE TYPE addon_type AS ENUM ('ground_transfer', 'crew', 'catering', 'special');
CREATE TYPE addon_status AS ENUM ('pending', 'confirmed', 'delivered', 'cancelled');

CREATE TYPE medevac_service_level AS ENUM ('BMT', 'ALS', 'CCT', 'repatriation');
CREATE TYPE medevac_severity AS ENUM ('stable', 'moderate', 'critical');
CREATE TYPE medevac_status AS ENUM ('received', 'dispatched', 'in_transit', 'delivered', 'cancelled');

CREATE TYPE cargo_type AS ENUM ('equine', 'automotive', 'high_value', 'time_critical');
CREATE TYPE cargo_status AS ENUM ('inquiry', 'quoted', 'confirmed', 'in_transit', 'delivered');

CREATE TYPE subscription_plan AS ENUM ('individual', 'family', 'vip_family', 'diamond');
CREATE TYPE subscription_status AS ENUM ('pending', 'active', 'expired', 'cancelled');

CREATE TYPE notification_type AS ENUM ('booking', 'offer', 'empty_leg', 'payment', 'loyalty', 'marketing');
CREATE TYPE notification_channel AS ENUM ('in_app', 'email', 'sms', 'whatsapp');

CREATE TYPE loyalty_transaction_type AS ENUM ('earn', 'redeem', 'bonus', 'referral', 'expire');

CREATE TYPE support_category AS ENUM ('booking', 'payment', 'refund', 'complaint', 'other');
CREATE TYPE support_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE support_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

CREATE TYPE payment_method AS ENUM ('apple_pay', 'mada', 'visa', 'mastercard', 'stc_pay');
CREATE TYPE payment_status AS ENUM ('initiated', 'success', 'failed', 'refunded');

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_request_number(prefix TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN prefix || '-' ||
    to_char(NOW(), 'YYMMDD') ||
    upper(substring(md5(random()::text) from 1 for 4));
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- USERS
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE,
  full_name VARCHAR(200) NOT NULL,
  role user_role NOT NULL DEFAULT 'client',
  language VARCHAR(5) DEFAULT 'ar',
  avatar_url TEXT,
  nationality VARCHAR(50),
  date_of_birth DATE,
  loyalty_tier loyalty_tier DEFAULT 'silver',
  loyalty_points INTEGER DEFAULT 0 CHECK (loyalty_points >= 0),
  total_spent_yearly DECIMAL(12,2) DEFAULT 0,
  total_spent_lifetime DECIMAL(14,2) DEFAULT 0,
  preferences JSONB DEFAULT '{}'::jsonb,
  passport_number TEXT, -- encrypted via pgcrypto
  referral_code VARCHAR(10) UNIQUE DEFAULT upper(substring(md5(random()::text) from 1 for 8)),
  referred_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_verified BOOLEAN DEFAULT false,
  status user_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_loyalty_tier ON users(loyalty_tier);
CREATE INDEX idx_users_referral_code ON users(referral_code);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- AIRPORTS (Reference Data)
-- ============================================

CREATE TABLE airports (
  iata_code VARCHAR(3) PRIMARY KEY,
  icao_code VARCHAR(4) UNIQUE,
  name VARCHAR(200) NOT NULL,
  name_ar VARCHAR(200),
  city VARCHAR(100) NOT NULL,
  city_ar VARCHAR(100),
  country VARCHAR(100) NOT NULL,
  country_ar VARCHAR(100),
  latitude DECIMAL(10,6),
  longitude DECIMAL(10,6),
  timezone VARCHAR(50),
  is_private_capable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_airports_city ON airports(city);
CREATE INDEX idx_airports_country ON airports(country);

-- ============================================
-- OPERATORS
-- ============================================

CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(200) NOT NULL,
  company_name_ar VARCHAR(200),
  commercial_registration VARCHAR(50) NOT NULL,
  vat_number VARCHAR(20),
  gaca_license VARCHAR(100) NOT NULL,
  license_expiry DATE NOT NULL,
  base_airport VARCHAR(10) REFERENCES airports(iata_code),
  operating_airports TEXT[] DEFAULT ARRAY[]::TEXT[],
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  bank_iban VARCHAR(50),
  bank_name VARCHAR(100),
  commission_rate DECIMAL(4,2) DEFAULT 8.0 CHECK (commission_rate >= 0 AND commission_rate <= 50),
  rating DECIMAL(3,2) DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  total_trips INTEGER DEFAULT 0,
  response_time_avg INTEGER, -- minutes
  documents_urls JSONB DEFAULT '[]'::jsonb,
  status operator_status DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_operators_user_id ON operators(user_id);
CREATE INDEX idx_operators_status ON operators(status);
CREATE INDEX idx_operators_rating ON operators(rating DESC);

CREATE TRIGGER operators_updated_at BEFORE UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- AIRCRAFT
-- ============================================

CREATE TABLE aircraft (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  registration VARCHAR(20) UNIQUE NOT NULL,
  manufacturer VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  category aircraft_category NOT NULL,
  year INTEGER CHECK (year >= 1960 AND year <= EXTRACT(YEAR FROM NOW()) + 1),
  max_passengers INTEGER NOT NULL CHECK (max_passengers > 0),
  max_range_km INTEGER CHECK (max_range_km > 0),
  cabin_config JSONB DEFAULT '{}'::jsonb,
  photos TEXT[] DEFAULT ARRAY[]::TEXT[],
  base_hourly_rate DECIMAL(10,2) NOT NULL CHECK (base_hourly_rate > 0),
  amenities JSONB DEFAULT '{}'::jsonb,
  is_cargo_capable BOOLEAN DEFAULT false,
  is_medevac_capable BOOLEAN DEFAULT false,
  status aircraft_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_aircraft_operator ON aircraft(operator_id);
CREATE INDEX idx_aircraft_category ON aircraft(category);
CREATE INDEX idx_aircraft_status ON aircraft(status);

CREATE TRIGGER aircraft_updated_at BEFORE UPDATE ON aircraft
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- CREW MEMBERS
-- ============================================

CREATE TABLE crew_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  role crew_role NOT NULL,
  nationality VARCHAR(50),
  languages TEXT[] DEFAULT ARRAY[]::TEXT[],
  specializations TEXT[] DEFAULT ARRAY[]::TEXT[],
  experience_hours INTEGER DEFAULT 0,
  license_number VARCHAR(100),
  license_expiry DATE,
  photo_url TEXT,
  is_available BOOLEAN DEFAULT true,
  extra_fee DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crew_operator ON crew_members(operator_id);
CREATE INDEX idx_crew_role ON crew_members(role);
CREATE INDEX idx_crew_availability ON crew_members(is_available) WHERE is_available = true;

CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON crew_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- TRIP REQUESTS
-- ============================================

CREATE TABLE trip_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('AER'),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_type trip_type NOT NULL DEFAULT 'charter',
  legs JSONB NOT NULL, -- Array of { from, to, date, time }
  departure_airport VARCHAR(10) REFERENCES airports(iata_code),
  arrival_airport VARCHAR(10) REFERENCES airports(iata_code),
  departure_date TIMESTAMPTZ NOT NULL,
  return_date TIMESTAMPTZ,
  is_flexible_date BOOLEAN DEFAULT false,
  passengers_count INTEGER NOT NULL CHECK (passengers_count > 0 AND passengers_count <= 19),
  aircraft_category_preference aircraft_category,
  special_requests TEXT,
  preferences JSONB DEFAULT '{}'::jsonb,
  status trip_request_status DEFAULT 'pending',
  distributed_to UUID[] DEFAULT ARRAY[]::UUID[], -- operator IDs
  distributed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trip_requests_client ON trip_requests(client_id, created_at DESC);
CREATE INDEX idx_trip_requests_status ON trip_requests(status, created_at DESC);
CREATE INDEX idx_trip_requests_departure ON trip_requests(departure_date);

CREATE TRIGGER trip_requests_updated_at BEFORE UPDATE ON trip_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- OFFERS
-- ============================================

CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id UUID NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  aircraft_id UUID NOT NULL REFERENCES aircraft(id),
  crew_ids UUID[] DEFAULT ARRAY[]::UUID[],
  base_price DECIMAL(12,2) NOT NULL CHECK (base_price > 0),
  vat_amount DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(12,2) NOT NULL,
  match_score INTEGER CHECK (match_score >= 0 AND match_score <= 100),
  cancellation_policy JSONB DEFAULT '{}'::jsonb,
  validity_minutes INTEGER DEFAULT 120,
  notes TEXT,
  status offer_status DEFAULT 'pending',
  viewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offers_trip_request ON offers(trip_request_id);
CREATE INDEX idx_offers_operator ON offers(operator_id);
CREATE INDEX idx_offers_status ON offers(status);
CREATE INDEX idx_offers_match_score ON offers(match_score DESC);

CREATE TRIGGER offers_updated_at BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- BOOKINGS
-- ============================================

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('AER-B'),
  offer_id UUID REFERENCES offers(id),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  aircraft_id UUID NOT NULL REFERENCES aircraft(id),
  base_amount DECIMAL(12,2) NOT NULL CHECK (base_amount > 0),
  addons_amount DECIMAL(12,2) DEFAULT 0,
  vat_amount DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  commission_amount DECIMAL(12,2) NOT NULL,
  operator_payout DECIMAL(12,2) NOT NULL,
  payment_status booking_payment_status DEFAULT 'pending',
  flight_status booking_flight_status DEFAULT 'confirmed',
  zatca_invoice_url TEXT,
  zatca_qr_code TEXT,
  zatca_uuid VARCHAR(100),
  departure_scheduled TIMESTAMPTZ NOT NULL,
  departure_actual TIMESTAMPTZ,
  arrival_actual TIMESTAMPTZ,
  loyalty_points_earned INTEGER DEFAULT 0,
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_client ON bookings(client_id, created_at DESC);
CREATE INDEX idx_bookings_operator ON bookings(operator_id, flight_status);
CREATE INDEX idx_bookings_payment ON bookings(payment_status);
CREATE INDEX idx_bookings_flight ON bookings(flight_status);
CREATE INDEX idx_bookings_departure ON bookings(departure_scheduled);

CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- BOOKING ADDONS
-- ============================================

CREATE TABLE booking_addons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_type addon_type NOT NULL,
  addon_subtype VARCHAR(100) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  commission_rate DECIMAL(4,2) DEFAULT 0,
  supplier_id UUID,
  status addon_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_booking_addons_booking ON booking_addons(booking_id);
CREATE INDEX idx_booking_addons_type ON booking_addons(addon_type);

-- ============================================
-- EMPTY LEGS
-- ============================================

CREATE TABLE empty_legs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leg_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('EL'),
  parent_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  aircraft_id UUID NOT NULL REFERENCES aircraft(id),
  departure_airport VARCHAR(10) NOT NULL REFERENCES airports(iata_code),
  arrival_airport VARCHAR(10) NOT NULL REFERENCES airports(iata_code),
  departure_window_start TIMESTAMPTZ NOT NULL,
  departure_window_end TIMESTAMPTZ NOT NULL,
  flexibility_hours INTEGER DEFAULT 3,
  original_price DECIMAL(12,2) NOT NULL,
  current_discount_pct DECIMAL(4,2) DEFAULT 40 CHECK (current_discount_pct >= 0 AND current_discount_pct <= 90),
  current_price DECIMAL(12,2) NOT NULL,
  max_passengers INTEGER NOT NULL,
  status empty_leg_status DEFAULT 'available',
  views_count INTEGER DEFAULT 0,
  notifications_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_empty_legs_status ON empty_legs(status, departure_window_start)
  WHERE status = 'available';
CREATE INDEX idx_empty_legs_operator ON empty_legs(operator_id);
CREATE INDEX idx_empty_legs_airports ON empty_legs(departure_airport, arrival_airport);

CREATE TRIGGER empty_legs_updated_at BEFORE UPDATE ON empty_legs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- PAYMENTS
-- ============================================

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) DEFAULT 'SAR',
  payment_method payment_method NOT NULL,
  gateway VARCHAR(50) DEFAULT 'hyperpay',
  gateway_transaction_id VARCHAR(200),
  status payment_status DEFAULT 'initiated',
  gateway_response JSONB,
  fee_amount DECIMAL(10,2) DEFAULT 0,
  refund_amount DECIMAL(12,2) DEFAULT 0,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_gateway_txn ON payments(gateway_transaction_id);

CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- LOYALTY TRANSACTIONS
-- ============================================

CREATE TABLE loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_type loyalty_transaction_type NOT NULL,
  points INTEGER NOT NULL,
  source_type VARCHAR(50),
  source_id UUID,
  description TEXT,
  multiplier DECIMAL(3,1) DEFAULT 1.0,
  balance_after INTEGER NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_loyalty_user ON loyalty_transactions(user_id, created_at DESC);
CREATE INDEX idx_loyalty_type ON loyalty_transactions(transaction_type);

-- ============================================
-- REVIEWS
-- ============================================

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  aircraft_id UUID REFERENCES aircraft(id) ON DELETE SET NULL,
  overall_rating INTEGER NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
  aircraft_rating INTEGER CHECK (aircraft_rating >= 1 AND aircraft_rating <= 5),
  crew_rating INTEGER CHECK (crew_rating >= 1 AND crew_rating <= 5),
  service_rating INTEGER CHECK (service_rating >= 1 AND service_rating <= 5),
  comment TEXT,
  is_verified BOOLEAN DEFAULT true,
  is_published BOOLEAN DEFAULT true,
  response TEXT,
  response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_operator ON reviews(operator_id, created_at DESC);
CREATE INDEX idx_reviews_aircraft ON reviews(aircraft_id);
CREATE INDEX idx_reviews_rating ON reviews(overall_rating DESC);

CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  channel notification_channel NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, sent_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- ============================================
-- MEDEVAC REQUESTS
-- ============================================

CREATE TABLE medevac_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('MEV'),
  client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subscription_id UUID, -- Will reference medevac_subscriptions later
  patient_name VARCHAR(200) NOT NULL,
  patient_age INTEGER,
  condition_severity medevac_severity NOT NULL,
  service_level medevac_service_level NOT NULL,
  from_location VARCHAR(300) NOT NULL,
  to_hospital VARCHAR(300) NOT NULL,
  hospital_contact VARCHAR(100),
  insurance_provider VARCHAR(100),
  insurance_claim_ref VARCHAR(100),
  estimated_cost DECIMAL(12,2),
  final_cost DECIMAL(12,2),
  status medevac_status DEFAULT 'received',
  response_time_minutes INTEGER,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_medevac_client ON medevac_requests(client_id);
CREATE INDEX idx_medevac_status ON medevac_requests(status);
CREATE INDEX idx_medevac_severity ON medevac_requests(condition_severity);

CREATE TRIGGER medevac_requests_updated_at BEFORE UPDATE ON medevac_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- MEDEVAC SUBSCRIPTIONS (Aeris Shield)
-- ============================================

CREATE TABLE medevac_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('SHIELD'),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan subscription_plan NOT NULL,
  covered_members JSONB DEFAULT '[]'::jsonb,
  annual_fee DECIMAL(10,2) NOT NULL,
  covered_events INTEGER NOT NULL,
  used_events INTEGER DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  auto_renew BOOLEAN DEFAULT true,
  status subscription_status DEFAULT 'pending',
  payment_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_client ON medevac_subscriptions(client_id);
CREATE INDEX idx_subscriptions_status ON medevac_subscriptions(status);

CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON medevac_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add FK back to medevac_requests
ALTER TABLE medevac_requests
  ADD CONSTRAINT fk_medevac_subscription
  FOREIGN KEY (subscription_id) REFERENCES medevac_subscriptions(id) ON DELETE SET NULL;

-- ============================================
-- CARGO REQUESTS
-- ============================================

CREATE TABLE cargo_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('CGO'),
  client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cargo_type cargo_type NOT NULL,
  cargo_subtype VARCHAR(100),
  cargo_description TEXT,
  estimated_value DECIMAL(15,2),
  weight_kg DECIMAL(10,2),
  dimensions JSONB,
  pickup_location VARCHAR(300),
  delivery_location VARCHAR(300),
  preferred_date DATE,
  insurance_required BOOLEAN DEFAULT false,
  special_requirements TEXT,
  photos_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  estimated_cost DECIMAL(12,2),
  final_cost DECIMAL(12,2),
  status cargo_status DEFAULT 'inquiry',
  assigned_to UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cargo_client ON cargo_requests(client_id);
CREATE INDEX idx_cargo_type ON cargo_requests(cargo_type);
CREATE INDEX idx_cargo_status ON cargo_requests(status);

CREATE TRIGGER cargo_requests_updated_at BEFORE UPDATE ON cargo_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- SUPPORT TICKETS
-- ============================================

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('TKT'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  category support_category NOT NULL,
  priority support_priority DEFAULT 'medium',
  subject VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  status support_status DEFAULT 'open',
  assigned_to UUID REFERENCES users(id),
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_support_user ON support_tickets(user_id, created_at DESC);
CREATE INDEX idx_support_status ON support_tickets(status);
CREATE INDEX idx_support_priority ON support_tickets(priority);

CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- AUDIT LOGS
-- ============================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE aircraft ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE empty_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medevac_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE medevac_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Airports are public (read-only for all authenticated users)
ALTER TABLE airports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "airports_public_read" ON airports FOR SELECT USING (true);

-- Users: can see/update their own profile
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (auth.uid() = id);

-- Bookings: client sees own, operator sees their bookings
CREATE POLICY "bookings_select_client" ON bookings FOR SELECT
  USING (client_id = auth.uid());
CREATE POLICY "bookings_select_operator" ON bookings FOR SELECT
  USING (operator_id IN (SELECT id FROM operators WHERE user_id = auth.uid()));

-- Trip Requests: client sees own
CREATE POLICY "trip_requests_select_own" ON trip_requests FOR SELECT
  USING (client_id = auth.uid());
CREATE POLICY "trip_requests_insert_own" ON trip_requests FOR INSERT
  WITH CHECK (client_id = auth.uid());

-- Empty Legs: visible to all authenticated users (marketplace)
CREATE POLICY "empty_legs_public_available" ON empty_legs FOR SELECT
  USING (status = 'available' OR
    operator_id IN (SELECT id FROM operators WHERE user_id = auth.uid()));

-- Notifications: users see own
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  USING (user_id = auth.uid());

-- NOTE: Admin policies will be added separately using the is_admin() function

-- ============================================
-- HELPER FUNCTIONS FOR ADMIN
-- ============================================

CREATE OR REPLACE FUNCTION is_admin(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users WHERE id = user_id AND role IN ('admin', 'support')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SEED DATA: Major Saudi Airports
-- ============================================

INSERT INTO airports (iata_code, icao_code, name, name_ar, city, city_ar, country, country_ar, latitude, longitude, timezone) VALUES
  ('RUH', 'OERK', 'King Khalid International Airport', 'مطار الملك خالد الدولي', 'Riyadh', 'الرياض', 'Saudi Arabia', 'المملكة العربية السعودية', 24.9576, 46.6988, 'Asia/Riyadh'),
  ('JED', 'OEJN', 'King Abdulaziz International Airport', 'مطار الملك عبدالعزيز الدولي', 'Jeddah', 'جدة', 'Saudi Arabia', 'المملكة العربية السعودية', 21.6796, 39.1565, 'Asia/Riyadh'),
  ('DMM', 'OEDF', 'King Fahd International Airport', 'مطار الملك فهد الدولي', 'Dammam', 'الدمام', 'Saudi Arabia', 'المملكة العربية السعودية', 26.4712, 49.7979, 'Asia/Riyadh'),
  ('MED', 'OEMA', 'Prince Mohammad Bin Abdulaziz Airport', 'مطار الأمير محمد بن عبدالعزيز', 'Medina', 'المدينة المنورة', 'Saudi Arabia', 'المملكة العربية السعودية', 24.5534, 39.7051, 'Asia/Riyadh'),
  ('TUU', 'OETB', 'Tabuk Regional Airport', 'مطار تبوك الإقليمي', 'Tabuk', 'تبوك', 'Saudi Arabia', 'المملكة العربية السعودية', 28.3654, 36.6189, 'Asia/Riyadh'),
  ('NUM', 'OENG', 'NEOM Bay Airport', 'مطار نيوم', 'NEOM', 'نيوم', 'Saudi Arabia', 'المملكة العربية السعودية', 27.9, 35.0, 'Asia/Riyadh'),
  ('AHB', 'OEAB', 'Abha International Airport', 'مطار أبها الدولي', 'Abha', 'أبها', 'Saudi Arabia', 'المملكة العربية السعودية', 18.2364, 42.6566, 'Asia/Riyadh'),
  ('DXB', 'OMDB', 'Dubai International Airport', 'مطار دبي الدولي', 'Dubai', 'دبي', 'UAE', 'الإمارات العربية المتحدة', 25.2532, 55.3657, 'Asia/Dubai'),
  ('AUH', 'OMAA', 'Abu Dhabi International Airport', 'مطار أبوظبي الدولي', 'Abu Dhabi', 'أبوظبي', 'UAE', 'الإمارات العربية المتحدة', 24.4330, 54.6511, 'Asia/Dubai'),
  ('DOH', 'OTHH', 'Hamad International Airport', 'مطار حمد الدولي', 'Doha', 'الدوحة', 'Qatar', 'قطر', 25.2609, 51.6138, 'Asia/Qatar'),
  ('KWI', 'OKBK', 'Kuwait International Airport', 'مطار الكويت الدولي', 'Kuwait City', 'مدينة الكويت', 'Kuwait', 'الكويت', 29.2266, 47.9689, 'Asia/Kuwait'),
  ('BAH', 'OBBI', 'Bahrain International Airport', 'مطار البحرين الدولي', 'Manama', 'المنامة', 'Bahrain', 'البحرين', 26.2708, 50.6336, 'Asia/Bahrain');

-- ============================================
-- END OF MIGRATION
-- ============================================

COMMENT ON DATABASE postgres IS 'Aeris - Smart Private Aviation Platform';
