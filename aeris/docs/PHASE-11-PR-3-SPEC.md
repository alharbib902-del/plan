# Phase 11 PR 3 — Distribution + notifications + ops polish (delta spec)

> **Status:** Draft (round 0). Awaiting Codex review.
> **Scope:** Distribution engine + notifications pipeline + cron route +
> 6th canary card + manual dispatch button + probe 32.
> **Activation baseline:** PR 1 + PR 2 live in production since
> `2026-05-16`. See `docs/PHASE-11-ACTIVATION-NOTES.md` for the
> full activation runbook + booking-shape proof + hotfix log.
> **Source of truth:** `docs/PHASE-11-CARGO-SPEC.md` §5 PR 3
> + §6 probe 32 + Decision #10 (per-client submission rate alert).
> This file is a **delta** — it does NOT redefine schema or RPC
> contracts already locked in the parent spec. It only resolves
> the "PR 3" deliverables and pins the new outbox / cron /
> notification surfaces.
>
> **Out of scope (deferred to Phase 14):**
> - Cargo booking cancellation flow (post-accept) — bundled with
>   HyperPay payment integration phase
> - Cargo invoicing (ZATCA) — Phase 14
> - Operator payouts on cargo bookings — Phase 14
>
> **Defaults inherited:** all locked decisions in §2 of the parent
> spec carry forward unchanged.

---

## §1 Scope summary

| Layer | Item | Origin |
|---|---|---|
| Migration | `cargo_dispatch_events_outbox` table + indexes + RLS | Parent §5 PR 3; full SQL here |
| Migration | `publish_cargo_dispatch_event` RPC | New, this spec |
| Migration | Trigger on `cargo_requests` INSERT → outbox emit | New, this spec |
| TS pipeline | `lib/cargo/distribution.ts` — eligible operator scoring | Parent §5 PR 3; signature here |
| TS pipeline | `lib/cargo/notifications.ts` — operator email + wa.me builders | Parent §5 PR 3 |
| TS pipeline | `lib/cargo/founder-batch-email.ts` — admin alert | Decision #10; full contract here |
| Cron route | `/api/cron/cargo/dispatch-drain` (every 15 min) | Parent §5 PR 3 |
| Admin | 6th `<ChannelHealth>` card on `/admin/operators/canary` | Parent §3.6 + §5 PR 3 |
| Admin | `/admin/cargo/[id]/distribute` manual dispatch button | Parent §5 PR 3 |
| Observability | Per-operator `cargo_dispatch_count_24h` metric | Parent §5 PR 3 |
| Tests | `distribution-scoring.test.ts` + `outbox-drain.test.ts` + `cron-auth.test.ts` | New, this spec |
| Probes | 32 (distribution filter by capability) | Parent §6 |

**Estimated lines of code:** ~900 (matches parent §5 PR 3 budget
~800 + small overhead for the manual-dispatch admin button).

---

## §2 Migration `20260520000032_phase_11_pr_3_cargo_distribution.sql`

### §2.1 `cargo_dispatch_events_outbox` table

Mirror of Phase 7 `empty_leg_events_outbox` shape. Each row is a
durable record of "this cargo_request needs to be dispatched to
operators." The cron drains by claiming rows where
`processed_at IS NULL`.

```sql
CREATE TABLE IF NOT EXISTS cargo_dispatch_events_outbox (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_request_id  UUID NOT NULL
                      REFERENCES cargo_requests(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL
                      CHECK (event_type IN ('initial', 'manual_redispatch')),
  emitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Round 1 PR #72 P1 #2 — claim-before-send columns.
  -- claim_id stamps a UUID at SELECT time; the marker UPDATE
  -- later writes processed_at only if the same claim_id matches.
  -- Combined with FOR UPDATE SKIP LOCKED in §5.2, two concurrent
  -- cron runs CANNOT both notify the same operators (the second
  -- worker skips locked rows entirely, so it never reads them).
  -- claimed_at also enables a 5-minute lease recovery: a crashed
  -- worker's claim is reclaimable so rows don't stick forever.
  claim_id          UUID,
  claimed_at        TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,
  -- Per-attempt metadata so the cron can record what happened
  -- (success count, failure count, skipped reasons) without
  -- separate audit tables.
  dispatch_result   JSONB,
  attempt_count     INT NOT NULL DEFAULT 0
);

-- Drain partial index — pending AND not currently claimed (or
-- claim lease expired). The cron's claim UPDATE reads from this.
CREATE INDEX IF NOT EXISTS idx_cargo_dispatch_outbox_pending
  ON cargo_dispatch_events_outbox(emitted_at ASC)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cargo_dispatch_outbox_request
  ON cargo_dispatch_events_outbox(cargo_request_id, emitted_at DESC);

ALTER TABLE cargo_dispatch_events_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only (cron + admin actions).
```

