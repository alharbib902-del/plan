# Phase 10 — Empty Legs Client-Side Portal

> **Status:** Draft for Codex review (round 7).
> **Codex history:** rounds 1-6 closed 13 P1 + 8 P2 findings
> across §3.1 / §3.2 / §3.4 / §3.5 / §3.6 / §4.2 / §4.3 /
> §4.4 / §4.5 / §4.6 + Decision #9 + Probe 21 + PR 1 Server
> Actions manifest + accept_offer locked decision. Round 7
> should verify §3.1 FK is `ON DELETE RESTRICT` (not SET
> NULL — would corrupt valid-states CHECK on hard-delete),
> §4.6 `release_empty_leg_reservation_for_client` is the
> single source of truth for client cancel (Server Action
> wrapper only), `MatchOutcome` carries both
> `clients_written` + `clients_skipped_preferences` for
> opt-out observability, and PR 1 manifest explicitly
> states "do NOT patch accept_offer" (relies on §3.4
> DEFAULT 'charter').
> **Predecessor:** Phase 9 — Charter & Client Portal — closed
> 2026-05-15 at sha `c1f975e` (PR #60). Phase 9 gave clients
> first-class authenticated accounts + `/me/*` portal +
> auto-distribution engine. Phase 10 extends the same
> account surface to the **Empty Legs** business unit:
> authenticated browse, AI-matched personalised feed,
> in-portal reserve, notification preferences, and unified
> `/me/bookings` covering both charter + empty leg booking
> outcomes.
>
> **Scope (locked).** Three PRs (Codex round 0 P1 #1
> alignment — spec PR added):
> 1. **Spec PR** — this document, locked decisions + probes.
> 2. **PR 1** — migration + RPCs + Server Actions + tests.
> 3. **PR 2** — portal pages + components + bookings
>    unification + 7 founder probes.
>
> Every PR in this phase MUST clear Codex 100/100 before
> merge. No payment integration in this phase (per founder
> directive: payment + ZATCA = single final phase wiring
> HyperPay + Moyasar + ZATCA at once).

---

## 0. Objective

Phase 6/7 shipped a complete operator + admin + AI-matching
engine for empty legs, plus a **guest-only** browse +
reserve flow keyed on signed `wa.me` tokens. Phase 9 then
introduced authenticated `clients` accounts with `/me/*`
portal, but the empty-legs surface stayed guest-only.

Phase 10 closes that gap:

1. **Authenticated browse** — logged-in clients see the
   same `aeris-flax.vercel.app/empty-legs` catalogue, but
   from inside `/me/empty-legs` with personalised match
   ordering (AI-scored matches first, browse-all second).
2. **Match history** — every match the dispatcher sent to
   the client is queryable at `/me/empty-legs/matches`
   (read-only ledger; mirrors the wa.me/email payload).
3. **In-portal reserve** — the existing `(public)`
   `/empty-legs/[leg_number]?token=` reserve form requires
   a wa.me token. Phase 10 authenticated reserve uses the
   session cookie instead — same DB write shape (in-place
   reservation on the empty_legs row), zero divergence
   from Phase 7 admin-confirmation flow.
4. **Notification preferences** — `/me/notifications`
   gives clients toggle control over the channels the
   dispatcher uses (email, wa.me link). Existing Phase 7
   guest opt-out token continues to work for
   `lead_inquiries`.
5. **Unified `/me/bookings`** — Phase 9 listed only charter
   bookings. Phase 10 makes the page polymorphic: charter
   bookings AND empty-leg-derived bookings (post-admin-
   confirmation) appear together with a `source`
   discriminator chip.

The dispatcher (Phase 7's `dispatch_empty_leg_matches`),
auction Dutch-curve cron, frequency cap, and admin canary
are NOT being rewritten. Phase 10 extends them with a
client-aware code path; the existing lead-inquiry-keyed
behaviour stays intact.

---

## 1. User journeys

### J1 — Authenticated browse + reserve
1. Logged-in client opens `/me/empty-legs`.
2. Default tab "مطابقاتي" shows match history rows (legs
   the dispatcher sent to this client) ordered by recency.
3. Secondary tab "تصفّح الكل" shows every `available` leg
   ordered by current price ascending.
4. Client opens `/me/empty-legs/<leg_number>` → server
   component renders leg metadata + live auction countdown
   (client-side timer + 30s re-fetch for price tick).
5. Client clicks "احجز الآن" → Server Action
   `reserveAuthenticatedEmptyLeg` writes the in-place
   reservation columns on `empty_legs` (mirrors Phase 7
   guest path) + sets `reservation_client_id = session.client_id`.
6. UI flips to "تم الحجز — في انتظار تأكيد الإدارة" with
   a 1-hour hold timer (Decision #9). Admin confirms via existing Phase 7
   admin panel; on confirmation a booking row is created
   (existing accept-flow), and the booking shows up in
   `/me/bookings` for the client.

### J2 — Match notification → portal landing
1. Operator publishes empty leg → dispatcher runs.
2. Dispatcher finds eligible clients (per matching weights
   + opt-in preference) AND eligible leads → INSERTs
   `empty_leg_notifications` rows for each.
3. For clients: dispatcher sends email + (optional) wa.me
   link based on `clients.notification_preferences`. The
   email body links to `/me/empty-legs/<leg_number>`
   (NOT the public token URL — authenticated path).
4. Client clicks → if logged in, lands on `/me/empty-legs/<leg_number>`;
   if not, redirected to `/login` then back.

### J3 — Notification preferences
1. Client opens `/me/notifications`.
2. Toggles surface 4 categories × 2 channels:
   `{ category, channel } → enabled` (16 cells, but Phase 10
   ships only `empty_legs × {email, wa.me}` + the existing
   marketing flag from signup).
3. Save → Server Action writes `clients.notification_preferences`
   JSONB column.
4. Future dispatcher runs honor the new prefs (matched
   client may receive email-only, wa.me-only, or none).

### J4 — Unified bookings view
1. Client opens `/me/bookings`.
2. Server component fetches BOTH:
   - `bookings WHERE client_id = session.client_id` (charter,
     from Phase 9)
   - `bookings WHERE client_id = session.client_id AND
      source = 'empty_leg'` (post-confirmation empty-leg
     bookings)
3. Single table with `source` column ("Charter" / "Empty Leg")
   + ordered by `created_at DESC`.

---

## 2. Locked decisions

These are settled before spec acceptance:

1. **In-place reservation pattern preserved.** Phase 7's
   reservation lives on `empty_legs.reservation_*` columns
   (4-pair check). Phase 10 adds **one** column —
   `reservation_client_id UUID NULL REFERENCES clients(id)
   ON DELETE RESTRICT` (Codex round 6 P1 #1 fix — `SET NULL`
   would corrupt the State C valid-states CHECK on hard-
   delete; see §3.1 for the rationale) — and extends the
   pair check so `(reservation_client_id IS NULL) OR
   (reservation_token_hash IS NULL)` (i.e. either the
   guest-token reservation OR the authenticated-client
   reservation, never both on one row).
2. **No new reservations table.** Reasoning: Phase 7
   shipped the in-place pattern with full audit trail +
   admin confirmation flow. A parallel `empty_leg_reservations`
   table doubles the write surface and forks the admin UI.
   The single-row pattern keeps Phase 7's confirmation
   flow + `customer_booking_id` link intact.
3. **Match history extension via `empty_leg_notifications.client_id`.**
   Add `client_id UUID NULL REFERENCES clients(id) ON
   DELETE CASCADE` column + XOR check
   `(client_id IS NULL) <> (lead_inquiry_id IS NULL)`. The
   existing UNIQUE `(lead_inquiry_id, leg_id)` index gets
   a sibling: UNIQUE `(client_id, leg_id) WHERE client_id
   IS NOT NULL`. Frequency cap (5/24h) extended to keyed
   on `COALESCE(client_id, lead_inquiry_id)`.
4. **Matching engine dispatches to clients alongside
   leads, NOT instead of.** Existing lead-inquiry path
   stays untouched; new code is an additional INSERT
   loop iterating eligible clients. Backwards compatibility
   is non-negotiable.
5. **Default-off rollout.** New env flag
   `ENABLE_CLIENT_EMPTY_LEGS_PORTAL=false` gates BOTH:
   - The `/me/empty-legs/*` route group (404 when off,
     mirror of Phase 9 `ENABLE_CLIENT_PORTAL` discipline).
   - The dispatcher's "include clients" branch (when off,
     dispatcher only writes to `lead_inquiries` rows —
     existing Phase 7 behaviour).
   Founder flips to `true` only after probes 22+23 pass.
6. **Notification preferences storage:** JSONB column on
   `clients` table named `notification_preferences`. Default
   on signup: `{"empty_legs": {"email": true, "wa_link": true},
   "marketing": <existing marketing_opt_in flag>}`. Backfill
   strategy: PR 1 migration adds the column with default
   `'{}'::jsonb`, app code COALESCEs missing keys to true
   (opt-in by default, matches Phase 9 marketing semantics).
7. **Reserve concurrency:** `pg_advisory_xact_lock` on
   `leg_id` hash + `SELECT FOR UPDATE` on the empty_legs
   row inside the RPC body. Mirrors Phase 9 PR 1
   `client_signup` pattern — defense-in-depth against
   two clients racing the same leg.
8. **Authenticated reserve email confirmation:** the RPC
   does NOT send an email itself. The Server Action wraps
   the RPC + on success calls
   `sendClientEmptyLegReservationEmail` (NEW Resend helper,
   mirror of Phase 9 password-reset email).
   **Alert channel separation (Codex PR #61 round 2 P2 #5
   + round 3 P2 #3 fix — settled).** Empty-leg reservation
   email is a different operational channel from client
   auth/password-reset, so failure DOES NOT write to the
   existing `client_notification_alert_status` singleton
   (which would mislabel `/admin/operators/canary` "client
   auth unhealthy" when only the empty-leg reservation
   channel is degraded). PR 1 ships a NEW singleton
   `client_empty_leg_alert_status` (§3.6) + matching
   `recordClientEmptyLegAlertStatus` helper + a 5th
   `<ChannelHealth>` card on the canary page (verbatim
   Arabic title "بريد العملاء — عرض رحلة فارغة (Resend)").
   Mirror of Phase 8 PR 2e singleton + Phase 9 PR 1 §3.7
   + the existing `empty_leg_outreach_alert_status` (Phase
   7) discipline. ~30 lines migration + ~80 lines helper
   + ~40 lines canary card. The "extend existing Phase 7
   singleton with a category column" alternative was
   considered + rejected during round 2 review: it muddies
   Phase 7's existing semantics + breaks the canary's
   1-to-1 mapping between cards and Resend channels.
9. **Reserve TTL:** 1 hour (Codex round 5 PR #61 P1 #3 fix
   + founder confirmation). The prior draft said "24h
   matches Phase 7 guest default" — both halves wrong:
   Phase 7 guest TTL is **10 minutes** (see
   `lib/empty-legs/reservation-token.ts` line 42:
   `DEFAULT_TTL_SECONDS = 10 * 60`), and 24h would block
   Dutch-auction inventory far longer than guests get.
   1 hour is the deliberate middle ground: an authenticated
   client gets ~6× longer than a guest (privilege uplift —
   they may need to coordinate with travel companions or
   loop in family before committing), but the leg returns
   to the auction within the same operating shift if the
   client doesn't confirm. The Phase 7 cron at
   `/api/cron/empty-legs/expire-reservations` (every 5 min)
   continues to handle expiry — see §4.5 for the
   `expire_empty_leg_reservation(UUID)` patch that adds
   `reservation_client_id = NULL` to the existing clear-on-
   expiry UPDATE. The 1h value is hard-coded into §4.1's
   `reserve_empty_leg_authenticated` (`v_now + INTERVAL '1
   hour'`); if product wants to change later, the constant
   lives in one place.
10. **Bookings unification:** application-level merge in
    `/me/bookings/page.tsx` server component. NO database
    VIEW (avoids migration + makes filtering cheaper). The
    `bookings.source_discriminator` column added in PR 1
    migration distinguishes `'charter'` (Phase 9) vs
    `'empty_leg'` (Phase 10 admin confirmation flow).
    Existing Phase 9 bookings get `source_discriminator =
    'charter'` via column DEFAULT + idempotent backfill.
11. **Auction countdown:** client-side JavaScript timer
    (`Date.now()` based on `auction_window_end_at`) + 30s
    polling re-fetch for price tick. NO server-sent
    events / WebSocket. Reasoning: auction ticks happen
    every 30 minutes (Phase 7 cron); a 30s poll is more
    than enough fidelity for a discount that moves at
    half-hour granularity.
12. **No payment in this phase.** Per founder directive
    in user memory: payment + ZATCA = a single final
    phase. Phase 10 reservations land in
    `bookings.payment_status = 'pending_offline'` (Phase
    6/9 default) until that final phase ships HyperPay +
    Moyasar + ZATCA.
13. **Match scoring data sources for clients** (Codex round
    1 PR #61 P2 #6 fix). Phase 7's `scoreCandidateAgainstLeg`
    consumes a `CandidateRow` shape with explicit
    `origin_iata` / `destination_iata` / `passengers` /
    `travel_window_start` / `travel_window_end` / `route_pairs`
    fields — these are read from `lead_inquiries` columns
    (which collect the inquiry intent at submit time).
    Clients have no equivalent intent columns; the spec
    therefore pins the **client signal sources** as follows:
    - `origin_iata` ← latest non-cancelled `trip_requests.departure_airport`
      where `client_id = client.id`. NULL → no geo signal.
    - `destination_iata` ← latest non-cancelled
      `trip_requests.arrival_airport`. NULL → no geo signal.
    - `passengers` ← latest `trip_requests.passengers_count`.
      NULL → defaults to 2 (median family size).
    - `travel_window_start` / `travel_window_end` ← derived
      from latest `trip_requests.departure_date` ±3 days.
      NULL → wide window (no time score).
    - `route_pairs` ← DISTINCT `(departure_airport, arrival_airport)`
      pairs across the client's full `trip_requests` history
      (used for the existing route-affinity factor).
    A client with **zero** trip_requests history has all
    signals NULL → scores zero on geo + time factors but
    still receives matches via the discount + capacity
    factors (Phase 7 weights). The `listEligibleClientCandidates`
    query (§4.2 step 1) is the single source of truth for
    this projection — implemented as a CTE join with the
    same shape as `CandidateRow`. PR 1 ships this projection
    + a unit test fixing the mapping. Per-client booking
    history boost + manual saved-preference inputs deferred
    to Phase 10.x (the projection is the extension point).
14. **Codex 100/100 mandatory** before any merge to main.
    Branch protection enforces CI passing too. (Carries
    forward from Phase 9 conventions playbook.)
15. **No Functions map entries** in `types/database.ts`
    for new RPCs. Mirror of Phase 8 PR 2e #48 + Phase 9
    PR 1 convention #1 — the `looseClient()` cast pattern
    is the only way new code calls RPCs.
16. **Confirmation flow: ship a NEW dedicated RPC for
    client reservations** (Codex round 1 PR #61 P1 #4
    fix). The existing Phase 7 `confirm_empty_leg_reservation`
    requires a reservation `token_hash` + guest snapshot
    fields, INSERTs `bookings.client_id = NULL`, and the
    admin form asks for a guest token. Authenticated
    reservations carry NONE of these. PR 1 ships a parallel
    `confirm_empty_leg_reservation_for_client(p_leg_id,
    p_admin_user_id)` RPC (§4.3) that:
    - Reads the leg's `reservation_client_id` (NOT the
      token hash) + verifies it is still within TTL
    - Pulls `bookings.client_id` + `customer_name` +
      `customer_phone` from the `clients` table (NOT from
      reservation snapshot columns — they are NULL for
      State C reservations)
    - INSERTs the booking with
      `source_discriminator = 'empty_leg'` +
      `source_offer_table = 'phase7_empty_leg'` +
      `client_id = empty_legs.reservation_client_id`
    - Clears `empty_legs.reservation_client_id` +
      `reservation_expires_at` + flips `status='sold'`
    The existing Phase 7 `confirm_empty_leg_reservation`
    (guest path) stays untouched. PR 2 wires a new admin
    UI affordance ("تأكيد حجز عميل مسجّل") that calls
    the new RPC; the existing guest-token confirm UI is
    unaffected. **Both confirm paths now write
    `bookings.source_discriminator='empty_leg'` so unified
    /me/bookings renders correctly per Decision #10.**

---

## 3. Schema additions

### §3.1 — `empty_legs.reservation_client_id`

Allows authenticated clients to reserve in-place without
a guest token. Phase 7 reservation_* columns stay; this
adds one nullable FK + extends the existing pair-check
constraint.

**Codex round 6 PR #61 P1 #1 fix — FK behavior must not break
the valid-states CHECK.** The prior draft used `ON DELETE SET
NULL`. With the State C valid-states CHECK (which requires
both `reservation_client_id` AND `reservation_expires_at`
populated together), a hard-delete of a client row holding
an active State C reservation would set ONLY
`reservation_client_id` to NULL, leaving
`reservation_expires_at` populated → the row matches no valid
state, so PostgreSQL would abort the DELETE itself. That's
silent data corruption mode + admin operations that fail with
no obvious cause.

Use `ON DELETE RESTRICT` instead: PostgreSQL refuses to delete
the client row while any leg references it, with an explicit
FK violation message. Operationally this means: **before hard-
deleting a client account (admin tool, future PDPL right-to-
erase flow), admin must first call `admin_release_empty_leg_reservation`
on every leg where `reservation_client_id = client.id`.** The
release RPC clears the entire reservation tuple atomically
(per §4.5.3 patch) so the FK then has nothing to reject.

Phase 9 does NOT expose a hard-delete flow for clients today
(deactivation is soft via `signup_status`). When a future
phase adds hard-delete, the spec there will document the
"release holds first" sequence; for Phase 10 the constraint
is purely defensive against accidental hard-delete from
Supabase Studio or admin tooling that doesn't know about
empty-leg reservations.

```sql
-- Add column with ON DELETE RESTRICT (Codex round 6 P1 #1).
-- See spec text above for the rationale (SET NULL would
-- leave reservation_expires_at populated, violating the
-- valid-states CHECK and aborting the DELETE).
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS reservation_client_id UUID
    REFERENCES clients(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_empty_legs_reservation_client
  ON empty_legs (reservation_client_id)
  WHERE reservation_client_id IS NOT NULL;

-- Replace the Phase 7 pair-check with explicit valid-states
-- (Codex round 1 PR #61 P1 #1 fix). The Phase 7 rule
-- `(token_hash IS NULL) = (expires_at IS NULL)` rejects the
-- valid client-reservation state where token_hash is NULL but
-- expires_at is NOT NULL — so the new RPC's happy path would
-- have violated the constraint. Three valid states only:
--
--   State A — NO reservation: all 5 columns NULL
--   State B — GUEST reservation: 4-pair NOT NULL, client_id NULL
--   State C — CLIENT reservation: client_id + expires_at NOT NULL,
--            token_hash + 2 snapshots NULL (client snapshots come
--            from the clients table at read time)
--
-- The 4-pair semantics for guest rows are preserved inside
-- State B; the XOR between guest and client is implicit in the
-- three-state OR.

ALTER TABLE empty_legs
  DROP CONSTRAINT IF EXISTS empty_legs_reservation_pair_check;

ALTER TABLE empty_legs
  ADD CONSTRAINT empty_legs_reservation_pair_check CHECK (
    -- State A: NO reservation
    (
      reservation_token_hash               IS NULL
      AND reservation_expires_at           IS NULL
      AND reservation_customer_name_snapshot  IS NULL
      AND reservation_customer_phone_snapshot IS NULL
      AND reservation_client_id            IS NULL
    )
    OR
    -- State B: GUEST reservation
    (
      reservation_token_hash               IS NOT NULL
      AND reservation_expires_at           IS NOT NULL
      AND reservation_customer_name_snapshot  IS NOT NULL
      AND reservation_customer_phone_snapshot IS NOT NULL
      AND reservation_client_id            IS NULL
    )
    OR
    -- State C: CLIENT reservation
    (
      reservation_token_hash               IS NULL
      AND reservation_expires_at           IS NOT NULL
      AND reservation_customer_name_snapshot  IS NULL
      AND reservation_customer_phone_snapshot IS NULL
      AND reservation_client_id            IS NOT NULL
    )
  );
```

### §3.2 — `empty_leg_notifications.client_id` + multi-channel row model

Allows the matching engine to write a match row keyed on a
client (not just a lead). XOR check ensures exactly one of
`client_id` or `lead_inquiry_id` is populated per row.

**Codex round 1 PR #61 P1 #2 fix:** Phase 7 created the table
with `lead_inquiry_id UUID NOT NULL`. The XOR check below
expects client-keyed rows to set `lead_inquiry_id = NULL`, so
PR 1 migration MUST drop the NOT NULL constraint BEFORE adding
the XOR check, otherwise every client INSERT raises
`null_value_not_allowed` before the XOR predicate even
evaluates. The `types/database.ts` regen must reflect the
nullable shape.

**Codex round 4 PR #61 P1 #1 fix — multi-channel row model.**
Phase 7 created the table with `channel TEXT NOT NULL CHECK
(channel IN ('whatsapp_link'))` + `wa_url TEXT NOT NULL`.
Phase 10 needs to support clients who opt OUT of wa.me
(email-only matches) AND clients who get BOTH channels for
the same leg. The single-row-per-(client, leg) dedupe model
(unique index from §3.2 below) MUST be preserved — it's how
frequency cap + match-history work correctly. Solution:
extend the `channel` CHECK to `('whatsapp_link', 'email',
'email_and_wa')`, drop NOT NULL on `wa_url`, add a new
`email_url TEXT NULL` column, then add a per-channel
constraint pinning which URL columns are populated for each
channel value. Existing Phase 7 rows already conform
(channel='whatsapp_link', wa_url NOT NULL, email_url NULL by
default), so the constraint validates trivially on a clean
production DB.

**Replay-safe XOR add (Codex round 2 PR #61 P1 #3 + round 3
P2 #2 fix).** A previous failed migration run (e.g. partial
replay where `client_id` got added + NOT NULL got dropped,
then ADD CONSTRAINT failed mid-flight) could leave malformed
rows (`both NULL` or `both populated`) that would abort the
constraint addition on retry. We use a strict pre-audit
model: a `DO` block scans for any XOR-violating rows + RAISES
EXCEPTION with the offending count if any are found, then
the migration runs `ADD CONSTRAINT` normally. Round 2's
draft also added `NOT VALID` + `VALIDATE` separately, but
that branch is unreachable when the pre-audit RAISE is in
place (the pre-audit fails fast on any violation, so the
constraint always lands against a clean dataset). Dropped
the `NOT VALID` + `VALIDATE` pair for internal consistency
(Codex round 3 P2 #2 fix); a single normal `ADD CONSTRAINT`
suffices.

```sql
ALTER TABLE empty_leg_notifications
  ADD COLUMN IF NOT EXISTS client_id UUID
    REFERENCES clients(id) ON DELETE CASCADE;

-- Drop the legacy NOT NULL on lead_inquiry_id (Codex round 1
-- PR #61 P1 #2 fix). The XOR below enforces "exactly one of
-- {client, lead} is populated" so the column-level NOT NULL
-- becomes redundant + harmful.
ALTER TABLE empty_leg_notifications
  ALTER COLUMN lead_inquiry_id DROP NOT NULL;

-- Codex round 4 PR #61 P1 #1 fix — multi-channel row model.
-- Phase 7 only allowed channel='whatsapp_link' + wa_url NOT
-- NULL. Phase 10 clients may be email-only or two-channel,
-- so extend the CHECK list, drop NOT NULL on wa_url, and add
-- email_url + a per-channel pair check. Existing Phase 7
-- rows already conform (whatsapp_link + wa_url + email_url
-- NULL by default).
ALTER TABLE empty_leg_notifications
  ADD COLUMN IF NOT EXISTS email_url TEXT;

ALTER TABLE empty_leg_notifications
  ALTER COLUMN wa_url DROP NOT NULL;

-- Drop + recreate the channel CHECK to allow the two new
-- values. Named constraint (Codex round 4 P2 #3 discipline
-- carries over to this section too).
ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_channel_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_channel_check CHECK (
    channel IN ('whatsapp_link', 'email', 'email_and_wa')
  );

-- Per-channel URL pair check. Each channel value pins which
-- URL columns must / must not be populated. Pre-audit + RAISE
-- before adding (Phase 9 PR 2 §1 + this spec's round-2 P1 #3
-- discipline) — Phase 7 production rows are guaranteed to
-- conform (channel='whatsapp_link', wa_url NOT NULL,
-- email_url NULL by default), so the audit reports zero
-- violations on healthy production.
DO $$
DECLARE
  v_offending_count INT;
BEGIN
  SELECT COUNT(*) INTO v_offending_count
    FROM empty_leg_notifications
   WHERE NOT (
     (channel = 'whatsapp_link'  AND wa_url IS NOT NULL AND email_url IS NULL)
     OR (channel = 'email'        AND email_url IS NOT NULL AND wa_url IS NULL)
     OR (channel = 'email_and_wa' AND wa_url IS NOT NULL AND email_url IS NOT NULL)
   );
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'PR 1 migration: empty_leg_notifications has % rows that violate the per-channel URL pair check; manual cleanup required',
      v_offending_count;
  END IF;
END $$;

ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_channel_url_pair_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_channel_url_pair_check CHECK (
    (channel = 'whatsapp_link'  AND wa_url IS NOT NULL AND email_url IS NULL)
    OR (channel = 'email'        AND email_url IS NOT NULL AND wa_url IS NULL)
    OR (channel = 'email_and_wa' AND wa_url IS NOT NULL AND email_url IS NOT NULL)
  );

-- Audit + cleanup pass: any pre-existing row that violates
-- the XOR (both NULL or both populated) is a partial-replay
-- artifact. Phase 7 production rows are guaranteed to have
-- exactly lead_inquiry_id populated (the column was NOT NULL
-- and client_id didn't exist), so this audit should report
-- zero rows in healthy production. We RAISE (rather than
-- auto-clean) to surface DR-replay state for a human review
-- before the constraint enforces forward.
DO $$
DECLARE
  v_offending_count INT;
BEGIN
  SELECT COUNT(*) INTO v_offending_count
    FROM empty_leg_notifications
   WHERE NOT ((client_id IS NULL) <> (lead_inquiry_id IS NULL));
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'PR 1 migration: empty_leg_notifications has % rows that violate the recipient XOR (both NULL or both populated); manual cleanup required before the constraint can be added',
      v_offending_count;
  END IF;
END $$;

-- XOR check. The pre-audit DO block above has guaranteed
-- zero violating rows by this point, so a normal
-- ADD CONSTRAINT (no NOT VALID dance) is sufficient and
-- internally consistent (Codex round 3 PR #61 P2 #2 fix).
ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_recipient_xor_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_recipient_xor_check CHECK (
    (client_id IS NULL) <> (lead_inquiry_id IS NULL)
  );

-- Sibling unique index for client+leg dedupe
CREATE UNIQUE INDEX IF NOT EXISTS idx_empty_leg_notifications_client_leg_unique
  ON empty_leg_notifications (client_id, leg_id)
  WHERE client_id IS NOT NULL;

-- Frequency cap (5/24h) index keyed on client too
CREATE INDEX IF NOT EXISTS idx_empty_leg_notifications_client_24h
  ON empty_leg_notifications (client_id, sent_at DESC)
  WHERE client_id IS NOT NULL;
```

### §3.3 — `clients.notification_preferences`

Single JSONB column for forward-extensible preferences. Default
empty object; app code COALESCEs missing keys to opt-in.

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clients.notification_preferences IS
  'Per-client opt-in/opt-out per (category, channel). Missing keys default to opt-in. Phase 10 ships empty_legs.{email,wa_link}; later phases extend.';
```

App-side helper (TypeScript):

```typescript
// lib/clients/notification-preferences.ts
export function isClientOptedIn(
  prefs: Record<string, unknown> | null,
  category: 'empty_legs' | 'marketing',
  channel: 'email' | 'wa_link'
): boolean {
  if (!prefs) return true;  // missing → opt-in
  const cat = (prefs as Record<string, Record<string, boolean>>)[category];
  if (!cat) return true;
  const value = cat[channel];
  if (value === undefined) return true;
  return value === true;
}
```

### §3.4 — `bookings.source_discriminator`

Distinguishes Phase 9 charter bookings from Phase 10 empty-leg
bookings.

**Codex round 1 PR #61 P2 #5 fix:** the prior draft defaulted
every existing row to `'charter'`, but Phase 7 already creates
empty-leg bookings tagged `source_offer_table = 'phase7_empty_leg'`
(Phase 6/7 admin confirmation flow). Defaulting to `'charter'`
would mislabel those historical empty-leg bookings on the
unified `/me/bookings` view. Backfill via a `CASE` on the
existing `source_offer_table` column instead, then make the
column NOT NULL after the backfill is verified.

**Codex round 4 PR #61 P2 #3 fix — named CHECK constraint
separated from `ADD COLUMN`.** The prior draft inlined an
anonymous `CHECK (source_discriminator IN ('charter',
'empty_leg'))` clause inside `ADD COLUMN IF NOT EXISTS`. Two
problems with that form:

1. **Replay un-safety.** `ADD COLUMN IF NOT EXISTS` is
   idempotent on the column itself, but the inline CHECK is
   re-emitted with an auto-generated name (e.g.
   `bookings_source_discriminator_check1`,
   `..._check2`, …) on every replay if the column already
   exists with a slightly-different inline check signature.
   PostgreSQL silently accepts the column-already-exists case
   but the inline CHECK is NOT idempotent the way a named
   constraint with `DO $$ … IF NOT EXISTS … END $$` is.
2. **Rollback opacity.** Anonymous constraints can only be
   dropped by querying `pg_constraint` for the auto-name —
   fragile across PG versions.

Use a named constraint added in a separate step, guarded by
a `pg_constraint`-existence check (mirrors the §3.2 and §5.2
discipline established in Phase 9 PR 1):

```sql
-- Step 1: add the column NULLABLE (so we can backfill correctly
-- before flipping NOT NULL). NO inline CHECK — added separately
-- in step 3 with an explicit name.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source_discriminator TEXT;

-- Step 2: backfill from source_offer_table (Phase 6/7 column).
-- Idempotent: WHERE source_discriminator IS NULL ensures replay
-- safety. The CASE pins each historical row to its true origin
-- (Phase 6 charter → 'charter'; Phase 7 empty-leg → 'empty_leg';
-- legacy NULLs default to 'charter' since pre-Phase-6 data
-- preceded the empty-leg flow).
UPDATE bookings
   SET source_discriminator = CASE
     WHEN source_offer_table = 'phase7_empty_leg' THEN 'empty_leg'
     ELSE 'charter'
   END
 WHERE source_discriminator IS NULL;

-- Step 3: add the named CHECK constraint AFTER backfill so the
-- pre-existing rows are valid before the constraint binds.
-- Replay-safe pg_constraint guard mirrors the §3.2 +
-- §5.2 pattern.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_discriminator_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_discriminator_check
      CHECK (source_discriminator IN ('charter', 'empty_leg'));
  END IF;
END $$;

-- Step 4: set NOT NULL + DEFAULT for forward writes. The DEFAULT
-- only matters for rows inserted by code paths that omit the
-- column (Phase 9 accept_offer is one such path until §4.4 below
-- patches it to set the explicit value); Phase 10 PR 1's
-- new admin confirmation RPC for client reservations will
-- always set 'empty_leg' explicitly.
ALTER TABLE bookings
  ALTER COLUMN source_discriminator SET NOT NULL;

ALTER TABLE bookings
  ALTER COLUMN source_discriminator SET DEFAULT 'charter';

CREATE INDEX IF NOT EXISTS idx_bookings_client_source
  ON bookings (client_id, source_discriminator, created_at DESC)
  WHERE client_id IS NOT NULL;
```

### §3.5 — Phase 7 reservation-clearing RPC patches (pointer)

**Codex round 5 PR #61 P1 #1 + P1 #2 fix.** The prior draft
in this slot invented a `cleanup_expired_empty_leg_reservations()`
batch RPC that does NOT exist in Phase 7. The Phase 7
implementation is per-leg:

- `expire_empty_leg_reservation(p_leg_id UUID)` — line 957 of
  `20260510000011_phase_7_empty_legs_rpcs.sql`, called by the
  cron route at `/api/cron/empty-legs/expire-reservations`
  for each leg where `status='reserved'` AND
  `reservation_expires_at <= NOW()`.
- `release_empty_leg_reservation(UUID, VARCHAR)` — line 777,
  customer-initiated release (token-bound).
- `admin_release_empty_leg_reservation(UUID)` — line 840,
  admin force-release.
- `cancel_empty_leg(UUID, TEXT)` — line 893, admin/operator
  terminal cancel (flips to `'cancelled'`).

All four currently clear `reservation_token_hash`,
`reservation_expires_at`, `reservation_customer_name_snapshot`,
`reservation_customer_phone_snapshot` — but **not the new
`reservation_client_id`** column added by §3.1. Without
patches, a State C (CLIENT) reservation that hits any of these
paths would leave the column populated while `status` flips
back to `'available'` / `'cancelled'`, violating the new §3.1
CHECK constraint (which requires `reservation_client_id IS
NULL` when `reservation_token_hash IS NULL` AND `status <>
'reserved'`).

Body patches live in **§4.5 below** alongside the §4.4
booking-write RPC patches (single PR 1 migration; all five
patched RPCs ship in lockstep). The cron route at
`/api/cron/empty-legs/expire-reservations` needs no code
change — it already calls `expire_empty_leg_reservation(UUID)`
per leg every 5 minutes, and the patched body keeps the
same signature.

### §3.6 — `client_empty_leg_alert_status` singleton (NEW)

Codex round 2 PR #61 P2 #5 fix (option A). Tracks the
operational health of the **empty-leg client reservation
confirmation email** channel separately from the Phase 9
client auth singleton. Mirrors Phase 8 PR 2e
`operator_email_alert_status` + Phase 9 PR 1 §3.7
`client_notification_alert_status` + Phase 7 §16
`empty_leg_outreach_alert_status` patterns.

```sql
CREATE TABLE IF NOT EXISTS client_empty_leg_alert_status (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status               TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at      TIMESTAMPTZ,
  last_failure_reason  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO client_empty_leg_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE client_empty_leg_alert_status ENABLE ROW LEVEL SECURITY;
```

App-side helper (TypeScript, mirror of Phase 9 PR 1
`recordClientEmailAlertStatus`):

```typescript
// lib/notifications/client-empty-leg-alert-status.ts
export async function recordClientEmptyLegAlertStatus(
  client: AdminClient,
  result: ClientEmailDeliveryResult,
  contextLabel: string
): Promise<void> {
  // Same UPDATE pattern as Phase 9 PR 1 — singleton row
  // (id=1) gets `status` flipped to 'healthy' on success
  // or 'config_missing'/'send_failed' on failure with the
  // contextLabel + Resend reason joined into
  // `last_failure_reason`.
}
```

Admin canary extension: a 5th `<ChannelHealth>` card on
`/admin/operators/canary` reads from this singleton with
the verbatim Arabic title "بريد العملاء — عرض رحلة فارغة (Resend)".

---

## 4. RPC layer

### §4.1 — `reserve_empty_leg_authenticated` (NEW)

Authenticated client reserves a leg in-place. Mirrors Phase 9
`create_authenticated_trip_request` shape: pre-checks +
advisory lock + SELECT FOR UPDATE + INSERT-equivalent UPDATE
+ structured error contracts.

```sql
CREATE OR REPLACE FUNCTION reserve_empty_leg_authenticated(
  p_client_id UUID,
  p_leg_id    UUID,
  p_ip        INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_row    RECORD;
  v_leg_row       RECORD;
  v_now           TIMESTAMPTZ := NOW();
  v_expires_at    TIMESTAMPTZ;
BEGIN
  -- ip_required guard (mirrors Phase 9 PR 1 convention #12)
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  -- 1. Client lookup + status guard (FOR UPDATE serialises
  --    against future profile-delete flow)
  SELECT id, full_name, contact_phone, signup_status
    INTO v_client_row
    FROM clients
   WHERE id = p_client_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  IF v_client_row.signup_status <> 'active' THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_active');
  END IF;

  -- 2. Per-leg advisory lock (Phase 9 PR 1 convention)
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_leg_id::text), 1, 16))::bit(64)::bigint
  );

  -- 3. Leg lookup + state guard
  SELECT id, status, auction_window_end_at,
         reservation_token_hash, reservation_client_id,
         max_passengers, current_price
    INTO v_leg_row
    FROM empty_legs
   WHERE id = p_leg_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  IF v_leg_row.status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reservable');
  END IF;

  -- Guard: leg already reserved (by anyone — guest or client)
  IF v_leg_row.reservation_token_hash IS NOT NULL
     OR v_leg_row.reservation_client_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_already_reserved');
  END IF;

  -- Guard: auction window has already closed
  IF v_leg_row.auction_window_end_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'auction_window_closed');
  END IF;

  -- 4. Compute reservation TTL: 1 hour (Decision #9 +
  --    Codex round 5 P1 #3 fix), capped at the auction
  --    window end (so the reservation never outlives the
  --    leg's offer validity).
  v_expires_at := LEAST(
    v_now + INTERVAL '1 hour',
    v_leg_row.auction_window_end_at
  );

  -- 5. Apply the reservation in-place
  UPDATE empty_legs
     SET reservation_client_id = v_client_row.id,
         reservation_expires_at = v_expires_at,
         status = 'reserved'
   WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'reserved_at', v_now,
    'expires_at', v_expires_at,
    'price_at_reservation', v_leg_row.current_price
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_empty_leg_authenticated(UUID, UUID, INET) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_empty_leg_authenticated(UUID, UUID, INET) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_empty_leg_authenticated(UUID, UUID, INET) TO service_role;
```

**Structured contracts:**

| Code | Trigger |
|---|---|
| `ip_required` | Server Action passed null IP (defense-in-depth) |
| `client_not_found` | session.client_id no longer exists |
| `client_not_active` | client suspended/deleted |
| `leg_not_found` | leg_id invalid |
| `leg_not_reservable` | leg.status not 'available' (sold/expired/draft) |
| `leg_already_reserved` | another reservation already in place |
| `auction_window_closed` | auction_window_end_at <= NOW |

### §4.2 — TS matching-pipeline extension (NOT a SQL RPC)

**Codex round 1 PR #61 P1 #3 fix.** The prior draft proposed
extending a SQL RPC named `dispatch_empty_leg_matches`. That RPC
does not exist — Phase 7 matching is a **TypeScript pipeline**
driven by outbox + cron routes:

- `lib/empty-legs/matching.ts` (`matchLeg`, `scoreCandidateAgainstLeg`)
- `lib/empty-legs/candidate-pool.ts` (`listEligibleCandidates`)
- `lib/empty-legs/frequency-cap.ts` (`isLeadOverFrequencyCap`,
  `hasNotifiedLeadOnLeg`, `shouldSkipCandidate`)
- `lib/empty-legs/notifications.ts` (Resend + wa.me link build)
- Outbox routes: `app/api/empty-legs/internal/match-trigger/`
  + `app/api/cron/empty-legs/match-drain/`

PR 1 ships the client-aware extension as TS code changes (NOT
a migration), with Phase 9 conventions #1, #15, #19 carried
forward. Concretely:

1. **`candidate-pool.ts`** gains a sibling
   `listEligibleClientCandidates(leg)` returning a `ClientCandidateRow`
   shape (mirror of `CandidateRow` but sourced from `clients`
   joined with the per-client signal sources defined in
   Decision #13). Existing `listEligibleCandidates` (lead path)
   stays untouched.
2. **`frequency-cap.ts`** gains `isClientOverFrequencyCap`
   + `hasNotifiedClientOnLeg` + `shouldSkipClientCandidate`
   helpers, querying the new `idx_empty_leg_notifications_client_24h`
   + `idx_empty_leg_notifications_client_leg_unique` indexes
   from §3.2. The 5/24h cap is the same constant
   (`FREQUENCY_CAP_PER_24H`).
3. **`matching.ts`** `matchLeg(legId)` is extended:
   - Existing lead-loop runs unchanged.
   - When `process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL === 'true'`,
     a NEW client-loop runs after the lead-loop: list eligible
     client candidates → score with the same
     `scoreCandidateAgainstLeg` function (signal substitutions
     per Decision #13) → for each client passing the
     frequency-cap helpers, INSERT a `client_id`-keyed row
     into `empty_leg_notifications` + dispatch via
     `notifications.ts`.
   - **Per-client channel selection (Codex round 4 P1 #1
     fix).** `notifications.ts` reads
     `clients.notification_preferences.empty_legs.{email,wa_link}`
     via the §3.3 `isClientOptedIn` helper, then writes the
     match row + dispatches per these rules:
     - opted in to BOTH → `channel='email_and_wa'`, both
       `wa_url` + `email_url` populated, dispatch both
       Resend + wa.me link
     - opted in to email ONLY → `channel='email'`,
       `email_url` populated + `wa_url` NULL, dispatch
       Resend only
     - opted in to wa.me ONLY → `channel='whatsapp_link'`,
       `wa_url` populated + `email_url` NULL, dispatch
       wa.me link only
     - opted OUT of both → **no row written**, no dispatch
       (the client is counted in
       `matched.clients_skipped_preferences` for observability —
       see MatchOutcome shape below)
     The single-row-per-(client, leg) dedupe model is
     preserved by the §3.2 unique index — frequency cap
     + match-history work the same regardless of channel
     count.
   - **`MatchOutcome` shape change (Codex round 2 PR #61
     P2 #4 fix + round 6 P2 #3 fix).** The actual current
     shape is `{ ok: true; matched: { leg_id: string;
     rows_written: number } } | <skipped variants>`.
     **`rows_written` stays as the lead count** (no rename
     — preserves backwards-compat with all existing call
     sites + outbox-processed semantics). Two new optional
     siblings are added inside `matched`, populated only
     when the client-loop actually ran (i.e. when
     `ENABLE_CLIENT_EMPTY_LEGS_PORTAL === 'true'`):
     - `clients_written?: number` — Phase 10 round 2 fix:
       count of `empty_leg_notifications` rows successfully
       inserted for opted-in clients
     - `clients_skipped_preferences?: number` — Phase 10
       round 6 P2 #3 fix: count of eligible clients (passed
       candidate-pool + frequency-cap) but who opted out of
       BOTH email AND wa.me channels in §3.3
       `notification_preferences`. Useful for observability
       (matching pipeline visibility into how many clients
       the dispatcher would have notified but skipped per
       preferences). Goes in the same `matched` branch
       because a leg WAS matched even if some clients opted
       out — it's a sibling counter, not a skipped-variant
       reason.
     Concretely:
     ```typescript
     export type MatchOutcome =
       | { ok: true;
           matched: {
             leg_id: string;
             rows_written: number;                  // existing — leads
             clients_written?: number;               // NEW round 2 — opted-in client rows
             clients_skipped_preferences?: number;   // NEW round 6 — opted-out client count
           };
         }
       | <skipped variants unchanged>;
     ```
     `shouldMarkOutboxProcessed` is extended to consider
     `(rows_written + (clients_written ?? 0)) > 0` so the
     outbox row gets marked processed when the client-loop
     succeeded even if the lead-loop wrote zero (and vice-
     versa). `clients_skipped_preferences` does NOT
     contribute to the processed predicate (skipped clients
     are not "work done" — only written rows count).
4. **`notifications.ts`** gains
   `sendClientEmptyLegMatchEmail(client, leg, event_type)`
   + `buildClientWaMeUrl(client, leg)` — mirror of the existing
   lead-side helpers but reading `clients.contact_phone` +
   `clients.full_name` instead of the lead snapshot fields.
5. **`outboxes`** require no schema change. The match-drain
   cron route at `/api/cron/empty-legs/match-drain` calls
   `matchLeg(legId)` per leg — the new client-loop runs
   transparently when the flag is on.

**Tests** added in PR 1 alongside the code changes:

- `lib/empty-legs/__tests__/matching-clients.test.ts` —
  scores for clients with various signal-source profiles
  (per Decision #13).
- `lib/empty-legs/__tests__/frequency-cap-clients.test.ts` —
  5/24h cap behavior across `client_id`-keyed rows.
- Existing 7 Phase 7 empty-legs test suites must continue
  to pass unchanged.

**Backwards compatibility is non-negotiable.** When
`ENABLE_CLIENT_EMPTY_LEGS_PORTAL` is unset or `false`, the
extension code path is dead. No existing Phase 7 test or
production behaviour changes.

### §4.3 — `confirm_empty_leg_reservation_for_client` (NEW)

Codex round 1 PR #61 P1 #4 fix + round 2 P1 #1+#2 fixes.
Parallel to the existing Phase 7 `confirm_empty_leg_reservation`
(guest path), this RPC handles the admin-confirmation step
for reservations created by `reserve_empty_leg_authenticated`
(State C in §3.1). The existing guest RPC stays unchanged.

**Column shape mirrors Phase 7 `confirm_empty_leg_reservation`
exactly** (Codex round 2 PR #61 P1 #1 + P1 #2 fix). The only
divergences from the guest RPC are:
- No token-hash check (replaced by `reservation_client_id IS
  NOT NULL` guard).
- `customer_name_snapshot` + `customer_phone_snapshot` come
  from the **clients table** (live snapshot at confirm time),
  NOT from the leg's reservation snapshot columns (which are
  NULL for State C reservations).
- `bookings.client_id` populated (NOT NULL — this is the
  authenticated path's whole point).
- New `source_discriminator = 'empty_leg'` (Phase 10 §3.4).
- `source_offer_table = 'phase7_empty_leg'` + `source_offer_id
  = v_leg.id` reuse the **existing** Phase 6.2 / Phase 7
  source-offer linkage; **NO** new `source_empty_leg_id`
  column is added (the prior round-1 spec proposed one — it
  was redundant with `source_offer_id` and the existing
  `bookings_source_offer_check` constraint already allows
  `'phase7_empty_leg'`, see Phase 7 reshape migration §1).

```sql
CREATE OR REPLACE FUNCTION confirm_empty_leg_reservation_for_client(
  p_leg_id        UUID,
  p_admin_user_id UUID
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now         TIMESTAMPTZ := NOW();
  v_leg         empty_legs%ROWTYPE;
  v_client_row  RECORD;
  v_booking_id  UUID;
BEGIN
  -- 1. Lock the leg row + verify State C
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF v_leg.reservation_client_id IS NULL THEN
    -- Guest reservation: caller used the wrong RPC.
    RETURN json_build_object('ok', false, 'error', 'not_a_client_reservation');
  END IF;

  IF v_leg.reservation_expires_at IS NOT NULL
     AND v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expired');
  END IF;

  -- Route presence guard (mirrors Phase 7 confirm RPC).
  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

  -- 2. Live client snapshot (State C reservations don't carry
  --    snapshot columns — Decision #1 + §3.1 State C).
  SELECT id, full_name, contact_phone, signup_status
    INTO v_client_row
    FROM clients
   WHERE id = v_leg.reservation_client_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- We do NOT block on client_not_active here: a client
  -- whose status flipped to 'suspended' between reserve
  -- and confirm still gets the booking row (they already
  -- paid the reservation hold cost — flipping the account
  -- doesn't void a confirmed transaction). Admin can
  -- manually cancel via existing booking-cancel flow.

  -- 3. INSERT bookings row — column shape mirrors Phase 7
  --    confirm_empty_leg_reservation EXACTLY. Only divergences
  --    (vs guest RPC) noted with `-- *DIFF*` comments.
  INSERT INTO bookings (
    offer_id,
    trip_request_id,
    route_origin_iata,
    route_destination_iata,
    route_origin_freeform_snapshot,
    route_destination_freeform_snapshot,
    passengers_count_snapshot,
    return_scheduled,
    source_offer_table,
    source_offer_id,
    source_discriminator,             -- *DIFF*: Phase 10 §3.4 column
    client_id,                         -- *DIFF*: NOT NULL (auth path)
    customer_name_snapshot,            -- *DIFF*: from clients table
    customer_phone_snapshot,           -- *DIFF*: from clients table
    operator_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_id,
    aircraft_snapshot,
    base_amount,
    addons_amount,
    vat_amount,
    total_amount,
    commission_amount,
    operator_payout,
    payment_status,
    flight_status,
    departure_scheduled,
    checkout_token_hash,
    checkout_token_expires_at
  ) VALUES (
    NULL,                                            -- offer_id
    NULL,                                            -- trip_request_id
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,                                            -- return_scheduled (one-way)
    'phase7_empty_leg',                              -- source_offer_table (existing Phase 7 tag)
    v_leg.id,                                        -- source_offer_id (leg id as discriminator target)
    'empty_leg',                                     -- *DIFF* source_discriminator
    v_client_row.id,                                 -- *DIFF* client_id NOT NULL
    v_client_row.full_name,                          -- *DIFF* customer_name_snapshot from clients
    v_client_row.contact_phone,                      -- *DIFF* customer_phone_snapshot from clients
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,                             -- base_amount
    0,                                               -- addons_amount
    NULL,                                            -- vat_amount (Decision #12: payment phase)
    v_leg.current_price,                             -- total_amount
    NULL,                                            -- commission_amount (Decision #12)
    NULL,                                            -- operator_payout (Decision #12)
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,                    -- departure_scheduled
    NULL,                                            -- checkout_token_hash
    NULL                                             -- checkout_token_expires_at
  )
  RETURNING id INTO v_booking_id;

  -- 4. Clear reservation + flip leg to sold + link booking back
  UPDATE empty_legs
     SET status                 = 'sold',
         customer_booking_id    = v_booking_id,
         reservation_client_id  = NULL,
         reservation_expires_at = NULL
   WHERE id = p_leg_id;

  -- 5. Audit log entry. Codex round 3 PR #61 P1 #1 fix:
  --    audit_logs has `user_id` (NOT `actor_id`) and the
  --    column is FK to `users(id) ON DELETE SET NULL`.
  --    Aeris admin auth is cookie + env-var based (Phase 8
  --    `ADMIN_INBOX_PASSWORD`); admins do NOT have a `users`
  --    row. So we pass user_id = NULL and stash p_admin_user_id
  --    inside new_value for traceability. (If a future phase
  --    wires admin → users row, this can flip back to a real
  --    FK.) The `action` column is VARCHAR(100) — keep the
  --    label short.
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'booking', v_booking_id, 'empty_leg_client_confirmed',
    jsonb_build_object(
      'leg_id', v_leg.id,
      'client_id', v_client_row.id,
      'admin_user_id', p_admin_user_id,
      'confirmed_at', v_now
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'leg_id', v_leg.id,
    'client_id', v_client_row.id,
    'confirmed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_empty_leg_reservation_for_client(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_empty_leg_reservation_for_client(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_empty_leg_reservation_for_client(UUID, UUID) TO service_role;
```

**Existing Phase 6.2 + Phase 7 schema dependencies (no new
columns added by this section):**
- `bookings.source_offer_table` (VARCHAR(20)) — already
  exists, allows `'phase7_empty_leg'` per Phase 7 reshape
  migration §1's extended `bookings_source_offer_check`.
- `bookings.source_offer_id` (UUID) — already exists.
- `bookings.client_id` — exists, FK retargeted to
  `clients(id)` in Phase 9 PR 2 §2.

**Structured contracts:**

| Code | Trigger |
|---|---|
| `leg_not_found` | leg_id invalid |
| `leg_not_reserved` | leg.status not 'reserved' |
| `not_a_client_reservation` | reservation_client_id IS NULL (guest reservation — wrong RPC) |
| `reservation_expired` | reservation TTL elapsed before admin confirmed |
| `leg_route_origin_missing` | both `departure_airport` AND `departure_airport_freeform_snapshot` NULL |
| `leg_route_destination_missing` | both `arrival_airport` AND `arrival_airport_freeform_snapshot` NULL |
| `client_not_found` | reservation_client_id no longer exists in clients table |

### §4.4 — Phase 7 RPC patches for `source_discriminator='empty_leg'`

**Codex round 4 PR #61 P1 #2 fix.** §3.4 introduces the
`bookings.source_discriminator` column with NOT NULL + DEFAULT
`'charter'`. Two existing Phase 7 RPCs (`confirm_empty_leg_reservation`
+ `admin_mark_empty_leg_sold`) INSERT bookings rows for the
**guest** + **admin-direct** empty-leg paths respectively;
without an explicit `source_discriminator` value in those
INSERTs, both code paths would fall through to the `'charter'`
DEFAULT and mislabel post-migration empty-leg bookings on
`/me/bookings` as charter.

The §3.4 backfill correctly tags **historical** rows via
`source_offer_table = 'phase7_empty_leg' → 'empty_leg'`. But
forward writes from these two RPCs need explicit values,
because the DEFAULT does not flip per code path.

PR 1's migration includes a `CREATE OR REPLACE FUNCTION` for
each of the two Phase 7 RPCs. Body changes are minimal —
identical to the original migration body except the INSERT
column list adds `source_discriminator` and the VALUES list
adds `'empty_leg'`. Signatures + REVOKE/GRANT + structured
error contracts stay unchanged so existing callers continue
to compile.

```sql
-- ============================================================
-- §4.4.1 — confirm_empty_leg_reservation (guest path patch)
--
-- Phase 7 reference: aeris/supabase/migrations/
--   20260510000011_phase_7_empty_legs_rpcs.sql §5 line 615.
-- Original signature, search_path, error contracts, and 30+
-- column INSERT all preserved. Only diffs vs original:
--   - INSERT column list: + source_discriminator
--   - VALUES list:        + 'empty_leg'
-- All other behaviour identical. Re-runnable as a CREATE OR
-- REPLACE; PG drops the prior body atomically.
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_empty_leg_reservation(
  p_leg_id     UUID,
  p_token_hash VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_leg             empty_legs%ROWTYPE;
  v_booking_id      UUID;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF v_leg.reservation_expires_at IS NOT NULL
     AND v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expired');
  END IF;

  IF p_token_hash IS NULL
     OR v_leg.reservation_token_hash IS DISTINCT FROM p_token_hash THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_mismatch');
  END IF;

  IF v_leg.reservation_customer_name_snapshot IS NULL
     OR v_leg.reservation_customer_phone_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_state_invalid');
  END IF;

  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

  INSERT INTO bookings (
    offer_id,
    trip_request_id,
    route_origin_iata,
    route_destination_iata,
    route_origin_freeform_snapshot,
    route_destination_freeform_snapshot,
    passengers_count_snapshot,
    return_scheduled,
    source_offer_table,
    source_offer_id,
    source_discriminator,             -- *DIFF* Phase 10 §3.4 column
    client_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    operator_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_id,
    aircraft_snapshot,
    base_amount,
    addons_amount,
    vat_amount,
    total_amount,
    commission_amount,
    operator_payout,
    payment_status,
    flight_status,
    departure_scheduled,
    checkout_token_hash,
    checkout_token_expires_at
  ) VALUES (
    NULL,
    NULL,
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,
    'phase7_empty_leg',
    v_leg.id,
    'empty_leg',                                     -- *DIFF* source_discriminator
    NULL,
    v_leg.reservation_customer_name_snapshot,
    v_leg.reservation_customer_phone_snapshot,
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,
    0,
    NULL,
    v_leg.current_price,
    NULL,
    NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,
    NULL,
    NULL
  )
  RETURNING id INTO v_booking_id;

  UPDATE empty_legs
    SET status = 'sold',
        customer_booking_id = v_booking_id,
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_empty_leg_reservation(UUID, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_empty_leg_reservation(UUID, VARCHAR)
  TO service_role;


-- ============================================================
-- §4.4.2 — admin_mark_empty_leg_sold (admin-direct path patch)
--
-- Phase 7 reference: same migration §11 line 1085. Same diff
-- pattern: + source_discriminator column, + 'empty_leg' value.
-- All other behaviour preserved.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_mark_empty_leg_sold(
  p_leg_id         UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_leg            empty_legs%ROWTYPE;
  v_booking_id     UUID;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_available');
  END IF;

  IF v_leg.auction_window_end_at IS NOT NULL
     AND v_leg.auction_window_end_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'leg_window_closed');
  END IF;

  IF NULLIF(TRIM(p_customer_name), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_missing');
  END IF;

  IF NULLIF(TRIM(p_customer_phone), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_missing');
  END IF;

  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

  INSERT INTO bookings (
    offer_id,
    trip_request_id,
    route_origin_iata,
    route_destination_iata,
    route_origin_freeform_snapshot,
    route_destination_freeform_snapshot,
    passengers_count_snapshot,
    return_scheduled,
    source_offer_table,
    source_offer_id,
    source_discriminator,             -- *DIFF* Phase 10 §3.4 column
    client_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    operator_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_id,
    aircraft_snapshot,
    base_amount,
    addons_amount,
    vat_amount,
    total_amount,
    commission_amount,
    operator_payout,
    payment_status,
    flight_status,
    departure_scheduled,
    checkout_token_hash,
    checkout_token_expires_at
  ) VALUES (
    NULL,
    NULL,
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,
    'phase7_empty_leg',
    v_leg.id,
    'empty_leg',                                     -- *DIFF* source_discriminator
    NULL,
    TRIM(p_customer_name),
    TRIM(p_customer_phone),
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,
    0,
    NULL,
    v_leg.current_price,
    NULL,
    NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,
    NULL,
    NULL
  )
  RETURNING id INTO v_booking_id;

  UPDATE empty_legs
    SET status = 'sold',
        customer_booking_id = v_booking_id
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
  TO service_role;
```

**Why two functions and not a trigger?** A trigger on
`bookings AFTER INSERT` could derive `source_discriminator`
from `source_offer_table`, but:
- Triggers on hot tables add per-row overhead even for the
  Phase 9 charter accept_offer path (which already sets the
  column explicitly via §3.4 DEFAULT in the short term).
- A trigger hides the contract — the RPC body becomes the
  source of truth for the column value, which matches Phase
  7 + Phase 9 conventions across the codebase.
- The DEFAULT `'charter'` covers any third path we haven't
  thought of (e.g. a future admin-direct charter create
  RPC); the explicit `'empty_leg'` here covers the two
  known empty-leg paths. No silent mislabeling either way.

**What about Phase 9 `accept_offer`?** Locked decision
(Codex round 6 PR #61 P2 #4 fix): **PR 1 does NOT patch
`accept_offer`.** The §3.4 column DEFAULT `'charter'`
correctly tags new charter accept_offer rows. Three reasons
to leave accept_offer untouched in this phase:

1. **Surface area discipline.** PR 1 already touches 6 RPCs
   (§4.1 reserve, §4.3 confirm-for-client, §4.4 patches
   confirm + admin_mark_sold, §4.5 patches expire +
   release + admin_release + cancel, §4.6 release-for-
   client). Adding accept_offer = 11 RPCs in one PR
   makes the review surface harder to keep at 100/100.
2. **DEFAULT is correct.** The §3.4 backfill `CASE` already
   tags historical accept_offer rows as `'charter'` (rows
   without `source_offer_table = 'phase7_empty_leg'` fall
   to the ELSE branch). Forward writes get the same value
   via DEFAULT. No silent mislabeling.
3. **Phase 11 will touch accept_offer anyway.** The payment
   phase wires HyperPay/Moyasar/ZATCA, which means
   `accept_offer` will be `CREATE OR REPLACE`d to integrate
   payment intent creation. That's the natural moment to
   add explicit `source_discriminator: 'charter'` (one-line
   defensive write removing DEFAULT-dependency). Doing it
   now would just mean re-touching the same RPC twice.

The trade-off accepted: if a Phase 10.x patch ever changes
the §3.4 DEFAULT (e.g., to NULL for some new business unit),
existing charter accept_offer code paths would silently start
writing NULL. Mitigation: §3.4 explicitly says NOT NULL +
DEFAULT 'charter', and Probe 21 verifies the named CHECK
constraint binds. Any future DEFAULT change has to be a
deliberate spec edit, which makes the implicit dependency
visible.

### §4.5 — Phase 7 reservation-clearing RPC patches

**Codex round 5 PR #61 P1 #2 fix.** §3.1's new valid-states
CHECK constraint requires that `reservation_client_id` be
NULL whenever `reservation_token_hash` is NULL **and**
`status <> 'reserved'`. Four existing Phase 7 RPCs clear
the legacy reservation columns but were written before
`reservation_client_id` existed; without patches, a State C
(client) reservation that hits any of these clear-paths
would leave `reservation_client_id` populated while the
status flips to `'available'` / `'cancelled'`, violating
the new CHECK on the very next admin write.

PR 1's migration patches all four via `CREATE OR REPLACE
FUNCTION`. Body changes are minimal — identical to the
Phase 7 originals except the SET clause adds
`reservation_client_id = NULL`. Signatures + REVOKE/GRANT
+ structured error contracts unchanged so existing callers
(including the cron route at
`/api/cron/empty-legs/expire-reservations`) compile and
run with no edit.

```sql
-- ============================================================
-- §4.5.1 — expire_empty_leg_reservation (cron path patch)
--
-- Phase 7 reference: aeris/supabase/migrations/
--   20260510000011_phase_7_empty_legs_rpcs.sql §9 line 957.
-- Cron-callable per-leg RPC (the cron route loops legs where
-- status='reserved' AND reservation_expires_at <= NOW(), then
-- calls this RPC for each). No-op if status flipped or TTL
-- not elapsed yet.
-- Diff vs Phase 7 original: + reservation_client_id = NULL on
-- the UPDATE SET clause. All other behaviour preserved.
-- ============================================================
CREATE OR REPLACE FUNCTION expire_empty_leg_reservation(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_status          empty_leg_status;
  v_expires_at      TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, reservation_expires_at
    INTO v_status, v_expires_at
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  IF v_expires_at IS NULL OR v_expires_at > v_now THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION expire_empty_leg_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_empty_leg_reservation(UUID)
  TO service_role;


-- ============================================================
-- §4.5.2 — release_empty_leg_reservation (customer release)
--
-- Phase 7 reference: same migration §6 line 777. Token-bound
-- customer-initiated release. State C (client) reservations
-- have no token (NULL `reservation_token_hash`), so the existing
-- token-mismatch guard naturally rejects them — but the function
-- can still be invoked by the dispatcher cleanup path or future
-- admin tooling that doesn't know about State C, so the
-- defensive `reservation_client_id = NULL` belongs in the
-- clear-clause regardless.
--
-- For State C release flows, the actual entry point is the
-- new Server Action `cancelMyEmptyLegReservation` (§5 PR 1)
-- which performs an atomic UPDATE-with-WHERE-guards and does
-- NOT call this RPC. Patch is defense-in-depth.
-- Diff vs Phase 7 original: + reservation_client_id = NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION release_empty_leg_reservation(
  p_leg_id     UUID,
  p_token_hash VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   empty_leg_status;
  v_hash     VARCHAR(64);
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, reservation_token_hash INTO v_status, v_hash
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF p_token_hash IS NULL
     OR v_hash IS DISTINCT FROM p_token_hash THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_mismatch');
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION release_empty_leg_reservation(UUID, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_empty_leg_reservation(UUID, VARCHAR)
  TO service_role;


-- ============================================================
-- §4.5.3 — admin_release_empty_leg_reservation (admin force-release)
--
-- Phase 7 reference: same migration §7 line 840. Admin "إلغاء
-- التحفظ" button on the empty-leg detail page calls this RPC.
-- After Phase 10, the same admin affordance also handles State C
-- (client) reservations — the button reads `reservation_client_id`
-- and shows a different label ("إلغاء حجز العميل") for State C,
-- but routes through this same RPC.
-- Diff vs Phase 7 original: + reservation_client_id = NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_release_empty_leg_reservation(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status empty_leg_status;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status INTO v_status FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION admin_release_empty_leg_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_release_empty_leg_reservation(UUID)
  TO service_role;


-- ============================================================
-- §4.5.4 — cancel_empty_leg (admin/operator terminal cancel)
--
-- Phase 7 reference: same migration §8 line 893. Terminal cancel
-- of the leg itself (flips to 'cancelled', not 'available'). When
-- a State C reservation exists at cancel time, this clears the
-- client's hold + flips the leg terminal — clients see the leg
-- disappear from their reservation cards on next page load.
-- The audit_logs row already captures the operator/admin action
-- + reason text via the existing AFTER UPDATE trigger + this
-- RPC's explicit insert; no Phase 10 audit additions needed.
-- Diff vs Phase 7 original: + reservation_client_id = NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_empty_leg(
  p_leg_id UUID,
  p_reason TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status empty_leg_status;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status INTO v_status FROM empty_legs WHERE id = p_leg_id;

  IF v_status NOT IN ('available', 'reserved') THEN
    RETURN json_build_object('ok', false,
      'error', CASE v_status
                 WHEN 'sold' THEN 'leg_sold_use_booking_flow'
                 ELSE 'leg_terminal'
               END);
  END IF;

  UPDATE empty_legs
    SET status = 'cancelled',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
    VALUES (
      'empty_legs', p_leg_id, 'cancel',
      jsonb_build_object('reason', NULLIF(TRIM(p_reason), ''))
    );

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION cancel_empty_leg(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_empty_leg(UUID, TEXT)
  TO service_role;
```

**Why per-leg patches and not a trigger or generated column?**
Same rationale as §4.4: triggers hide the contract,
generated columns can't reference the live status flip
context. Each RPC body remains the source of truth for what
"clear a reservation" means; Phase 10 simply extends the
shared clear-set with one new column. If a future Phase
adds another reservation column, the same four RPCs need
the same one-line addition — easy to grep, easy to review.

**Cron-route compatibility:** the cron route at
`/api/cron/empty-legs/expire-reservations` (Phase 7,
schedule `*/5 * * * *` per `vercel.json`) calls
`expire_empty_leg_reservation(p_leg_id UUID)` per leg. The
patched signature is identical, so no route code change.
Probe 22 (post-deploy) verifies the cron route still
returns `200 OK` after migration — see §6 Probe 22 footnote.

### §4.6 — `release_empty_leg_reservation_for_client` (NEW)

**Codex round 6 PR #61 P1 #2 fix.** The prior draft described
`cancelMyEmptyLegReservation` as "a single conditional UPDATE
with three guards (Phase 9 PR 3 P1 #2 pattern)" — but did not
specify the SET list and could not call
`_recompute_empty_leg_price(p_leg_id)` from the Server Action,
because that helper is REVOKEd from `service_role` (it's
SECURITY DEFINER + only callable from other SECURITY DEFINER
functions, per Phase 7 lockdown).

Phase 7's release / expire / admin_release all do three things
atomically: (a) clear the full reservation tuple, (b) flip
status back to `'available'`, (c) call `_recompute_empty_leg_price`
because the leg may have missed Dutch-auction ticks while
held. Symmetric with §4.3's
`confirm_empty_leg_reservation_for_client`, Phase 10 ships
a dedicated client-side release RPC that does all three:

```sql
CREATE OR REPLACE FUNCTION release_empty_leg_reservation_for_client(
  p_leg_id    UUID,
  p_client_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      TIMESTAMPTZ := NOW();
  v_leg      empty_legs%ROWTYPE;
BEGIN
  -- 1. Lock the leg row + load it
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  -- 2. Triple ownership + state guard (mirror of Phase 9
  --    PR 3 P1 #2 conditional-UPDATE pattern, but in RPC
  --    form so we can also call _recompute_empty_leg_price).
  --    Single opaque error covers all three failure modes
  --    (ownership, status, TTL) — UI shows a generic
  --    "تعذّر الإلغاء" without leaking which guard failed.
  IF v_leg.status <> 'reserved'
     OR v_leg.reservation_client_id IS DISTINCT FROM p_client_id
     OR v_leg.reservation_expires_at IS NULL
     OR v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'cancel_not_allowed');
  END IF;

  -- 3. Clear the full reservation tuple + flip back to
  --    'available'. Mirrors §4.5.3 admin_release_empty_leg_reservation
  --    SET list exactly so all three release paths
  --    (admin, cron expire, client cancel) leave identical
  --    post-state.
  UPDATE empty_legs
     SET status                              = 'available',
         reservation_token_hash              = NULL,
         reservation_expires_at              = NULL,
         reservation_customer_name_snapshot  = NULL,
         reservation_customer_phone_snapshot = NULL,
         reservation_client_id               = NULL
   WHERE id = p_leg_id;

  -- 4. Re-snap current_price onto the Dutch-auction curve
  --    (the leg may have missed ticks during the hold).
  --    SECURITY DEFINER lets us call the locked-down
  --    helper that service_role cannot reach directly.
  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'released_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION release_empty_leg_reservation_for_client(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_empty_leg_reservation_for_client(UUID, UUID)
  TO service_role;
```

**Structured contracts:**

| Code | Trigger |
|---|---|
| `leg_not_found` | leg_id invalid |
| `cancel_not_allowed` | Any of: status not 'reserved', reservation_client_id mismatch, reservation_expires_at NULL or elapsed |

**Why opaque single error?** Same rationale as Phase 9 PR 3
P1 #2: leaking the specific failure mode (e.g.
`not_your_reservation` vs `already_confirmed` vs `expired`)
gives an attacker a probe surface to discover which legs a
target client owns. Single `cancel_not_allowed` collapses
the three guards into one opaque outcome. The UI message
is constant: "تعذّر الإلغاء — قد يكون الحجز قد انتهى أو
تأكّد بالفعل." (~constant: "Cancel failed — the hold may
have expired or already been confirmed.")

**Server Action contract** (replaces the prior loose
description in §5 PR 1):

```typescript
// app/actions/clients-empty-legs.ts
export async function cancelMyEmptyLegReservation(
  legId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Validate session → client_id (Phase 9 PR 1 pattern)
  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  // 2. Validate input shape (Zod, leg_id UUID)
  const parsed = cancelMyEmptyLegReservationSchema.safeParse({
    leg_id: legId,
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  // 3. Call the dedicated RPC (single round-trip, atomic
  //    full-clear + status flip + price recompute).
  const client = looseClient(getServiceRoleClient());
  const { data, error } = await client.rpc(
    'release_empty_leg_reservation_for_client',
    { p_leg_id: parsed.data.leg_id, p_client_id: session.client_id }
  );

  if (error) return { ok: false, error: 'server_error' };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'cancel_not_allowed' };

  // 4. Revalidate the portal pages so the UI updates
  revalidatePath('/me/empty-legs');
  revalidatePath('/me/empty-legs/matches');
  return { ok: true };
}
```

This replaces the original "single conditional UPDATE with
three guards" description — the RPC is the single source of
truth for the full release semantics (clear + flip + recompute),
and the Server Action becomes a thin wrapper.

---

## 5. PR breakdown

### PR 1 — Migration + RPC + Server Actions + tests (~700 lines)

**Migration** `20260516000029_phase_10_pr_1_empty_legs_client_portal.sql`:
- §3.1 `empty_legs.reservation_client_id` + valid-states CHECK
  (3-state: NO / GUEST / CLIENT — Codex round 1 P1 #1 fix)
- §3.2 `empty_leg_notifications.client_id` + DROP NOT NULL on
  `lead_inquiry_id` + XOR check + indexes (Codex round 1 P1 #2 fix)
- §3.3 `clients.notification_preferences` JSONB column
- §3.4 `bookings.source_discriminator` (3-step: add nullable +
  CASE-based backfill from `source_offer_table` + flip NOT NULL —
  Codex round 1 P2 #5 fix). **NO** `source_empty_leg_id` column
  (Codex round 2 P1 #1 fix — the existing
  `bookings.source_offer_id` already serves the linkage when
  `source_offer_table='phase7_empty_leg'`).
- §3.5 — pointer to §4.5 (Codex round 5 P1 #1 fix —
  the prior `cleanup_expired_empty_leg_reservations` RPC
  did not exist in Phase 7; per-leg RPCs patched in §4.5)
- §3.6 `client_empty_leg_alert_status` singleton + RLS
  (Codex round 2 P2 #5 fix — separate channel from Phase 9
  client auth alert singleton)
- §4.1 `reserve_empty_leg_authenticated` RPC
- §4.2 (NOT a migration — TS pipeline changes; see below)
- §4.3 `confirm_empty_leg_reservation_for_client` RPC
  (NEW — Codex round 1 P1 #4 fix)
- §4.4 `CREATE OR REPLACE` for Phase 7
  `confirm_empty_leg_reservation` +
  `admin_mark_empty_leg_sold` to write
  `source_discriminator='empty_leg'` (Codex round 4 P1 #2 fix)
- §4.5 `CREATE OR REPLACE` for Phase 7
  `expire_empty_leg_reservation` +
  `release_empty_leg_reservation` +
  `admin_release_empty_leg_reservation` +
  `cancel_empty_leg` to ALSO clear `reservation_client_id`
  on all reservation-clearing paths (Codex round 5 P1 #2 fix —
  required for §3.1 valid-states CHECK to hold post-clear)
- §4.6 `release_empty_leg_reservation_for_client(p_leg_id,
  p_client_id)` RPC (NEW — Codex round 6 P1 #2 fix). Atomic
  ownership-guarded release for the client cancel flow;
  clears full reservation tuple + flips status='available' +
  calls `_recompute_empty_leg_price` (the helper is REVOKEd
  from service_role, so a Server Action UPDATE alone cannot
  re-snap the Dutch-auction curve — only this SECURITY
  DEFINER RPC can).
- §3.4 also patches Phase 9 `accept_offer` decision: do NOT
  patch (Codex round 6 P2 #4 lock). Rely on §3.4 column
  DEFAULT `'charter'` for charter accept_offer rows. Phase 11
  payment phase will revisit when accept_offer is touched
  for HyperPay wiring.
- REVOKE/GRANT for all new + modified functions

**TS pipeline changes (NOT in the migration — Codex round 1
P1 #3 fix)**, alongside the migration in PR 1:
- `lib/empty-legs/candidate-pool.ts` — `listEligibleClientCandidates`
- `lib/empty-legs/frequency-cap.ts` — client-keyed helpers
- `lib/empty-legs/matching.ts` — extended `matchLeg` with
  client-loop guarded by `ENABLE_CLIENT_EMPTY_LEGS_PORTAL`
- `lib/empty-legs/notifications.ts` — client email + wa.me builders
- `types/database.ts` regen reflects the nullable
  `lead_inquiry_id` shape

**Server Actions** (`app/actions/clients-empty-legs.ts`):
- `reserveAuthenticatedEmptyLeg` — wraps §4.1 RPC; on success
  triggers `sendClientEmptyLegReservationEmail` (helper) +
  `recordClientEmptyLegAlertStatus` (Codex round 5 PR #61
  P2 #4 fix — writes to the §3.6 `client_empty_leg_alert_status`
  singleton, NOT the Phase 9 `client_notification_alert_status`
  singleton, so a failed reservation email surfaces on the
  5th canary card "بريد العملاء — عرض رحلة فارغة (Resend)"
  not on the existing Phase 9 client-auth Resend card).
- `cancelMyEmptyLegReservation` — thin wrapper around the
  §4.6 `release_empty_leg_reservation_for_client` RPC (Codex
  round 6 PR #61 P1 #2 fix). Validates session + Zod input
  + delegates to the dedicated RPC for the full atomic
  release semantics (clear reservation tuple + flip status
  to 'available' + recompute Dutch-auction price). Three
  guards (ownership / status / TTL) live in the RPC body
  collapsed to a single opaque `cancel_not_allowed` so a
  failed cancel doesn't leak which guard rejected.
  Revalidates `/me/empty-legs` + `/me/empty-legs/matches`
  on success.
- `updateMyNotificationPreferences` — wraps Zod-validated
  preferences write to `clients.notification_preferences`.

**Lib helpers**:
- `lib/notifications/client-empty-leg-email.ts` — Resend
  sender for "تأكيد الحجز" email (mirrors Phase 9
  password-reset email shape).
- `lib/notifications/client-empty-leg-alert-status.ts` —
  `recordClientEmptyLegAlertStatus` helper writing to the
  §3.6 singleton (Codex round 2 P2 #5 fix; mirror of
  Phase 9 PR 1 `recordClientEmailAlertStatus` shape).
- `lib/clients/notification-preferences.ts` — `isClientOptedIn`
  helper (signature in §3.3).
- `lib/clients/queries/me-empty-legs.ts` — read helpers for
  the `/me/empty-legs/*` pages (browse + matches + detail
  with UUID guards from Phase 9 convention #19).

**Validators** (`lib/validators/clients.ts` extension):
- `reserveEmptyLegSchema` — leg_id UUID
- `cancelMyEmptyLegReservationSchema` — leg_id UUID
- `notificationPreferencesSchema` — strict shape:
  `{ empty_legs: { email: boolean, wa_link: boolean }, marketing: boolean }`

**i18n** (`lib/i18n/clients-ar.ts` extension):
- Empty legs page strings (browse, detail, reserve CTA,
  countdown copy, reserved confirmation banner)
- New error contracts (`leg_not_reservable`,
  `leg_already_reserved`, `auction_window_closed`,
  `cancel_not_allowed` already from PR 3)

**Tests** — 1 new suite + extending PR 9 tests:
- `lib/clients/__tests__/empty-legs-validators.test.ts` —
  10 cases covering Zod shape (UUID + boolean coercion +
  strict-only)
- Re-runs of all 8 Phase 9 suites must continue to pass

### PR 2 — Portal pages + components + bookings unification + probes (~600 lines)

**Pages** (under `app/(client)/me/`):
- `empty-legs/page.tsx` — tabbed view: matches (default)
  + browse-all
- `empty-legs/[leg_number]/page.tsx` — detail + countdown +
  reserve button
- `empty-legs/matches/page.tsx` — read-only ledger
- `notifications/page.tsx` — preferences form
- `bookings/page.tsx` (modified) — application-level merge
  of charter + empty_leg bookings

**Admin UI extensions** (Codex PR #61 round 1 P1 #4 +
round 2 P2 #5 fixes):
- New affordance on the existing admin reservation card
  (in `/admin/empty-legs/<leg>` detail) labelled
  "تأكيد حجز عميل مسجّل" — visible ONLY when
  `empty_legs.reservation_client_id IS NOT NULL`. Calls
  the §4.3 `confirm_empty_leg_reservation_for_client`
  RPC (NOT the existing guest confirm RPC). The existing
  guest-token confirm UI stays exactly as-is for State B
  reservations.
- 5th `<ChannelHealth>` card on `/admin/operators/canary`
  reading from §3.6 `client_empty_leg_alert_status`,
  Arabic title "بريد العملاء — عرض رحلة فارغة (Resend)"
  (Codex round 2 P2 #5 fix — distinct from the existing
  Phase 9 client-auth Resend card so a degraded
  empty-leg reservation channel doesn't mislabel client
  auth as unhealthy).

**Components** (under `components/clients/`):
- `empty-leg-table.tsx` — list rows for browse + matches
- `auction-countdown.tsx` — client component, `Date.now()`
  + 30s poll for price tick
- `reserve-empty-leg-button.tsx` — client component,
  `useTransition` + opaque error handling
- `notification-preferences-form.tsx` — toggles + save action
- `bookings-source-chip.tsx` — "Charter" / "Empty Leg" pill

**i18n + tests** — extensions to existing files; 1 new test
suite for auction-countdown timing math.

**7 founder probes** (per §6 below).

---

## 6. Founder probes

7 probes for Phase 10 (Codex round 0 expects this count;
adjust during review based on edge-case discoveries):

- **PR 1 (3 probes):** 21, 22, 23
- **PR 2 (4 probes):** 24, 25, 26, 27

Each probe states the SQL or HTTP call + the structured
expected result, mirroring the Phase 9 §6 format.

### Probe 21 — Schema state

**Codex round 4 PR #61 P2 #4 fix.** Probe extended from 5 to 9
checks: adds the new `email_url` column (§3.2 — Codex round 4
P1 #1), the named `bookings_source_discriminator_check`
constraint (§3.4 step 3 — Codex round 4 P2 #3 fix), the
extended channel CHECK accepting `'email_and_wa'` (§3.2 —
Codex round 4 P1 #1 multi-channel row model), and the §3.6
alert singleton row (Codex round 2 P2 #5 fix). Without these
four extra checks, replays or partial migrations could leave
the schema half-applied without surfacing in Probe 21.

```sql
SELECT
  -- new column on empty_legs
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empty_legs'
      AND column_name = 'reservation_client_id') AS has_reservation_client_id,
  -- new column on empty_leg_notifications
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empty_leg_notifications'
      AND column_name = 'client_id') AS has_notif_client_id,
  -- new column on empty_leg_notifications (Codex round 4 P1 #1)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empty_leg_notifications'
      AND column_name = 'email_url') AS has_email_url,
  -- new column on clients
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients'
      AND column_name = 'notification_preferences') AS has_notif_prefs,
  -- new column on bookings
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'source_discriminator') AS has_source_discriminator,
  -- named CHECK constraint on bookings (Codex round 4 P2 #3)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_source_discriminator_check'
      AND conrelid = 'bookings'::regclass) AS has_source_discriminator_check,
  -- XOR check on notifications
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_leg_notifications_recipient_xor_check'
      AND conrelid = 'empty_leg_notifications'::regclass) AS xor_check_present,
  -- extended channel CHECK accepts the 3-state set (Codex round 4 P1 #1)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_leg_notifications_channel_check'
      AND conrelid = 'empty_leg_notifications'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%email_and_wa%') AS channel_check_extended,
  -- alert singleton row exists + healthy (Codex round 4 P2 #4)
  EXISTS (SELECT 1 FROM client_empty_leg_alert_status
    WHERE id = 1 AND status = 'healthy') AS alert_singleton_healthy;
```

**Expected:** all 9 columns = `true`. Any `false` indicates
PR 1 migration failed midway or was replayed without the
named constraints binding — re-investigate before flipping
`ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true`.

### Probe 22 — Matching engine writes client rows

Pre-condition: Phase 7 dispatcher running on a fresh
empty-leg publish, with `ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true`
and at least one eligible client (active + opted in).

```sql
SELECT
  COUNT(*) FILTER (WHERE client_id IS NOT NULL) AS client_matches,
  COUNT(*) FILTER (WHERE lead_inquiry_id IS NOT NULL) AS lead_matches
FROM empty_leg_notifications
WHERE leg_id = '<the-test-leg-id>';
```

**Expected:** both > 0 (engine writes to BOTH paths, not just one).

### Probe 23 — Authenticated reserve happy path

```sql
SELECT reserve_empty_leg_authenticated(
  '<client-id>', '<leg-id>', '127.0.0.1'::INET
);
```

**Expected:**
```json
{
  "ok": true,
  "leg_id": "...",
  "reserved_at": "...",
  "expires_at": "<NOW + 1 hour or auction_end, whichever earlier>",
  "price_at_reservation": "<DECIMAL>"
}
```

Then verify via SQL:
```sql
SELECT reservation_client_id, reservation_expires_at, status
FROM empty_legs WHERE id = '<leg-id>';
```
→ all 3 fields populated, `status='reserved'`.

### Probe 24 — Opt-out via preferences blocks future matches

1. Client `A` receives a match (verify row in
   `empty_leg_notifications`).
2. Client `A` opens `/me/notifications` → toggle off
   `empty_legs.email` AND `empty_legs.wa_link` → save.
3. Operator publishes a NEW empty leg.
4. Verify `empty_leg_notifications` has NO new row for
   client `A` on the new leg:

```sql
SELECT COUNT(*) FROM empty_leg_notifications
WHERE client_id = '<A-id>' AND leg_id = '<new-leg-id>';
```

**Expected:** `0`.

### Probe 25 — Bookings unification view

After Phase 9 charter accept (Phase 9 PR 3 flow) AND a
Phase 10 empty-leg admin confirmation (admin clicks
"تأكيد" on a reserved leg, creating a booking with
`source_discriminator='empty_leg'`):

Visit `/me/bookings` as the client.

**Expected:** table with **2 rows**, each labelled
"Charter" / "Empty Leg" via the source chip.

### Probe 26 — Frequency cap honors clients

Insert 5 synthetic match rows for a single client over the
last 23h, then run the dispatcher on a new leg.

**Expected:** new leg does NOT generate a 6th row for that
client (cap = 5/24h).

```sql
SELECT COUNT(*) FROM empty_leg_notifications
WHERE client_id = '<client-id>'
  AND sent_at > NOW() - INTERVAL '24 hours';
```
→ `5` (not 6).

### Probe 27 — Race guard (concurrent reserve)

Open two SQL Editor tabs, paste the same
`reserve_empty_leg_authenticated` call in each, run them
within milliseconds of each other.

**Expected:**
- One returns `{ok:true, …}`.
- The other returns `{ok:false, error:'leg_already_reserved'}`.
- NOT a Postgres deadlock; NOT both ok.
- The advisory lock + `SELECT FOR UPDATE` serialises them.

---

## 7. Acceptance + activation runbook

### Codex review checkpoint
- [ ] Spec PR reaches Codex 100/100 (this document)
- [ ] PR 1 reaches Codex 100/100 (migration + RPCs + Server Actions + tests)
- [ ] PR 2 reaches Codex 100/100 (pages + components + probes)

### Production activation
1. Apply migration in Supabase:
   `20260516000029_phase_10_pr_1_empty_legs_client_portal.sql`
2. Set Vercel env vars (Production + Preview):
   - `ENABLE_CLIENT_EMPTY_LEGS_PORTAL=false` — start OFF;
     flip to `true` only after probes 22+23 pass
3. Redeploy.
4. Run probes 21 (schema), 22 with `ENABLE_*=true` temporarily
   in a manual cron-trigger context, 23 (RPC).
5. If 21+22+23 pass → flip `ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true`
   permanently → redeploy.
6. Run probes 24, 25, 26, 27.
7. Close Phase 10 by archiving this doc to
   `aeris/docs/archive/PHASE-10-CLOSURE.md` + adding a
   summary section to `aeris/docs/CLAUDE-WORK-LOG.md`.

---

## Open questions for Codex round 7

Rounds 1-6 closed:
- **Round 1:** P1 #1 (3-state CHECK on `reservation_*`),
  P1 #2 (`lead_inquiry_id` DROP NOT NULL + XOR check),
  P1 #3 (TS pipeline scope correction), P1 #4 (new
  `confirm_empty_leg_reservation_for_client` RPC), P2 #5
  (separate alert singleton), P2 #6 (scoring sources +
  Decision #13).
- **Round 2:** P1 #1 (booking column shape mirrors Phase 7
  exactly — no new `source_empty_leg_id`), P1 #2 (full 30+
  column INSERT not shortened), P2 #5 (`client_empty_leg_alert_status`
  singleton + 5th canary card).
- **Round 3:** P1 #1 (`audit_logs.user_id` NULL + admin id in
  `new_value`), P2 #2 (no `NOT VALID + VALIDATE` pair —
  pre-audit `RAISE` only).
- **Round 4:** P1 #1 (multi-channel row model — `email_url`
  column + extended channel CHECK + per-channel URL pair
  CHECK + §4.2 step 3 channel selection rules), P1 #2 (Phase
  7 RPC `CREATE OR REPLACE` for `source_discriminator`),
  P2 #3 (named `bookings_source_discriminator_check`
  constraint added separately + replay-safe pg_constraint
  guard), P2 #4 (Probe 21 extended from 5 → 9 checks),
  P2 #5 (header + footer + PR 1 manifest sync).
- **Round 5:** P1 #1 (§3.5 fix — patch real
  `expire_empty_leg_reservation(UUID)` per leg, NOT the
  invented `cleanup_expired_empty_leg_reservations()`),
  P1 #2 (§4.5 new — `CREATE OR REPLACE` for the four Phase 7
  reservation-clearing RPCs to ALSO clear `reservation_client_id`
  so §3.1 valid-states CHECK holds), P1 #3 (Decision #9 TTL —
  was wrongly stated "24h matches Phase 7 guest"; founder
  picked 1 hour as middle ground between 10-min guest and
  too-long 24h hold), P2 #4 (PR 1 Server Actions manifest —
  `reserveAuthenticatedEmptyLeg` calls
  `recordClientEmptyLegAlertStatus` not the Phase 9
  client-auth singleton helper).
- **Round 6:** P1 #1 (§3.1 FK `ON DELETE SET NULL` →
  `ON DELETE RESTRICT` because SET NULL would clear only
  `reservation_client_id` and leave `reservation_expires_at`
  populated, violating the State C check and aborting the
  client DELETE itself — silent corruption mode), P1 #2
  (§4.6 NEW `release_empty_leg_reservation_for_client` RPC —
  client cancel needs to clear full tuple + flip status +
  recompute Dutch-auction price atomically; Server Action
  alone cannot call REVOKEd `_recompute_empty_leg_price`),
  P2 #3 (`MatchOutcome` extended with
  `clients_skipped_preferences?: number` for opt-out
  observability), P2 #4 (`accept_offer` decision locked —
  PR 1 does NOT patch; relies on §3.4 DEFAULT `'charter'`;
  Phase 11 payment phase will revisit when accept_offer is
  touched anyway).

Two open questions carry forward to round 7 (unchanged from
round 2 — scope is acknowledged but deferred to PR 1
implementation phase):

1. **`empty_legs.status='reserved'` semantics** — Phase 7
   schema has `empty_leg_status ENUM ('available','reserved',
   'sold','expired')`. The Phase 10 RPC sets `status='reserved'`
   on successful reserve. Does this conflict with any existing
   Phase 7 admin UI flow that assumes `status='reserved'` only
   for guest reservations? Spot-check: admin "ركبتي حجز" chip
   in `/admin/leads` reads from `status` directly. Phase 10
   reservations would render the same chip — likely OK
   semantically (a reservation is a reservation regardless of
   source), and the new admin "تأكيد حجز عميل مسجّل"
   affordance from §5 PR 2 visually disambiguates the two
   confirmation paths. But worth Codex confirmation that no
   downstream Phase 7 query/UI silently breaks.
2. **Email opt-out token interplay** — Phase 7 guests opt
   out via signed token URL keyed on `lead_inquiries`.
   Authenticated clients opt out via `/me/notifications`.
   Should the PR 1 migration add a one-way sync (when client
   account is created with `auth_email` matching a previously-
   opted-out `lead_inquiries.email`, propagate the opt-out
   into the new client's `notification_preferences`)? Probably
   yes (UX continuity), but the implementation has trade-offs:
   - Eager backfill at PR 1 deploy time (one-shot SQL UPDATE
     joining lead_inquiries to clients on lower(email)).
   - Lazy sync on next client login (Server Action in
     `validateClientSession` checks + reconciles).
   - Or both (backfill at deploy + lazy sync for late
     signups). Codex to recommend.

---

**Spec ready for Codex round 7 review.**
