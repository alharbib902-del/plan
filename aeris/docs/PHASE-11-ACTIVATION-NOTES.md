# Phase 11 — Cargo activation notes

> **Status:** Phase 11 closed on production `2026-05-16`.
> **Scope:** PR 1 (intake) + PR 2 (offers/bookings) + PR 3
> (distribution / notifications / cron / canary).
>
> This file documents the activation runbook execution across all
> 3 PRs + the hotfixes flushed out by founder smoke testing + the
> end-to-end verification against real DB (Probes 28, 30, 31, 32).

---

## Timeline

| Step | Date | Reference |
|---|---|---|
| Phase 11 spec accepted at 100/100 | `2026-05-15` | PR #61 / #64 (merged `6f70662`) |
| PR 1 (backend + public form + admin intake) merged | `2026-05-15` | PR #65 (merged `bd5064c`) |
| PR 2 spec accepted at 100/100 | `2026-05-16` | PR #66 (merged `0b31c9b`) |
| PR 2 (offers/bookings) merged | `2026-05-16` | PR #67 (merged `a84560d`) |
| Hotfix #1: cargo UI polish + `aircraft.type` | `2026-05-16` | PR #68 (merged `ccd6b88`) |
| Hotfix #2: `aircraft.type` in operator capability picker | `2026-05-16` | PR #69 (merged `d47c203`) |
| Hotfix #3: cargo tables alignment | `2026-05-16` | PR #70 (merged `c63bd39`) |
| Production activation (`ENABLE_CARGO=true`) | `2026-05-16` | Vercel env var flip + redeploy |
| Activation notes #1 (PR 1+2 closure) | `2026-05-16` | PR #71 (merged `6c5abf3`) |
| PR 3 spec accepted at 100/100 (6 Codex rounds) | `2026-05-16` | PR #72 (merged `2160adc`) |
| PR 3 (distribution + cron + canary) merged | `2026-05-16` | PR #73 (merged `5692d2d`) |
| PR 3 migration applied to Supabase | `2026-05-16` | 10/10 schema verifier checks ✅ |
| Probe 32 verified (distribution filter by capability) | `2026-05-16` | Probe 14 → `'no_capability'`; Probe 18 dispatched via wa.me metadata |

---

## Migrations applied to Supabase

1. **Legacy cleanup** (one-off DO block):
   - Dropped `cargo_requests` + `cargo_type` + `cargo_status` from
     `initial_schema.sql` (Day-1 prototype with totally different
     shape — `equine/automotive/high_value/time_critical` vs the
     Phase 11 `horse/luxury_car/valuables/other`).
   - Safe-guarded: the script refused to drop if the legacy table
     had any rows (production had 0).
2. **`20260518000030_phase_11_pr_1_cargo_intake.sql`** (1,061 lines)
   - 4 new tables, 3 new ENUMs, FK + invariant CHECKs, RLS, RPCs
     §4.1 `create_cargo_request_guest` + §4.2
     `create_cargo_request_authenticated` + §4.3 `submit_cargo_offer`.
3. **`20260519000031_phase_11_pr_2_cargo_offers_booking.sql`**
   - 3 schema deltas (2 `cargo_offers` reason columns + length
     CHECKs, `cargo_requests.cancellation_reason` length CHECK,
     `bookings` 6 financial columns widened to `DECIMAL(14,2)`).
   - 4 new RPCs: §4.4 `accept_cargo_offer`, §4.5 `decline_cargo_offer`
     + `withdraw_cargo_offer`, §4.6 `cancel_cargo_request`.

Both migrations are replay-safe (Phase 9 convention): ENUM /
constraint / column guards via `pg_constraint` + `pg_type` +
`information_schema.columns` checks.

---

## Probes results

### Probe 28 — Schema state (33 checks)

All 33 boolean assertions returned `true` ✅ — every named
constraint, ENUM, RLS flag, widened column, and length CHECK
that PR 1 + PR 2 introduced is present and intact.

### Probe 30 — Authed cargo request via SQL-only path

```
rpc_result = { ok: true, cargo_request_id: '96d5a037-...',
               cargo_request_number: 'CGO-10aea1f3', ... }
```

Verified: `customer_name_snapshot` and `customer_phone_snapshot`
came from the `clients` table (not from payload) — Phase 9 PR 2
immutable-snapshot discipline carries forward to cargo §4.2.

### Probe 31 — Offer → accept → booking