### §2.2 `publish_cargo_dispatch_event` RPC

Mirror of `publish_empty_leg_event`. Called by:
- the INSERT trigger (§2.3) on `cargo_requests` (event_type='initial')
- the manual dispatch admin Server Action (event_type='manual_redispatch')

```sql
CREATE OR REPLACE FUNCTION publish_cargo_dispatch_event(
  p_cargo_request_id UUID,
  p_event_type       TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_event_type NOT IN ('initial', 'manual_redispatch') THEN
    RETURN json_build_object('ok', false, 'error', 'event_type_invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cargo_requests WHERE id = p_cargo_request_id) THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_request_not_found');
  END IF;

  INSERT INTO cargo_dispatch_events_outbox (cargo_request_id, event_type)
    VALUES (p_cargo_request_id, p_event_type);

  RETURN json_build_object('ok', true, 'cargo_request_id', p_cargo_request_id);
END;
$$;

REVOKE ALL ON FUNCTION publish_cargo_dispatch_event(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_cargo_dispatch_event(UUID, TEXT) TO service_role;
```

### §2.3 Trigger on `cargo_requests` INSERT

Auto-emit `'initial'` event when ANY cargo request is created
(guest or authed). The cron picks up + scores eligible operators
+ dispatches. The TRIGGER is `AFTER INSERT` so the request row is
fully committed before the outbox row appears.

```sql
CREATE OR REPLACE FUNCTION cargo_requests_dispatch_trigger()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only emit for actionable statuses; pre-cancelled or pre-
  -- expired inserts (shouldn't happen, but defensive) skip.
  IF NEW.status IN ('pending', 'offers_received') THEN
    PERFORM publish_cargo_dispatch_event(NEW.id, 'initial');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cargo_requests_dispatch_trigger ON cargo_requests;
CREATE TRIGGER cargo_requests_dispatch_trigger
  AFTER INSERT ON cargo_requests
  FOR EACH ROW EXECUTE FUNCTION cargo_requests_dispatch_trigger();
```

### §2.4 Schema delta on `cargo_email_alert_status`

The singleton was seeded in PR 1 §3.6. PR 3 doesn't add new
columns — it just starts writing to it from the
`/api/cron/cargo/dispatch-drain` route via the same
`mark_*_alert_*` Phase 7+ helpers (no schema change needed).

### §2.5 Schema delta on `cargo_requests` (Round 1 PR #72 P2 #4 fix)

Add a per-request flag for founder-batch-alert throttling. The
earlier draft tried to throttle via `dispatch_result.founder_alerted`
on the outbox row, but `manual_redispatch` creates a new outbox
row so the previous row's flag is invisible. Fix: store the
"already alerted" timestamp on the parent `cargo_requests` row
so EVERY outbox event for the same request sees the same flag.

```sql
ALTER TABLE cargo_requests
  ADD COLUMN IF NOT EXISTS founder_batch_alerted_at TIMESTAMPTZ;
```

Replay-safe (`IF NOT EXISTS`). No CHECK constraint needed — the
column is purely informational + serves as the throttle predicate.
The `sendFounderCargoBatchAlert` helper (§4.2) reads + sets this
in a single round-trip:

```sql
UPDATE cargo_requests
   SET founder_batch_alerted_at = NOW()
 WHERE id = <cargo_request_id>
   AND founder_batch_alerted_at IS NULL
 RETURNING id;
```

If the UPDATE returns 0 rows, another worker (or a prior cron
run) already alerted — skip the email. Atomic + idempotent.

### §2.5 Replay safety

