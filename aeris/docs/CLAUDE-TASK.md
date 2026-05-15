# Phase 10 — Empty Legs Client-Side Portal

> **Status:** Draft for Codex review (round 1).
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
   a 24h hold timer. Admin confirms via existing Phase 7
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
   ON DELETE SET NULL` — and extends the pair check so
   `(reservation_client_id IS NULL) OR
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
   **Alert channel separation (Codex round 2 PR #61 P2 #5
   fix).** Empty-leg reservation email is a different
   operational channel from client auth/password-reset,
   so failure DOES NOT write to the existing
   `client_notification_alert_status` singleton (which
   would mislabel `/admin/operators/canary` "client auth
   unhealthy" when only the empty-leg reservation channel
   is degraded). Two options scoped for Codex round 3
   selection:
   - **(A) New singleton** `client_empty_leg_alert_status`
     (table + helper `recordClientEmptyLegAlertStatus`)
     + 5th `<ChannelHealth>` card on the canary page.
     Mirror of Phase 8 PR 2e singleton + Phase 9 PR 1
     §3.7 + the existing `empty_leg_outreach_alert_status`
     (Phase 7) discipline. ~30 lines migration + ~80 lines
     helper + ~40 lines canary card.
   - **(B) Extend `empty_leg_outreach_alert_status`**
     (Phase 7 singleton already covers empty-leg
     dispatcher health) + add a `category` column or
     parallel row to distinguish "outreach send" from
     "client reservation confirm". Cheaper schema, but
     muddies Phase 7's existing semantics.
   The spec's recommendation is **option (A)** — clean
   separation matches the Phase 8/9 alert-singleton
   pattern + keeps the canary cards 1-to-1 with Resend
   email channels (the operator never has to read a
   composite "category" field). PR 1 ships option (A)
   unless Codex round 3 prefers (B).
9. **Reserve TTL:** 24 hours (matches Phase 7 guest
   default). Cron `cleanup_expired_empty_leg_reservations`
   already exists from Phase 7 — extends to also clear
   `reservation_client_id` (no new RPC; existing function
   gets a CREATE OR REPLACE in PR 1 migration).
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

```sql
-- Add column
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS reservation_client_id UUID
    REFERENCES clients(id) ON DELETE SET NULL;

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

### §3.2 — `empty_leg_notifications.client_id`

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

**Replay-safe XOR add (Codex round 2 PR #61 P1 #3 fix).**
A previous failed migration run (e.g. partial replay where
`client_id` got added + NOT NULL got dropped, then ADD
CONSTRAINT failed mid-flight) could leave malformed rows
(`both NULL` or `both populated`) that abort `ADD CONSTRAINT`
on retry. Use Phase 9 PR 2 §1 discipline: audit-then-add as
NOT VALID, then VALIDATE in a separate statement so any
legacy violations surface as a structured failure rather
than silently corrupting forward writes.

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

-- XOR check — added NOT VALID so a clean Phase-7 production
-- DB never blocks forward dispatch on the constraint addition,
-- then VALIDATE separately. Forward INSERTs are gated as soon
-- as the constraint exists (Postgres applies NOT VALID to new
-- writes); the VALIDATE pass just confirms historical rows
-- comply.
ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_recipient_xor_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_recipient_xor_check CHECK (
    (client_id IS NULL) <> (lead_inquiry_id IS NULL)
  ) NOT VALID;

ALTER TABLE empty_leg_notifications
  VALIDATE CONSTRAINT empty_leg_notifications_recipient_xor_check;

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

```sql
-- Step 1: add the column NULLABLE (so we can backfill correctly
-- before flipping NOT NULL).
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source_discriminator TEXT
    CHECK (source_discriminator IN ('charter', 'empty_leg'));

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

-- Step 3: set NOT NULL + DEFAULT for forward writes. The DEFAULT
-- only matters for rows inserted by code paths that omit the
-- column (Phase 9 accept_offer is one such path until PR 1
-- code change adds the explicit value); Phase 10 PR 1's
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

### §3.5 — `cleanup_expired_empty_leg_reservations` extension

Phase 7's existing cleanup RPC drops in-place reservation
when `reservation_expires_at <= NOW()`. Phase 10 extends it
to also clear `reservation_client_id` when the same TTL
expires (single CREATE OR REPLACE — no new RPC).

The extended RPC body:

