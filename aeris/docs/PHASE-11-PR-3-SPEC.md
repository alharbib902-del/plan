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
  processed_at      TIMESTAMPTZ,
  -- Per-attempt metadata so the cron can record what happened
  -- (success count, failure count, skipped reasons) without
  -- separate audit tables.
  dispatch_result   JSONB,
  attempt_count     INT NOT NULL DEFAULT 0
);

-- Drain partial index (Phase 7 pattern):
-- "SELECT id WHERE processed_at IS NULL ORDER BY emitted_at LIMIT N"
-- then "UPDATE WHERE id IN (...) AND processed_at IS NULL".
-- The IS NULL guard prevents double-processing under concurrent
-- workers — no FOR UPDATE SKIP LOCKED needed.
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

### §2.5 Replay safety

Same Phase 9 conventions as PR 1 + PR 2:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION`
- `CREATE INDEX IF NOT EXISTS`
- `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`
- All RPCs `REVOKE ALL FROM PUBLIC + GRANT TO service_role`

---

## §3 Distribution engine (`lib/cargo/distribution.ts`)

### §3.1 Eligibility filter

Given a `cargo_request`, the eligible operator set is:

```ts
operators WHERE
  signup_status = 'approved'
  AND EXISTS (
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
  )
```

i.e., operator must (a) be approved AND (b) own at least one
active aircraft with a capability row matching the request's
`cargo_type`. The capability check is the SAME predicate used at
offer-submit time (§4.3 RPC), so the dispatch never targets an
operator whose offer would later be rejected.

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

export interface CargoDispatchResult {
  ok: true;
  dispatched_operator_ids: string[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, 'recently_dispatched' | 'no_capability' | 'not_approved'>;
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
}): Promise<{ sent: boolean }>;
```

Subject line: `[Aeris Cargo] طلب شحن جديد دُفع إلى {N} مشغّل`.
Body: snapshot of cargo_request + list of operator names + link
to `/admin/cargo/[id]`. Throttled to once per cargo_request via
the `cargo_dispatch_events_outbox.dispatch_result.founder_alerted`
flag (set on first dispatch, checked on subsequent
`manual_redispatch` events).

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
- **Auth:** `Authorization: Bearer <CRON_AUTH_SECRET>` (Phase 7
  pattern; the secret is a Vercel-managed env var, NOT shared
  with any UI surface). The route refuses 401 if the header is
  missing or doesn't match.

### §5.2 Drain loop

```
1. Claim up to N=20 pending outbox rows (batch size cap to avoid
   serverless timeout):
     SELECT id, cargo_request_id, event_type
       FROM cargo_dispatch_events_outbox
      WHERE processed_at IS NULL
      ORDER BY emitted_at ASC
      LIMIT 20;
2. For each claimed row:
   2.1. Load cargo_request by id (skip if status no longer
        actionable — e.g. cancelled in flight).
   2.2. Call dispatchCargoRequest() → eligible + scored operators.
   2.3. For each dispatched operator: notifyOperatorOfCargo().
   2.4. If 5 operators dispatched: sendFounderCargoBatchAlert().
   2.5. Update the outbox row:
          UPDATE cargo_dispatch_events_outbox
             SET processed_at = NOW(),
                 attempt_count = attempt_count + 1,
                 dispatch_result = <JSONB summary>
           WHERE id = <claimed id>
             AND processed_at IS NULL;        ← double-process guard
3. Return JSON summary: { ok: true, processed: N, skipped: M, errors: K }
```

### §5.3 Error handling

- Individual operator notify failure: log to console + record in
  `dispatch_result.skip_reasons[operator_id] = 'notify_failed'`,
  continue with next operator.
- Whole-request failure (e.g. cargo_request deleted mid-drain):
  mark `processed_at = NOW()` with `dispatch_result = { skipped:
  'request_not_actionable' }` so the row doesn't retry forever.
- Resend down: caught by the singleton update (§4.3); cron
  continues with WhatsApp-link-only dispatch.

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
| 4 | Env var unset (CRON_AUTH_SECRET = "") | 500 |

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
        -H 'Authorization: Bearer <CRON_AUTH_SECRET>'
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
   surfaces. Cron route additionally checks `CRON_AUTH_SECRET`.
7. **Activation runbook** (§10) ran cleanly on production with
   probe 32 green.

---

## §10 Production activation runbook (PR 3 closure)

Same shape as PR 2 activation (Phase E + F succeeded), with one
extra prerequisite: a **second test operator** with capability
explicitly excluded for the cargo_type under test (per probe 32).

1. Apply migration `20260520000032_phase_11_pr_3_cargo_distribution.sql`
   on production Supabase via SQL Editor.
2. Set `CRON_AUTH_SECRET` env var on Vercel (if not already set
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