Same Phase 9 conventions as PR 1 + PR 2:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION`
- `CREATE INDEX IF NOT EXISTS`
- `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`
- All RPCs `REVOKE ALL FROM PUBLIC + GRANT TO service_role`

---

## §3 Distribution engine (`lib/cargo/distribution.ts`)

### §3.1 Candidate enumeration + skip-reason reporting (Round 1 PR #72 P1 #3 fix)

The earlier draft pre-filtered the candidate set by capability
join, which meant non-capable operators never appeared in the
result — but probe 32 expects them in `skip_reasons` with
`'no_capability'`. Fix: enumerate ALL approved operators, then
classify each into `dispatched | skipped` with an explicit
reason.

**Step 1 — load all approved operators:**

```sql
SELECT id, contact_email, contact_phone, company_name,
       <subquery for has_capability(cargo_type)>
       <subquery for last_dispatched_at>
  FROM operators
 WHERE signup_status = 'approved';
```

`has_capability(cargo_type)` is computed inline per row:

```sql
EXISTS (
  SELECT 1 FROM aircraft a
    JOIN cargo_aircraft_capabilities cac ON cac.aircraft_id = a.id
   WHERE a.operator_id = operators.id
     AND a.status = 'active'
     AND CASE <cargo_request.cargo_type>
           WHEN 'horse'      THEN cac.supports_horse
           WHEN 'luxury_car' THEN cac.supports_luxury_car
           WHEN 'valuables'  THEN cac.supports_valuables
           WHEN 'other'      THEN cac.supports_other
         END
) AS has_capability
```

(The same predicate the §4.3 RPC uses at offer-submit time —
keeps dispatch + accept in sync.)

`last_dispatched_at` is the max `created_at` from
`cargo_dispatch_events_outbox` joined through `cargo_requests`
that reached this operator (recorded in
`dispatch_result.dispatched_operator_ids`).

**Step 2 — classify each candidate:**

```
for each operator in candidates:
  if not has_capability:
    skip_reasons[id] = 'no_capability'
    continue
  recency_score = compute_recency(last_dispatched_at)
  if recency_score == 0:
    skip_reasons[id] = 'recently_dispatched'
    continue
  rating_score = (operators.rating ?? 3.0) / 5.0
  score = 0.4 * 1.0 + 0.3 * recency_score + 0.3 * rating_score
  push { id, score } to eligible
```

(Step 2 never produces `'not_approved'` because Step 1 already
filtered. The reason remains in the union for completeness —
e.g. for a future variant that also accepts pending operators
for canary tests, where pre-approved would surface as a skip
reason. Today no code path writes it; the type union just
permits it.)

**Step 3 — rank + cap:**

```
sort eligible by score desc
dispatched = eligible[0..5]
for each o in eligible[5..]:
  skip_reasons[o.id] = 'lower_score'
```

Step 3 captures the operators that were qualified but didn't
make the top-5 cut so the cron operator log shows why each
operator did or didn't receive a dispatch.

### §3.2 Scoring formula

Per parent spec §5 PR 3: capability match + last-dispatched
recency + operator rating. Concrete weights:

```ts
score = 0.40 * capability_match_quality
      + 0.30 * recency_score
      + 0.30 * rating_score

where:
  capability_match_quality = 1.0 if any aircraft supports it
                             (binary today; future could weight
                             by max_horse_count vs request count)

  recency_score = 1.0 if last_dispatched > 7 days ago
                  0.5 if 3-7 days
                  0.0 if < 3 days        ← rate-limit signal

  rating_score = (operators.rating ?? 3.0) / 5.0
                 (operators table has no `rating` column yet — use
                 3.0 default until Phase 13 Privilege adds the
                 rating-aggregation pipeline)
```

Top `N=5` operators dispatched per request. The "5" matches
the Phase 4-5 Trip Distribution Engine cap.

### §3.3 Signature

```ts
export interface CargoDispatchInput {
  cargo_request_id: string;
  event_type: 'initial' | 'manual_redispatch';
}

export type CargoDispatchSkipReason =
  | 'no_capability'        // operator lacks an active aircraft with the cargo_type capability (§3.1 step 2)
  | 'recently_dispatched'  // operator received a dispatch < 3 days ago (§3.2 recency_score=0)
  | 'lower_score'          // operator qualified but didn't make the top-5 cut (§3.1 step 3)
  | 'not_approved'         // reserved for a future variant that enumerates non-approved operators
  | 'notify_failed';       // dispatch attempted but the notification helper failed (§5.3)

