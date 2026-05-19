# Phase 13 — Aeris Privilege Spec

> **Status:** Round 0 draft, pending Codex review.
> **Scope:** 4-tier loyalty program (Silver/Gold/Platinum/Diamond)
> with rolling-12-month qualified-spend evaluation, internal
> cashback ledger, auto-upgrade + soft-downgrade with 90-day grace,
> cross-product Diamond → Aeris Shield auto-grant, Empty Legs
> early-access via distribution scoring, and a 2FA policy flag
> (enforcement deferred to Phase 13.2 — Phase 9 auth refactor).

---

## Source-of-truth pointers

This spec lives in `docs/PHASE-13-PRIVILEGE-SPEC.md` and is the
single source of truth for Phase 13 implementation. Other files
that reference Phase 13 conventions:

- `CLAUDE.md` §3 — "Aeris Privilege — 4-tier loyalty program"
- `docs/PHASE-12-ACTIVATION-NOTES.md` — Phase 12 closure (Phase
  13 builds on its medevac_subscriptions infrastructure)
- `D:/Plan/advisor-doc/Aeris-Advisor-Study.docx` §5.3 — original
  business design (4 tiers + cashback %)

Phase 13 deliberately **does not block on Phase 14 (payment
integration)** — the trigger on `bookings.payment_status = 'paid'`
already fires today via the manual-confirmation path
(`pending_offline` → admin confirms → `paid`). When Phase 14 wires
HyperPay + Moyasar in, the same trigger fires automatically on
webhook receipt. No Phase 13 code change required.

---

## §0 Objective

Aeris Privilege is a **4-tier loyalty program** that increases
CLV, reduces CAC, and creates a brand prestige ladder distinct
from competitors (NetJets Card, VistaJet Membership) by combining:

1. **Internal cashback ledger** (5% / 8% / 12% / 15% per tier)
   — credit-only, no cash-out in v1, no compounding.
2. **Rolling 12-month qualified-spend** tier evaluation —
   privilege reflects current activity, not lifetime.
3. **Soft downgrade with 90-day grace** — high-value clients
   never feel "demoted" overnight; admin lock preserves
   strategic accounts.
4. **Cross-product Diamond benefit**: free unlimited Aeris Shield
   Diamond plan auto-granted on Diamond entry, gracefully
   revoked on downgrade.
5. **Empty Legs early-access window** baked into distribution
   scoring (Gold +2h, Platinum +6h, Diamond +12h) — privilege
   yields actual matching priority, not a UI-only badge.
6. **Audit-first design** — every tier change + every cashback
   event written to `client_loyalty_ledger` + `privilege_tier_change_log`
   with PII redaction (D-spec compliance).

### KPIs at Phase 13 closure (7-day post-activation window)

- ≥80% of active clients (paid booking in last 90 days) auto-evaluated
  into a tier (vs default `silver`).
- 0 silently-suppressed tier changes (every change logged to
  `privilege_tier_change_log` with reason).
- 0 cashback ledger imbalances. Round 1 PR #80 F17 fix —
  the invariant is signed-sum: `SUM(amount_sar) over ALL events
  for client = clients.cashback_balance_sar`. Diamond-shield-*
  events have `amount_sar=0` so they don't affect balance.
- 0 Diamond clients without an active Shield subscription
  (cross-product invariant).

---

## §1 User journeys

### J1 — Silver client books charter → cashback earned

1. Client `c1` (tier=silver, default) books a charter trip.
2. Operator submits offer, client accepts.
3. Booking created with `payment_status='pending_offline'`,
   `total_amount=80,000 SAR`.
4. Founder/admin confirms payment via existing admin flow → status
   flips to `paid`.
5. `AFTER UPDATE` trigger on `bookings.payment_status` fires.
6. Trigger calls `award_cashback_for_booking(c1, booking_id,
   80000)` → silver rate 5% → ledger event
   `{ event_type:'earn', amount_sar:4000, balance_after:4000 }`.
7. `c1.cashback_balance_sar` updated to `4000`.
8. Trigger also calls `evaluate_client_privilege_tier(c1)` →
   qualified_spend_12m = 80000 < 100000 → stays silver, no change
   log entry.

### J2 — Client reaches Gold threshold (100K+) → auto-upgrade

1. Client `c1` (silver, cumulative spend = 70k) books charter for
   50,000 SAR. Total qualified spend_12m → 120,000.
2. Payment confirmed → trigger fires.
3. `award_cashback_for_booking` runs at **silver** rate (5%) —
   the per-booking rate is the rate **at the moment of payment
   confirmation**, not retroactively recomputed.
4. `evaluate_client_privilege_tier(c1)` runs:
   - spend_12m = 120,000 → matches gold threshold (100k-500k).
   - current tier = silver, new tier = gold → upgrade.
   - INSERT into `privilege_tier_change_log`
     `{ from='silver', to='gold', reason='auto_upgrade',
        qualified_spend_12m=120000 }`.
   - UPDATE `clients SET privilege_tier='gold', privilege_tier_assigned_at=NOW(),
        privilege_below_threshold_since=NULL`.
5. Next booking onwards earns at **gold rate (8%)**.

### J3 — Client redeems cashback on next booking

1. Client `c1` (gold, balance=4000 SAR) gets a new offer for
   60,000 SAR.
2. Client opens accept dialog. A new section appears:
   - "رصيد الاسترداد الحالي: 4,000 SAR"
   - Input: "كم تريد استرداده؟" with max validation.
