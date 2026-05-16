# Phase 11 — Cargo activation notes

> **Status:** Activated on production `2026-05-16`.
> **Scope:** PR 1 (intake) + PR 2 (offers/bookings).
> **PR 3 (distribution/notifications/cron/canary) not yet activated.**
>
> This file documents the activation runbook execution after PR
> #65 + PR #67 merged, the hotfixes flushed out by founder smoke
> testing, and the end-to-end verification against real DB.

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