export interface CargoDispatchResult {
  ok: true;
  dispatched_operator_ids: string[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, CargoDispatchSkipReason>;
  founder_alerted: boolean;  // set true iff sendFounderCargoBatchAlert returned sent=true
}

export async function dispatchCargoRequest(
  input: CargoDispatchInput
): Promise<CargoDispatchResult | { ok: false; error: string }>;
```

Called by the cron drain loop (§5) and by the manual-dispatch
admin action (§6.2).

---

## §4 Notifications pipeline

### §4.1 `lib/cargo/notifications.ts`

Two builders + one sender per operator:

```ts
// WhatsApp wa.me link (NO WhatsApp API — Aeris pattern is
// "click-to-chat" links that pre-fill the message; operator
// taps and the WA client opens).
export function buildOperatorWhatsAppLink(args: {
  operator_phone: string;
  cargo_request: CargoRequestRow;
  offer_form_url: string;
}): string;

// Resend email template
export function buildOperatorCargoEmail(args: {
  cargo_request: CargoRequestRow;
  offer_form_url: string;
}): { subject: string; html: string; text: string };

// Combined sender: writes WhatsApp link to outbox metadata,
// sends email via Resend, updates cargo_email_alert_status
// on failure.
export async function notifyOperatorOfCargo(args: {
  operator_id: string;
  operator_email: string;
  operator_phone: string;
  cargo_request: CargoRequestRow;
}): Promise<{ sent: boolean; channel: 'email' | 'whatsapp_link' }>;
```

Email template is RTL Arabic with cargo details + a CTA button
linking to `/operator/cargo/[id]/offer` (deep link to the offer
form, where `requireOperatorSession()` will redirect to login if
not authed — Phase 8 pattern).

### §4.2 `lib/cargo/founder-batch-email.ts` (Decision #10)

When the cron dispatches a cargo request to **all 5** top
operators (i.e., the request was sufficiently in-demand that the
full quota was consumed), send a single batch email to the
founder admin inbox:

```ts
export async function sendFounderCargoBatchAlert(args: {
  cargo_request: CargoRequestRow;
  dispatched_operator_ids: string[];
}): Promise<{ sent: boolean; reason?: 'already_alerted' | 'send_failed' }>;
```

Subject line: `[Aeris Cargo] طلب شحن جديد دُفع إلى {N} مشغّل`.
Body: snapshot of cargo_request + list of operator names + link
to `/admin/cargo/[id]`.

**Throttle (Round 1 PR #72 P2 #4 fix):** the function uses the
new `cargo_requests.founder_batch_alerted_at` column (§2.5) for
per-REQUEST throttling (NOT per outbox row, which would let
`manual_redispatch` re-trigger). Atomic claim:

```ts
// 1. Try to claim the alert via a single conditional UPDATE.
const { data: claim } = await admin
  .from('cargo_requests')
  .update({ founder_batch_alerted_at: new Date().toISOString() })
  .eq('id', cargo_request.id)
  .is('founder_batch_alerted_at', null)
  .select('id')
  .maybeSingle();

if (!claim) {
  // Another worker (or prior cron run) already alerted.
  return { sent: false, reason: 'already_alerted' };
}

// 2. Send the email; if Resend fails, the alerted_at flag stays
//    so we don't spam. (Cargo demand patterns are not
//    "must-deliver" — a single alert lost to a Resend outage is
//    acceptable; the operator-facing notifications are the
//    business-critical channel.)
```

### §4.3 Resend health → singleton

On any Resend failure during `notifyOperatorOfCargo` or
`sendFounderCargoBatchAlert`, the helper writes:

```sql
UPDATE cargo_email_alert_status
   SET status = 'send_failed',
       last_failure_at = NOW(),
       last_failure_reason = <truncated 200 chars>,
       updated_at = NOW()
 WHERE id = 1;
```

Success path resets `status='healthy'`. The 6th canary card (§6.1)
reads this singleton.

---

## §5 Cron route `/api/cron/cargo/dispatch-drain`

### §5.1 Schedule + auth

- **Schedule:** `*/15 * * * *` (every 15 minutes — same cadence as
  Phase 7 empty-leg drain). Configured in `vercel.json` cron entry.
- **Auth:** `Authorization: Bearer <CRON_SECRET>` (Round 1 PR
  #72 P1 #1 — env var name is `CRON_SECRET`, matching the
  existing Phase 7 helper `verifyCronAuth()` in
  `lib/empty-legs/cron-auth.ts`). The route reuses this helper
  verbatim:
  ```ts
  import { verifyCronAuth } from '@/lib/empty-legs/cron-auth';
  // ...
  const auth = verifyCronAuth(request.headers);
  if (auth.kind !== 'ok') return new Response(auth.body, { status: 401 });
  ```
  The secret is a Vercel-managed env var, NOT shared with any UI
  surface. The route refuses 401 if missing/wrong, 500 if
  `CRON_SECRET` env var unset.

### §5.2 Drain loop — claim-before-send (Round 1 PR #72 P1 #2 fix)

The earlier draft had a "SELECT then UPDATE WHERE processed_at IS
NULL" pattern that only prevented double-MARK, not double-SEND:
two concurrent cron runs could both read the same pending rows
and notify the same operators before either marked them. The
fix is **claim-before-send** via an atomic UPDATE that stamps a
`claim_id` + `claimed_at` and reads the rows in the same
statement, plus `FOR UPDATE SKIP LOCKED` to make concurrent
workers see disjoint row sets.

```
1. Generate a per-run claim_id (uuid_generate_v4() in JS).

2. Atomic claim: stamp claim_id + claimed_at AND return the rows
   we successfully claimed. The inner SELECT uses FOR UPDATE
   SKIP LOCKED so a parallel worker sees a disjoint set.