3. Client enters `redemption_amount=4000`.
4. RPC `redeem_cashback_for_booking(c1, booking_id, 4000)`:
   - Validates: balance >= 4000 ✓
   - Validates: redemption_amount <= booking.total_amount * 0.5
     (max 50% of booking can be paid from cashback per D-spec D4).
   - Validates: redemption_amount <= booking.total_amount - 1
     (always at least 1 SAR paid in cash, to keep payment_status
     trigger valid).
   - INSERT ledger event `{ event_type:'redeem',
     amount_sar:-4000, booking_id, balance_after:0 }`.
   - UPDATE `bookings SET cashback_redemption_sar=4000`.
     **Note (Round 4 PR #80 F37 fix)**: `total_amount` is NOT
     mutated — D24 immutability already prevents that. The
     effective payable amount = `total_amount - cashback_redemption_sar`
     is computed inline (D23) at award/payment time, never stored.
5. Future cashback earned on this booking is calculated on the
   inline-derived `amount_paid = total_amount - cashback_redemption_sar`
   (D23), NOT `total_amount` → **no compound** (D-spec
   D6). E.g. gold 8% on 56k = 4,480 SAR earned.

### J4 — Client falls below threshold → 90-day grace → soft downgrade

1. Client `c2` is gold (spend_12m = 200k a year ago, now spend_12m
   has decayed to 80k as past bookings roll outside the 12mo
   window).
2. Daily cron `evaluate_all_active_privileges` runs at 00:30 Riyadh time.
3. For `c2`:
   - qualified_spend_12m = 80,000 < gold threshold (100k).
   - current tier = gold → grace check.
   - If `privilege_below_threshold_since IS NULL` → SET it to NOW()
     (first day below threshold). No downgrade yet.
4. Day +89: `c2` still below threshold. `privilege_below_threshold_since`
   = 89 days ago. Grace not yet expired.
5. Day +90: cron fires. Grace expired. Check `tier_locked_until`:
   - If `tier_locked_until > NOW()` → skip downgrade (admin lock
     active), reset `privilege_below_threshold_since` to NULL so
     the grace clock restarts after the lock expires.
   - Else → downgrade **one step** (gold → silver):
     - INSERT into `privilege_tier_change_log`
       `{ from='gold', to='silver', reason='auto_downgrade',
          qualified_spend_12m=80000,
          grace_started_at='<day -89>' }`.
     - UPDATE `clients SET privilege_tier='silver',
       privilege_tier_assigned_at=NOW(),
       privilege_below_threshold_since=NULL`.
6. If `c2` makes a booking that pushes spend_12m back above 100k
   on day 95 (now silver), upgrade fires immediately on the
   payment-confirmed trigger (no 90-day waiting on upgrades —
   only downgrades).

### J5 — Client reaches Diamond → free Shield Diamond plan auto-granted

1. Client `c3` is platinum (spend_12m = 1.8M).
2. Books a charter for 250,000 SAR. Payment confirmed.
3. spend_12m → 2,050,000. Crosses Diamond threshold.
4. `evaluate_client_privilege_tier(c3)`:
   - Upgrades to diamond.
   - **Cross-product hook**: check if `c3` has an active
     `medevac_subscription` with `plan='diamond'`:
     - If yes (already paying Diamond subscriber) → skip (no
       duplicate), log ledger event `diamond_shield_skipped_already_diamond`
       (Round 1 PR #80 F12 fix — renamed from `diamond_shield_skipped`
       for clarity vs the paid-plan skip variant).
     - If yes with `plan!='diamond'` but `paid` (e.g. paying
       individual/family/vip_family) → log
       `diamond_shield_skipped_paying_paid_plan`, do nothing.
       The paid plan continues; Diamond grant is suppressed until
       the paid plan ends.
     - If no active subscription → call
       `auto_grant_diamond_shield_subscription(c3, change_log_id)`.
       Per Round 3 PR #80 F31 + Round 5 PR #80 F4 fix, the grant
       inserts the subscription with **empty covered_members** (no
       owner-seeded entry; `clients.dob` does not exist). INSERT shape:
         - plan='diamond'
         - annual_fee_at_signup_sar=0
         - covered_events_at_signup=-1 (unlimited)
         - service_level_at_signup='CCT'
         - includes_repatriation_at_signup=true
         - max_covered_members_at_signup=4 (mirror Diamond default)
         - status='active'
         - start_date=CURRENT_DATE
         - end_date=CURRENT_DATE + INTERVAL '1 year'
         - **covered_members='[]'::jsonb** (must be populated by
           client/admin before first use; UI CTA enforces this on
           `/me/medevac/new` and `/me/medevac/shield/[id]`)
         - payment_token_hash=NULL (free)
         - notes='Auto-granted via Phase 13 Diamond tier upgrade.
           covered_members must be populated by client/admin before
           first Shield use. change_log_id=<id>'
       - INSERT ledger event `{ event_type:'diamond_shield_granted',
         subscription_id=<new>, change_log_id=<id> }`.
   - All inside a single transaction. The deferred member-population
     step is documented in J5b below.

### J5b — Diamond client populates covered_members before first use

1. Client `c3` (newly Diamond) navigates to `/me/medevac/new` and
   checks the "use Shield" box.
2. Form detects the active free Diamond subscription has
   `covered_members='[]'` → renders a blocking banner:
   "تحتاج أولاً إلى تعبئة بيانات الأعضاء المغطّين قبل استخدام Shield"
   with a CTA link to `/me/medevac/shield/<sub-id>`.
3. Client opens the Shield detail page (Phase 12 PR 2 surface) →
   adds owner self entry with DOB + optional additional members.
4. Returns to `/me/medevac/new` → Shield checkbox now usable.
5. `consume_aeris_shield_event` matches `(patient_name, patient_dob)`
   against `covered_members` per spec D4 and proceeds normally.

### J6 — Empty Legs match-drain: Gold gets 2h priority window

1. Empty Leg created at 10:00 (operator publishes).
2. Match-drain cron runs every 30 min (per Phase 7-10).
3. At 10:00 first tick: matching engine selects candidates.
4. For each eligible client, compute `effective_match_time = NOW()
   - privilege_tier_boost_hours(client)`:
   - silver: 0h
   - gold: 2h
   - platinum: 6h
   - diamond: 12h
5. Sort candidates by `effective_match_time DESC` (i.e. higher
   tier appears "earlier" in the queue).
6. First tick (10:00) selects top 5: a Diamond + 2 Platinum +
   2 Gold matched first.
7. Silver candidates appear in tick 2-3 (after the tier window
   shifts).
8. Match outbox event records: `{ tier_boost_applied: true,
   privilege_tier_at_match: 'diamond', boost_hours: 12 }`
   for telemetry.
9. **Invariant**: silver clients are NOT excluded — they're delayed.
   Per D-spec D8, after `max(boost_hours) = 12h` from leg
   creation, all candidates re-merge into a single FCFS pool.

### J7 — Admin override: lock/force-promote tier

1. Admin opens `/admin/clients/[id]/privilege` for high-value
   strategic account `c4` (currently gold).
2. Admin sees:
   - Current tier, spend_12m, balance, recent events.
   - Two action buttons: "Force tier" + "Lock until".
3. Admin clicks "Force tier" → modal:
   - Select: silver / gold / platinum / diamond.
   - Required: `reason TEXT (>=10 chars)`.
   - Optional: `lock_until DATE`.
4. Submit calls `admin_force_privilege_tier(c4, 'platinum', reason,
   lock_until)`:
   - INSERT into `privilege_tier_change_log` `{ from='gold',
     to='platinum', reason='admin_force', admin_user_id=NULL
     (admin cookie session per D8), admin_reason=<text>,
     lock_until=<date> }`.
   - UPDATE `clients SET privilege_tier='platinum',
     privilege_tier_assigned_at=NOW(),
     tier_locked_until=<lock_until OR NULL>`.
   - If new_tier='diamond' AND no active Shield → trigger
     `auto_grant_diamond_shield_subscription` (same cross-product
     hook as J5).
   - If new_tier!='diamond' AND old_tier='diamond' AND
     admin_grant Shield exists → schedule revoke at lock_until +
     grace per D7 (see D-spec).
5. Audit log entry created (mirror Phase 12 admin_pii_read
   pattern — admin cookie fingerprint, no PII in log).

### J8 — Platinum+ login → "2FA recommended" badge (v1, no enforcement)

1. Client `c5` (platinum) logs into `/login`.
2. Existing Phase 9 login flow runs.
3. After successful login, `/me` page checks `tier IN
   ('platinum', 'diamond')`.
4. If true and `two_factor_enabled = false` (column added by
   Phase 13 schema, default false):
   - Display banner at top of `/me`: "**حسابك من المستوى
     {Platinum|Diamond} — يُنصح بشدّة بتفعيل المصادقة الثنائية
     لحماية حسابك**" with `/me/security` link.
   - The link is a placeholder that says "ميزة المصادقة الثنائية
     تطلق قريباً" (Phase 13.2 will replace this).
5. NO login blocking, NO forced setup, NO email/SMS sent. Pure
   informational banner.
6. Phase 13.2 (out of scope here) replaces step 4-5 with TOTP
   setup, recovery codes, and login enforcement.

---

## §2 Locked decisions

The following are the founder-locked decisions made before
drafting this spec. Each carries a D-prefix used throughout the
schema/RPC/probe sections for traceability.

| ID | Decision | Rationale |
|---|---|---|
| **D1** | Spend window = rolling 12 months (365 days) | Reflects real activity; smooths year-end cliff effects. |
| **D2** | Spend basis = `bookings.paid_at`, NOT `created_at` (Round 4 PR #80 F32 fix — cleaned up earlier alias) | Prevents cashback on incomplete/cancelled bookings; aligns with revenue recognition. |
| **D3** | Tier thresholds (annual qualified spend, SAR): silver < 100k, gold 100k-500k, platinum 500k-2M, diamond ≥ 2M | From advisor-doc §5.3. |
| **D4** | Cashback %: silver 5, gold 8, platinum 12, diamond 15 | From advisor-doc §5.3. |
| **D5** | Cashback model: internal ledger, credit-only, no cash-out in v1 | Simpler; retention-driving; lower regulatory risk (no money transmission). |
| **D6** | No compounding: `redeem` reduces effective payable; next earn fires on the inline-computed `amount_paid = total_amount - cashback_redemption_sar` (per D23 — no stored `amount_paid_sar` column), NOT on `total_amount`. Round 5 PR #80 F6 fix — earlier wording referenced the ghost `amount_paid_sar` column. | Prevents infinite cashback loop. |
| **D7** | Redemption cap per booking: 50% of `total_amount`, AND always leave ≥1 SAR as cash payment | Keeps payment_status workflow valid (every booking needs a real payment event). |
| **D8** | Downgrade: soft after 90-day grace, one-step-down per recalc, never skip tiers downward | Protects high-value clients from sudden demotion; clear UX. |
| **D9** | Admin lock (`tier_locked_until`) suppresses auto-downgrade and resets grace clock | Strategic-account protection. |
| **D10** | Upgrades fire on payment-confirmed trigger (immediate); downgrades only via daily cron (eventual) | Upgrades are pleasant; downgrades shouldn't surprise mid-booking. |
| **D11** | Diamond × Shield: auto-grant `medevac_subscriptions` row `{ plan:'diamond', annual_fee:0, status:'active' }`; on downgrade, let subscription expire at end_date or 90-day grace, whichever later | Reuses Phase 12 infrastructure; no parallel "free MedEvac" flag. |
| **D12** | No duplicate Shield grant if client has an active paid subscription at Diamond-equivalent or higher level (paid plan wins) | Prevents commercial conflict; logs ledger event `diamond_shield_skipped_paying_paid_plan`. |
| **D13** | Empty Legs early access: applied in `lib/empty-legs/matching.ts` scoring via `privilege_tier_boost_hours` (gold +2h, platinum +6h, diamond +12h) | Distribution-level priority, NOT UI-only. |
| **D14** | Tier boost windows merge to a single FCFS pool after `max(boost_hours)=12h` from leg creation | Silver clients are delayed, never excluded. |
| **D15** | 2FA Platinum+ in v1 = policy flag only (`two_factor_required` derived from tier); enforcement deferred to Phase 13.2 | Phase 9 auth lacks TOTP infrastructure; refactor out of scope here. |
| **D16** | Eligible products for cashback: Charter, Cargo, MedEvac out-of-pocket. NOT eligible: covered MedEvac (Shield events), Aeris Shield subscription fee itself | Cashback rewards spend, not subscription fees or pre-paid covered events. |
| **D17** | PII redaction continues: admin tier-change actions logged with admin cookie fingerprint (Phase 12 §4.10 pattern), no PII leaked in audit log | Consistency with D8/D12 across Aeris. |
| **D18** | Cashback expiry: 24 months from earn date (configurable via `privilege_tier_thresholds.cashback_expiry_months`) | Standard loyalty industry practice; ledger event `expire` written by daily cron. |
| **D19** | `clients.cashback_balance_sar` is a **denormalized snapshot** maintained by the SECURITY DEFINER RPCs (award/redeem/adjust/expire) that INSERT into `client_loyalty_ledger`, NOT a computed view nor a DB trigger. Round 2 PR #80 F23 fix: reconciliation cron is **report-only** in v1; manual `admin_adjust_cashback` corrects any drift. Round 3 PR #80 F29 clarifying — "trigger maintained" wording in earlier rounds was inaccurate; the RPC is the sole writer and is the single chokepoint that updates both ledger + denorm in the same transaction. | Performance for booking checkout (no aggregate query per page load); RPC-level atomicity guarantees ledger + denorm stay in sync per write; reconcile cron detects drift if it ever appears. |
| **D20** | Activation is gated by `ENABLE_PRIVILEGE=true` env var (mirror `ENABLE_MEDEVAC` pattern from Phase 12) | Safe rollout; allows schema deploy before flag flip. |
| **D21** | **Idempotent cashback award**: `award_cashback_for_booking` RPC checks `EXISTS (earn for booking_id)` BEFORE INSERT, returns `{ok:true, already_awarded:true, skipped_reason:'duplicate_earn_for_booking'}` if found. DB-side `UNIQUE INDEX (booking_id) WHERE event_type='earn'` enforces the invariant defense-in-depth. | Prevents double-award across all code paths: trigger replay on same `paid` UPDATE, `refunded→paid` re-confirmation, manual admin re-award attempts. Cannot silently corrupt ledger balance. |
| **D22** | **`bookings.paid_at` is the canonical payment-confirmation timestamp** added by Phase 13 PR 1 (not Phase 6/14 — Round 1 PR #80 F1 fix verified column does NOT exist anywhere in current schema). Trigger §3.4 stamps `paid_at = NOW()` on the same UPDATE that flips `payment_status='paid'`. The qualified-spend window (D1) filters on `paid_at > NOW() - INTERVAL '12 months'`. | Eliminates spec-vs-schema drift; Phase 13 owns the column it depends on. |
| **D23** | **`amount_paid_sar` is computed inline** as `(total_amount - cashback_redemption_sar)` at award-time, NOT a stored column. `award_cashback_for_booking` reads `total_amount` + `cashback_redemption_sar` from `bookings` inside the FOR UPDATE lock and derives `v_amount_paid` locally (Round 1 PR #80 F2 fix). | Avoids stored-derived column inconsistency; the single source of truth is `(total_amount, cashback_redemption_sar)`. |
| **D24** | **`total_amount` immutability after `payment_status='paid'`**: enforced by AFTER UPDATE trigger that rejects any UPDATE of `total_amount` once the booking is paid. Out-of-band amount adjustments (refunds, disputes) MUST flow through dedicated refund RPC (D25), which atomically updates `cashback_redemption_sar` + posts refund_back ledger event. | Prevents `amount_paid_sar` drift from constraint re-eval after payment; aligns with revenue-recognition contract (Round 1 PR #80 F4 fix). |
| **D25** | **Refund flow deferred to Phase 13.1 mini-spec**: v1 supports full bookings cancellation BEFORE `payment_status='paid'` (no cashback impact since none earned). Once paid, total_amount is locked (D24); any post-paid refund requires a dedicated `process_refund_for_booking` RPC + new ledger logic. The `refund_back` ENUM value + `on_bookings_payment_refunded_reverse_cashback` trigger are **reserved placeholders** in v1 — no producer path exists. Trigger DDL is omitted from PR 1 migration to avoid dead code (Round 1 PR #80 F5 fix). | Avoids opening a tax/accounting decision tree (proportional cashback reversal, partial vs full, VAT handling) inside Phase 13 v1. The decision belongs with Phase 14 payment gateway integration (refund webhooks). |
| **D26** | **Diamond × Shield grant failure is non-fatal to payment confirmation**: `evaluate_client_privilege_tier` wraps `auto_grant_diamond_shield_subscription` call in BEGIN/EXCEPTION. On failure, logs `diamond_shield_grant_failed` ledger event (new ENUM value) + writes to `audit_logs` + continues. Payment UPDATE succeeds regardless. Admin reviews failed grants via canary card (PR 3). | Decouples Privilege side-effects from payment confirmation — a Phase 12 schema change cannot block payment receipt (Round 1 PR #80 F6 fix). |
| **D27** | **EL match outbox enforces `UNIQUE (empty_leg_id, client_id)` to prevent duplicate notifications** across tier-boost windows. Gold matched at T0 (boost active) cannot be re-matched at T+2h (FCFS round); the second insert fails via UNIQUE → matching cron logs `tier_boost_already_consumed` skip reason. | Per founder review of EL early access: privilege gives priority window, not multiple matches (Round 1 PR #80 F7 fix). |
| **D28** | **VAT treatment**: `bookings.total_amount` is the **VAT-inclusive (gross)** value (Saudi 15% VAT included). Cashback is computed on the gross figure: `gross_amount_paid * cashback_pct / 100`. Phase 14 will introduce explicit `vat_amount_sar` + `pre_vat_amount_sar` columns when ZATCA integration ships; until then, the gross-basis simplifies the v1 ledger arithmetic + matches how the client sees the offer total in `/accept-offer`. | Avoids opening tax-accounting decision tree in v1; defers VAT-aware cashback to Phase 14 alongside the ZATCA invoice work. Round 4 PR #80 F38 fix. |
| **D29** | **Booking cancellation interaction**: (1) Cancel BEFORE `payment_status='paid'` → no cashback earned (trigger never fires) AND no redemption possible (RPC `redeem_cashback_for_booking` rejects bookings with `paid_at IS NULL`... wait, actually we should allow pre-paid redemption; clarification below). (2) Cancel AFTER `payment_status='paid'` → blocked by D24 immutability (post-paid mutation = refund flow, deferred D25). Pre-paid redemption interaction: `redeem_cashback_for_booking` checks the booking is NOT yet paid (so client can lock-in cashback redemption before actually paying); if the booking is then cancelled before payment, the `redeem` ledger event remains posted, the cashback was debited from balance, but no actual benefit was delivered. **Decision**: v1 leaves the redeem event in place (no auto-reversal); admin can manually `admin_adjust_cashback` to restore balance if the cancellation was operator-driven (not client-driven). Phase 13.1 may add `cancel_unused_redemption` RPC for client-driven cancellations. | Avoids an auto-reversal layer that would be hard to test in v1; admin-driven correction is acceptable for low-volume v1 launch. Round 4 PR #80 F39 fix. |

---

## §3 Schema additions

### §3.1 ENUMs (4 new)

#### `client_privilege_tier`

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'client_privilege_tier' AND n.nspname = 'public') THEN
    CREATE TYPE client_privilege_tier AS ENUM (
      'silver',    -- default; spend_12m < 100,000 SAR
      'gold',      -- spend_12m 100,000 - 499,999 SAR
      'platinum',  -- spend_12m 500,000 - 1,999,999 SAR
      'diamond'    -- spend_12m >= 2,000,000 SAR
    );
  END IF;
END $$;
```

Order matters: enum sort order doubles as numeric tier rank
(silver=1, gold=2, platinum=3, diamond=4). RPC `tier_rank(t
client_privilege_tier) RETURNS INT` exposes this.

#### `loyalty_ledger_event_type`

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'loyalty_ledger_event_type' AND n.nspname = 'public') THEN
    CREATE TYPE loyalty_ledger_event_type AS ENUM (
      'earn',                                 -- cashback from confirmed booking
      'redeem',                               -- applied to a future booking
      'adjust',                               -- admin manual correction
      'expire',                               -- 24-month expiry sweep
      -- Round 2 PR #80 F24 fix: `refund_back` removed from v1 ENUM.
      -- Phase 13.1 will add via `ALTER TYPE loyalty_ledger_event_type
      -- ADD VALUE 'refund_back'` together with its producer
      -- (process_refund_for_booking RPC). Dead ENUM values cause
      -- amount_sign_check to carry untestable branches; better to
      -- ship the value with the code that produces it.
      'diamond_shield_granted',               -- cross-product Diamond auto-grant
      'diamond_shield_skipped_already_diamond',   -- Round 1 F12 fix
      'diamond_shield_skipped_paying_paid_plan',  -- D12 invariant
      'diamond_shield_revoked_on_downgrade',  -- diamond → lower, subscription end
      'diamond_shield_grant_failed'            -- D26: grant RPC raised an exception
    );
  END IF;
END $$;
```

#### `privilege_tier_change_reason`

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'privilege_tier_change_reason' AND n.nspname = 'public') THEN
    CREATE TYPE privilege_tier_change_reason AS ENUM (
      'signup_default',         -- silver assigned at clients INSERT
      'auto_upgrade',            -- evaluate RPC promoted on payment trigger
      'auto_downgrade',          -- daily cron after 90-day grace
      'admin_force',             -- admin manual override
      'admin_lock_expired',      -- lock window ended, auto-downgrade resumes
      'data_correction'          -- admin retroactive fix (with audit reason)
    );
  END IF;
END $$;
```

#### `privilege_admin_action_type`

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'privilege_admin_action_type' AND n.nspname = 'public') THEN
    CREATE TYPE privilege_admin_action_type AS ENUM (
      'view_privilege_detail',
      'force_tier_change',
      'set_tier_lock',
      'manual_cashback_adjustment'
    );
  END IF;
END $$;
```

### §3.2 New tables (3)

#### `privilege_tier_thresholds` (lookup, 4-row seed)

```sql
CREATE TABLE IF NOT EXISTS privilege_tier_thresholds (
  tier client_privilege_tier PRIMARY KEY,
  min_qualified_spend_sar DECIMAL(14, 2) NOT NULL CHECK (min_qualified_spend_sar >= 0),
  cashback_pct DECIMAL(5, 2) NOT NULL CHECK (cashback_pct >= 0 AND cashback_pct <= 100),
  empty_legs_boost_hours INT NOT NULL CHECK (empty_legs_boost_hours >= 0),
  free_diamond_shield BOOLEAN NOT NULL DEFAULT false,
  two_factor_required BOOLEAN NOT NULL DEFAULT false,
  cashback_expiry_months INT NOT NULL DEFAULT 24 CHECK (cashback_expiry_months > 0),
  perks_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,   -- free-form perks documentation
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE privilege_tier_thresholds ENABLE ROW LEVEL SECURITY;

INSERT INTO privilege_tier_thresholds (
  tier, min_qualified_spend_sar, cashback_pct, empty_legs_boost_hours,
  free_diamond_shield, two_factor_required, cashback_expiry_months, perks_jsonb
) VALUES
  ('silver',   0,         5.00,  0,  false, false, 24,
    '{"empty_legs_window":"standard","support":"24/7"}'::jsonb),
  ('gold',     100000,    8.00,  2,  false, false, 24,
    '{"empty_legs_window":"+2h","catering":"complimentary","account_manager":true}'::jsonb),
  ('platinum', 500000,   12.00,  6,  false, true,  24,
    '{"empty_legs_window":"+6h","ground_transfer":"complimentary","alternative_aircraft":"guaranteed","2fa":"required_soon"}'::jsonb),
  ('diamond',  2000000,  15.00, 12,  true,  true,  24,
    '{"empty_legs_window":"+12h","concierge":"24/7","free_flight_per_year":1,"shield":"diamond_unlimited","2fa":"required_soon"}'::jsonb)
ON CONFLICT (tier) DO NOTHING;
```

#### `client_loyalty_ledger` (append-only event log)

```sql
CREATE TABLE IF NOT EXISTS client_loyalty_ledger (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  event_type            loyalty_ledger_event_type NOT NULL,
  amount_sar            DECIMAL(12, 2) NOT NULL,
    -- POSITIVE for earn/adjust+/refund_back; NEGATIVE for redeem/expire/adjust-.
    -- Always interpreted as the delta to balance.
  balance_after_sar     DECIMAL(14, 2) NOT NULL CHECK (balance_after_sar >= 0),
  booking_id            UUID REFERENCES bookings(id) ON DELETE RESTRICT,
    -- NULL for adjust/expire/diamond_shield_* events.
  source_change_log_id  UUID REFERENCES privilege_tier_change_log(id) ON DELETE RESTRICT,
    -- NOT NULL for diamond_shield_* events; NULL otherwise.
  source_subscription_id UUID REFERENCES medevac_subscriptions(id) ON DELETE RESTRICT,
    -- NOT NULL for diamond_shield_granted events; NULL otherwise.
  admin_actor_cookie_fingerprint TEXT,
    -- NOT NULL for adjust events (admin manual correction).
  admin_reason          TEXT CHECK (admin_reason IS NULL OR length(admin_reason) BETWEEN 10 AND 500),
  cashback_expiry_at    TIMESTAMPTZ,
    -- For earn events: NOW() + cashback_expiry_months from thresholds. NULL otherwise.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Invariants
  -- Round 2 PR #80 F24 fix: `refund_back` removed from ENUM; this
  -- branch now covers only `earn` (Phase 13.1 will re-add refund_back
  -- to both ENUM and this CHECK when shipping the producer RPC).
  CONSTRAINT client_loyalty_ledger_amount_sign_check CHECK (
    (event_type = 'earn' AND amount_sar > 0)
    OR (event_type IN ('redeem', 'expire') AND amount_sar < 0)
    OR (event_type = 'adjust')   -- can be either sign
    OR (event_type IN ('diamond_shield_granted',
                        'diamond_shield_skipped_already_diamond',
                        'diamond_shield_skipped_paying_paid_plan',
                        'diamond_shield_revoked_on_downgrade',
                        'diamond_shield_grant_failed')
        AND amount_sar = 0)
  ),
  CONSTRAINT client_loyalty_ledger_admin_reason_required_for_adjust CHECK (
    event_type != 'adjust' OR admin_reason IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_subscription_required_for_grant CHECK (
    event_type != 'diamond_shield_granted' OR source_subscription_id IS NOT NULL
  ),
  -- Round 5 PR #80 F7 fix — extended to cover ALL diamond_shield_*
  -- event_types (including the Round 1 F12 / Round 5 _already_diamond
  -- and the D26 _grant_failed values). The simplest robust shape is
  -- a prefix check rather than enumerating each label.
  CONSTRAINT client_loyalty_ledger_change_log_required_for_diamond CHECK (
    NOT (event_type::text LIKE 'diamond_shield_%')
    OR source_change_log_id IS NOT NULL
  ),
  -- Round 2 PR #80 F24 fix: refund_back removed from ENUM;
  -- this CHECK no longer references it. Phase 13.1 will re-add.
  CONSTRAINT client_loyalty_ledger_booking_required_for_booking_events_check CHECK (
    event_type NOT IN ('earn', 'redeem')
    OR booking_id IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_expiry_only_on_earn CHECK (
    cashback_expiry_at IS NULL OR event_type = 'earn'
  )
);

CREATE INDEX IF NOT EXISTS idx_client_loyalty_ledger_client
  ON client_loyalty_ledger (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_loyalty_ledger_booking
  ON client_loyalty_ledger (booking_id) WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_loyalty_ledger_expiry_sweep
  ON client_loyalty_ledger (cashback_expiry_at)
  WHERE event_type = 'earn' AND cashback_expiry_at IS NOT NULL;

-- D21: defense-in-depth idempotency. The RPC checks before INSERT;
-- this UNIQUE index ensures the DB rejects any concurrent double-insert
-- attempt (e.g. trigger fires twice in racing transactions). Partial on
-- WHERE event_type='earn' so adjust/expire/diamond_shield_* events
-- remain freely multi-per-booking.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_loyalty_ledger_earn_per_booking
  ON client_loyalty_ledger (booking_id)
  WHERE event_type = 'earn' AND booking_id IS NOT NULL;

-- Round 3 PR #80 F28 fix — same idempotency invariant for redeem:
-- a booking can have AT MOST ONE redeem event. Multiple
-- redeem-per-booking would also conflict with D7 (50% cap is
-- single-redemption-based, not cumulative). The RPC short-circuits
-- on EXISTS too; this index is the DB backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_loyalty_ledger_redeem_per_booking
  ON client_loyalty_ledger (booking_id)
  WHERE event_type = 'redeem' AND booking_id IS NOT NULL;

ALTER TABLE client_loyalty_ledger ENABLE ROW LEVEL SECURITY;
```

**Append-only**: no UPDATE or DELETE allowed via RLS. The only
modifications are INSERTs from `award_cashback_for_booking`,
`redeem_cashback_for_booking`, `admin_adjust_cashback`,
`expire_old_loyalty_credits` RPCs (all SECURITY DEFINER).

#### `privilege_tier_change_log` (audit log)

```sql
CREATE TABLE IF NOT EXISTS privilege_tier_change_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  from_tier             client_privilege_tier NOT NULL,
  to_tier               client_privilege_tier NOT NULL,
  reason                privilege_tier_change_reason NOT NULL,
  qualified_spend_12m_sar DECIMAL(14, 2) NOT NULL,
  grace_started_at      TIMESTAMPTZ,
    -- For auto_downgrade events: the day client first dropped below
    -- threshold (privilege_below_threshold_since at downgrade time).
  admin_actor_cookie_fingerprint TEXT,
    -- NOT NULL for admin_force / admin_lock_expired / data_correction.
  admin_reason          TEXT CHECK (admin_reason IS NULL OR length(admin_reason) BETWEEN 10 AND 500),
  lock_until            DATE,
    -- For admin_force with lock; NULL otherwise.
  source_booking_id     UUID REFERENCES bookings(id) ON DELETE RESTRICT,
    -- For auto_upgrade events triggered by a specific booking payment.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT privilege_tier_change_log_admin_required CHECK (
    reason NOT IN ('admin_force', 'data_correction')
    OR (admin_actor_cookie_fingerprint IS NOT NULL AND admin_reason IS NOT NULL)
  ),
  CONSTRAINT privilege_tier_change_log_grace_only_on_downgrade CHECK (
    grace_started_at IS NULL OR reason = 'auto_downgrade'
  ),
  CONSTRAINT privilege_tier_change_log_lock_only_on_admin_force CHECK (
    lock_until IS NULL OR reason = 'admin_force'
  ),
  -- Round 1 PR #80 F3 fix: prevent no-op log entries (e.g. silver→silver
  -- when client is already at lowest tier and below_since clock expired).
  -- The §4.2 RPC short-circuits before reaching INSERT, this CHECK is
  -- defense-in-depth.
  CONSTRAINT privilege_tier_change_log_from_to_distinct_check CHECK (
    from_tier != to_tier
  )
);

CREATE INDEX IF NOT EXISTS idx_privilege_tier_change_log_client
  ON privilege_tier_change_log (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privilege_tier_change_log_pending_grace
  ON privilege_tier_change_log (created_at DESC)
  WHERE reason = 'auto_downgrade';

ALTER TABLE privilege_tier_change_log ENABLE ROW LEVEL SECURITY;
```

### §3.3 Columns added to existing tables

#### `clients` — 7 new columns

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS privilege_tier client_privilege_tier NOT NULL DEFAULT 'silver',
  ADD COLUMN IF NOT EXISTS privilege_tier_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS privilege_tier_qualified_spend_12m_sar DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS privilege_below_threshold_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_locked_until DATE,
  ADD COLUMN IF NOT EXISTS cashback_balance_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CHECK (cashback_balance_sar >= 0),
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_privilege_tier
  ON clients (privilege_tier);

CREATE INDEX IF NOT EXISTS idx_clients_below_threshold_grace
  ON clients (privilege_below_threshold_since)
  WHERE privilege_below_threshold_since IS NOT NULL;
```

#### `bookings` — 3 new columns (cashback + payment timestamp)

Round 1 PR #80 F1+F2+F8 fix — neither `payment_status_confirmed_at`
nor `amount_paid_sar` exist anywhere in current schema. Phase 13
owns the `paid_at` column it depends on (per D22), and computes
`amount_paid_sar` inline (per D23) rather than introducing a
stored-derived column that can drift.

```sql
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cashback_redemption_sar DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (cashback_redemption_sar >= 0),
  ADD COLUMN IF NOT EXISTS cashback_earned_sar DECIMAL(12, 2) DEFAULT NULL
    CHECK (cashback_earned_sar IS NULL OR cashback_earned_sar >= 0),
  -- D22: canonical payment-confirmation timestamp. Stamped by the
  -- §3.4 trigger on the same UPDATE that flips payment_status='paid'.
  -- NULL until first payment; backfill cron at activation step 3
  -- (§7) populates this for historical paid bookings using updated_at
  -- as the best-available proxy.
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- D7 cap: redemption <= 50% of total_amount AND total_amount - redemption >= 1
-- Round 5 PR #80 F5 fix — wrapped in DO block for replay safety
-- (raw ALTER TABLE ADD CONSTRAINT fails with `already exists` on
-- re-run; the migration in PR 1 already uses this guarded form).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'bookings_cashback_redemption_cap_check') THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_cashback_redemption_cap_check CHECK (
        cashback_redemption_sar <= total_amount * 0.5
        AND (total_amount - cashback_redemption_sar) >= 1
      );
  END IF;
END $$;

-- D24 + Round 3 PR #80 F26 fix: total_amount + paid_at BOTH
-- immutable AFTER payment_status='paid'. The trigger now guards
-- both fields:
--   - total_amount: cannot change once paid_at is set (existing D24)
--   - paid_at: cannot be cleared (NEW.paid_at → NULL) or shifted
--     (NEW.paid_at → different non-NULL timestamp) once set.
--     This is critical because paid_at drives the rolling-12-month
--     spend window (D1/D22); mutating it post-set would silently
--     re-classify a client's tier eligibility.
--
-- Round 2 PR #80 F22 clarification still holds — admin pre-paid
-- corrections are EXPLICITLY ALLOWED (rejection fires only when
-- OLD.paid_at IS NOT NULL).
--
-- Renamed function: `reject_paid_state_mutation_after_paid` to
-- reflect both-field coverage (was `reject_total_amount_*` in
-- Round 1).
CREATE OR REPLACE FUNCTION reject_paid_state_mutation_after_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.paid_at IS NOT NULL THEN
    -- Block total_amount mutation
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
      RAISE EXCEPTION 'bookings_total_amount_immutable_after_paid: cannot mutate total_amount once paid_at is set (booking_id=%)', OLD.id
        USING ERRCODE = '22023';
    END IF;
    -- Block paid_at mutation (clear OR shift)
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'bookings_paid_at_immutable_after_set: cannot mutate paid_at once set (booking_id=%, old=%, new=%)', OLD.id, OLD.paid_at, NEW.paid_at
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Round 3 PR #80 F26 fix — trigger + function renamed.
DROP TRIGGER IF EXISTS trg_bookings_total_amount_immutable_after_paid ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_paid_state_immutable_after_paid ON bookings;
CREATE TRIGGER trg_bookings_paid_state_immutable_after_paid
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION reject_paid_state_mutation_after_paid();

-- D22: replaced payment_status_confirmed_at (ghost) with paid_at.
CREATE INDEX IF NOT EXISTS idx_bookings_paid_at_for_loyalty
  ON bookings (paid_at DESC, client_id)
  WHERE payment_status = 'paid' AND client_id IS NOT NULL;
```

### §3.4 Triggers (4 new — split BEFORE/AFTER per Round 5 F1 fix)

**Round 5 PR #80 F1 fix (P1)** — the earlier single-function
BEFORE trigger had a critical timing bug:

- In `BEFORE INSERT paid`: the row is not yet visible in the
  table, so `award_cashback_for_booking` calling
  `SELECT total_amount FROM bookings WHERE id = NEW.id` returned
  no row.
- In `BEFORE UPDATE pending_offline → paid`: the row is still
  visible with OLD's `payment_status='pending_offline'`, so
  `calculate_client_qualified_spend_12m` (which filters on
  `payment_status='paid'`) excluded the current booking from
  the spend window — the very upgrade that this UPDATE was
  supposed to trigger.

The fix splits responsibility:
- **BEFORE** trigger stamps `NEW.paid_at = NOW()` (mutates the
  row that's about to be written; trivially safe).
- **AFTER** trigger fires `award_cashback_for_booking` and
  `evaluate_client_privilege_tier` (row is now visible, and
  the spend window query sees it).

#### `bookings_stamp_paid_at_before` (BEFORE — stamp only)

```sql
CREATE OR REPLACE FUNCTION on_bookings_stamp_paid_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- D22: stamp paid_at on the first paid transition. Only set if
  -- NULL (caller may have pre-stamped on legacy import). No other
  -- side effects in BEFORE — award/evaluate run in AFTER.
  IF NEW.paid_at IS NULL THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_stamp_paid_at_ins ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_stamp_paid_at_upd ON bookings;

CREATE TRIGGER trg_bookings_stamp_paid_at_ins
  BEFORE INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid')
  EXECUTE FUNCTION on_bookings_stamp_paid_at();

CREATE TRIGGER trg_bookings_stamp_paid_at_upd
  BEFORE UPDATE OF payment_status ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status != 'paid')
  EXECUTE FUNCTION on_bookings_stamp_paid_at();
```

#### `bookings_award_and_evaluate_after` (AFTER — side effects)

```sql
CREATE OR REPLACE FUNCTION on_bookings_paid_award_and_evaluate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tier_eval_result JSONB;
BEGIN
  -- Row is now visible with payment_status='paid' and paid_at set
  -- (stamped by the matching BEFORE trigger). All downstream RPCs
  -- can SELECT the row and rely on its committed state.

  -- D16: cashback eligibility filter (charter / cargo / medevac
  -- out-of-pocket only).
  IF NEW.client_id IS NOT NULL
     AND NEW.source_discriminator IN ('charter', 'cargo', 'medevac')
     AND NOT (NEW.source_discriminator = 'medevac' AND COALESCE(NEW.is_covered, false))
  THEN
    PERFORM award_cashback_for_booking(NEW.client_id, NEW.id);
  END IF;

  -- Re-evaluate tier. D26: Diamond grant failure inside this call
  -- is caught + logged but does NOT block payment confirmation
  -- (the AFTER trigger has already let the payment UPDATE commit;
  -- the only side effect of a failure here is a missing Diamond
  -- Shield grant, surfaced via the canary card).
  IF NEW.client_id IS NOT NULL THEN
    v_tier_eval_result := evaluate_client_privilege_tier(NEW.client_id, NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_payment_paid_award_cashback ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_payment_paid_award_cashback_ins ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_payment_paid_award_cashback_upd ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_paid_award_after_ins ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_paid_award_after_upd ON bookings;

CREATE TRIGGER trg_bookings_paid_award_after_ins
  AFTER INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid')
  EXECUTE FUNCTION on_bookings_paid_award_and_evaluate();

CREATE TRIGGER trg_bookings_paid_award_after_upd
  AFTER UPDATE OF payment_status ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status != 'paid')
  EXECUTE FUNCTION on_bookings_paid_award_and_evaluate();
```

Total trigger count: **5** = `paid_state_immutable` (D24+F26) +
`stamp_paid_at_ins` + `stamp_paid_at_upd` (F1 BEFORE) +
`paid_award_after_ins` + `paid_award_after_upd` (F1 AFTER).

Neither function references `OLD` directly (only `NEW.*` fields),
so both INSERT and UPDATE paths work without TG_OP guards.

#### `reject_total_amount_mutation_after_paid` (D24)

Defined inline in §3.3 above. Enforces D24 immutability.

#### Refund-reversal trigger — **deferred to Phase 13.1**

Round 1 PR #80 F5 fix — the `on_bookings_payment_refunded_reverse_cashback`
trigger and the `process_refund_for_booking` RPC are explicitly
**OUT OF SCOPE for Phase 13 v1** (per D25). The `refund_back` ENUM
value and `idx_client_loyalty_ledger_booking_refund_back` indexes
are reserved placeholders. No producer path ships in v1.

Phase 13.1 will:
1. Decide partial vs full refund proportional cashback reversal.
2. Decide VAT/commission handling on reversal.
3. Add `process_refund_for_booking(p_booking_id, p_refund_amount, p_reason)` RPC.
4. Lift the D24 immutability constraint to permit refund-authored mutations.

### §3.5 RLS policies

Round 4 PR #80 F35 fix — earlier rounds described RLS in prose
only. Phase 12 Round 9 P2 #2 pattern requires explicit `CREATE
POLICY` blocks per table for Codex acceptance. Full DDL below.

Round 5 PR #80 F5 fix — each `CREATE POLICY` is wrapped in
`DROP POLICY IF EXISTS` (or DO-block existence check) so the
migration re-runs cleanly without `policy "X" for table "Y"
already exists` errors. PR 1 migration uses the DO-block form;
the equivalent `DROP POLICY IF EXISTS` style is shown here for
spec readability.

```sql
-- client_loyalty_ledger: clients read OWN rows; no client write.
-- Service-role bypasses RLS (writes happen via SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS client_loyalty_ledger_select_own ON client_loyalty_ledger;
CREATE POLICY client_loyalty_ledger_select_own
  ON client_loyalty_ledger FOR SELECT
  TO authenticated
  USING (client_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid);
-- No INSERT/UPDATE/DELETE policies → all writes happen via service-role.

-- privilege_tier_change_log: clients read OWN rows. Admin force
-- + admin_reason ARE visible to the affected client (transparency).
-- If we want to hide admin_reason from client, that's Phase 13.x.
DROP POLICY IF EXISTS privilege_tier_change_log_select_own ON privilege_tier_change_log;
CREATE POLICY privilege_tier_change_log_select_own
  ON privilege_tier_change_log FOR SELECT
  TO authenticated
  USING (client_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid);

-- privilege_tier_thresholds: PUBLIC SELECT (anyone can see the
-- 4-tier breakdown — it's the basis of the loyalty marketing page).
-- Service-role only updates (rare; thresholds are stable).
DROP POLICY IF EXISTS privilege_tier_thresholds_select_public ON privilege_tier_thresholds;
CREATE POLICY privilege_tier_thresholds_select_public
  ON privilege_tier_thresholds FOR SELECT
  TO anon, authenticated
  USING (true);

-- clients new columns: existing RLS policies continue from Phase 9
-- (client owns row, sees own data only). cashback_balance_sar and
-- privilege_tier are part of the existing OWN-row visibility →
-- no additional CREATE POLICY needed (they're columns on a row
-- that already has SELECT-own policy from Phase 9 PR 1).
--
-- Defensive note: anon role cannot see clients table at all per
-- existing Phase 9 RLS → no risk of leaking cashback_balance_sar
-- to logged-out visitors.
```

**Service-role bypass**: all 11 RPCs (§4) are `SECURITY DEFINER`
+ `SET search_path = public`, so they execute as the function
owner (service-role) and bypass RLS. Application code calling
RPCs via `createAdminClient()` (Phase 7+ convention) sees full
visibility; clients calling via PostgREST hit RLS-filtered rows
of `client_loyalty_ledger` + `privilege_tier_change_log` (own
only).

---

## §4 RPC layer

### §4.1 `calculate_client_qualified_spend_12m(p_client_id UUID) RETURNS DECIMAL(14,2)`

Pure read-only. Sums **`(total_amount - cashback_redemption_sar)`**
inline (per D23 — no stored `amount_paid_sar` column) where:

- `client_id = p_client_id`
- `payment_status = 'paid'`
- `paid_at > NOW() - INTERVAL '12 months'` (D22 — replaces ghost
  `payment_status_confirmed_at`)
- `source_discriminator IN ('charter', 'cargo', 'medevac')` per D16
- NOT (source_discriminator = 'medevac' AND is_covered = true)

Round 1 PR #80 F1+F2 fix — both `payment_status_confirmed_at` and
`amount_paid_sar` were spec-references to columns that don't exist
in the actual schema. This RPC now uses the schema as Phase 13 PR 1
defines it (paid_at column from D22, amount_paid computed inline
from D23).

```sql
CREATE OR REPLACE FUNCTION calculate_client_qualified_spend_12m(
  p_client_id UUID
)
RETURNS DECIMAL(14,2)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(total_amount - cashback_redemption_sar), 0)::DECIMAL(14,2)
  FROM bookings
  WHERE client_id = p_client_id
    AND payment_status = 'paid'
    AND paid_at > NOW() - INTERVAL '12 months'
    AND source_discriminator IN ('charter', 'cargo', 'medevac')
    AND NOT (source_discriminator = 'medevac' AND COALESCE(is_covered, false));
$$;

REVOKE ALL ON FUNCTION calculate_client_qualified_spend_12m(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_client_qualified_spend_12m(UUID)
  TO service_role;
```

### §4.2 `evaluate_client_privilege_tier(p_client_id UUID) RETURNS JSONB`

Main tier evaluation entry point. Behaviour:

1. Compute `qualified_spend_12m` via §4.1.
2. Look up `current_tier` from clients.
3. Determine `target_tier` from thresholds.
4. Determine `tier_action`:
   - target > current → `upgrade` (immediate)
   - target == current → `no_change`
   - target < current AND tier_locked_until > NOW() → `locked_no_action`
   - target < current AND privilege_below_threshold_since IS NULL → `start_grace`
   - target < current AND grace expired (>=90 days) → `downgrade_one_step`
   - target < current AND grace in progress → `grace_in_progress`
5. Execute action atomically (UPDATE clients + INSERT change_log;
   optionally trigger Diamond × Shield grant per D11).
6. Return JSONB envelope:

```json
{
  "ok": true,
  "tier_action": "upgrade|no_change|start_grace|grace_in_progress|downgrade_one_step|locked_no_action",
  "from_tier": "silver",
  "to_tier": "gold",
  "qualified_spend_12m_sar": 120000.00,
  "change_log_id": "<uuid or null>",
  "diamond_shield_granted_subscription_id": "<uuid or null>"
}
```

Pseudocode:

```sql
CREATE OR REPLACE FUNCTION evaluate_client_privilege_tier(
  p_client_id UUID,
  p_source_booking_id UUID DEFAULT NULL  -- for change_log audit context
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spend            DECIMAL(14,2);
  v_current_tier     client_privilege_tier;
  v_target_tier      client_privilege_tier;
  v_below_since      TIMESTAMPTZ;
  v_locked_until     DATE;
  v_change_log_id    UUID;
  v_subscription_id  UUID;
  v_action           TEXT;
BEGIN
  v_spend := calculate_client_qualified_spend_12m(p_client_id);

  SELECT privilege_tier, privilege_below_threshold_since, tier_locked_until
    INTO v_current_tier, v_below_since, v_locked_until
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  -- Determine target
  SELECT tier INTO v_target_tier
  FROM privilege_tier_thresholds
  WHERE v_spend >= min_qualified_spend_sar
  ORDER BY min_qualified_spend_sar DESC
  LIMIT 1;

  IF v_target_tier IS NULL THEN v_target_tier := 'silver'; END IF;

  -- Branch on action
  IF tier_rank(v_target_tier) > tier_rank(v_current_tier) THEN
    v_action := 'upgrade';
  ELSIF v_target_tier = v_current_tier THEN
    v_action := 'no_change';
    -- Reset grace if back at/above threshold
    IF v_below_since IS NOT NULL THEN
      UPDATE clients SET privilege_below_threshold_since = NULL
        WHERE id = p_client_id;
    END IF;
  ELSIF v_locked_until IS NOT NULL AND v_locked_until > CURRENT_DATE THEN
    -- Round 1 PR #80 F18 fix — `tier_locked_until` is EXCLUSIVE end
    -- date. Lock applies WHILE CURRENT_DATE < v_locked_until. On the
    -- day v_locked_until = CURRENT_DATE, the lock has expired and
    -- normal auto-downgrade resumes. Documented in §4.5 admin RPC
    -- as well so admin UX matches expectation.
    v_action := 'locked_no_action';
    -- Reset grace clock under lock
    IF v_below_since IS NOT NULL THEN
      UPDATE clients SET privilege_below_threshold_since = NULL
        WHERE id = p_client_id;
    END IF;
  ELSIF v_below_since IS NULL THEN
    v_action := 'start_grace';
    UPDATE clients SET privilege_below_threshold_since = NOW()
      WHERE id = p_client_id;
  ELSIF NOW() - v_below_since >= INTERVAL '90 days' THEN
    v_action := 'downgrade_one_step';
    -- Compute next lower tier (one step only, never skip)
    v_target_tier := step_down_one(v_current_tier);
    -- Round 1 PR #80 F3 fix: silver→silver is a no-op (already
    -- lowest). Skip log + clear grace clock so we don't loop
    -- forever appending dummy rows every 90 days.
    IF v_target_tier = v_current_tier THEN
      v_action := 'already_lowest_no_action';
      UPDATE clients SET privilege_below_threshold_since = NULL
        WHERE id = p_client_id;
    END IF;
  ELSE
    v_action := 'grace_in_progress';
  END IF;

  -- Apply upgrade or downgrade
  IF v_action IN ('upgrade', 'downgrade_one_step') THEN
    INSERT INTO privilege_tier_change_log (
      client_id, from_tier, to_tier, reason,
      qualified_spend_12m_sar,
      grace_started_at,
      source_booking_id
    ) VALUES (
      p_client_id, v_current_tier, v_target_tier,
      CASE WHEN v_action = 'upgrade' THEN 'auto_upgrade' ELSE 'auto_downgrade' END,
      v_spend,
      CASE WHEN v_action = 'downgrade_one_step' THEN v_below_since ELSE NULL END,
      p_source_booking_id
    ) RETURNING id INTO v_change_log_id;

    UPDATE clients SET
      privilege_tier = v_target_tier,
      privilege_tier_assigned_at = NOW(),
      privilege_below_threshold_since = NULL,
      privilege_tier_qualified_spend_12m_sar = v_spend
    WHERE id = p_client_id;

    -- D11 + D26: Diamond cross-product grant — wrapped in BEGIN/EXCEPTION
    -- so a Phase 12 schema change (e.g. new required medevac_subscriptions
    -- field) cannot block payment confirmation. Failure is logged to ledger
    -- + audit_logs; admin reviews via canary card (PR 3).
    IF v_target_tier = 'diamond' THEN
      BEGIN
        v_subscription_id := auto_grant_diamond_shield_subscription(
          p_client_id, v_change_log_id
        );
      EXCEPTION WHEN OTHERS THEN
        -- Log failure to ledger (D26 reserved event_type
        -- 'diamond_shield_grant_failed') + audit_logs; continue.
        INSERT INTO client_loyalty_ledger (
          client_id, event_type, amount_sar, balance_after_sar,
          source_change_log_id, admin_reason
        ) VALUES (
          p_client_id, 'diamond_shield_grant_failed', 0,
          (SELECT cashback_balance_sar FROM clients WHERE id = p_client_id),
          v_change_log_id,
          'auto_grant failed: ' || SQLERRM
        );
        INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
        VALUES ('privilege_tier_change_log', v_change_log_id,
                'diamond_shield_grant_failed',
                jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE));
        v_subscription_id := NULL;
      END;
    END IF;
    -- D11: Diamond downgrade — schedule revoke (end_date or grace,
    -- whichever later); detail in §4.8. Also wrapped per D26.
    IF v_current_tier = 'diamond' AND v_target_tier != 'diamond' THEN
      BEGIN
        PERFORM schedule_diamond_shield_revoke(p_client_id, v_change_log_id);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
        VALUES ('privilege_tier_change_log', v_change_log_id,
                'diamond_shield_revoke_schedule_failed',
                jsonb_build_object('error', SQLERRM));
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tier_action', v_action,
    'from_tier', v_current_tier,
    'to_tier', v_target_tier,
    'qualified_spend_12m_sar', v_spend,
    'change_log_id', v_change_log_id,
    'diamond_shield_granted_subscription_id', v_subscription_id
  );
END;
$$;
```

### §4.3 `award_cashback_for_booking(p_client_id UUID, p_booking_id UUID) RETURNS JSONB`

Computes cashback based on **tier at the moment of payment
confirmation** and `amount_paid_sar` (D6 — no compound).

```
amount = booking.amount_paid_sar * cashback_pct(client.tier) / 100
```

INSERTs `earn` ledger event + UPDATEs `clients.cashback_balance_sar`
+ stores `bookings.cashback_earned_sar` for transparency.

**D21 idempotency guard + Round 5 PR #80 F2 fix** (P1 — SECURITY
DEFINER RPC must enforce booking ownership + state at DB boundary,
not rely on the trigger caller). The RPC now locks the booking
row FOR UPDATE and verifies:

- booking exists
- `booking.client_id = p_client_id` (cross-client attack guard)
- `payment_status = 'paid'` AND `paid_at IS NOT NULL`
- `source_discriminator IN ('charter', 'cargo', 'medevac')`
- NOT (medevac AND is_covered) — D16 eligibility

If any guard fails, returns `{ok:false, error:'<reason>'}`. The
trigger eligibility filter (D16) and ownership are kept there
too for defense-in-depth, but the RPC is now safe to call directly
from any context (admin tool, future webhook, etc.).

```sql
CREATE OR REPLACE FUNCTION award_cashback_for_booking(
  p_client_id UUID,
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier             client_privilege_tier;
  v_pct              DECIMAL(5,2);
  v_amount_paid      DECIMAL(14,2);
  v_cashback_amount  DECIMAL(12,2);
  v_expiry_months    INT;
  v_new_balance      DECIMAL(14,2);
  v_ledger_id        UUID;
  v_booking_client   UUID;
  v_payment_status   TEXT;
  v_paid_at          TIMESTAMPTZ;
  v_discriminator    TEXT;
  v_is_covered       BOOLEAN;
  v_total_amount     DECIMAL(14,2);
  v_redemption       DECIMAL(14,2);
BEGIN
  -- D21 guard: refuse to double-award. RPC-level check + DB UNIQUE
  -- index on (booking_id) WHERE event_type='earn' (§3.2) is the
  -- defense-in-depth backstop for races.
  IF EXISTS (
    SELECT 1 FROM client_loyalty_ledger
    WHERE booking_id = p_booking_id
      AND event_type = 'earn'
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_awarded', true,
      'skipped_reason', 'duplicate_earn_for_booking',
      'booking_id', p_booking_id
    );
  END IF;

  -- F2 (P1): lock booking row + verify ownership + state at DB
  -- boundary. SECURITY DEFINER means we can't trust the caller.
  SELECT client_id, payment_status::text, paid_at,
         source_discriminator::text, COALESCE(is_covered, false),
         total_amount, cashback_redemption_sar
    INTO v_booking_client, v_payment_status, v_paid_at,
         v_discriminator, v_is_covered,
         v_total_amount, v_redemption
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking_client IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;
  IF v_booking_client != p_client_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_client_mismatch');
  END IF;
  IF v_payment_status != 'paid' OR v_paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_paid');
  END IF;
  IF v_discriminator NOT IN ('charter', 'cargo', 'medevac') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_eligible_for_cashback');
  END IF;
  IF v_discriminator = 'medevac' AND v_is_covered THEN
    -- D16: covered MedEvac (Shield-funded) does not earn cashback.
    RETURN jsonb_build_object('ok', false, 'error', 'booking_covered_medevac_excluded');
  END IF;

  -- Load tier + cashback % (lock client row FOR UPDATE — serializes
  -- balance writes across racing earn events for same client).
  SELECT c.privilege_tier, t.cashback_pct, t.cashback_expiry_months
    INTO v_tier, v_pct, v_expiry_months
  FROM clients c
  JOIN privilege_tier_thresholds t ON t.tier = c.privilege_tier
  WHERE c.id = p_client_id
  FOR UPDATE;

  IF v_tier IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- D23: amount_paid is computed inline (NOT a stored column).
  v_amount_paid := v_total_amount - COALESCE(v_redemption, 0);
  IF v_amount_paid <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_zero_amount_paid');
  END IF;

  v_cashback_amount := ROUND(v_amount_paid * v_pct / 100, 2);

  -- Append-only INSERT. UNIQUE index race backstop.
  BEGIN
    INSERT INTO client_loyalty_ledger (
      client_id, event_type, amount_sar, balance_after_sar,
      booking_id, cashback_expiry_at
    ) VALUES (
      p_client_id, 'earn', v_cashback_amount,
      (SELECT cashback_balance_sar FROM clients WHERE id = p_client_id) + v_cashback_amount,
      p_booking_id,
      NOW() + (v_expiry_months || ' months')::INTERVAL
    ) RETURNING id, balance_after_sar INTO v_ledger_id, v_new_balance;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_awarded', true,
      'skipped_reason', 'duplicate_earn_for_booking_race',
      'booking_id', p_booking_id
    );
  END;

  UPDATE clients SET cashback_balance_sar = v_new_balance
    WHERE id = p_client_id;
  UPDATE bookings SET cashback_earned_sar = v_cashback_amount
    WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_awarded', false,
    'ledger_id', v_ledger_id,
    'tier_at_award', v_tier,
    'cashback_pct', v_pct,
    'amount_paid_sar', v_amount_paid,
    'cashback_amount_sar', v_cashback_amount,
    'new_balance_sar', v_new_balance
  );
END;
$$;
```

### §4.4 `redeem_cashback_for_booking(p_client_id UUID, p_booking_id UUID, p_redemption_amount DECIMAL) RETURNS JSONB`

Caller-bound: called from `accept_offer` Server Actions when client
elects to redeem balance. Validates D7 caps + sufficient balance.

INSERTs `redeem` ledger event + UPDATEs
`clients.cashback_balance_sar` (decrement) + sets
`bookings.cashback_redemption_sar`.

**Round 3 PR #80 F27 + F30 fix** (FOR UPDATE on clients +
idempotency) **+ Round 5 PR #80 F3 fix** (P1 — booking ownership
lock at DB boundary; SECURITY DEFINER cannot trust caller). The
RPC now locks the booking row FOR UPDATE with `client_id` predicate
in the SELECT — preventing cross-client redemption attempts:

```sql
CREATE OR REPLACE FUNCTION redeem_cashback_for_booking(
  p_client_id          UUID,
  p_booking_id         UUID,
  p_redemption_amount  DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance  DECIMAL(14,2);
  v_total_amount     DECIMAL(14,2);
  v_paid_at          TIMESTAMPTZ;
  v_new_balance      DECIMAL(14,2);
  v_ledger_id        UUID;
BEGIN
  IF p_redemption_amount IS NULL OR p_redemption_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'redemption_amount_invalid');
  END IF;

  -- F28 idempotency
  IF EXISTS (
    SELECT 1 FROM client_loyalty_ledger
    WHERE booking_id = p_booking_id AND event_type = 'redeem'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed_for_booking');
  END IF;

  -- F27: lock clients row (serializes all balance writes)
  SELECT cashback_balance_sar INTO v_current_balance
  FROM clients WHERE id = p_client_id FOR UPDATE;
  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;
  IF v_current_balance < p_redemption_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'current_balance', v_current_balance, 'requested', p_redemption_amount
    );
  END IF;

  -- F3 (P1): lock booking row WITH client_id predicate. This is
  -- the security boundary — without the AND client_id filter, any
  -- caller with a valid p_booking_id could redeem against any
  -- client's balance.
  SELECT total_amount, paid_at INTO v_total_amount, v_paid_at
  FROM bookings
  WHERE id = p_booking_id AND client_id = p_client_id
  FOR UPDATE;
  IF v_total_amount IS NULL THEN
    -- Either booking doesn't exist OR client_id doesn't match.
    -- Same error envelope for both (don't leak booking existence
    -- to other clients).
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found_or_not_owned');
  END IF;

  -- D7 cap 1
  IF p_redemption_amount > v_total_amount * 0.5 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'redemption_exceeds_cap',
      'max_allowed', v_total_amount * 0.5
    );
  END IF;
  -- D7 cap 2
  IF (v_total_amount - p_redemption_amount) < 1 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'redemption_leaves_no_cash_payment'
    );
  END IF;

  -- D29: redemption must happen BEFORE payment confirmation.
  -- Now checked from the locked booking row (no second SELECT).
  IF v_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_already_paid');
  END IF;

  v_new_balance := v_current_balance - p_redemption_amount;

  BEGIN
    INSERT INTO client_loyalty_ledger (
      client_id, event_type, amount_sar, balance_after_sar, booking_id
    ) VALUES (
      p_client_id, 'redeem', -p_redemption_amount, v_new_balance, p_booking_id
    ) RETURNING id INTO v_ledger_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed_for_booking_race');
  END;

  UPDATE clients SET cashback_balance_sar = v_new_balance
    WHERE id = p_client_id;
  UPDATE bookings SET cashback_redemption_sar = p_redemption_amount
    WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ledger_id', v_ledger_id,
    'redeemed_sar', p_redemption_amount,
    'new_balance_sar', v_new_balance,
    'booking_id', p_booking_id
  );