```
submit_cargo_offer  → { ok: true, offer_id: '10b55123-...' }
accept_cargo_offer  → { ok: true, booking_id: '49e75e03-...' }
```

Booking shape verifier returned exactly the Phase 11 §4.4
contract:

```
booking_number:           AER-B-260515CA4A
source_discriminator:     cargo
source_offer_table:       cargo_offers
legacy_offer_id_null:     true   ← bookings.offer_id = NULL
trip_request_id_null:     true   ← bookings.trip_request_id = NULL
source_offer_id_populated: true  ← bookings.source_offer_id NOT NULL
total_amount:             300000.00  ← 280k base + 15k insurance + 5k customs
customer_name_snapshot:   باسم محمد حميد الحجري
```

Cleanup verified post-Probe 31 (5/5 = 0).

---

## End-to-end test (6 phases)

After production activation, ran a full UI walkthrough covering
every cargo path:

| Phase | Path | Result |
|---|---|---|
| **A** | Public guest submits cargo via `/cargo` | ✅ `CGO-a662e765` |
| **B** | Admin sees guest request in `/admin/cargo` queue + detail | ✅ admin nav links + accept/decline/cancel buttons visible on guest detail |
| **C** | Authed client (basem902) submits cargo via `/me/cargo-requests/new` | ✅ `CGO-514584e8` — form mode='authed' hides customer fields, `customer_*_snapshot` pulled from clients table |
| **D** | Operator (Probe 18) submits offer via `/operator/cargo/[id]/offer` | ✅ 300,000 SAR offer (280k + 15k + 5k); capability picker filtered to operator's only HZ-CARGO-TEST aircraft |
| **E** | Client accepts offer → booking with cargo chip | ✅ `AER-B-260516E5A5` — `client_id` set, `source_discriminator='cargo'`, emerald chip "شحن" in `/me/bookings` |
| **F** | Admin accept-on-behalf for guest request | ✅ `AER-B-260516718C` — `client_id=NULL`, `customer_name_snapshot='اختبار ضيف'`, same booking shape |

**Booking shape verified on both real bookings** (`client_id` set
and `client_id=NULL` cases):
- `offer_id` IS NULL ✓
- `trip_request_id` IS NULL ✓
- `source_offer_table` = 'cargo_offers' ✓
- `source_offer_id` IS NOT NULL ✓
- `source_discriminator` = 'cargo' ✓

---

## Hotfixes flushed out during smoke test

| # | PR | Issue | Files | Outcome |
|---|---|---|---|---|
| 1 | #68 | (a) `/cargo` page rendered with title overlapping fixed navbar (no top padding) + form filling full viewport. (b) `aircraft.type` column referenced in `aircraft-capabilities/page.tsx` doesn't exist (real columns: `manufacturer`, `model`, `category`) | `app/(public)/cargo/page.tsx`, `components/cargo/cargo-request-form.tsx`, `app/(admin)/admin/(protected)/cargo/aircraft-capabilities/page.tsx` | UI polish + select fixed |
| 2 | #69 | Same `aircraft.type` bug in `lib/cargo/queries/operator-list.ts:listCapableAircraftForOperator` (missed in PR #68) — operator offer form showed "لا توجد طائرات" even with capable aircraft seeded | `lib/cargo/queries/operator-list.ts` | Capability picker fixed |
| 3 | #70 | Cargo tables alignment broken: `dir="ltr"` on `<td>` forces text-align left while `<th>` inherits RTL right | `app/operator/(authed)/cargo/{page,offers/page}.tsx`, `app/(client)/me/cargo-requests/page.tsx` | All 3 tables now match admin queue pattern (`<span dir="ltr">` inside cells) |

**Root cause pattern:** the Phase 11 spec was written assuming
no legacy `cargo_requests` prototype, and assumed `aircraft.type`
column existed (it doesn't — the Day-1 schema used `manufacturer`
+ `model` + `category`). Both gaps caught by smoke testing
post-activation. The 3 hotfix PRs total ~150 lines of net change.

---

## Activation runbook execution order

1. ✅ Phase 1 prototype cleanup DO block.
2. ✅ Apply PR 1 migration.
3. ✅ Apply PR 2 migration.
4. ✅ Run Probe 28 → 33/33 green.
5. ✅ Run Probe 30 → authed cargo request returns ok + verifies
   snapshot-from-clients invariant.
