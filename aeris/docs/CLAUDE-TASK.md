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
   does NOT send an email itself. The Server Action
   wraps the RPC + on success calls
   `sendClientEmptyLegReservationEmail` (NEW Resend
   helper, mirror of Phase 9 password-reset email). On
   failure, `recordClientEmailAlertStatus` writes degraded
   alert to the existing canary singleton (no NEW
   singleton needed; Phase 9 PR 1 §3.7 covers it).
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
13. **Match scoring weights:** identical to Phase 7
    lead-inquiry weights for round 1. The
    `score_empty_leg_match_for_client` helper inside the
    dispatcher reuses the lead-side scoring function
    `_score_empty_leg_match` with `client_id` substituted
    for `lead_inquiry_id`. Per-client preferences
    (favourite routes, preferred timing) deferred to
    Phase 10.x or later — the JSONB shape allows
    forward extension.
14. **Codex 100/100 mandatory** before any merge to main.
    Branch protection enforces CI passing too. (Carries
    forward from Phase 9 conventions playbook.)
15. **No Functions map entries** in `types/database.ts`
    for new RPCs. Mirror of Phase 8 PR 2e #48 + Phase 9
    PR 1 convention #1 — the `looseClient()` cast pattern
    is the only way new code calls RPCs.

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

-- Extend the pair check.
-- Before (Phase 7): all 4 of (token_hash, expires_at, name, phone)
--                   must be either all-NULL or all-NOT-NULL.
-- After (Phase 10): same 4-pair rule, AND additionally
--                   reservation_client_id MUST be NULL when
--                   reservation_token_hash IS NOT NULL (i.e.
--                   guest reservation cannot also be a client
--                   reservation), AND when client_id IS NOT NULL
--                   the 4 guest snapshot columns may be NULL
--                   (the client's snapshots come from the clients
--                   table at read time).

ALTER TABLE empty_legs
  DROP CONSTRAINT IF EXISTS empty_legs_reservation_pair_check;

ALTER TABLE empty_legs
  ADD CONSTRAINT empty_legs_reservation_pair_check CHECK (
    -- guest reservation: 4-pair rule still in force
    (reservation_token_hash IS NULL) = (reservation_expires_at IS NULL)
    AND (reservation_token_hash IS NULL) = (reservation_customer_name_snapshot IS NULL)
    AND (reservation_token_hash IS NULL) = (reservation_customer_phone_snapshot IS NULL)
    -- guest XOR client: cannot have both
    AND NOT (
      reservation_token_hash IS NOT NULL
      AND reservation_client_id IS NOT NULL
    )
    -- client reservation needs expires_at (TTL still required)
    AND (
      reservation_client_id IS NULL
      OR reservation_expires_at IS NOT NULL
    )
  );
```

### §3.2 — `empty_leg_notifications.client_id`

Allows the matching engine to write a match row keyed on a
client (not just a lead). XOR check ensures exactly one of
`client_id` or `lead_inquiry_id` is populated per row.

```sql
ALTER TABLE empty_leg_notifications
  ADD COLUMN IF NOT EXISTS client_id UUID
    REFERENCES clients(id) ON DELETE CASCADE;

-- XOR check
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
bookings. Backfill on existing rows: all Phase 9 bookings
get `'charter'` (their `accept_offer` flow) — empty-leg
bookings only appear after Phase 10 ships.