END;
$$;
```

### §4.5 `admin_force_privilege_tier(p_client_id UUID, p_new_tier client_privilege_tier, p_session_metadata JSONB, p_reason TEXT, p_lock_until DATE DEFAULT NULL) RETURNS JSONB`

Admin manual override. Same audit pattern as Phase 12 §4.10
`admin_read_medevac_request_detail`: SECURITY DEFINER, audit
INSERT before tier change, cookie fingerprint required, fail-closed
on missing metadata.

**Round 1 PR #80 F9+F18 fix — explicit validation rules**:

1. `p_reason` must be ≥10 chars (matched by `privilege_tier_change_log_admin_required` CHECK + RPC raises `admin_reason_too_short` early).
2. `p_lock_until`, if provided, MUST be `> CURRENT_DATE` (future-only).
   Past dates rejected with `lock_until_must_be_future`. Per D18,
   the value is treated as EXCLUSIVE end (lock active WHILE
   `CURRENT_DATE < lock_until`).
3. `p_new_tier = current_tier` is rejected with `no_op_tier_change`
   (matches the new `privilege_tier_change_log_from_to_distinct_check`
   constraint per F3 fix).
4. `p_session_metadata.cookie_fingerprint` required NOT NULL +
   non-empty (per Phase 12 §4.10 fail-closed pattern).
5. If `p_new_tier='diamond'`, triggers `auto_grant_diamond_shield_subscription`
   (D11 cross-product applies to admin_force too) — wrapped in
   BEGIN/EXCEPTION per D26.

### §4.6 `expire_old_loyalty_credits() RETURNS JSONB`

Daily cron. Scans `client_loyalty_ledger` for `earn` events with
`cashback_expiry_at < NOW()` AND not yet expired (no later `expire`
event for same earn — tracked via FIFO matching). INSERTs
`expire` events to clear oldest unredeemed credits.

### §4.7 `auto_grant_diamond_shield_subscription(p_client_id UUID, p_change_log_id UUID) RETURNS UUID`

D11/D12 cross-product hook. Helper called by §4.2 + admin force
when target tier = diamond.

Round 1 PR #80 F11 fix — explicit return contract for all 3 branches:

| Branch | Condition | Returns | Side effect |
|---|---|---|---|
| **Grant new** | No active medevac_subscription for client | UUID of new subscription | INSERT subscription + ledger event `diamond_shield_granted` (links subscription_id + change_log_id) |
| **Skip — already Diamond** | Active subscription with `plan='diamond'` | `NULL` | Ledger event `diamond_shield_skipped_already_diamond` (links change_log_id only) |
| **Skip — paid higher plan** | Active subscription with `plan != 'diamond'` AND `annual_fee_at_signup_sar > 0` | `NULL` | Ledger event `diamond_shield_skipped_paying_paid_plan` (links change_log_id; commercial conflict avoidance per D12) |

**Round 3 PR #80 F31 fix — covered_members handling**:
Earlier rounds assumed `clients.dob` exists and could seed the
self-relationship covered_member. Verification proved:
- `clients` table (Phase 9) has NO `dob` column
- Phase 12 `subscribe_to_aeris_shield` RPC takes `p_owner_dob DATE`
  as REQUIRED parameter (sourced from the subscribe form, not the
  clients table)

There is no source of DOB for an auto-grant triggered by a tier
upgrade. The fix:

Auto-grant inserts the subscription with `covered_members='[]'::jsonb`
(empty array — Phase 12 schema `covered_members JSONB NOT NULL
DEFAULT '[]'` accepts this). The `notes` field records:
`'Auto-granted via Phase 13 Diamond tier upgrade. covered_members
must be populated by client/admin before first Shield use.
change_log_id=<id>'`.