6. ✅ Run Probe 31 → offer → accept → booking shape correct +
   cleanup test data (5/5 = 0).
7. ✅ Set `ENABLE_CARGO=true` on Vercel.
8. ✅ Redeploy production (without build cache).
9. ✅ Smoke test all 8 cargo routes: 2× 200 (public) + 6× 307
   (auth gated, redirect to login as expected).
10. ✅ Hotfix #1 (#68) merged.
11. ✅ Founder visual review of `/cargo`.
12. ✅ End-to-end UI walkthrough — 6 phases passed.
13. ✅ Hotfix #2 (#69) merged mid-walkthrough.
14. ✅ Hotfix #3 (#70) merged mid-walkthrough.
15. ✅ Final cleanup of test data.

---

## Outstanding follow-ups (deferred)

1. **Client detail page (`/me/cargo-requests/[id]`)** does not
   render per-category fields (e.g. Ferrari F40 didn't appear in
   the detail view even though `car_make` + `car_model` are
   in DB). Admin detail page DOES render them — pattern exists,
   just needs porting. Low priority (admin can already inspect).
2. **`/me` homepage subtitle** still says "ستفتح صفحة طلب
   الرحلات + عروضك بمجرد تسليم PR 3 + PR 2" — stale copy from
   Phase 9, can be updated now that PR 2 shipped.
3. **PR 3 will pick up:** distribution engine
   (`cargo_dispatch_events_outbox` + trigger), notifications
   pipeline (operator email + wa.me + founder batch), cron route
   for outbox drain, 6th canary card on
   `/admin/operators/canary`, probe 32 (distribution filter by
   capability).

---

## Test passwords cleanup

The end-to-end test set temporary `Test1234!` passwords on:
- `clients.basem902@gmail.com`
- `operators.id = 182587d6-cfc8-43bf-a21f-fc737819335a` (Probe 18, auth_email=`probe18@aeris.test`)

Both were reverted in the cleanup step to random `gen_random_uuid()`
hashes with `password_must_change=true`, forcing a real reset via
`/forgot-password` on next login. No test passwords linger in
production.

---

## Booking shape contract (pinned)

