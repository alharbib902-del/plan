# Phase 11 PR 2 — Cargo offers + booking integration (delta spec)

> **Status:** Draft (round 0). Awaiting Codex review.
> **Scope:** Authed cargo portal + operator portal + offer
> accept/decline/withdraw + cancel request + bookings unification.
> **Source of truth:** `docs/PHASE-11-CARGO-SPEC.md` (the accepted
> Phase 11 spec, 100/100 across 10 Codex rounds, merged in PR #64).
> This file is a **delta** — it does NOT redefine schema, ENUMs,
> RPC contracts, or business rules already locked in the parent
> spec. It only resolves the "deferred to PR 2 implementation"
> items and pins the new Server Actions / pages / tests.
>
> **Why a delta and not a full re-spec:**
> 1. Schema (`cargo_requests`, `cargo_offers`, `cargo_aircraft_capabilities`,
>    bookings extensions) shipped in PR 1 (#65, merged at `bd5064c`).
> 2. RPC §4.4 `accept_cargo_offer` is fully specified in the parent
>    spec (~300 lines of SQL across 6 Codex iterations); copying it
>    here would invite drift.
> 3. RPC contracts for §4.5 + §4.6 are pinned in the parent spec
>    (signatures, callers, required guards); only the SQL bodies
>    are deferred to this PR.
>
> **Out of scope (deferred to PR 3):**
> - Distribution engine (cargo_dispatch_events_outbox + scoring)
> - Notifications pipeline (operator email/wa.me + founder batch)
> - Cron route for outbox drain
> - 6th canary card on `/admin/operators/canary`
> - Probe 32 (distribution filter)
>
> **Defaults inherited from parent spec:** all locked decisions in
> §2 of the parent (cargo_type ENUM v1, 7-day offer expiry, separate
> table approach over polymorphism, etc.) carry forward unchanged.

---

## §1 Scope summary

| Layer | Item | Origin |
|---|---|---|
| Migration | §4.4 `accept_cargo_offer` | Parent §4.4 (full SQL ready) |
| Migration | §4.5 `decline_cargo_offer` + `withdraw_cargo_offer` | Parent §4.5 contracts; full SQL **here** |
| Migration | §4.6 `cancel_cargo_request` | Parent §4.6 signature; full SQL **here** |
| Server Actions | `app/actions/cargo-clients.ts` (4 wrappers) | New, this spec |
| Server Actions | `app/actions/cargo-operators.ts` (2 wrappers) | New, this spec |
| Pages (client) | `/me/cargo-requests`, `…/new`, `…/[id]` | New, this spec |
| Pages (operator) | `/operator/cargo`, `…/[id]/offer`, `…/offers` | New, this spec |
| Pages (admin) | `/admin/cargo/[id]` accept/decline buttons | Extends PR 1 page |
| Bookings UI | (no change — chip already shipped in PR 1) | — |
| Tests | `accept-flow.test.ts` + `booking-shape.test.ts` | Parent §5 PR 2 |
| Probes | 30 (authed list) + 31 (offer→accept→booking) | Parent §6 |

**Estimated lines of code:** ~1,200 (matches parent §5 PR 2 budget).

---

## §2 Migration `20260519000031_phase_11_pr_2_cargo_offers_booking.sql`

### §2.1 §4.4 `accept_cargo_offer` — copy from parent spec

Full SQL (lines 1872–2134 of `PHASE-11-CARGO-SPEC.md`). No
modifications. The 6-iteration history (Codex rounds 4-10 on PR #64)
is preserved in the inline comments — do NOT trim or restructure
those comments; they document why current invariants exist (deadlock
order, actor_ambiguous-only check, post-accept booking shape).

**Probe 31 verifier** (parent §6) confirms post-accept booking row
shape:
```
offer_id IS NULL
AND trip_request_id IS NULL
AND source_offer_table = 'cargo_offers'
AND source_offer_id IS NOT NULL
```

### §2.2 §4.5 `decline_cargo_offer` — full SQL (was deferred)

Mirror of §4.4 lock pattern but only flips offer status; does NOT
touch `cargo_requests.status` (request stays open).

```sql
CREATE OR REPLACE FUNCTION decline_cargo_offer(
  p_offer_id UUID,
  p_actor_client_id UUID,        -- NULL for admin path
  p_actor_admin_user_id UUID,    -- ALWAYS NULL today (Phase 8 cookie auth, no users row)
  p_reason TEXT                  -- optional, max 500 chars
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer cargo_offers%ROWTYPE;
  v_request cargo_requests%ROWTYPE;
  v_request_id_for_lock UUID;
BEGIN
  -- Mirror §4.4 round 6 P1 #1 — both NULL allowed (admin path),
  -- both set rejected (ambiguous accountability).
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  -- Reason length cap (defense-in-depth; Server Action validates too).
  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  -- Mirror §4.4 deterministic lock order: parent request first,
  -- then offer. Single offer mutated, but lock-then-read prevents
  -- a concurrent accept on a sibling offer from racing the
  -- decline.
  SELECT cargo_request_id INTO v_request_id_for_lock
    FROM cargo_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  SELECT * INTO v_request FROM cargo_requests
   WHERE id = v_request_id_for_lock FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  SELECT * INTO v_offer FROM cargo_offers
   WHERE id = p_offer_id FOR UPDATE;

  -- Round 1 PR #66 P2 #2 — authorization BEFORE idempotency.
  -- A logged-in client probing arbitrary offer UUIDs must not learn
  -- whether they're declined; only the request owner / admin (for
  -- guest requests) gets to see status. The earlier draft returned
  -- already_declined=true before authz, which was a status-leak.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS NULL OR v_request.client_id <> p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    -- Admin path: must be guest request.
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'admin_cannot_decline_authed');
    END IF;
  END IF;

  -- Idempotency (now scoped to the authorized actor).
  -- Re-decline returns ok with already_declined=true.
  IF v_offer.status = 'declined' THEN
    RETURN json_build_object('ok', true, 'already_declined', true);
  END IF;
  IF v_offer.status <> 'pending' THEN
    -- accepted, withdrawn, expired → not declinable.
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending',
      'current_status', v_offer.status);
  END IF;

  UPDATE cargo_offers
     SET status = 'declined',
         decided_at = NOW(),
         decline_reason = NULLIF(BTRIM(p_reason), '')
   WHERE id = p_offer_id;

  -- Audit log — Round 1 PR #66 P1 #1 fix.
  -- The audit_logs schema uses (entity_type, entity_id, action,
  -- old_value, new_value, user_id), NOT (actor_type, actor_id,
  -- target_type, target_id, metadata). Phase 7/10 pattern: pack
  -- actor info inside new_value JSONB; user_id stays NULL because
  -- admins have no users row (Phase 8 cookie auth) and the
  -- clients table is separate from auth.users.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
  VALUES (
    'cargo_offers',
    p_offer_id,
    'cargo_offer_declined',
    jsonb_build_object(
      'actor_type', CASE WHEN p_actor_client_id IS NOT NULL THEN 'client' ELSE 'admin' END,
      'actor_client_id', p_actor_client_id,
      'reason', NULLIF(BTRIM(p_reason), '')
    )
  );

  RETURN json_build_object('ok', true, 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION decline_cargo_offer(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decline_cargo_offer(UUID, UUID, UUID, TEXT) TO service_role;
```

### §2.3 §4.5 `withdraw_cargo_offer` — full SQL

Operator-initiated. Same lock pattern but operator_id auth instead
of client/admin.

```sql
CREATE OR REPLACE FUNCTION withdraw_cargo_offer(
  p_offer_id UUID,
  p_operator_id UUID,            -- REQUIRED (no admin override)
  p_reason TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer cargo_offers%ROWTYPE;
  v_request_id_for_lock UUID;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'operator_required');
  END IF;

  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  -- Same deterministic lock order as §4.4/§4.5 decline.
  SELECT cargo_request_id INTO v_request_id_for_lock
    FROM cargo_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  PERFORM 1 FROM cargo_requests WHERE id = v_request_id_for_lock FOR UPDATE;
  SELECT * INTO v_offer FROM cargo_offers
   WHERE id = p_offer_id FOR UPDATE;

  -- Operator must own the offer.
  IF v_offer.operator_id <> p_operator_id THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Idempotency.
  IF v_offer.status = 'withdrawn' THEN
    RETURN json_build_object('ok', true, 'already_withdrawn', true);
  END IF;
  IF v_offer.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending',
      'current_status', v_offer.status);
  END IF;

  UPDATE cargo_offers
     SET status = 'withdrawn',
         decided_at = NOW(),
         withdraw_reason = NULLIF(BTRIM(p_reason), '')
   WHERE id = p_offer_id;

  -- Round 1 PR #66 P1 #1 — same audit_logs shape as §2.2 decline.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
  VALUES (
    'cargo_offers',
    p_offer_id,
    'cargo_offer_withdrawn',
    jsonb_build_object(
      'actor_type', 'operator',
      'actor_operator_id', p_operator_id,
      'reason', NULLIF(BTRIM(p_reason), '')
    )
  );

  RETURN json_build_object('ok', true, 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION withdraw_cargo_offer(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION withdraw_cargo_offer(UUID, UUID, TEXT) TO service_role;
```

**Schema deltas required** (Round 1 PR #66 P2 #4 — replay-safe
DO blocks inline; do NOT copy raw `ADD CONSTRAINT` because PG
will fail on second-run with `42710 duplicate_object`):

```sql
-- Add nullable reason columns (CREATE COLUMN IF NOT EXISTS is
-- replay-safe natively).
ALTER TABLE cargo_offers
  ADD COLUMN IF NOT EXISTS decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS withdraw_reason TEXT;

-- Length CHECKs wrapped in pg_constraint guards (Phase 9
-- replay-safety convention).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_decline_reason_length_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_decline_reason_length_check
      CHECK (decline_reason IS NULL OR length(decline_reason) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_withdraw_reason_length_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_withdraw_reason_length_check
      CHECK (withdraw_reason IS NULL OR length(withdraw_reason) <= 500);
  END IF;
END $$;
```

### §2.4 §4.6 `cancel_cargo_request` — full SQL

Cancels the request before any offer is accepted. Cascades to
declining all pending offers. If an offer is already accepted,
the request must be cancelled via the booking-cancel flow
(deferred to Phase 14 payment phase).

```sql
CREATE OR REPLACE FUNCTION cancel_cargo_request(
  p_request_id UUID,
  p_actor_client_id UUID,
  p_actor_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_request cargo_requests%ROWTYPE;
  v_cascade_count INT := 0;
BEGIN
  -- Same actor_ambiguous rule as §4.4.
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  SELECT * INTO v_request FROM cargo_requests
   WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Round 1 PR #66 P2 #2 — authorization FIRST (mirror §2.2 decline).
  -- Probing an arbitrary request UUID must not reveal whether it
  -- exists, is cancelled, or is accepted. Auth-then-state.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS NULL OR v_request.client_id <> p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'admin_cannot_cancel_authed');
    END IF;
  END IF;

  -- Idempotency (now scoped to the authorized actor).
  IF v_request.status = 'cancelled' THEN
    RETURN json_build_object('ok', true, 'already_cancelled', true);
  END IF;

  -- Already-accepted requests cannot be cancelled here; they
  -- must go through the booking-cancel flow (Phase 14).
  IF v_request.status = 'accepted' OR v_request.accepted_offer_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'request_already_accepted');
  END IF;

  IF v_request.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_cancellable',
      'current_status', v_request.status);
  END IF;

  -- Cascade: decline all pending offers (ordered by id for
  -- deterministic lock acquisition).
  WITH cascade AS (
    UPDATE cargo_offers
       SET status = 'declined',
           decided_at = NOW(),
           decline_reason = COALESCE(NULLIF(BTRIM(p_reason), ''),
                                     'request_cancelled')
     WHERE cargo_request_id = p_request_id
       AND status = 'pending'
     RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_count FROM cascade;

  -- Round 1 PR #66 P2 #3 — reuse cargo_requests.cancellation_reason
  -- (created in PR 1 §3.1 line 141) instead of adding a duplicate
  -- cancel_reason. cancelled_at also already exists from PR 1.
  UPDATE cargo_requests
     SET status = 'cancelled',
         cancellation_reason = NULLIF(BTRIM(p_reason), ''),
         cancelled_at = NOW()
   WHERE id = p_request_id;

  -- Round 1 PR #66 P1 #1 — audit_logs shape matches Phase 7/10.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
  VALUES (
    'cargo_requests',
    p_request_id,
    'cargo_request_cancelled',
    jsonb_build_object(
      'actor_type', CASE WHEN p_actor_client_id IS NOT NULL THEN 'client' ELSE 'admin' END,
      'actor_client_id', p_actor_client_id,
      'reason', NULLIF(BTRIM(p_reason), ''),
      'cascade_declined_offers', v_cascade_count
    )
  );

  RETURN json_build_object('ok', true,
    'request_id', p_request_id,
    'cascade_declined_offers', v_cascade_count);
END;
$$;

REVOKE ALL ON FUNCTION cancel_cargo_request(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_cargo_request(UUID, UUID, UUID, TEXT) TO service_role;
```

**Schema deltas required** (Round 1 PR #66 P2 #3 + #4):

PR 1 §3.1 already shipped both `cancellation_reason TEXT` and
`cancelled_at TIMESTAMPTZ` on `cargo_requests` (lines 140–141 of
the PR 1 migration). Reuse those columns — adding a duplicate
`cancel_reason` would split the source of truth and leave
`types/database.ts` stale. The only delta needed in PR 2 is the
length CHECK on the existing column, wrapped in a pg_constraint
guard for replay safety:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_cancellation_reason_length_check'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_cancellation_reason_length_check
      CHECK (cancellation_reason IS NULL
             OR length(cancellation_reason) <= 500);
  END IF;
END $$;
```

The `cancel_cargo_request` RPC writes to `cancellation_reason`
(see §2.4 SQL above) so the column name flows end-to-end:
PR 1 schema → PR 2 RPC → existing `types/database.ts` row type.

---

## §3 Server Actions

### §3.1 `app/actions/cargo-clients.ts` (NEW)

All actions:
1. Call `requireClientSession()` (Phase 9 pattern) → resolves to
   `client_id` UUID; throws NEXT_REDIRECT to `/login` if missing.
2. Check `process.env.ENABLE_CARGO === 'true'` → return
   `{ ok: false, error: 'flag_disabled' }` if off (no DB call).
3. Validate input via Zod schema (per-action; see below).
4. Call corresponding RPC via `createAdminClient()` (service-role).
5. Map RPC error codes to translated user messages via
   `cargoAr` lookup map.
6. On success: `revalidatePath('/me/cargo-requests')` + return
   `{ ok: true, ...payload }`.

| Action | Zod schema | RPC | Success path |
|---|---|---|---|
| `submitCargoRequestAuthed(input)` | `cargoRequestAuthedSchema` (PR 1, exists) | §4.2 `create_cargo_request_authenticated` | `{ ok: true, request_id, request_number }` |
| `acceptMyCargoOffer(offer_id)` | `acceptOfferSchema` (NEW: `{ offer_id: uuid }`) | §4.4 `accept_cargo_offer` (client path: `p_actor_client_id=session_id, p_actor_admin_user_id=null`) | `{ ok: true, booking_id, booking_number }` |
| `declineMyCargoOffer({offer_id, reason?})` | `declineOfferSchema` (NEW) | §4.5 `decline_cargo_offer` | `{ ok: true, offer_id }` |
| `cancelMyCargoRequest({request_id, reason?})` | `cancelRequestSchema` (NEW) | §4.6 `cancel_cargo_request` | `{ ok: true, request_id, cascade_declined_offers }` |

**Zod schemas** (in `lib/cargo/validators/cargo-actions.ts`, NEW):

```ts
import { z } from 'zod';

export const acceptOfferSchema = z.object({
  offer_id: z.string().uuid('معرّف العرض غير صحيح'),
});

export const declineOfferSchema = z.object({
  offer_id: z.string().uuid('معرّف العرض غير صحيح'),
  reason: z.string().trim().max(500, 'السبب لا يتعدى 500 حرف').optional(),
});

export const cancelRequestSchema = z.object({
  request_id: z.string().uuid('معرّف الطلب غير صحيح'),
  reason: z.string().trim().max(500, 'السبب لا يتعدى 500 حرف').optional(),
});
```

**Error code → Arabic message map** (extends `cargoAr`):

| RPC error | i18n key | Arabic |
|---|---|---|
| `actor_ambiguous` | `errorActorAmbiguous` | "تعارض في تحديد المنفّذ — أعد المحاولة" |
| `offer_not_found` | `errorOfferNotFound` | "العرض غير موجود أو حُذف" |
| `offer_not_pending` | `errorOfferNotPending` | "لا يمكن تنفيذ الإجراء — العرض لم يعد قابلاً للتعديل" |
| `request_not_found` | `errorRequestNotFound` | "الطلب غير موجود" |
| `forbidden` | `errorForbidden` | "ليس لديك صلاحية تنفيذ هذا الإجراء" |
| `request_already_accepted` | `errorRequestAccepted` | "تم قبول عرض على هذا الطلب — لا يمكن إلغاؤه" |
| `request_not_cancellable` | `errorRequestNotCancellable` | "حالة الطلب لا تسمح بالإلغاء" |
| `flag_disabled` | `errorFlagDisabled` | "خدمة الشحن غير مفعّلة حالياً" |
| `reason_too_long` | `errorReasonTooLong` | "السبب لا يتعدى 500 حرف" |

### §3.2 `app/actions/cargo-operators.ts` (NEW)

All actions:
1. Call `requireOperatorSession()` (Phase 8 pattern) → resolves to
   `operator_id` UUID.
2. Cargo flag check (same pattern).
3. Zod validate.
4. RPC call.
5. `revalidatePath('/operator/cargo')` + return.

| Action | Zod schema | RPC |
|---|---|---|
| `submitCargoOffer(input)` | `cargoOfferSchema` (NEW) | §4.3 `submit_cargo_offer` |
| `withdrawMyCargoOffer({offer_id, reason?})` | `withdrawOfferSchema` (NEW; same shape as `declineOfferSchema`) | §4.5 `withdraw_cargo_offer` |

**`cargoOfferSchema`** (in `lib/cargo/validators/cargo-offer.ts`, NEW):

```ts
export const cargoOfferSchema = z.object({
  cargo_request_id: z.string().uuid(),
  aircraft_id: z.string().uuid(),
  aircraft_snapshot: z.string().trim().max(500).optional(),
  base_price_sar: z.number().positive('السعر الأساسي يجب أن يكون موجباً'),
  insurance_price_sar: z.number().nonnegative().optional().default(0),
  customs_handling_price_sar: z.number().nonnegative().optional().default(0),
  proposed_pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proposed_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operator_notes: z.string().trim().max(1000).optional(),
}).superRefine((val, ctx) => {
  if (val.proposed_delivery_date < val.proposed_pickup_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['proposed_delivery_date'],
      message: 'تاريخ التسليم يجب أن يكون بعد تاريخ الاستلام',
    });
  }
});
```

### §3.3 Admin Server Actions extension

Extend `app/actions/cargo-admin.ts` (PR 1) with 2 new actions for
guest-request accept/decline:

| Action | RPC | Notes |
|---|---|---|
| `adminAcceptCargoOfferOnBehalf(offer_id)` | §4.4 (admin path: both actor IDs NULL) | Returns `forbidden` if request.client_id IS NOT NULL |
| `adminDeclineCargoOfferOnBehalf({offer_id, reason?})` | §4.5 (admin path) | Same gate |

Both call `requireAdminSession()` first (PR 1 round 1 P1 #1
discipline carries forward).

---

## §4 Pages

### §4.1 Client portal (`/me/cargo-requests/...`)

Mirror of `/me/requests` (Phase 9) for cargo. All pages:
- Server Components with `dynamic = 'force-dynamic'`
- Gated behind `ENABLE_CARGO` flag (404 when off)
- Require client session (redirect to `/login`)
- RTL Arabic; reuse `cargoAr` i18n strings

| Route | Purpose | Components |
|---|---|---|
| `/me/cargo-requests` | List client's cargo requests sorted by `pickup_date ASC` | `CargoRequestsList` (NEW) — same table shape as admin queue but read-only |
| `/me/cargo-requests/new` | Authed form (re-uses `<CargoRequestForm>` from PR 1 with `mode='authed'`) | Form prop `mode`: `'guest'` (PR 1) vs `'authed'` (NEW); authed mode hides customer fields |
| `/me/cargo-requests/[id]` | Detail + offers table + accept/decline buttons + cancel button | `CargoRequestDetail` (NEW) + `CargoOffersTable` (NEW) + `<AcceptOfferButton>` + `<DeclineOfferButton>` + `<CancelRequestButton>` |

**Form `mode` extension** (`components/cargo/cargo-request-form.tsx`):
- Add `mode: 'guest' | 'authed'` prop
- Authed mode: skip rendering customer fields (name/phone/email
  rows) and submit via `submitCargoRequestAuthed` instead of
  `submitCargoRequestGuest`
- One file, conditional rendering keyed on `mode`

**Detail page query** (in `lib/cargo/queries/client-detail.ts`, NEW):
- Fetch request by id (RLS via service-role + explicit
  `client_id = session_id` filter — defense-in-depth)
- Fetch all offers for request, ORDER BY `created_at ASC`
- Compute `acceptable` flag per offer (status='pending' AND
  request.status IN ('pending','offers_received') AND
  offer.expires_at > NOW())

### §4.2 Operator portal (`/operator/cargo/...`)

| Route | Purpose | Components |
|---|---|---|
| `/operator/cargo` | List cargo requests dispatched to operator (deferred — PR 3 wires distribution; in PR 2 this lists requests where operator has at least one offer OR the operator can self-discover via direct nav) | `OperatorCargoRequestsList` (NEW) |
| `/operator/cargo/[id]/offer` | Submit offer form | `<CargoOfferForm>` (NEW) — calls `submitCargoOffer` |
| `/operator/cargo/offers` | Operator's submitted offers + status + withdraw button | `OperatorCargoOffersList` (NEW) + `<WithdrawOfferButton>` |

**Aircraft picker** (in `<CargoOfferForm>`): `<select>` showing
only operator's aircraft that have a `cargo_aircraft_capabilities`
row matching the request's `cargo_type` (filtered server-side).
Empty state: "لا توجد طائرات مسجّلة لهذا النوع من الشحن. تواصل
مع فريق Aeris."

### §4.3 Admin extension (`/admin/cargo/[id]`)

PR 1 page (`app/(admin)/admin/(protected)/cargo/[id]/page.tsx`)
gains:
- Per-offer "قبول نيابة" + "رفض" buttons (visible only when
  `request.client_id IS NULL` — guest path)
- Buttons are wired to `adminAcceptCargoOfferOnBehalf` /
  `adminDeclineCargoOfferOnBehalf` Server Actions
- Cancel-request button (visible when guest + status pending/offers_received)

---

## §5 Tests

### §5.1 `lib/cargo/__tests__/accept-flow.test.ts` (NEW)

Layer-1 (no DB) tests on Server Action error mapping. 5 cases:

| # | Case | Expected |
|---|---|---|
| 1 | Guest accept (admin path; both actor IDs NULL passed to RPC) | `{ ok: true, booking_id }` (mocked RPC returns success) |
| 2 | Authed accept (client_id set, admin_id NULL) | `{ ok: true }` |
| 3 | Expired offer (RPC returns `offer_not_pending` with `current_status='expired'`) | `{ ok: false, error: 'offer_not_pending' }` |
| 4 | Already-accepted (RPC returns `request_already_accepted`) | `{ ok: false, error: 'request_already_accepted' }` |
| 5 | Forbidden (client tries to accept another client's offer) | `{ ok: false, error: 'forbidden' }` |

Tests mock `createAdminClient` to return canned RPC responses; no
real DB call. Runs as `npm run test:cargo-accept-flow`.

### §5.2 `lib/cargo/__tests__/booking-shape.test.ts` (NEW)

Pure assertion test on the expected post-accept booking row
shape (parent §4.4 invariant):

```ts
test('cargo booking shape matches Phase 6/9 contract', () => {
  // After accept_cargo_offer success, the bookings row inserted
  // by the RPC must satisfy:
  const expectedShape = {
    offer_id: null,                       // legacy column
    trip_request_id: null,                // not from charter funnel
    source_offer_table: 'cargo_offers',   // §3.4.2 extension
    source_offer_id: 'expect-not-null',   // accepted offer UUID
    source_discriminator: 'cargo',        // §3.4.1 ENUM extension
  };
  // ... assert ...
});
```

This test pins the contract for /me/bookings code (Phase 9 PR 3 +
Phase 10 PR 2) which keys on `client_id` then reads rows directly
— no `offer_id` join. Any future code that adds `offer_id`-keyed
queries must explicitly handle the NULL case.

### §5.3 `lib/cargo/__tests__/cargo-offer-validators.test.ts` (NEW)

Layer-1 Zod schema tests for `cargoOfferSchema`. ~8 cases:
- happy path with all fields
- happy path with optional fields omitted
- date order (delivery before pickup) → fails
- price 0 / negative → fails
- aircraft_id missing → fails
- whitespace-only aircraft_snapshot trimmed
- price types (string vs number)
- operator_notes max length

Runs as `npm run test:cargo-offer-validators`.

---

## §6 Founder probes

### Probe 30 — Authed cargo request appears in /me/cargo-requests

Per parent §6 probe 30. Authed user submits request via
`/me/cargo-requests/new` → reloads list → sees row with status
`pending`. Verifier:

```sql
SELECT id, cargo_request_number, status, client_id, customer_name_snapshot
  FROM cargo_requests
 WHERE client_id = '<session_client_id>'
 ORDER BY created_at DESC LIMIT 1;
-- Expect: status='pending', client_id matches, customer_name_snapshot
-- equals the client's full_name (from clients table, not payload)
```

### Probe 31 — Offer → accept → booking with source chip

Per parent §6 probe 31. Operator submits offer via
`/operator/cargo/[id]/offer` → client sees offer in detail page →
client clicks "قبول العرض" → booking created → /me/bookings shows
new row with "شحن" chip (emerald color, shipped in PR 1).

Verifier (post-accept):

```sql
SELECT b.id, b.booking_number, b.source_discriminator,
       b.source_offer_table, b.source_offer_id, b.offer_id, b.trip_request_id,
       co.id AS offer_id_check, co.status AS offer_status,
       cr.status AS request_status, cr.accepted_offer_id
  FROM bookings b
  JOIN cargo_offers co ON co.id = b.source_offer_id
  JOIN cargo_requests cr ON cr.id = co.cargo_request_id
 WHERE cr.id = '<request_id>';
-- Expect:
--   source_discriminator='cargo'
--   source_offer_table='cargo_offers'
--   source_offer_id IS NOT NULL
--   offer_id IS NULL
--   trip_request_id IS NULL
--   offer_status='accepted'
--   request_status='accepted'
--   accepted_offer_id = source_offer_id
```

---

## §7 Acceptance criteria

PR 2 is mergeable when ALL of the following hold:

1. **Codex review:** spec at 100/100 (this file) + implementation
   PR at 100/100.
2. **Type-check:** `npm run type-check` clean.
3. **Lint:** `npm run lint` clean (zero warnings).
4. **Tests:** all of:
   - `npm run test:cargo-request-validators` (PR 1, 19/19)
   - `npm run test:cargo-offer-validators` (NEW, ≥8/8)
   - `npm run test:cargo-accept-flow` (NEW, 5/5)
   - all prior Phase 7-10 test scripts (regression)
5. **Migration:** replay-safe (re-running on fresh DB succeeds;
   re-running on PR 1-applied DB succeeds; standard Phase 9 DO-block
   guards for ENUMs / CONSTRAINTs).
6. **Flag discipline:** `ENABLE_CARGO` flag still gates EVERY new
   page + Server Action (no surface accidentally always-on).

---

## §8 Production activation runbook (PR 2 closure)

Same shape as Phase 10 activation:

1. Apply migration `20260519000031_phase_11_pr_2_cargo_offers_booking.sql`
   on production Supabase via `supabase db push`.
2. Founder runs Probe 28 (parent §6) to verify the post-PR-2 schema state.
3. Set `ENABLE_CARGO=true` on Vercel.
4. Founder runs Probe 30 + 31 against production.
5. Monitor `audit_logs` for cargo events for 7 days; if any
   `cargo_offer_declined` or `cargo_request_cancelled` shows
   anomalous patterns, file follow-up.

PR 3 (distribution) lands separately and does NOT block this
activation — operators can still self-discover requests via direct
nav until distribution lands.

---

## §9 Codex review history

(To be filled by Codex during review.)

| Round | Findings | Resolved at |
|---|---|---|
| 0 | (initial draft) | — |