The client (or admin) populates covered_members later via:
- `/me/medevac/shield/[id]` — client edits own subscription
  (Phase 12 PR 2 page; supports adding members + DOB)
- `/admin/medevac/subscriptions/[id]` — admin edits any
  subscription (Phase 12 admin tool)

This forces an explicit human touchpoint before Shield is consumed
on a covered medevac request — which is appropriate for a free
auto-granted benefit (vs the paid Phase 12 subscribe flow that
collected DOB upfront).

Side-effect: a Diamond client without populated covered_members
who tries `use_subscription=true` on a medevac request will fail
the §4.7 `consume_aeris_shield_event` covered_members
(name, dob) match guard — the UI must surface a clear "populate
covered members first" CTA on `/me/medevac/new` when the only
active subscription has empty covered_members. Phase 13 PR 2
file list adds this CTA to the medevac form.

### §4.8 `schedule_diamond_shield_revoke(p_client_id UUID, p_change_log_id UUID) RETURNS VOID`

D11. On Diamond → lower downgrade, find the
`free Diamond subscription` (the one granted by §4.7 — identifiable
via ledger event `diamond_shield_granted` with matching client) and
set its `end_date` to `MAX(end_date, NOW() + INTERVAL '90 days')`
to honor grace. Cron `expire-shield-subscriptions` (existing Phase
12 infra) handles the actual `status` flip on `end_date` reached.

