# Phase 12 — MedEvac activation notes

> **Status:** Phase 12 activated on production `2026-05-18`.
> **Scope:** PR 1 (backend + intake + admin) + PR 2 (authed portal +
> offers + subscriptions) + PR 3 (distribution + cron + canary).
>
> This file documents the activation runbook execution across all
> 3 PRs + the end-to-end verification against real DB
> (Probes 33-40 inclusive).

---

## Timeline

| Step | Date | Reference |
|---|---|---|
| Phase 12 spec accepted at 100/100 (16 Codex rounds) | `2026-05-17` | PR #75 (merged `d5abe81` parent) |
| PR 1 (backend + intake + admin) merged | `2026-05-17` | PR #76 (merged `d5abe81`) |
| PR 2 (authed portal + offers + subs) merged | `2026-05-17` | PR #77 (merged `a4fc076`) |
| PR 3 (distribution + cron + canary) merged | `2026-05-17` | PR #78 (merged `32c30b7`) |
| Migrations applied to remote Supabase | `2026-05-18` | Via Supabase SQL Editor (replay-safe) |
| Probe 33 → 45/45 schema checks green | `2026-05-18` | Plus env-var check #46 verified manually |
| Production activation (`ENABLE_MEDEVAC=true`) | `2026-05-18` | Vercel env var flip + redeploy |
| End-to-end verification (Probes 34-40) | `2026-05-18` | All 7 probes passed |
| Test data cleanup + closure | `2026-05-18` | This file |

---

## Migrations applied to Supabase

1. **`20260520000040_phase_12_pr_1_medevac_intake.sql`** (~2000 lines)
   - 7 new ENUMs (`medevac_severity`, `medevac_service_level`,
     `medevac_request_status`, `medevac_offer_status`,
     `aeris_shield_plan`, `aeris_shield_subscription_status`,
     `medical_certifying_authority`).
   - 8 new tables/lookups/singletons: `medevac_requests`,
     `medevac_offers`, `aircraft_medical_certifications`,
     `medevac_severity_sla` (3-row seed), `medevac_subscription_plan_terms`
     (4-row seed), `medevac_subscriptions`, `aeris_shield_config`
     (1-row seed), `medevac_email_alert_status` (1-row seed).
   - 14 named CHECK + FK constraints (identity, severity gate,
     covered status equiv, covered has subscription, accepted link,
     value positive, cancellation reason length × 2,
     subscription_fkey ON DELETE RESTRICT, date order, active has
     dates, events within plan, bookings discriminator/offer
     extensions).
   - 1 consolidated trigger
     (`enforce_aircraft_medical_certifications_trigger`).
   - 8 named indexes (4 on `medevac_requests` + 2 on
     `medevac_offers` + 2 on `medevac_subscriptions`).
   - 6 RPCs + 1 helper function: `create_medevac_request_guest`,
     `create_medevac_request_authenticated`,
     `submit_medevac_offer`, `consume_aeris_shield_event`
     (note: physically in PR 2 migration per code, listed in PR 1
     inventory in spec §6 — implementation matters for testing),
     `subscribe_to_aeris_shield`,
     `admin_read_medevac_request_detail`, `safe_parse_date`
     (IMMUTABLE + PARALLEL SAFE).
   - RLS enabled on every new table/lookup/singleton.
2. **`20260526000041_phase_12_pr_2_medevac_offers_subs.sql`** (~700 lines)
   - 6 RPCs: `accept_medevac_offer`, `decline_medevac_offer`,
     `withdraw_medevac_offer`, `cancel_medevac_request`,
     `admin_activate_subscription`, `consume_aeris_shield_event`.
   - `bookings` financial column widening to `DECIMAL(14,2)` for
     medevac high-value covered events.
3. **`20260527000042_phase_12_pr_3_medevac_distribution.sql`** (302 lines)
   - 1 new table: `medevac_dispatch_events_outbox` with claim_id /
     claimed_at / processed_at / dispatch_result + 2 partial indexes.
   - 3 RPCs: `publish_medevac_dispatch_event`,
     `claim_medevac_dispatch_events`,
     `medevac_operator_last_dispatch_map`.
   - 1 AFTER INSERT trigger on `medevac_requests` filtering
     `is_covered = false` (covered J5 rows skip outbox per D6).
   - 1 new column: `medevac_requests.founder_batch_alerted_at`.

