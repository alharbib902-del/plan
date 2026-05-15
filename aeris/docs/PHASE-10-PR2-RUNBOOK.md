# Phase 10 — Empty Legs Client-Side Portal — Activation Runbook

> **Scope:** This runbook covers the production activation of
> Phase 10 PR 1 (#62 — backend) + PR 2 (this PR — UI surface).
> Both PRs gate behind `ENABLE_CLIENT_EMPTY_LEGS_PORTAL` (Phase 10
> flag) and the existing `ENABLE_CLIENT_PORTAL` (Phase 9 flag).
>
> **Predecessors:**
> - Phase 9 — Client Portal — closed (live in production)
> - Phase 10 spec — PR #61 — Codex 100/100 — merged at `e0e120f`
> - Phase 10 PR 1 (backend) — PR #62 — Codex 100/100 (3 rounds, 3 P1 + 2 P2 closed) — merged at `cf33a9a`
> - Phase 10 PR 2 (UI) — PR #63 — this PR
>
> **Audience:** Founder + ops. All probes are runnable end-to-end
> from Supabase SQL Editor + the live deployment without any
> developer-side scripting.

---

## 1. Pre-activation checklist

Before touching production:

- [ ] **PR #62 merged + deployed.** Verify `cf33a9a` is the
      current `main` HEAD on Vercel. The migration
      `20260516000029_phase_10_pr_1_empty_legs_client_portal.sql`
      MUST be applied to Supabase before the Phase 10 flag flips
      to `true`.
- [ ] **PR #63 merged + deployed.** Vercel deployment is green
      on `main` after this PR merges.
- [ ] **Migration verified.** Run Probe 21 below — all 10 checks
      must return `true`. If any return `false`, do NOT proceed
      to flag flip.
- [ ] **Existing Phase 7 + 8 + 9 production health green.**
      Visit `/admin/operators/canary` — all 4 existing
      ChannelHealth cards (operator email + WhatsApp + client
      auth Resend + ${{ Phase 8.1 alerts }}) show "سليم" status.
      The new 5th card may show "unknown" until first probe run.

---

## 2. Apply the migration (one-time, idempotent)

The PR 1 migration is idempotent (round 4 + round 7 replay-safe
discipline; pre-audit DO blocks RAISE on data violations rather
than silently corrupting). Safe to re-run.

**SQL editor steps:**

1. Open Supabase project → SQL Editor.
2. Paste the entire contents of
   `aeris/supabase/migrations/20260516000029_phase_10_pr_1_empty_legs_client_portal.sql`.
3. Run. Expected output: 9 RPCs created/replaced, 0 rows
   modified on `bookings.source_discriminator` backfill IF
   running on a fresh DB (rows seeded by Phase 6/7 will
   backfill non-zero on production).
4. If any pre-audit RAISE fires (e.g. `empty_leg_notifications
   has N rows that violate the per-channel URL pair check`),
   STOP — investigate the offending rows manually before
   retrying. The pre-audit is intentional: silent constraint
   binding on dirty data would mask real DR-replay state.

---

## 3. Probes 21-23 — verify backend (run BEFORE flag flip)

These three probes verify the schema + RPCs are wired correctly.
They do NOT require `ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true` — the
RPCs are callable directly via service-role from the SQL Editor.

### Probe 21 — Schema state (10 checks)

```sql
SELECT
  -- New column on empty_legs (§3.1)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empty_legs'
      AND column_name = 'reservation_client_id') AS has_reservation_client_id,
  -- New columns on empty_leg_notifications (§3.2)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empty_leg_notifications'
      AND column_name = 'client_id') AS has_notif_client_id,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empty_leg_notifications'
      AND column_name = 'email_url') AS has_email_url,
  -- New column on clients (§3.3)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients'
      AND column_name = 'notification_preferences') AS has_notif_prefs,
  -- New column on bookings (§3.4)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'source_discriminator') AS has_source_discriminator,
  -- Named CHECK on bookings.source_discriminator (round 4 P2 #3)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_source_discriminator_check'
      AND conrelid = 'bookings'::regclass) AS has_source_discriminator_check,
  -- Recipient XOR on empty_leg_notifications (§3.2)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_leg_notifications_recipient_xor_check'
      AND conrelid = 'empty_leg_notifications'::regclass) AS xor_check_present,
  -- Multi-channel CHECK accepts email_and_wa (round 4 P1 #1)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_leg_notifications_channel_check'
      AND conrelid = 'empty_leg_notifications'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%email_and_wa%') AS channel_check_extended,
  -- §3.6 alert singleton row exists + healthy
  EXISTS (SELECT 1 FROM client_empty_leg_alert_status
    WHERE id = 1 AND status = 'healthy') AS alert_singleton_healthy,
  -- §3.1 named FK with ON DELETE RESTRICT (round 7 P2 #3)
  -- confdeltype = 'r' = RESTRICT, 'n' = SET NULL (the wrong action)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_reservation_client_fkey'
      AND conrelid = 'empty_legs'::regclass
      AND confdeltype = 'r') AS fk_action_is_restrict;
```

**Expected:** all 10 columns = `true`. Any `false` blocks the
flag flip.

If `fk_action_is_restrict` is `false` but the column exists,
a partial replay from the round-6 draft slipped through. Run
§3.1 step 2 (DROP CONSTRAINT IF EXISTS the legacy name) + step
3 (DO block adds the RESTRICT FK by name) manually.

### Probe 22 — Matching engine writes client rows

**Pre-condition:** at least one active client account exists +
one published empty leg with `status='available'`.

**Setup:** flip the flag temporarily for THIS probe only:

```bash
# Vercel dashboard → Project → Settings → Environment Variables
# Add (Production + Preview):
ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true
# Then redeploy.
```

Trigger the matcher manually via the existing cron route:

```bash
curl -X POST https://aeris-flax.vercel.app/api/cron/empty-legs/match-drain \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
# Or wait up to 30 minutes for the natural cron tick.
```

Then verify in SQL Editor:

```sql
SELECT
  COUNT(*) FILTER (WHERE client_id IS NOT NULL) AS client_matches,
  COUNT(*) FILTER (WHERE lead_inquiry_id IS NOT NULL) AS lead_matches
FROM empty_leg_notifications
WHERE leg_id = '<the-test-leg-id>';
```

**Expected:** `client_matches > 0` AND `lead_matches > 0` (the
matcher writes to BOTH paths, not just one). If `client_matches
= 0` but eligible clients exist, check `notification_preferences`
JSONB on the test clients — the default opt-in (§3.3 Decision
#4) means missing keys should NOT block matching.

### Probe 23 — Authenticated reserve happy path

```sql
-- Replace UUIDs with real values from your test client + an
-- available leg.
SELECT reserve_empty_leg_authenticated(
  '<client-id>',
  '<leg-id>',
  '127.0.0.1'::INET
);
```

**Expected return:**

```json
{
  "ok": true,
  "leg_id": "...",
  "reserved_at": "<NOW>",
  "expires_at": "<NOW + 1 hour or auction_end, whichever earlier>",
  "price_at_reservation": "<DECIMAL>"
}
```

Verify the leg row state:

```sql
SELECT reservation_client_id, reservation_expires_at, status
FROM empty_legs WHERE id = '<leg-id>';
```

→ All 3 fields populated, `status='reserved'`,
`reservation_expires_at` is exactly 1 hour from `reserved_at`
(or earlier if the auction window closes first).

**Cleanup:** release the test reservation so the leg is
re-bookable for Probe 27:

```sql
SELECT admin_release_empty_leg_reservation('<leg-id>');
```

---

## 4. Flip the flag

**ONLY after probes 21-23 all pass:**

```bash
# Vercel dashboard → Project → Settings → Environment Variables
# Verify (Production + Preview):
ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true
ENABLE_CLIENT_PORTAL=true              # already set from Phase 9
# Redeploy production.
```

After redeploy, the new routes go live:
- `/me/empty-legs` (and tabs)
- `/me/empty-legs/[leg_number]`
- `/me/empty-legs/matches`
- `/me/notifications`
- 5th canary card on `/admin/operators/canary`
- "تأكيد حجز عميل مسجّل" affordance on
  `/admin/empty-legs/[id]` (visible only when State C)

---

## 5. Probes 24-27 — verify UX flows (run AFTER flag flip)

These probes exercise the full user-facing surface end-to-end.
All four should pass on first attempt against a freshly-flipped
production deployment.

### Probe 24 — Opt-out via preferences blocks future matches

**Setup:**
1. Log in as test client `A` at `/login`.
2. Navigate to `/me/empty-legs`. Verify the matches tab shows
   the rows from Probe 22.
3. Open `/me/notifications`. Toggle OFF both
   `empty_legs.email` AND `empty_legs.wa_link` checkboxes.
   Click "حفظ التفضيلات". Confirm the success banner appears.
4. Verify in SQL:

```sql
SELECT notification_preferences
FROM clients
WHERE id = '<A-id>';
```

→ Returns `{"empty_legs": {"email": false, "wa_link": false}, "marketing": ...}`.

5. Operator publishes a NEW empty leg (via the Phase 7 admin
   form at `/admin/empty-legs/new`). Trigger the matcher (curl
   to `/api/cron/empty-legs/match-drain`).

6. Verify NO new row was written for client `A`:

```sql
SELECT COUNT(*) FROM empty_leg_notifications
WHERE client_id = '<A-id>' AND leg_id = '<new-leg-id>';
```

**Expected:** `0`.

7. Verify the matcher reported the skip via the
   `clients_skipped_preferences` observability counter (this
   shows up in match-drain route logs):

```bash
# Check Vercel logs for the most recent match-drain run.
# Look for: { matched: { leg_id, rows_written, clients_written, clients_skipped_preferences: 1+ } }
```

**Expected:** `clients_skipped_preferences >= 1`.

### Probe 25 — Bookings unification view

**Pre-condition:** Client `B` has at least one charter booking
from the Phase 9 PR 3 flow (any status) AND has a Phase 10
empty-leg reservation that the admin has confirmed.

**Setup:**
1. Reserve an empty leg as client `B` via `/me/empty-legs/[leg_number]`
   → click "احجز الآن".
2. Admin opens `/admin/empty-legs/[leg-id]` → reserved card
   shows "تفاصيل التحفظ — عميل مسجّل" with client B's name +
   phone (NOT a token field). Click "تأكيد حجز عميل مسجّل".
   Confirm the leg flips to `status='sold'` + a booking row is
   created.

3. Log in as client `B` at `/me/bookings`.

**Expected:** the table shows **2 rows**:
- One with chip "طيران خاص" (charter — from Phase 9)
- One with chip "رحلة فارغة" (empty_leg — from Phase 10)

4. Verify in SQL:

```sql
SELECT booking_number, source_discriminator, total_amount
FROM bookings
WHERE client_id = '<B-id>'
ORDER BY created_at DESC;
```

→ At least 2 rows; one with `source_discriminator='charter'`,
one with `source_discriminator='empty_leg'`.

### Probe 26 — Frequency cap honors clients

**Note:** Spec §6 originally said "cap = 5/24h" but the actual
production constant is `FREQUENCY_CAP_PER_24H = 1` (see
`aeris/lib/empty-legs/frequency-cap.ts:34` + the matching
test `aeris/lib/empty-legs/__tests__/frequency-cap-clients.test.ts`).
This probe uses the **real** cap of 1 row per client per 24h.

**Setup:** insert ONE synthetic match row for a single client
within the last 23h:

```sql
-- Replace UUIDs with real values.
INSERT INTO empty_leg_notifications (
  client_id, lead_inquiry_id, leg_id, event_type,
  channel, wa_url, email_url, sent_at
) VALUES (
  '<test-client-id>', NULL,
  '<some-existing-leg-id>', 'published',
  'email', NULL, 'https://aeris.sa/me/empty-legs/EL-XXXX',
  NOW() - INTERVAL '23 hours'
);
```

Then publish a NEW empty leg + trigger the matcher.

**Expected:** the new leg does NOT generate a 2nd row for that
client (cap = 1/24h hit; the existing 23h-old row blocks):

```sql
SELECT COUNT(*) FROM empty_leg_notifications
WHERE client_id = '<test-client-id>'
  AND sent_at > NOW() - INTERVAL '24 hours';
```

→ `1` (NOT 2).

### Probe 27 — Race guard (concurrent reserve)

**Setup:** open two SQL Editor tabs side-by-side. Pick a fresh
`status='available'` leg (e.g. the one from Probe 22 cleanup).

In **both** tabs simultaneously, paste:

```sql
SELECT reserve_empty_leg_authenticated(
  '<client-id>',
  '<leg-id>',
  '127.0.0.1'::INET
);
```

Click "Run" in tab 1, then within 1 second click "Run" in tab 2.

**Expected:**
- One tab returns `{ok: true, ...}` with the reservation details.
- The other tab returns `{ok: false, error: 'leg_already_reserved'}`.
- NEITHER returns a Postgres deadlock error or an internal
  server error.
- BOTH tabs complete within ~100ms (the `pg_advisory_xact_lock`
  serializes them; no infinite block).

**Why this matters:** the §4.1 RPC uses
`pg_advisory_xact_lock(hash(leg_id)) + SELECT FOR UPDATE`.
Without the advisory lock, two concurrent reserves could race
the `SELECT FOR UPDATE` and BOTH succeed, double-booking the
leg. The probe verifies the serialization holds.

**Cleanup:**
```sql
SELECT admin_release_empty_leg_reservation('<leg-id>');
```

---

## 6. Smoke test the admin UI

After probes 24-27 pass, do a quick visual sanity check on the
admin extensions:

1. **5th canary card:** visit `/admin/operators/canary`. The
   "بريد العملاء — عرض رحلة فارغة (Resend)" card appears in the
   notifications health grid alongside the existing 4 cards.
   Status should be "سليم" (the singleton was seeded in §3.6).

2. **State C admin affordance:**
   - Have a test client reserve a leg via `/me/empty-legs/[leg_number]`.
   - Admin visits `/admin/empty-legs/[leg-id]`.
   - The reservation card title reads "تفاصيل التحفظ — عميل مسجّل"
     (NOT "تفاصيل التحفظ").
   - The customer name + phone show the live values from
     `clients` table (not the snapshot columns, which are NULL
     for State C).
   - The action button reads "تأكيد حجز عميل مسجّل" (NOT
     "تأكيد الحجز" — the State B token-input flow is hidden).
   - Clicking it confirms the reservation + creates a booking
     with `source_discriminator='empty_leg'` (verify via SQL
     or by checking client's `/me/bookings`).

3. **Founder batch alert separation:** trigger a matching cycle
   that produces both lead matches AND client matches with
   wa_link channels. The founder should receive **2 separate
   Resend emails** at `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` (one
   for the lead batch, one for the client batch — round 1 P1
   #2 fix). Email-only client matches should NOT trigger a
   founder alert (round 2 P2 #1 fix).

---

## 7. Rollback plan

If any probe fails OR an unexpected production issue emerges
within 24h of the flag flip, roll back immediately:

```bash
# Vercel dashboard → Project → Settings → Environment Variables
ENABLE_CLIENT_EMPTY_LEGS_PORTAL=false
# Redeploy. The new routes 404 + the matcher's client-loop
# becomes dead code. No data loss; existing reservations
# survive in the database but the UI is hidden.
```

**No database rollback needed.** The migration is non-destructive:
- Phase 9 + Phase 7 + Phase 6 functionality is unchanged.
- The new schema additions (columns + indexes + singleton) are
  inert when the flag is off.
- The 6 Phase 7 patched RPCs (§4.4 + §4.5) work identically to
  Phase 7 originals when no State C reservations exist.

If the underlying issue requires a hotfix (e.g. a malformed
`notification_preferences` JSONB row crashes the matcher),
issue a single-commit hotfix PR per Aeris discipline (founder
exempt from Codex 100/100 requirement for genuine hotfixes,
per memory feedback).

---

## 8. Closure ceremony

Once probes 21-27 all pass + 7 days of healthy production
operation:

1. Archive this runbook to `aeris/docs/archive/PHASE-10-CLOSURE.md`.
2. Append the closure summary to `aeris/docs/CLAUDE-WORK-LOG.md`
   following the Phase 9 closure template (PR #60).
3. Open closure PR + merge after Codex 100/100 (lighter review;
   docs-only changes).
4. Delete this file from `aeris/docs/`.

---

## Reference

- **Spec:** `aeris/docs/CLAUDE-TASK.md` (PR #61, merged at
  `e0e120f`, Codex 100/100 across 8 rounds)
- **PR 1 (backend):** PR #62, merged at `cf33a9a`, Codex
  100/100 across 3 rounds (3 P1 + 2 P2 closed)
- **PR 2 (UI):** PR #63 — this PR
- **Migration:** `aeris/supabase/migrations/20260516000029_phase_10_pr_1_empty_legs_client_portal.sql`
  (1,207 lines SQL, 9 RPCs, 4 schema sections, 1 singleton table,
  5 named constraints, 4 indexes)
- **Vercel project:** `aeris-flax.vercel.app` (production
  deployment URL — pinned to Phase 9 activation runbook)
- **Supabase project:** Aeris Cloud — single project for all
  environments (per CLAUDE.md)

**Key environment variables for Phase 10 PR 2:**

| Variable | Purpose | Default |
|---|---|---|
| `ENABLE_CLIENT_EMPTY_LEGS_PORTAL` | Phase 10 master flag | `unset` (= disabled) |
| `ENABLE_CLIENT_PORTAL` | Phase 9 portal master flag (already set) | `true` (production) |
| `ENABLE_EMPTY_LEGS_NOTIFICATIONS` | Phase 7 matcher master flag (already set) | `true` (production) |
| `RESEND_API_KEY` | Email dispatch (already set) | — |
| `RESEND_FROM_EMAIL` | Email sender domain (already set) | — |
| `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` | Founder alert recipient (already set) | — |
| `CRON_SECRET` | Manual cron-trigger auth (already set) | — |