### §4.9 `tier_rank(t client_privilege_tier) RETURNS INT` (helper)

IMMUTABLE + PARALLEL SAFE. Returns silver=1, gold=2, platinum=3,
diamond=4. Used in evaluate logic for upgrade/downgrade direction.

### §4.10 `step_down_one(t client_privilege_tier) RETURNS client_privilege_tier` (helper)

IMMUTABLE. Returns diamond→platinum, platinum→gold, gold→silver,
silver→silver (already lowest). Used in evaluate for soft
downgrade. Per Round 1 PR #80 F3 fix, callers MUST short-circuit
when `step_down_one(t) = t` (the silver case) to avoid no-op
log entries.

### §4.11 `reconcile_client_cashback_balance(p_client_id UUID) RETURNS JSONB`

Round 1 PR #80 F14 fix — D19 mentions a daily reconciliation cron
but no RPC was defined. This is the worker called by
`/api/cron/privilege/reconcile-balances/route.ts` (added to PR 3
file list).

**Round 2 PR #80 F23 fix — REPORT-ONLY in v1**. The original Round 1
design auto-wrote drift corrections via `adjust` events. Founder
review flagged: auto-correct hides bugs in the award logic; v1
should report only. Manual `admin_adjust_cashback` flow handles
any drift the admin chooses to correct (with audit reason).

