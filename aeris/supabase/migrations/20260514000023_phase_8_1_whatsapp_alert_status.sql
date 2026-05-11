-- ============================================================
-- Phase 8.1 — WhatsApp delivery alert status
--
-- Extends the singleton operator_notification_alert_status row
-- (created in 20260512000020 §3.10) with three WhatsApp-side
-- columns. The existing `status` column tracks Resend email
-- health; the new `whatsapp_status` column tracks the parallel
-- wasenderapi.com channel introduced in Phase 8.1.
--
-- Two channels degrade independently. Admin banner in
-- /admin/operators surfaces both states so the founder can
-- triage:
--   - email_status='healthy', whatsapp_status='config_missing'
--     → operators still get welcome/reset email; founder needs
--     to set WASENDER_API_KEY to restore WhatsApp.
--   - email_status='send_failed', whatsapp_status='healthy'
--     → email outage; WhatsApp is the fallback channel and
--     the magic link still reaches the operator.
--
-- whatsapp_status enum is intentionally wider than the email
-- enum: it includes 'rate_limited' because the wasender trial
-- enforces a 1 msg/min cap that email does not have. The
-- provider's in-memory rate-limit guard returns 'rate_limited'
-- without calling the API, preserving trial budget; this
-- migration records that state alongside genuine 4xx/5xx
-- failures so the founder can distinguish "we throttled
-- ourselves" from "wasender rejected".
-- ============================================================

ALTER TABLE operator_notification_alert_status
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (whatsapp_status IN ('healthy', 'config_missing', 'send_failed', 'rate_limited')),
  ADD COLUMN IF NOT EXISTS whatsapp_last_failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_last_failure_reason TEXT;

-- The seed row from §3.10 already exists (id=1). The new
-- columns inherit DEFAULT 'healthy' on existing rows, so no
-- backfill is required. Defensive UPDATE in case a deployment
-- predates this migration on a partially-seeded environment.
UPDATE operator_notification_alert_status
   SET whatsapp_status = COALESCE(whatsapp_status, 'healthy')
 WHERE id = 1;