For ANY future code that touches `bookings` rows, cargo bookings
follow this invariant (per parent spec §4.4 + Phase 11 PR 1
round 5 P1 #1):

```
offer_id              = NULL                  -- legacy column; never used
trip_request_id       = NULL                  -- cargo skips Phase 4-6 funnel
source_offer_table    = 'cargo_offers'        -- §3.4.2 extension
source_offer_id       = <UUID of accepted cargo_offer>
source_discriminator  = 'cargo'               -- §3.4.1 extension
client_id             = <UUID> | NULL         -- NULL on guest path
customer_*_snapshot   = from cargo_requests (which itself snapshots
                                              from clients on §4.2
                                              authed path)
```

The Phase 6.2 `bookings_source_offer_pair_check` constraint
(`(source_offer_table IS NULL) = (source_offer_id IS NULL)`)
passes trivially since cargo sets both NOT NULL.

Any future code that adds `bookings.offer_id`-keyed queries
MUST handle the cargo NULL case (or migrate cargo bookings to
populate `offer_id`, which is deferred to Phase 14 when
HyperPay integration may want a unified offer pointer across
all 5 business units).

---

## PR 3 (distribution + cron + canary) — activation

PR 3 shipped the autonomous dispatch layer: every cargo intake
emits an outbox event via trigger; a 15-min cron drain claims
pending rows atomically, scores eligible operators, sends
operator notifications (Resend email + wa.me link metadata),
and conditionally alerts the founder when the full N=5 quota
is dispatched. PR 3 went through **6 Codex review rounds on
the spec** and **2 rounds on the implementation** before
merging.

### Migration applied

`20260520000032_phase_11_pr_3_cargo_distribution.sql` (302
lines) — replay-safe (Phase 9 conventions). 10/10 schema
verifier checks green: outbox table + claim_id/claimed_at
columns + 3 RPCs (publish, claim, last_dispatch_map) + trigger
+ founder_batch_alerted_at column + drain partial index + RLS.

### Probe 32 — distribution filter by capability

**Setup:**
- Probe 18 operator: aircraft + `cargo_aircraft_capabilities.supports_horse=true`
- Probe 14 operator: aircraft + `cargo_aircraft_capabilities.supports_horse=false` (only `supports_luxury_car`)

**Flow:**
1. Inserted a `horse` cargo request via `create_cargo_request_guest`
   (CGO-e1f8b1fa, request_id `cbc61067-...`)
2. `cargo_requests_dispatch_trigger` fired → outbox row emitted
   with `event_type='initial'`, `processed_at=NULL`,
   `claim_id=NULL`
3. Triggered the cron route manually with `Authorization:
   Bearer $CRON_SECRET`

**Result (from `dispatch_result` JSONB on the outbox row):**

```json
{
  "skip_reasons": {
    "ea0a07c0-...": "no_capability",
    "182587d6-...": "notify_failed"
  },
  "dispatched_count": 0,
  "skipped_count": 2,
  "whatsapp_links": {
    "182587d6-...": "https://wa.me/966558048004?text=..."
  }
}
```

| Invariant | Status | Notes |
|---|---|---|
| Probe 14 (non-capable) appears in `skip_reasons['no_capability']` | ✅ | PR #72 Round 1 P1 #3 (enumerate-then-classify) verified end-to-end |
| Probe 18 (capable) reached the dispatch candidate list | ✅ | Made it past the capability filter (would have been in `dispatched_operator_ids` if Resend allowed sending to non-account-owner) |
| `was_claimed=true`, `was_processed=true`, `attempt_count=1` | ✅ | claim RPC + mark-processed `claim_id` guard work atomically |
| `dispatch_result.whatsapp_links` populated for capable operators | ✅ | PR #73 Round 1 P1 #3 (wa.me as audit metadata, NOT as a delivery channel) verified |

**Probe 32 PASSED.** The distribution logic — the PR 3 core
deliverable — works as spec'd. The `notify_failed` reason on
Probe 18 reflects Resend's testing-mode policy
(`statusCode: 403, validation_error`: "You can only send
testing emails to your own email address"), **not** a code
defect; PR #73 Round 1 P1 #3 ensures we don't fake-dispatch
operators whose email failed.

### Outstanding follow-up: Resend domain verification

**Status:** Email delivery code path wired correctly; Resend
DNS verification pending before onboarding real operators.

**Steps before real operator rollout:**
1. Resend Dashboard → Domains → Add `aeris.sa`
2. Add DKIM + SPF DNS records on the registrar (or Cloudflare
   if domain DNS is delegated)
3. Wait for Resend to verify (usually <10 min after DNS
   propagation)
4. Smoke test: insert a horse cargo request with a real
   operator email + run the cron manually → confirm email
   delivery (instead of `notify_failed`)
5. Verify `cargo_email_alert_status.status='healthy'` post-send

This is an **ops follow-up**, not a code task — the cron + the
fallback `wa.me` metadata channel already give the founder a
manual outreach option even before DNS verification.

### Cleanup

Probe 32 test data was removed after verification:
- `cargo_requests` row (`cbc61067-...`) deleted →
  CASCADE removed the outbox row
- 2 test aircraft (`aa5e7ff4-...`, `4de665cd-...`) deleted →
  CASCADE removed their `cargo_aircraft_capabilities` rows

The Probe 18 + Probe 14 operator rows themselves were left in
place (they pre-date Phase 11 and serve other test surfaces).

---

## Phase 11 closure summary

All 3 PRs of Phase 11 are now live in production:

| PR | Scope | Status |
|---|---|---|
| #65 | Backend + public form + admin intake | ✅ activated |
| #67 | Authed portal + offers + bookings unification | ✅ activated, Probes 28/30/31 green |
| #73 | Distribution + cron + canary + manual dispatch | ✅ activated, Probe 32 green |

**Total commits to main from Phase 11:** 9 (spec + 3 PRs + 3
hotfixes + 2 activation notes — this file).

**Known follow-ups:**
1. Resend domain verification (this section above) — before
   real operator rollout
2. Client detail page per-category fields render (PR 2 §4.1
   deferred polish — admin detail already renders them, only
   `/me/cargo-requests/[id]` is missing the section)
3. `/me` homepage subtitle still references "بعد تسليم PR 3"
   — stale copy from Phase 9; trivial fix
4. PR 3 §6.3 future polish — per-operator dispatch breakdown
   on a dedicated `/admin/cargo/dispatch-analytics` view
   (out of scope this phase; canary card carries the
   aggregate `cargo_dispatch_runs_24h` smoke signal)

**Phase 11 closed.** Ready for Phase 12 (MedEvac) or Phase 13
(Privilege) per the master 60-day plan.