Pure read-only: computes `SUM(amount_sar)` over all ledger events
for `p_client_id`, compares to `clients.cashback_balance_sar`, and:

- If equal → return `{ok:true, drift:false, balance:<value>}`.
- If different → log `audit_logs` entry with the drift
  (action='cashback_balance_drift_detected', new_value contains
  prior_balance + ledger_sum + delta). Return `{ok:true,
  drift:true, prior_balance:<denorm>, ledger_sum:<actual>,
  delta:<diff>, action_required:'admin_review'}`.
- **No automatic correction**. No `adjust` event posted. The
  denormalized `clients.cashback_balance_sar` is left as-is until
  admin manually intervenes via `admin_adjust_cashback`.

Cron `/api/cron/privilege/reconcile-balances` iterates all clients
with `cashback_balance_sar > 0 OR any ledger event in last 24h`,
calls this RPC per client, and aggregates results into a daily
report (canary card #8 in PR 3 + founder summary email when
`drift > 0`). The canary card shows count of drifted clients +
total drift magnitude for ops triage.

Phase 13.x may upgrade to auto-correct when:
1. Award logic has been stable for 30+ days with zero drift.
2. A formal safeguard exists (e.g. drift threshold below 100 SAR
   auto-corrects, larger drift requires admin review).

### §4.12 `award_cashback_for_booking` race-locking note

Round 1 PR #80 F13 fix — clarifying the existing FOR UPDATE:

The `SELECT ... FOR UPDATE` on the `clients` row at the start of
the RPC (`SELECT c.privilege_tier, ... FROM clients c JOIN ...
WHERE c.id = p_client_id FOR UPDATE`) serializes all writes to
`cashback_balance_sar` for that client across concurrent
transactions. Two parallel booking payments fall into a wait
queue, not a race.

The subsequent `SELECT cashback_balance_sar` inside the INSERT
VALUES clause reads the same locked row → safe.

The DB UNIQUE INDEX `uq_client_loyalty_ledger_earn_per_booking`
provides the second defense layer for trigger-replay races (where
the same booking_id is awarded twice from racing trigger fires).

### ACL contract for all RPCs above

