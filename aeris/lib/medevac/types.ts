/**
 * Phase 12 PR 1 — shared medevac type module.
 *
 * Hand-maintained until `npm run db:types` is wired to a real
 * Supabase project (same loose-cast pattern as Phase 11 cargo
 * lib/cargo/types.ts). Mirrors the SQL migration
 * 20260520000040_phase_12_pr_1_medevac_intake.sql.
 *
 * Once db:types runs against the live schema, the
 * MedevacRequestRow / MedevacOfferRow / etc. interfaces below
 * should be replaced by re-exports from `@/types/database`
 * — same migration path Phase 11 cargo will follow when its
 * tables make it into database.ts.
 */

// ============================================================
// ENUMs (7) — mirror §3.1 ENUM definitions
// ============================================================

export type MedevacSeverity = 'stable' | 'moderate' | 'critical';

export type MedevacServiceLevel =
  | 'BMT'
  | 'ALS'
  | 'CCT'
  | 'repatriation';

export type MedevacRequestStatus =
  | 'pending'
  | 'offers_received'
  | 'accepted'
  | 'covered'
  | 'cancelled'
  | 'expired';

export type MedevacOfferStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired';

export type AerisShieldPlan =
  | 'individual'
  | 'family'
  | 'vip_family'
  | 'diamond';

export type AerisShieldSubscriptionStatus =
  | 'pending_payment'
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'suspended';

export type MedicalCertifyingAuthority =
  | 'SCFHS'
  | 'civil_aviation_authority'
  | 'foreign_equivalent'
  | 'other';

// ============================================================
// medevac_requests (§3.1)
// ============================================================

export interface MedevacRequestRow {
  id: string;
  medevac_request_number: string;
  client_id: string | null;
  patient_name_snapshot: string;
  patient_age_snapshot: number | null;
  contact_name_snapshot: string;
  contact_phone_snapshot: string;
  contact_email_snapshot: string | null;
  condition_severity: MedevacSeverity;
  service_level: MedevacServiceLevel;
  from_location_freeform: string;
  from_iata: string | null;
  to_hospital_name: string;
  to_hospital_contact_phone: string | null;
  to_hospital_freeform_address: string | null;
  to_iata: string | null;
  insurance_provider_snapshot: string | null;
  insurance_claim_ref: string | null;
  estimated_value_sar: string; // numeric — string via PostgREST
  subscription_id: string | null;
  is_covered: boolean;
  status: MedevacRequestStatus;
  expires_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  accepted_offer_id: string | null;
  dispatched_at: string | null;
  sla_escalated_at: string | null;
  handling_notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Redacted projection for admin list/index views (D8). NEVER
 * carries patient_name_snapshot OR patient_age_snapshot —
 * those PII columns are admin-detail-only and require the
 * audited §4.10 RPC path.
 */
export interface MedevacRequestRedactedRow {
  id: string;
  medevac_request_number: string;
  condition_severity: MedevacSeverity;
  service_level: MedevacServiceLevel;
  from_location_freeform: string;
  from_iata: string | null;
  to_hospital_name: string;
  to_iata: string | null;
  status: MedevacRequestStatus;
  is_covered: boolean;
  estimated_value_sar: string;
  dispatched_at: string | null;
  sla_escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// medevac_offers (§3.2)
// ============================================================

export interface MedevacOfferRow {
  id: string;
  medevac_request_id: string;
  operator_id: string;
  aircraft_id: string;
  operator_name_snapshot: string;
  operator_phone_snapshot: string;
  operator_email_snapshot: string;
  aircraft_snapshot: string | null;
  medical_team_snapshot: string | null;
  base_price_sar: string;
  medical_team_price_sar: string;
  insurance_coordination_price_sar: string;
  total_price_sar: string;
  proposed_pickup_at: string;
  proposed_arrival_at: string;
  operator_notes: string | null;
  decline_reason: string | null;
  withdraw_reason: string | null;
  status: MedevacOfferStatus;
  expires_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// aircraft_medical_certifications (§3.5)
// ============================================================

/**
 * Round 3 PR #76 P1 #1 fix — column names lowercased here so
 * PostgREST JSON keys match the actual Postgres column names.
 * Unquoted SQL identifiers like `supports_BMT` are folded to
 * `supports_bmt` by Postgres at DDL time, so the upsert
 * payload + select projection MUST use lowercase. Mismatched
 * keys were silently dropped by PostgREST so the cert matrix
 * editor couldn't seed any capabilities.
 *
 * Aliased TS shape (PascalCase) at the form layer is
 * acceptable for the UI vocabulary, but everything that
 * touches the wire (DB + RPC + Server Action payload) MUST
 * use the lowercase form below.
 */
export interface AircraftMedicalCertificationRow {
  aircraft_id: string;
  supports_bmt: boolean;
  supports_als: boolean;
  supports_cct: boolean;
  supports_repatriation: boolean;
  certifying_authority: MedicalCertifyingAuthority;
  certification_number: string | null;
  certification_expires_at: string;
  warning_30d_sent_at: string | null;
  warning_14d_sent_at: string | null;
  warning_7d_sent_at: string | null;
  warning_1d_sent_at: string | null;
  notes: string | null;
  updated_at: string;
}

// ============================================================
// medevac_severity_sla lookup (§3.6)
// ============================================================

export interface MedevacSeveritySlaRow {
  severity: MedevacSeverity;
  sla_interval: string; // INTERVAL — string via PostgREST
  updated_at: string;
}

// ============================================================
// medevac_subscription_plan_terms (§3.7)
// ============================================================

export interface MedevacSubscriptionPlanTermsRow {
  plan: AerisShieldPlan;
  annual_fee_sar: string;
  covered_events: number; // -1 = unlimited (diamond)
  service_level: MedevacServiceLevel;
  includes_repatriation: boolean;
  max_covered_members: number;
  description: string | null;
  updated_at: string;
}

// ============================================================
// medevac_subscriptions (§3.7)
// ============================================================

export interface CoveredMember {
  name: string;
  relationship: string;
  dob: string; // ISO yyyy-mm-dd
}

export interface MedevacSubscriptionRow {
  id: string;
  subscription_number: string;
  client_id: string;
  plan: AerisShieldPlan;
  annual_fee_at_signup_sar: string;
  covered_events_at_signup: number;
  service_level_at_signup: MedevacServiceLevel;
  includes_repatriation_at_signup: boolean;
  max_covered_members_at_signup: number;
  covered_members: CoveredMember[];
  used_events: number;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  status: AerisShieldSubscriptionStatus;
  payment_token_hash: string | null;
  last_renewal_at: string | null;
  next_renewal_due: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// aeris_shield_config (§3.8)
// ============================================================

export interface AerisShieldConfigRow {
  id: 1;
  default_operator_id: string | null;
  founder_notification_email: string | null;
  updated_at: string;
}

// ============================================================
// medevac_email_alert_status (§3.9)
// ============================================================

export type MedevacEmailAlertStatusValue =
  | 'healthy'
  | 'config_missing'
  | 'send_failed';

export interface MedevacEmailAlertStatusRow {
  id: 1;
  status: MedevacEmailAlertStatusValue;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
}

// ============================================================
// RPC return-shape helpers
// ============================================================

export interface RpcOk<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  [k: string]: unknown;
}

export interface RpcErr {
  ok: false;
  error: string;
  [k: string]: unknown;
}

export type RpcResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | RpcOk<T>
  | RpcErr;