```sql
CREATE OR REPLACE FUNCTION cleanup_expired_empty_leg_reservations()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  WITH cleaned AS (
    UPDATE empty_legs
       SET reservation_token_hash               = NULL,
           reservation_expires_at               = NULL,
           reservation_customer_name_snapshot   = NULL,
           reservation_customer_phone_snapshot  = NULL,
           reservation_client_id                = NULL
     WHERE reservation_expires_at <= NOW()
     RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM cleaned;

  RETURN json_build_object('ok', true, 'deleted_count', v_deleted_count);
END;
$$;
-- REVOKE/GRANT explicit per Phase 8 PR #53 hardening;
-- already in place from Phase 7. Re-issue to be defensive.
REVOKE ALL ON FUNCTION cleanup_expired_empty_leg_reservations() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_empty_leg_reservations() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_empty_leg_reservations() TO service_role;
```

The cron route at `/api/cron/empty-legs/expire-reservations`
(Phase 7) needs no code change — it already calls this RPC
every 5 minutes.

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

  -- 4. Compute reservation TTL: 24h, capped at the auction
  --    window end (so the reservation never outlives the
  --    leg's offer validity)
  v_expires_at := LEAST(
    v_now + INTERVAL '24 hours',
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
     into `empty_leg_notifications` + dispatch the email +
     wa.me link via `notifications.ts` (extended to read
     `clients.notification_preferences` + skip channels the
     client opted out of).
   - **`MatchOutcome` shape change (Codex round 2 PR #61
     P2 #4 fix).** The actual current shape is
     `{ ok: true; matched: { leg_id: string; rows_written:
     number } } | <skipped variants>`. **`rows_written`
     stays as the lead count** (no rename — preserves
     backwards-compat with all existing call sites +
     outbox-processed semantics). A NEW optional sibling
     `clients_written?: number` is added inside `matched`,
     populated only when the client-loop actually ran (i.e.
     when `ENABLE_CLIENT_EMPTY_LEGS_PORTAL === 'true'`).
     Concretely:
     ```typescript
     export type MatchOutcome =
       | { ok: true;
           matched: {
             leg_id: string;
             rows_written: number;          // existing — leads
             clients_written?: number;       // NEW — Phase 10
           };
         }
       | <skipped variants unchanged>;
     ```
     `shouldMarkOutboxProcessed` is extended to consider
     `(rows_written + (clients_written ?? 0)) > 0` so the
     outbox row gets marked processed when the client-loop
     succeeded even if the lead-loop wrote zero (and vice-
     versa).
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

  -- 5. Audit log entry
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, actor_id
  ) VALUES (
    'booking', v_booking_id, 'empty_leg_client_confirmed',
    jsonb_build_object(
      'leg_id', v_leg.id,
      'client_id', v_client_row.id,
      'admin_user_id', p_admin_user_id,
      'confirmed_at', v_now
    ),
    p_admin_user_id
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
- §3.5 `cleanup_expired_empty_leg_reservations` CREATE OR REPLACE
- §3.6 `client_empty_leg_alert_status` singleton + RLS
  (Codex round 2 P2 #5 fix — separate channel from Phase 9
  client auth alert singleton)
- §4.1 `reserve_empty_leg_authenticated` RPC
- §4.2 (NOT a migration — TS pipeline changes; see below)
- §4.3 `confirm_empty_leg_reservation_for_client` RPC
  (NEW — Codex round 1 P1 #4 fix)
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
  `recordClientEmailAlertStatus` (Phase 9 singleton).
- `cancelMyEmptyLegReservation` — single conditional UPDATE
  with three guards (Phase 9 PR 3 P1 #2 pattern):
  ownership (`reservation_client_id = session.client_id`) +
  not-yet-confirmed (`status='reserved'`) + within-TTL
  (`reservation_expires_at > NOW()`). Zero rows → opaque
  `cancel_not_allowed`.
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
  -- new column on clients
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients'
      AND column_name = 'notification_preferences') AS has_notif_prefs,
  -- new column on bookings
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'source_discriminator') AS has_source_discriminator,
  -- XOR check on notifications
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_leg_notifications_recipient_xor_check') AS xor_check_present;
```

**Expected:** all 5 columns = `true`.

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
  "expires_at": "<NOW + 24h or auction_end>",
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

## Open questions for Codex round 2

Round 1 closed Decisions #1 / #2 / #3 / #5 (P1 #1 / P1 #2 /
P1 #3 / P1 #4) plus #6 (P2 #5) plus Decision #13 scoring
sources (P2 #6). Two open questions carry forward to
round 2:

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

**Spec ready for Codex round 2 review.**