Round 4 PR #80 F36 fix — per-RPC explicit DDL (Phase 12 Round 9
P2 #2 pattern). Each function definition in PR 1 migration MUST
be immediately followed by:

```sql
REVOKE ALL ON FUNCTION <name>(<exact_arg_types>) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION <name>(<exact_arg_types>) TO service_role;
```

Concrete examples for the 11 RPCs:

```sql
REVOKE ALL ON FUNCTION calculate_client_qualified_spend_12m(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_client_qualified_spend_12m(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION evaluate_client_privilege_tier(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION evaluate_client_privilege_tier(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION award_cashback_for_booking(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_cashback_for_booking(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION redeem_cashback_for_booking(UUID, UUID, DECIMAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_cashback_for_booking(UUID, UUID, DECIMAL)
  TO service_role;

REVOKE ALL ON FUNCTION admin_force_privilege_tier(UUID, client_privilege_tier, JSONB, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_force_privilege_tier(UUID, client_privilege_tier, JSONB, TEXT, DATE)
  TO service_role;

REVOKE ALL ON FUNCTION expire_old_loyalty_credits()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_old_loyalty_credits()
  TO service_role;

REVOKE ALL ON FUNCTION auto_grant_diamond_shield_subscription(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_grant_diamond_shield_subscription(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION schedule_diamond_shield_revoke(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION schedule_diamond_shield_revoke(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION reconcile_client_cashback_balance(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reconcile_client_cashback_balance(UUID)
  TO service_role;

-- Helpers (IMMUTABLE) — also revoked from PUBLIC for consistency.
-- These are called only from other SECURITY DEFINER RPCs, never
-- from PostgREST, so revocation is defense-in-depth.
REVOKE ALL ON FUNCTION tier_rank(client_privilege_tier)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tier_rank(client_privilege_tier)
  TO service_role;

REVOKE ALL ON FUNCTION step_down_one(client_privilege_tier)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION step_down_one(client_privilege_tier)
  TO service_role;
```

Probe 41 asserts all 4 privilege checks per RPC (Phase 12 Round 9
pattern): for each function the probe asserts ALL FOUR of
`has_function_privilege('service_role',  $oid, 'EXECUTE') = true`,
`has_function_privilege('public',        $oid, 'EXECUTE') = false`,
`has_function_privilege('anon',          $oid, 'EXECUTE') = false`,
`has_function_privilege('authenticated', $oid, 'EXECUTE') = false`.

---

## §5 PR breakdown

### Spec PR (this document) — pending Codex review

### PR 1 — Backend + admin + auto-evaluation infrastructure

**Files**:
- `supabase/migrations/2026MMDDXXXXXX_phase_13_pr_1_privilege_intake.sql`
  — all of §3 + §4.1-§4.5 + §4.9 + §4.10
- `lib/privilege/types.ts` — type definitions
- `lib/privilege/tier-helpers.ts` — pure helpers (tier_rank,
  step_down_one mirrors in JS)
- `app/actions/privilege-admin.ts` — admin Server Actions
- `app/(admin)/admin/(protected)/clients/[id]/privilege/page.tsx`
  — admin view
- `app/(admin)/admin/(protected)/clients/[id]/privilege/force/page.tsx`
  — admin force change form
- `lib/privilege/admin-pii.ts` — admin PII read pattern
  (Phase 12 admin-pii.ts mirror)
- `lib/privilege/__tests__/tier-helpers.test.ts`
- `lib/privilege/__tests__/spend-window.test.ts`
- `app/actions/__tests__/privilege-admin-validators.test.ts`

**Tests**: 25-30 new tsx tests.

**Activation gate**: `ENABLE_PRIVILEGE=false` initially.

**Probes**: Probe 41 (schema 50+ checks).

### PR 2 — Client UI + cashback redemption in checkout

**Files**:
- `app/(client)/me/privilege/page.tsx` — current tier + progress
  + balance + history
- `app/(public)/privilege/page.tsx` — 4 tiers display
- `app/(client)/me/privilege/history/page.tsx` — full ledger view
- `components/privilege/tier-badge.tsx` — reusable tier chip
  (silver=gray, gold=yellow, platinum=slate, diamond=cyan)
- `components/privilege/cashback-redeem-input.tsx` — accept-offer
  augmentation
- `lib/privilege/cashback-redemption.ts` — D7 cap validators
- Updates to: `app/actions/charter-accept.ts`,
  `app/actions/cargo-accept.ts`, `app/actions/medevac-accept.ts`
  — wire redemption into existing accept flows
- `app/(client)/me/page.tsx` — Platinum+ 2FA banner (D15)
- `lib/i18n/privilege-ar.ts` — Arabic strings

**Tests**: 25-35 new tsx tests covering redemption validators,
2FA banner conditional, tier badge rendering.

**Probes**: Probes 42 (earn), 43 (redeem), 44 (upgrade
end-to-end).

### PR 3 — Cron + cross-product Diamond × Shield + EL early access + activation

**Files**:
- `supabase/migrations/2026MMDDXXXXXX_phase_13_pr_3_privilege_distribution.sql`
  — §4.6 (expire), §4.7 (Diamond grant), §4.8 (revoke schedule)
- `app/api/cron/privilege/evaluate-all/route.ts` — daily recalc
- `app/api/cron/privilege/expire-cashback/route.ts` — daily expiry
- `app/api/cron/privilege/reconcile-balances/route.ts` — daily
  ledger-vs-denorm reconciliation per D19 (Round 1 PR #80 F14 fix)
- `lib/empty-legs/matching.ts` — modify scoring with
  `privilege_tier_boost_hours` (D13) per Round 1 PR #80 F7 fix
- `lib/empty-legs/matching-tier-boost.ts` — extracted pure logic
  for testing
- Migration delta — Round 2 PR #80 F19 fix: **NEW table** (not
  ALTER on imaginary `empty_legs_match_outbox`). Phase 7-10's
  existing `empty_leg_notifications` is lead-based (uses
  `lead_inquiry_id`), and Phase 10's `client_empty_leg_alert_status`
  is just a singleton canary. No client × leg matching outbox
  exists. Phase 13 PR 3 creates one:

  ```sql
  CREATE TABLE IF NOT EXISTS client_empty_leg_matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empty_leg_id    UUID NOT NULL
                      REFERENCES empty_legs(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL
                      REFERENCES clients(id) ON DELETE CASCADE,
    privilege_tier_at_match client_privilege_tier NOT NULL,
    -- Round 3 PR #80 F25 fix — merged `tier_boost_applied BOOLEAN` +
    -- `boost_hours INT` into single column. Value=0 means no boost
    -- (silver or FCFS round); value>0 is the boost hours from
    -- privilege_tier_thresholds.empty_legs_boost_hours.
    boost_hours_applied INT NOT NULL DEFAULT 0
      CHECK (boost_hours_applied >= 0),
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notification_sent_at TIMESTAMPTZ,
    -- D27: prevents duplicate notification across tier-boost windows
    CONSTRAINT uq_client_empty_leg_matches_leg_client
      UNIQUE (empty_leg_id, client_id)
  );
  ALTER TABLE client_empty_leg_matches ENABLE ROW LEVEL SECURITY;
  CREATE INDEX IF NOT EXISTS idx_client_empty_leg_matches_leg
    ON client_empty_leg_matches (empty_leg_id, matched_at DESC);
  CREATE INDEX IF NOT EXISTS idx_client_empty_leg_matches_client
    ON client_empty_leg_matches (client_id, matched_at DESC);
  ```

  Per D27: matching cron writes to this table; UNIQUE prevents
  the same client being matched twice for the same leg across
  boost windows. F20 note: this is SEPARATE from
  `empty_leg_notifications` (Phase 7-8 lead-based, kept as-is).
- `app/(admin)/admin/(protected)/operators/canary/page.tsx` — add
  8th `<ChannelHealth>` card for privilege cron health
  (evaluate-all + expire-cashback + reconcile-balances rolled
  into one card)
- `vercel.json` — 3 new cron entries (evaluate-all, expire-cashback,
  reconcile-balances)
- Tests covering matching tier boost, expire logic, evaluate-all
  drain pattern, reconcile drift detection.

**Probes**: Probes 45 (Diamond × Shield), 46 (downgrade Diamond
revoke), 47 (EL early access), 48 (admin force + lock).

---

## §6 Founder probes

8 probes (41-48), continuing from Phase 12 (probes 33-40).

### Probe 41 — Schema state (PR 1, before flag flip)

Single SQL script. ~50 checks covering:

**ENUMs (4)**:
- `client_privilege_tier` (4 labels)
- `loyalty_ledger_event_type` (9 labels — Round 1 PR #80 F12 fix
  added `diamond_shield_skipped_already_diamond` + D26 added
  `diamond_shield_grant_failed`; Round 2 PR #80 F24 fix REMOVED
  `refund_back` — Phase 13.1 will re-add via ALTER TYPE)
- `privilege_tier_change_reason` (6 labels)
- `privilege_admin_action_type` (4 labels)

**Tables + RLS (3)**:
- `privilege_tier_thresholds` (RLS on, 4-row seed)
- `client_loyalty_ledger` (RLS on)
- `privilege_tier_change_log` (RLS on)

**Constraints (named, 11)** — Round 1 PR #80 F3 added
`privilege_tier_change_log_from_to_distinct_check`:
- `client_loyalty_ledger_amount_sign_check` (NOTE: must include
  the new `diamond_shield_grant_failed` event_type in the
  `amount_sar = 0` branch — verifier asserts the actual
  pg_constraint definition matches the 10-value ENUM)
- `client_loyalty_ledger_admin_reason_required_for_adjust`
- `client_loyalty_ledger_subscription_required_for_grant`
- `client_loyalty_ledger_change_log_required_for_diamond`
- `client_loyalty_ledger_booking_required_for_booking_events_check` (D21 defense-in-depth)
- `client_loyalty_ledger_expiry_only_on_earn`
- `privilege_tier_change_log_admin_required`
- `privilege_tier_change_log_grace_only_on_downgrade`
- `privilege_tier_change_log_lock_only_on_admin_force`
- `privilege_tier_change_log_from_to_distinct_check` (Round 1 F3 fix)
- `bookings_cashback_redemption_cap_check`

**Triggers (5)** — Round 5 PR #80 F1 split BEFORE/AFTER per
timing-bug fix; immutability + 2 BEFORE (stamp) + 2 AFTER (award):
- `trg_bookings_paid_state_immutable_after_paid` (D24 + F26)
- `trg_bookings_stamp_paid_at_ins` (BEFORE INSERT — F1)
- `trg_bookings_stamp_paid_at_upd` (BEFORE UPDATE OF payment_status — F1)
- `trg_bookings_paid_award_after_ins` (AFTER INSERT — F1)
- `trg_bookings_paid_award_after_upd` (AFTER UPDATE OF payment_status — F1)

**Indexes (10)** — Round 1 PR #80 F1+F8 renamed `idx_bookings_payment_confirmed_for_loyalty` → `idx_bookings_paid_at_for_loyalty`; Round 3 PR #80 F28 added `uq_client_loyalty_ledger_redeem_per_booking`:
- `idx_client_loyalty_ledger_client`
- `idx_client_loyalty_ledger_booking`
- `idx_client_loyalty_ledger_expiry_sweep`
- **`uq_client_loyalty_ledger_earn_per_booking`** (D21 UNIQUE)
- **`uq_client_loyalty_ledger_redeem_per_booking`** (Round 3 F28 UNIQUE)
- `idx_privilege_tier_change_log_client`
- `idx_privilege_tier_change_log_pending_grace`
- `idx_clients_privilege_tier`
- `idx_clients_below_threshold_grace`
- `idx_bookings_paid_at_for_loyalty` (D22 — renamed from
  payment_confirmed)

**Helper + RPCs (11)** — full ACL check per Phase 12 Round 9.
Round 1 PR #80 F14 added `reconcile_client_cashback_balance`:
- `tier_rank`, `step_down_one` (IMMUTABLE + PARALLEL SAFE)
- `calculate_client_qualified_spend_12m`
- `evaluate_client_privilege_tier`
- `award_cashback_for_booking`
- `redeem_cashback_for_booking`
- `admin_force_privilege_tier`
- `expire_old_loyalty_credits`
- `auto_grant_diamond_shield_subscription`
- `schedule_diamond_shield_revoke`
- `reconcile_client_cashback_balance` (D19 implementation per Round 1 F14)

**Columns on clients (7)**:
- privilege_tier, assigned_at, qualified_spend_12m, below_since,
  tier_locked_until, cashback_balance_sar, two_factor_enabled