     UPDATE cargo_dispatch_events_outbox
        SET claim_id = <RUN_CLAIM_ID>,
            claimed_at = NOW(),
            attempt_count = attempt_count + 1
      WHERE id IN (
        SELECT id FROM cargo_dispatch_events_outbox
         WHERE processed_at IS NULL
           AND (claimed_at IS NULL
                OR claimed_at < NOW() - INTERVAL '5 minutes')
         ORDER BY emitted_at ASC
         LIMIT 20
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, cargo_request_id, event_type;

   - The `OR claimed_at < NOW() - INTERVAL '5 minutes'` clause is
     a lease-reclaim — a crashed worker's claim becomes
     reclaimable after 5 minutes so rows don't stick forever.
   - `attempt_count` increments on every claim (success OR
     subsequent reclaim), giving observability into stuck rows.

3. For each claimed row (returned from step 2):
   3.1. Load cargo_request by id (skip if status no longer
        actionable — e.g. cancelled in flight).
   3.2. Call dispatchCargoRequest() → eligible + scored operators.
   3.3. For each dispatched operator: notifyOperatorOfCargo().
   3.4. If exactly N=5 operators dispatched AND request hasn't
        been founder-alerted before: sendFounderCargoBatchAlert()
        (see §4.2 throttle).
   3.5. Mark processed — ONLY if our claim still owns the row.
        The `AND claim_id = <RUN_CLAIM_ID>` guard prevents
        clobbering a row that a reclaim-worker has since claimed.
          UPDATE cargo_dispatch_events_outbox
             SET processed_at = NOW(),
                 dispatch_result = <JSONB summary>
           WHERE id = <claimed id>
             AND claim_id = <RUN_CLAIM_ID>
             AND processed_at IS NULL;

4. Return JSON summary: { ok: true, claimed: N, processed: M,
                          skipped: K, errors: E }.
```

Why this is safe under concurrent cron runs:
- **No double-send:** step 2's `FOR UPDATE SKIP LOCKED` makes
  worker B see a disjoint row set from worker A. Each worker
  only sends notifications for rows IT claimed.
- **No double-mark:** step 3.5's `claim_id = <RUN_CLAIM_ID>`
  guard ensures only the claiming worker writes the result.
- **Crash recovery:** the 5-minute lease lets a new run reclaim
  rows whose worker died mid-flight (no stuck rows after a
  cold-start timeout).

### §5.3 Error handling

- **Individual operator notify failure:** the operator was
  chosen by the scoring loop (so they're in
  `dispatched_operator_ids` at first), but `notifyOperatorOfCargo`
  threw. Move the id from `dispatched_operator_ids` to
  `skipped_operator_ids` and record
  `skip_reasons[operator_id] = 'notify_failed'` (in the
  `CargoDispatchSkipReason` union — Round 1 PR #72 P2 #5 fix
  added this variant). Continue with next operator.
- **Whole-request failure** (e.g. cargo_request deleted
  mid-drain): mark `processed_at = NOW()` with
  `dispatch_result = { error: 'request_not_actionable' }` (NOT
  a `skip_reasons` entry — that union is per-operator; this is
  the per-request error envelope) so the row doesn't retry forever.
- **Resend down:** caught by the singleton update (§4.3); cron
  continues with WhatsApp-link-only dispatch. Operators who
  received only the WhatsApp link are still in
  `dispatched_operator_ids`.

---

## §6 Admin extensions

### §6.1 6th `<ChannelHealth>` card on `/admin/operators/canary`

Reads from `cargo_email_alert_status` singleton. Renders one of
3 states:

| singleton.status | card color | label |
|---|---|---|
| `healthy` | emerald | "بريد العملاء — شحن (Resend) — سليم" |
| `config_missing` | amber | "بريد العملاء — شحن — إعداد ناقص" |
| `send_failed` | rose | "بريد العملاء — شحن — فشل آخر إرسال {timeago}" |

i18n key already exists in `cargoAr.canaryCargoEmailChannel` (PR
1). The card data fetch reuses the canary page's existing
`Promise.all()` pattern.

### §6.2 `/admin/cargo/[id]/distribute` manual dispatch button

A new admin Server Action `adminManualDispatchCargoRequest` that:
1. Calls `requireAdminSession()` (PR 1 round 1 P1 #1 discipline)
2. Validates `request_id` via `cancelRequestSchema.request_id`
   (re-uses UUID guard)
3. Inserts outbox event via `publish_cargo_dispatch_event(id,
   'manual_redispatch')`
4. Optionally triggers immediate cron drain (POST to internal
   `/api/cron/cargo/dispatch-drain` with the shared secret).
   Defer the immediate-trigger to a future polish; v1 of this
   action just inserts the outbox row and lets the next 15-min
   cron pick it up.

The button renders on `/admin/cargo/[id]` only when:
- request.status IN ('pending', 'offers_received')
- request.client_id IS NULL OR IS NOT NULL (both paths get
  manual dispatch — admin override is legitimate either way)

Label: "إعادة توزيع يدوياً" (gold styling, distinct from accept/
decline/cancel rows).

### §6.3 Per-operator `cargo_dispatch_count_24h`

Surfaced via canary as a small stat next to the 6th card:

```sql
SELECT count(*) AS dispatch_count_24h
  FROM cargo_dispatch_events_outbox
 WHERE processed_at >= NOW() - INTERVAL '24 hours';
```

The card shows: "آخر 24 ساعة: {N} طلب تم توزيعه". Low/zero
is a smoke signal for cron-down or operator-pool-empty.

---

## §7 Tests

### §7.1 `lib/cargo/__tests__/distribution-scoring.test.ts` (NEW)

Layer-1 (no DB). Pure scoring function tests:

| # | Case | Expected |
|---|---|---|
| 1 | 1 capable operator, last dispatched 10 days ago | score ≈ 0.4 + 0.3 + 0.18 = 0.88 |
| 2 | 1 capable operator, last dispatched 5 days ago | score with recency=0.5 → ≈ 0.73 |
| 3 | 1 capable operator, last dispatched 1 day ago | score with recency=0.0 → ≈ 0.58 |
| 4 | 0 capable operators | result.dispatched_operator_ids = [] |
| 5 | 7 capable operators all 10 days ago | result returns top 5 |

### §7.2 `lib/cargo/__tests__/outbox-drain.test.ts` (NEW)

Layer-1: pure drain-loop logic with mocked Supabase responses:

| # | Case | Expected |
|---|---|---|
| 1 | 1 pending outbox row | claims + processes + marks processed |
| 2 | 1 pending row, cargo_request cancelled mid-drain | marks processed + skip_reason='request_not_actionable' |
| 3 | 1 pending row, dispatchCargoRequest returns 0 operators | marks processed + dispatch_result.dispatched=[] |
| 4 | 5 operators dispatched | sendFounderCargoBatchAlert called once |
| 5 | < 5 operators dispatched | sendFounderCargoBatchAlert NOT called |

### §7.3 `app/api/cron/cargo/__tests__/cron-auth.test.ts` (NEW)

Layer-1: route handler auth:

| # | Case | Expected |
|---|---|---|
| 1 | Missing Authorization header | 401 |
| 2 | Wrong bearer | 401 |
| 3 | Correct bearer | 200 |
| 4 | Env var unset (CRON_SECRET = "") | 500 |

Mirror of `app/api/empty-legs/__tests__/cron-auth.test.ts` shape.

---

## §8 Probe 32 — Distribution filter by capability

Per parent spec §6 probe 32.

### Pre-condition
- 2 cargo operators in production, both approved
- Only 1 has horse capability seeded (`cargo_aircraft_capabilities.
  supports_horse=true`)

### Test
1. Submit a `horse` cargo request via `/cargo`
2. Trigger the cron route manually:
   ```bash
   curl -X POST 'https://aeris-flax.vercel.app/api/cron/cargo/dispatch-drain' \
        -H 'Authorization: Bearer <CRON_SECRET>'
   ```
3. Verify the outbox row:
   ```sql
   SELECT cargo_request_id, processed_at, dispatch_result
     FROM cargo_dispatch_events_outbox
    WHERE cargo_request_id = '<id>';
   ```
   **Expected:** `dispatch_result.dispatched_operator_ids` contains
   ONLY the horse-capable operator's id. The other operator
   appears in `skip_reasons` with `'no_capability'`.

### Cleanup
Same pattern as Phase 11 PR 2 activation cleanup (Phase F notes):
delete cargo_request → cascades cargo_offers + cargo_dispatch_outbox
rows.

---

## §9 Acceptance criteria

PR 3 is mergeable when ALL of the following hold:

1. **Codex review:** spec at 100/100 (this file) + implementation
   PR at 100/100.
2. **Type-check:** `npm run type-check` clean.
3. **Lint:** `npm run lint` clean (zero warnings).
4. **Tests:** all of:
   - All Phase 11 PR 1 + PR 2 tests (51, regression)
   - `npm run test:cargo-distribution-scoring` (NEW, ≥5/5)
   - `npm run test:cargo-outbox-drain` (NEW, ≥5/5)
   - `npm run test:cargo-cron-auth` (NEW, ≥4/4)
   - All prior Phase 7-10 test scripts (regression)
5. **Migration:** replay-safe (Phase 9 convention).
6. **Flag discipline:** `ENABLE_CARGO` continues to gate the new
   surfaces. Cron route additionally checks `CRON_SECRET`.
7. **Activation runbook** (§10) ran cleanly on production with
   probe 32 green.

---

## §10 Production activation runbook (PR 3 closure)

Same shape as PR 2 activation (Phase E + F succeeded), with one
extra prerequisite: a **second test operator** with capability
explicitly excluded for the cargo_type under test (per probe 32).

1. Apply migration `20260520000032_phase_11_pr_3_cargo_distribution.sql`
   on production Supabase via SQL Editor.
2. Set `CRON_SECRET` env var on Vercel (if not already set
   for Phase 7 — re-use the same secret).
3. Add the cron entry to `vercel.json`:
   ```json
   { "path": "/api/cron/cargo/dispatch-drain", "schedule": "*/15 * * * *" }
   ```
4. Redeploy production.
5. Seed a second operator with NO horse capability (DB-only SQL).
6. Submit a horse cargo request via `/cargo`.
7. Trigger cron manually (curl + bearer).
8. Run probe 32 → verify only the capable operator received
   the dispatch.
9. Wait 24h, check `/admin/operators/canary` → 6th card
   reads `healthy` + dispatch_count_24h ≥ 1.
10. Cleanup test data.
11. Phase 11 closure: all 3 PRs activated, all 5 probes passed.

PR 3 carries forward the Phase 9 conventions around replay
safety, structured-error contracts, and immutable snapshots
(operator names/phones/emails snapshotted at dispatch time inside
`dispatch_result` JSONB for audit trail).

---

## §11 Codex review history

(To be filled by Codex during review.)

| Round | Findings | Resolved at |
|---|---|---|
| 0 | (initial draft) | — |