All migrations are replay-safe (Phase 9 convention): `DO $$ BEGIN
IF NOT EXISTS ... END $$` for ENUMs, `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
`ON CONFLICT (...) DO NOTHING` for seeds.

> **Spec→reality reconciliation noted during activation**:
> `medical_certifying_authority` is **4 labels** in the migration
> (`SCFHS`, `civil_aviation_authority`, `foreign_equivalent`,
> `other`), not 5 as spec §6 line 1796 claimed. The Probe 33
> verifier asserts the 4 actual labels.

---

## Probes results

### Probe 33 — Schema state (45 SQL checks + 1 env-var check)

Single SQL script (`D:/Plan/migration-runner/probe33.sql`) runs all
45 schema verifications. Final summary:

```
total | passed | failed | verdict
   45 |     45 |      0 | GREEN — proceed to step 3 (flip ENABLE_MEDEVAC=true).
                          Env check #46 verified separately.
```

Check #46 (`ADMIN_AUDIT_FINGERPRINT_SECRET` env var) verified
manually — exists on Vercel production + local `.env.local` with
64-hex-char value.

### Probe 34 — Guest stable medevac (3 parts)

**Part 1**: POST `/medevac` as anonymous guest, severity=`stable`,
service=`BMT`, route RUH→JED. → MEV-635c7b06 created, success page
shown with reference.

**Part 2**: Admin login → `/admin/medevac` shows MEV-635c7b06 row
with PII redacted (no patient_name in list view) ✓ (D8).

**Part 3**: Returning to `/medevac` as guest, the severity dropdown
is **locked on `مستقر` (stable)** — the UI hides `متوسطة` and
`حرجة` for guests (better UX than server-side rejection). ✓

### Probe 35 — Authed critical medevac

Signed in as `basem902@gmail.com` (existing Phase 9 client). Opened
`/me/medevac/new`. Severity dropdown showed **all 3 options**
(`مستقر`, `متوسط`, `حرج`) — confirming the authed path opens all
severities. Submitted MEV-8bbe1754 with severity=`حرج` (critical),
service=`CCT`, route RUH→JED, estimated_value=120,000 SAR.

`/me/medevac` lists the row with rose-tinted `حرج` chip ✓ (D9 rose
palette).

### Probe 36 — Operator offer → client accept → booking

Setup: created test aircraft `HZ-MEDEVAC-P36` for Probe 18 operator
+ medical certification (SCFHS, supports_bmt+als+cct=true,
expiry +6 months). Reset Probe 18 password to known temp value
(`TempP36-2026!`, bcrypt $2b$10$...).

Operator login at `/operator/login` → `/operator/medevac` showed
**2 open requests** (MEV-635c7b06 + MEV-8bbe1754) with PII hidden
("العرض هنا مُخفّى عن بيانات المريض") ✓ (D8 b).

The aircraft dropdown on `/operator/medevac/<id>/offer` showed
**HZ-MEDEVAC-P36 only** — confirming the D7/D11 cert capability
filter works (the aircraft is the only one with supports_cct=true
in the system).

Submitted offer for MEV-8bbe1754: base=60k + medical_team=15k +
insurance_coord=5k = **80,000 SAR total**, departure 1:00pm
Riyadh time, arrival 3:00pm.

Client returned to `/me/medevac/<id>`, saw the offer with status
"بانتظار قرارك" + accept button. Click "قبول" → atomic transition:
- medevac_request.status: `offers_received` → `accepted` ✓
- medevac_offer.status: `pending` → `accepted` ✓
- booking AER-B-260518F98B created with shape:

```
booking_number:              AER-B-260518F98B
source_discriminator:        medevac          ✓
source_offer_table:          medevac_offers   ✓ (out-of-pocket variant)
source_offer_id:             <UUID, NOT NULL> ✓
offer_id:                    NULL              ✓ (legacy column unused)
trip_request_id:             NULL              ✓ (medevac bypasses Phase 4-6 funnel)
total_amount:                80000.00          ✓
payment_status:              pending_offline   ✓ (payment-pluggable arch)
flight_status:               confirmed         ✓
customer_name_snapshot:      اختبار P35 - حالة حرجة  (= patient_name)
client_id:                   <UUID, NOT NULL> ✓
operator_id:                 <Probe 18 UUID>  ✓
```

`/me/bookings` shows the row with **rose** `إخلاء طبي` chip — the
visual palette differentiator from charter (gold) / empty-legs
(emerald) / cargo (slate) ✓ (D9).

### Probe 37 — Distribution + cert capability filter

3 outbox events queued from Probes 34-36 (MEV-635c7b06,
MEV-8bbe1754, MEV-ca4ed72b — the last one was an authed
out-of-pocket moderate, created by the client before checking the
Shield checkbox). MEV-4e516640 (covered) correctly **NOT in
outbox** — confirms PR 3 trigger filter `is_covered = false` ✓.

Manual cron trigger result:

```json
{
  "claimed": 3,
  "processed": 1,         // MEV-8bbe1754 (already accepted → request_not_actionable)
  "skipped_retry": 2,     // MEV-635c7b06 + MEV-ca4ed72b → retryable_failure
  "errors": 0,
  "summaries": [/* per-event details */]
}
```

For MEV-ca4ed72b + MEV-635c7b06, the per-event summaries showed:

```json
{
  "dispatched_operator_ids": [],
  "skipped_operator_ids": [
    "ea0a07c0-..." (Probe 14 — pre-existing, no medical cert),
    "182587d6-..." (Probe 18 — has cert)
  ],
  "skip_reasons": {
    "ea0a07c0-...": "no_capability",       // ✓ D7/D11 filter works
    "182587d6-...": "notify_failed"        // Resend not verified yet
  },
  "whatsapp_links": {
    "182587d6-...": "https://wa.me/...?text=..."   // ✓ fallback channel
  },
  "error": "retryable_failure",
  "retry_reason": "all_notifications_failed"  // ✓ R1 P1 #1 fix works
}
```

**Key invariants verified**:
1. Probe 14 (operator with aircraft but NO medical_cert) classified
   as `no_capability` ✓ — D7/D11 capability filter end-to-end.
2. Probe 18 (operator with valid CCT cert) passed capability filter
   but `notify_failed` because Resend domain not yet verified (Step
   5 deferred — see follow-ups below).
3. `wa.me` link generated for Probe 18 as fallback channel
   (PR #73 Round 1 P1 #3 — wa.me as audit metadata).
4. `retryable_failure` on all-notify-failed → R1 P1 #1 fix:
   the outbox row stays unprocessed, next cron tick retries.
5. `request_not_actionable` for MEV-8bbe1754 (status=accepted)
   correctly marks the row processed (no retry needed).

### Probe 38 — Aeris Shield covered event (J5 path)

Setup: client `basem902` subscribed to **Individual plan** (15k SAR
/year, 1 ALS event, owner = self with DOB 1975-01-17). Admin
activated subscription (`pending_payment` → `active`, start
2026-05-18, end 2027-05-18). Set
`aeris_shield_config.default_operator_id` to Probe 18.

Client returned to `/me/medevac/new`. The form now showed a
**new checkbox**: "استخدام حدث مغطّى من اشتراك Aeris Shield
(SHIELD-1bfe61e6)" — only visible when active subscription exists.

After checking the box, the form **revealed 2 additional fields**:
- اسم العضو المُغطّى (must match covered_members)
- تاريخ ميلاد العضو المُغطّى (must match)

→ D4 covered_member identity binding enforced at UI level.

Submitted MEV-4e516640 with covered_member name + DOB matching the
owner snapshot, severity=`متوسطة` (moderate), service=`ALS`,
route RUH→DMM, estimated_value=40,000 SAR.

Confirmation page showed:
> "تم استهلاك حدث Shield مغطّى. سيتواصل معك المشغل الافتراضي مباشرة."
> "الأحداث المتبقية: **0**"

DB verification of atomic transition:

| Object | Field | Value | ✓ |
|---|---|---|---|
| `medevac_request` MEV-4e516640 | status | `covered` | ✓ |
|   | is_covered | `true` | ✓ |
|   | subscription_id | <SHIELD-1bfe61e6 UUID> | ✓ |
| `medevac_subscription` SHIELD-1bfe61e6 | used_events | `1` | ✓ |
|   | remaining (= covered - used) | `0` | ✓ |
| `booking` AER-B-260518A940 | source_discriminator | `medevac` | ✓ |
|   | source_offer_table | **NULL** | ✓ (D6) |
|   | source_offer_id | **NULL** | ✓ (D6) |
|   | operator_id | <Probe 18 from `aeris_shield_config`> | ✓ |
|   | total_amount | `40000.00` | ✓ |

D6 covered-variant booking shape (both source pair NULL) confirmed
end-to-end — the J5 atomic flow works.

### Probe 39 — SLA escalation cron

Inserted MEV-P39TEST as backdated critical:

```
severity:            critical
service_level:       CCT
status:              pending
dispatched_at:       NOW() - INTERVAL '2 hours'   (past 1h critical SLA)
sla_escalated_at:    NULL
```

Manual cron trigger result:

```json
{
  "ok": true,
  "scanned": 1,
  "escalated": 0,
  "errors": 1,
  "escalations": []
}
```

DB verification immediately after:

| Field | Value |
|---|---|
| `status` | `pending` (unchanged) |
| `sla_escalated_at` | **NULL** ✓ — R2 F1 fix worked (unstamp on email failure) |
| `dispatched_at` | unchanged (still backdated for retry) |

**Why escalated=0 + errors=1**: the cron atomically claimed the row
(stamped `sla_escalated_at = NOW()`), then tried to send the founder
escalation email via Resend, which failed (Resend not verified —
same root cause as Probe 37 `notify_failed`). The **R2 F1 fix**
(Round 2 PR #78 P1 #1) detected the email failure and **rolled back
the stamp** so the next 5-min cron tick retries.

This is the critical insurance that the founder escalation cannot
be silently suppressed forever by a transient email outage —
verified live.

### Probe 40 — Expired cert removal cron

Setup: created test aircraft `HZ-MEDEVAC-P40` for Probe 18 (second
aircraft, keeping HZ-MEDEVAC-P36 valid for Probe 37). Inserted cert
with future expiry first (trigger blocks past on INSERT per Round 2
P2 #4 fix), then UPDATE to backdate
`certification_expires_at = NOW() - INTERVAL '1 day'` while keeping
supports_bmt + supports_als = true.

Manual cron trigger result:

```json
{
  "ok": true,
  "scanned": 2,             // HZ-MEDEVAC-P36 + HZ-MEDEVAC-P40
  "warnings_queued": 0,     // P36 expires +6mo, outside warning windows
  "enforcement_flipped": 1, // P40 flipped to all-supports-false
  "renewal_reset": 0,
  "errors": 0
}
```

DB verification:

| Aircraft | expires | supports_bmt | supports_als | supports_cct | all_flipped |
|---|---|---|---|---|---|
| HZ-MEDEVAC-P36 (valid) | +6mo | **true** | **true** | **true** | false ← selectivity ✓ |
| HZ-MEDEVAC-P40 (expired) | -1d | **false** | **false** | false | **true** ✓ |

**Selectivity confirmed** — the cron only flipped the expired
aircraft. The valid cert was unchanged.

---

## End-to-end activation order

1. ✅ Provision Vercel env vars: `ADMIN_AUDIT_FINGERPRINT_SECRET`
   (64 hex chars) + `ENABLE_MEDEVAC=false`.
2. ✅ Apply 3 Phase 12 migrations to remote Supabase via SQL
   Editor (PR 1 was already partially applied from earlier testing;
   the replay-safe DDL handled it gracefully; PR 2 + PR 3 applied
   fresh).
3. ✅ Probe 33 → 45/45 green + env-var check #46 manually verified.
4. ✅ Flip `ENABLE_MEDEVAC=true` on Vercel production + redeploy
   without build cache.
5. ✅ Smoke test routes:
   - `/medevac` → 200 (was 404)
   - `/me/medevac` → 307 → /login (auth gate works)
   - `/admin/medevac` → 307 → /admin/login (admin gate works)
   - `/api/cron/medevac/dispatch-drain` POST without auth → 401
   - cron route GET → 405
6. ✅ Probes 34, 35, 36, 38 (UI flows for guest + authed + offer +
   covered).
7. ✅ Probes 37, 39, 40 (cron triggers via Bearer CRON_SECRET).
8. ✅ Test data cleanup (DB returned to baseline; Probe 18 password
   randomized + password_must_change=true).
9. ⏳ Phase 12 closure (this file).

---

## Booking shape contracts (pinned for future code)

For ANY future code that touches `bookings` rows, medevac bookings
follow **2 distinct shapes** depending on the path:

### Out-of-pocket variant (Phase 12 §4.4 — accept_medevac_offer):

```
offer_id              = NULL
trip_request_id       = NULL
source_offer_table    = 'medevac_offers'
source_offer_id       = <UUID of accepted medevac_offer>
source_discriminator  = 'medevac'
client_id             = <UUID, NOT NULL>   (medevac always tied to client)
customer_name_snapshot = <patient_name>    (patient ≠ client owner sometimes)
operator_id           = <from accepted offer>
total_amount          = base + medical_team + insurance_coord
payment_status        = 'pending_offline'
flight_status         = 'confirmed'
```

### Covered variant — D6 J5 path (Phase 12 §4.7 — consume_aeris_shield_event):

```
offer_id              = NULL
trip_request_id       = NULL
source_offer_table    = NULL                ← D6 difference
source_offer_id       = NULL                ← D6 difference
source_discriminator  = 'medevac'
client_id             = <UUID, NOT NULL>
customer_name_snapshot = <patient_name>
operator_id           = <aeris_shield_config.default_operator_id>
total_amount          = <medevac_request.estimated_value_sar>
payment_status        = 'pending_offline'   (subscription pre-paid annually)
flight_status         = 'confirmed'
```

The Phase 6.2 `bookings_source_offer_pair_check` constraint
(`(source_offer_table IS NULL) = (source_offer_id IS NULL)`)
passes in both variants — out-of-pocket sets both NOT NULL, covered
sets both NULL.

---

## Outstanding follow-ups (deferred to ops or future PRs)

| # | Priority | Title | Notes |
|---|---|---|---|
| 1 | **P1** | **Resend domain verification (aeris.sa)** | Domain not yet purchased. All medevac emails (operator dispatch, founder SLA escalation, cert warnings, booking confirmations) currently `notify_failed` / `errors=1`. The `wa.me` fallback channel covers operator dispatch. SLA escalation cron rolls back `sla_escalated_at` on email failure (R2 F1 fix verified) so escalations are NOT silently suppressed. **Action**: buy aeris.sa → add DKIM/SPF/DMARC DNS records → Resend verifies → update `RESEND_FROM_EMAIL` env var → redeploy. |
| 2 | P2 | `/me` homepage stale subtitle | Says "ستفتح صفحة طلب الرحلات + عروضك بمجرد تسليم PR 3 + PR 2" — leftover from Phase 9. Trivial copy update. |
| 3 | P2 | `/me` homepage missing entry points | No buttons/links to medevac/cargo/empty-legs. Users must type URLs manually. Same problem flagged in Phase 11 activation notes. |
| 4 | P2 | Operator navbar missing "الإخلاء الطبي" link | `/operator` dashboard navbar has cargo + empty-legs links but no medevac entry. Operators must type `/operator/medevac` manually. |
| 5 | P3 | Confirmation page text identical for covered + out-of-pocket | After client submits a covered medevac (J5 path), the success page says "سيتم إشعار المشغلين الطبيين المعتمدين خلال 24 ساعة" — same as out-of-pocket. Should differentiate: "تم تأمين رحلتك عبر اشتراك Aeris Shield — المشغل الافتراضي سيتواصل معك مباشرة." Found during Probe 38 testing; D6 differentiation should propagate to UX copy. |
| 6 | P3 | `dispatched_at = NULL` on covered MEV | Spec D6 implies covered requests should have `dispatched_at = NOW() + sla_interval` stamped. Observed: dispatched_at = NULL on MEV-4e516640. Not blocking — covered requests never enter the SLA escalation scan (the cron filters on status IN pending/offers_received, but covered.status = 'covered'). Cosmetic spec divergence; revisit if Phase 13+ uses dispatched_at for covered analytics. |
| 7 | P3 | `customer_name_snapshot` semantics | Currently mirrors patient_name. For medevac where owner books on behalf of a different patient (e.g. family member), the customer name in the booking line-item shows the patient instead of the paying customer. Per D-shape contract, this is the documented behavior — but it surfaces in `/me/bookings` and may confuse the booking owner. Consider showing both ("paid by: <client> · patient: <patient_name>") in PR-N polish. |
| 8 | P2 | Medical cert spec divergence (4 vs 5 ENUM labels) | `medical_certifying_authority` is 4 labels in migration (`SCFHS`, `civil_aviation_authority`, `foreign_equivalent`, `other`). Spec §6 line 1796 claimed 5. Either add a 5th label via migration OR update the spec — current state is consistent but documentation drift. |

---

## Test data cleanup

After Probes 33-40 completed, the following test artifacts were
removed from production:

- 5 medevac_requests (MEV-635c7b06, MEV-8bbe1754, MEV-ca4ed72b,
  MEV-4e516640, MEV-P39TEST) — CASCADE deletes also removed:
  - 1 medevac_offer (linked to MEV-8bbe1754)
  - 3 outbox events
- 2 bookings (AER-B-260518F98B, AER-B-260518A940)
- 1 medevac_subscription (SHIELD-1bfe61e6) — basem902's test
- 2 test aircraft (HZ-MEDEVAC-P36, HZ-MEDEVAC-P40) — CASCADE deletes
  removed their `aircraft_medical_certifications` rows
- Probe 18 (`probe18@aeris.test`) operator password reset to random
  bcrypt hash + password_must_change=true → forces /forgot-password
  reset on next login
- `aeris_shield_config.default_operator_id` reset to NULL → no
  accidental routing of future real covered events to Probe 18

The Probe 14 + Probe 18 operator rows themselves were left in place
(they pre-date Phase 11 and serve other test surfaces). The
basem902 client account was left intact (founder's own account).

Final verification SQL returned all-zero baseline:

```
medevac_requests                        rows = 0
medevac_offers                          rows = 0
medevac_subscriptions                   rows = 0
aircraft_medical_certifications         rows = 0
medevac_dispatch_events_outbox          rows = 0
bookings (medevac discriminator)        rows = 0
aeris_shield_config.default_operator_id IS NULL = 1 ✓
```

---

## Codex review history (across all 3 PRs)

| PR | Codex rounds | Findings closed | Final score |
|---|---|---|---|
| Phase 12 spec (#75) | 16 | 51 (21 P1 + 30 P2) | 100/100 |
| PR 1 (#76) — backend + intake + admin | 5 | 13 (5 P1 + 8 P2) | 100/100 |
| PR 2 (#77) — authed + offers + subs | 4 | 8 (3 P1 + 5 P2) | 100/100 |
| PR 3 (#78) — distribution + cron + canary | 7 | 9 (4 P1 + 5 P2) | 100/100 |
| **Aggregate** | **32 rounds** | **81 findings (33 P1 + 48 P2)** | All 100/100 |

The most impactful P1 fixes in PR 3 (preventing silent-suppression
bugs at activation time):

- **R1 F1**: dispatch-drain `notify_failed` on every operator →
  retryable_failure (not silent processed). Verified live in
  Probe 37 — `notify_failed` for Probe 18 due to Resend
  unverified, outbox row stays unprocessed for retry.
- **R1 F2**: PostgREST `.is(uuid)` invalid → replaced with `.eq()`
  + updatedCount check. Verified live in Probe 40 — expired cert
  cleanup uses the corrected pattern.
- **R2 F1**: `sla_escalated_at` stamp-before-email-send →
  unstamp on failure. Verified live in Probe 39 — `errors=1,
  escalated=0`, sla_escalated_at remained NULL.
- **R2 F2**: `dispatched_at` stamp failure → retryable. Verified
  via code path (not triggered live since stamp didn't fail in our
  probes).

---

## Phase 12 closure summary

All 3 PRs of Phase 12 are live in production:

| PR | Scope | Status |
|---|---|---|
| #76 | Backend + intake + admin (PR 1) | ✅ activated, Probes 33-34 green |
| #77 | Authed portal + offers + subscriptions (PR 2) | ✅ activated, Probes 35, 36, 38 green |
| #78 | Distribution + cron + canary (PR 3) | ✅ activated, Probes 37, 39, 40 green |

**Total commits to main from Phase 12 (not counting spec):**
3 PRs + 1 activation-notes doc (this file).

**Phase 12 closed** as of `2026-05-18`. Next phase per the master
60-day plan is **Phase 13 (Aeris Privilege loyalty tier upgrade
automation)** or continued ops work (Resend domain verification,
UX gap closures from the follow-ups table above).

The 7-day production health monitoring window starts now. Watch
for:
- Cron success rates (Vercel cron logs + `medevac_email_alert_status`
  singleton canary)
- Any unexpected `dispatch_result.error` shapes in
  `medevac_dispatch_events_outbox`
- Any rows in `medevac_requests` with `sla_escalated_at IS NOT NULL`
  (founder escalation fired in production)
- Any rows in `audit_logs` with action `subscription_activated` or
  `admin_pii_read` (D8/D12 admin actions logged correctly)