**Columns on bookings (3)** — Round 1 PR #80 F1 added `paid_at`:
- cashback_redemption_sar, cashback_earned_sar, paid_at

**Env vars (1)** — Round 1 PR #80 F10 fix tightened wording:
- `ENABLE_PRIVILEGE` exists as a non-empty string matching the
  regex `^(true|false)$` (case-sensitive). Verified via a small
  Server Action probe endpoint that returns a sanitised boolean
  (mirror Phase 12 Probe 33 check #46 pattern).

**Total: ~57 named checks** (exact count depends on whether each
RPC's 4-tuple ACL assertion is counted as 1 check or 4. Probe 41
SQL script will produce a deterministic number; the spec
inventory above is the authoritative element list and the script
is the authoritative count). Round 5 PR #80 F1 delta: +2 triggers
(BEFORE/AFTER split — see §3.4). Round 1 PR #80 net deltas vs
round 0.6: +1 trigger (D24 immutability), +1 constraint (D21
booking_required), +1 RPC (reconcile per F14), +1 column
(paid_at per F1), +2 ENUM labels.

### Probe 42 — Earn cashback on payment confirmation (+ D21 idempotency)

1. Create test client `c1` (silver, balance=0).
2. Create test charter booking for `c1`, total_amount=50,000,
   payment_status='pending_offline'.
3. UPDATE booking → payment_status='paid' (simulate admin confirm).
4. Verify:
   - `client_loyalty_ledger` has new `earn` event,
     amount_sar=2500 (50,000 × 5%),
     balance_after_sar=2500,
     booking_id=<id>,
     cashback_expiry_at ≈ NOW() + 24 months.
   - `clients.cashback_balance_sar`=2500.
   - `bookings.cashback_earned_sar`=2500.
   - `privilege_tier_change_log` empty (spend 50k < 100k, stays
     silver).

5. **D21 idempotency assertion** — call
   `award_cashback_for_booking(c1, booking_id)` directly (bypassing
   the trigger WHEN guard) → expect return envelope:
   ```json
   {
     "ok": true,
     "already_awarded": true,
     "skipped_reason": "duplicate_earn_for_booking",
     "booking_id": "<id>"
   }
   ```
   Verify:
   - Ledger still has exactly 1 `earn` event for this booking.
   - `clients.cashback_balance_sar` unchanged at 2500.
6. **D21 race assertion** — try direct INSERT into
   `client_loyalty_ledger` with `(booking_id=<id>, event_type='earn')`
   → expect `23505 unique_violation` from `uq_client_loyalty_ledger_earn_per_booking`.
7. **Edge: refunded→paid transition** — UPDATE booking →
   payment_status='refunded' → UPDATE → payment_status='paid'.
   Trigger WHEN fires (OLD='refunded' != NEW='paid'). The RPC
   idempotency guard catches → no second earn event. Ledger
   remains 1 `earn`. (Future `refund_back` event mechanics are
   in scope of D-spec refund TBD; this probe only verifies the
   earn-side invariant.)

### Probe 43 — Redeem cashback within D7 cap

1. Client `c1` (silver, balance=2500 from Probe 42).
2. Create second booking, total_amount=10,000,
   payment_status='pending_offline'.
3. Attempt redeem_cashback_for_booking(c1, b2, 6000) → expect
   error `redemption_exceeds_cap` (D7: 6000 > 10,000 × 0.5 = 5000).
4. Attempt redeem_cashback_for_booking(c1, b2, 2500) → expect
   success.
5. Verify:
   - `client_loyalty_ledger` has new `redeem` event,
     amount_sar=-2500, balance_after_sar=0.
   - `clients.cashback_balance_sar`=0.
   - `bookings.cashback_redemption_sar`=2500.
6. UPDATE b2 → payment_status='paid'.
7. Verify cashback earned on **amount_paid (7500) only** → 5% =
   375 SAR (no compound — D6).

### Probe 44 — Auto-upgrade silver → gold

1. Client `c2` (silver, spend_12m=70,000 in 3 historical bookings).
2. Create new charter booking, total_amount=50,000,
   payment_status='paid' → spend_12m = 120,000.
3. Verify trigger fires `evaluate_client_privilege_tier`:
   - `privilege_tier_change_log` new row: from=silver, to=gold,
     reason='auto_upgrade', qualified_spend_12m_sar=120,000.
   - `clients.privilege_tier`='gold'.
   - `clients.privilege_tier_assigned_at` = NOW().
4. Verify subsequent earn event uses gold rate (8%).

### Probe 45 — Auto-upgrade platinum → Diamond + Shield grant

1. Client `c3` (platinum, spend_12m=1,800,000).
2. Create charter booking, total_amount=250,000, payment_status='paid'.
3. Verify cascade:
   - Tier change log: platinum → diamond.
   - `clients.privilege_tier`='diamond'.
   - **New `medevac_subscriptions` row** (Round 5 PR #80 F4 fix —
     aligned with F31 empty covered_members decision):
     - plan='diamond'
     - annual_fee_at_signup_sar=0
     - status='active'
     - covered_events_at_signup=-1 (unlimited)
     - **covered_members='[]'::jsonb** (empty array — admin/client
       must populate before first use per J5b)
     - notes contains 'Auto-granted via Phase 13 Diamond tier'
   - **New `client_loyalty_ledger` row** event_type='diamond_shield_granted'
     with `source_subscription_id` = new subscription.
4. **Negative assertion**: client `c3` opens `/me/medevac/new` and
   checks the Shield checkbox → form displays the "populate
   covered_members first" CTA banner (J5b) and disables the submit
   button until member is added via `/me/medevac/shield/<sub-id>`.

### Probe 46 — Soft downgrade after 90-day grace

1. Client `c4` (gold, spend_12m=80,000, `below_since` set to 91 days
   ago via test seed).
2. Run cron `/api/cron/privilege/evaluate-all` manually.
3. Verify:
   - `clients.privilege_tier`='silver'.
   - `privilege_tier_change_log`: from=gold, to=silver,
     reason='auto_downgrade', grace_started_at=91 days ago.
   - One-step only (gold→silver, not skip diamond→silver).

### Probe 47 — EL early access via distribution scoring

1. Create empty leg at T0.
2. Create 4 clients: silver, gold, platinum, diamond, all otherwise
   identical (same route history, same preferences).
3. Trigger match-drain at T0 + 30 min.
4. Verify match outbox order: diamond first, then platinum, gold,
   silver (priority order).
5. Verify outbox metadata: `boost_hours_applied > 0` (Round 5
   PR #80 F8 fix — Round 3 F25 merged the old `tier_boost_applied
   BOOLEAN` + `boost_hours INT` into a single `boost_hours_applied
   INT`), and the value matches the tier's
   `privilege_tier_thresholds.empty_legs_boost_hours` (gold=2,
   platinum=6, diamond=12). `privilege_tier_at_match` populated.
6. Wait 12h → silver appears in next tick (D14 — re-merge to FCFS).
   At this point silver's `boost_hours_applied=0` in their own
   match row.

### Probe 48 — Admin force + lock + Shield grant on Diamond

1. Admin logs in.
2. Open `/admin/clients/[c5]/privilege` (currently gold).
3. Click "Force tier" → select 'diamond', reason="strategic
   account onboarding", lock_until=2027-05-19.
4. Verify atomic:
   - `clients.privilege_tier`='diamond'.
   - `clients.tier_locked_until`=2027-05-19.
   - `privilege_tier_change_log`: reason='admin_force',
     admin_actor_cookie_fingerprint NOT NULL, lock_until set.
   - New Shield Diamond subscription auto-granted (cross-product
     applies to admin_force too).
   - `audit_logs` entry with admin cookie fingerprint, no PII.
5. Lower spend below diamond threshold for 90+ days (simulate via
   seed update).
6. Run cron evaluate-all → verify `tier_action='locked_no_action'`
   (admin lock honored).

---

## §7 Acceptance + activation runbook

### Codex review checkpoint

- [ ] Spec PR reaches Codex 100/100 (this document)
- [ ] PR 1 reaches Codex 100/100 (backend + admin + RPCs)
- [ ] PR 2 reaches Codex 100/100 (client UI + cashback redeem)
- [ ] PR 3 reaches Codex 100/100 (cron + cross-product + EL boost)

### Production activation (mirror Phase 12 §7)

0. **Provision PR 1 env vars BEFORE applying migration**:
   - `ENABLE_PRIVILEGE=false` (flip to true in step 3).
   - `CRON_SECRET` re-used from Phase 7 (no new secret).
1. Apply PR 1 migration. Run Probe 41 (50 named checks) →
   require all green.
2. Confirm `ENABLE_PRIVILEGE=false` on production.
3. After PR 1 + PR 2 deploy: flip `ENABLE_PRIVILEGE=true` →
   redeploy. Run probes 42, 43, 44 (earn / redeem / auto-upgrade).
4. After PR 3 deploy: add cron entries to vercel.json + confirm
   `CRON_SECRET`. Run probes 45, 46, 47, 48 (Diamond grant,
   soft downgrade, EL early access, admin override).
5. Resend domain verification (`aeris.sa`) — same follow-up as
   Phase 12, NOT blocking Phase 13 (Privilege has no email
   senders in v1; UI banners only).
6. After 7 days production health: Phase 13 closure ceremony +
   activation notes doc.

### Backfill plan (one-time at activation)

Round 4 PR #80 F32+F33+F34 fix — Round 1 renamed the spend-window
column to `paid_at` but forgot to update this section. Also: for
historical bookings (those that flipped to `payment_status='paid'`
BEFORE Phase 13 migration ran), `paid_at` is NULL because the
stamping trigger only fires on new transitions. The qualified-spend
RPC filters on `paid_at`, so without backfill every client sees
spend=0 and stays silver.

**Backfill order** (run AFTER step 1 migration, BEFORE flag flip in step 3):

```sql
-- Step A: backfill bookings.paid_at for historical paid rows using
--         updated_at as the best-available proxy. Round 4 PR #80 F33
--         fix. This is the chokepoint that makes the evaluate RPC see
--         actual historical spend.
--
-- The D24 immutability trigger (reject_paid_state_mutation_after_paid)
-- will REFUSE this UPDATE because OLD.paid_at IS NULL → on first set,
-- OLD.paid_at IS NULL → IF (OLD.paid_at IS NOT NULL) is FALSE → trigger
-- short-circuits → UPDATE permitted. Safe.
UPDATE bookings
SET paid_at = updated_at
WHERE payment_status = 'paid'
  AND paid_at IS NULL;

-- Step B: evaluate each client with any historical paid booking in
--         the last 12 months. NO cashback award (per Round 4 F34 —
--         historical bookings DON'T earn retroactive cashback; the
--         tier is computed but no `earn` events are inserted because
--         the AFTER UPDATE trigger isn't fired by tier evaluation
--         alone). Tier-only backfill.
SELECT evaluate_client_privilege_tier(id) FROM clients
WHERE id IN (
  SELECT DISTINCT client_id FROM bookings
  WHERE payment_status = 'paid'
    AND paid_at > NOW() - INTERVAL '12 months'
    AND client_id IS NOT NULL
);
```

**Expected outcome**:
- Most active clients evaluated to gold/platinum based on
  historical 12mo spend.
- `privilege_tier_change_log` shows a bulk-evaluation batch
  (all `reason='auto_upgrade'` from silver → target_tier).
- `client_loyalty_ledger` has 0 new `earn` events (no
  retroactive cashback per Round 4 F34).
- `clients.cashback_balance_sar` remains 0 for all clients.

**Why no retroactive cashback (F34)**:
- Avoids a one-time payout of millions of SAR in cashback for
  bookings that pre-date the loyalty program (clients didn't
  expect cashback when they booked).
- Keeps the ledger clean — first earn event for every client
  is their first NEW booking after Phase 13 activation.
- Aligns with industry practice (loyalty programs grandfather
  status, not balance).

**Operator review checklist after backfill**:
- Run reconcile cron once: verify `SUM(ledger) = balance` for
  all clients (should all be 0).
- Spot-check 5 clients in `privilege_tier_change_log` to confirm
  their tier matches manual spend calculation.
- Verify `audit_logs` has the bulk-eval batch.

---

## §8 Codex review history

Spec under active Codex review. Round-by-round tracking is via
git log + commit messages (`Phase 13 spec round N fixes (X P1 + Y P2)`)
rather than an in-document ledger. Inline `Round N PR #<spec-pr>
[P1/P2] #M fix` citations are added at the points the fix landed.

A summary ledger table will be added here only if rounds begin to
repeat on the same issue (Phase 12 added one at round 14 after the
per-round status wording started to lag-by-one repeatedly). For
clean rounds that close distinct findings, git log is the canonical
record.