```sql
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source_discriminator TEXT
    NOT NULL DEFAULT 'charter'
    CHECK (source_discriminator IN ('charter', 'empty_leg'));

-- Backfill is a no-op (DEFAULT covers existing rows automatically
-- because PostgreSQL adds the column with the default value);
-- the explicit UPDATE below is a defensive idempotent re-write
-- for DR/replay safety (mirrors Phase 9 PR 2 §1 NOT VALID
-- discipline — no harm if it runs twice).

UPDATE bookings
   SET source_discriminator = 'charter'
 WHERE source_discriminator IS NULL;

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

### §4.2 — `dispatch_empty_leg_matches` extension (Phase 7 RPC)

Existing Phase 7 RPC writes matches to `empty_leg_notifications`
keyed on `lead_inquiry_id`. PR 1 extends it to ALSO write
client-keyed rows when `ENABLE_CLIENT_EMPTY_LEGS_PORTAL = 'true'`.

The flag is read at the **route handler boundary** (matching the
trigger fire), NOT inside the RPC body — keeps the RPC pure +
testable (mirror of Phase 9 PR 4 `auto_dispatch_trip_request`
pattern). The flag is passed in as `p_include_clients BOOLEAN
DEFAULT FALSE` argument.

When `p_include_clients = TRUE`:
1. Build list of eligible clients:
   - `signup_status = 'active'`
   - NOT opted out via `notification_preferences.empty_legs.{email,wa_link}` for **at least one** channel
   - NOT already received a match for this leg (unique
     constraint check)
   - Frequency cap: < 5 matches in last 24h
2. For each eligible client: INSERT
   `empty_leg_notifications (client_id, leg_id, event_type,
   channel, wa_url, …)` row.
3. Return updated count: `{ok, leads_notified, clients_notified}`.

The Server Action layer (the cron + match-trigger callers)
reads `process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL === 'true'`
+ passes the boolean through.

---

## 5. PR breakdown

### PR 1 — Migration + RPC + Server Actions + tests (~700 lines)

**Migration** `20260516000029_phase_10_pr_1_empty_legs_client_portal.sql`:
- §3.1 `empty_legs.reservation_client_id` + extended pair check
- §3.2 `empty_leg_notifications.client_id` + XOR check + indexes
- §3.3 `clients.notification_preferences` JSONB column
- §3.4 `bookings.source_discriminator` + idempotent backfill
- §3.5 `cleanup_expired_empty_leg_reservations` CREATE OR REPLACE
- §4.1 `reserve_empty_leg_authenticated` RPC
- §4.2 `dispatch_empty_leg_matches` extension (CREATE OR REPLACE
  with new `p_include_clients` argument)
- REVOKE/GRANT for all new + modified functions

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

## Open questions for Codex round 1

These are intentionally NOT pre-decided; the spec PR review
is the right forum:

1. **`empty_legs.status='reserved'`** — Phase 7 schema has
   `empty_leg_status ENUM ('available','reserved','sold','expired')`.
   The Phase 10 RPC sets `status='reserved'` on successful
   reserve. Does this conflict with any existing Phase 7
   admin flow that assumes `status='reserved'` only for
   guest reservations? (Spot-check: admin "ركبتي حجز" badge in
   `/admin/leads` reads from `status` directly. Phase 10
   reservations would render the same chip — likely OK
   semantically, but worth Codex confirmation.)
2. **Confirmation flow ownership** — Phase 7 admin
   confirmation creates a `bookings` row (probably via
   existing admin Server Action). Phase 10 needs that
   same flow to set `bookings.source_discriminator='empty_leg'`
   + `bookings.client_id = empty_legs.reservation_client_id`
   when present (instead of the snapshot fields). PR 1
   migration should NOT modify the admin confirmation
   RPC — that needs a separate confirmation path or a
   Phase 10 hotfix PR. Codex should call out the cleanest
   split (modify Phase 7 admin RPC vs. ship a new
   `confirm_empty_leg_reservation_for_client` RPC).
3. **Scoring weights** — Decision #13 says "identical to
   leads". But leads have `customer_phone` for routing
   prior matches; clients have a richer profile (history
   of trip_requests + bookings). Should client-side scoring
   incorporate booking history (e.g. boost legs near
   client's past departure cities)? Codex round 1 P1 vs
   P2 boundary.
4. **Email opt-out token interplay** — Phase 7 guests opt
   out via signed token URL. Authenticated clients opt
   out via `/me/notifications`. Should the PR 1 migration
   add a one-way sync (when client matches a previously-
   opted-out lead by email, propagate the opt-out)? Codex
   to scope.

---

**Spec ready for Codex round 1 review.**
