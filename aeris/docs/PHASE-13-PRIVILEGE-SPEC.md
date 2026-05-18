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
- 0 cashback ledger imbalances (`SUM(amount) WHERE event_type IN
  ('earn','adjust','refund_back') = balance + SUM(redeem+expire)`).
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
     amount_sar:4000, booking_id, balance_after:0 }`.
   - UPDATE `bookings SET cashback_redemption_sar=4000,
     amount_paid_sar=56000` (booking.total_amount - redemption).
5. Future cashback earned on this booking is calculated on
   `amount_paid_sar`, NOT `total_amount` → **no compound** (D-spec
   D4). E.g. gold 8% on 56k = 4,480 SAR earned.

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
       duplicate), log ledger event `diamond_shield_skipped`.
     - If yes with `plan!='diamond'` but `paid` (e.g. paying
       individual/family/vip_family) → log
       `diamond_shield_skipped_paying_paid_plan`, do nothing.
       The paid plan continues; Diamond grant is suppressed until
       the paid plan ends.
     - If no active subscription → call
       `auto_grant_diamond_shield_subscription(c3, change_log_id)`:
       - INSERT `medevac_subscriptions` row:
         - plan='diamond'
         - annual_fee_at_signup_sar=0
         - covered_events_at_signup=-1 (unlimited)
         - service_level_at_signup='CCT'
         - includes_repatriation_at_signup=true
         - max_covered_members_at_signup=4 (mirror Diamond default)
         - status='active'
         - start_date=CURRENT_DATE
         - end_date=CURRENT_DATE + INTERVAL '1 year'
         - covered_members=[owner-seeded as 'self' from clients]
         - payment_token_hash=NULL (free)
         - notes='Auto-granted on Diamond tier upgrade. Tier
           change_log_id=<id>'
       - INSERT ledger event `{ event_type:'diamond_shield_granted',
         subscription_id=<new>, change_log_id=<id> }`.
   - All inside a single transaction.

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
| **D2** | Spend basis = `bookings.payment_status_confirmed_at` (or paid_at), NOT `created_at` | Prevents cashback on incomplete/cancelled bookings; aligns with revenue recognition. |
| **D3** | Tier thresholds (annual qualified spend, SAR): silver < 100k, gold 100k-500k, platinum 500k-2M, diamond ≥ 2M | From advisor-doc §5.3. |
| **D4** | Cashback %: silver 5, gold 8, platinum 12, diamond 15 | From advisor-doc §5.3. |
| **D5** | Cashback model: internal ledger, credit-only, no cash-out in v1 | Simpler; retention-driving; lower regulatory risk (no money transmission). |
| **D6** | No compounding: redeem reduces `amount_paid_sar`; next earn fires on `amount_paid_sar`, not `total_amount` | Prevents infinite cashback loop. |
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
| **D19** | `clients.cashback_balance_sar` is a **denormalized snapshot** maintained by ledger triggers, NOT a computed view; reconciliation cron verifies match against `SUM(ledger)` daily | Performance for booking checkout (no aggregate query per page load); integrity verified hourly. |
| **D20** | Activation is gated by `ENABLE_PRIVILEGE=true` env var (mirror `ENABLE_MEDEVAC` pattern from Phase 12) | Safe rollout; allows schema deploy before flag flip. |

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
      'refund_back',                          -- booking cancelled after earn → reverse
      'diamond_shield_granted',               -- cross-product Diamond auto-grant
      'diamond_shield_skipped_paying_paid_plan',  -- D12 invariant
      'diamond_shield_revoked_on_downgrade'   -- diamond → lower, subscription end
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
  CONSTRAINT client_loyalty_ledger_amount_sign_check CHECK (
    (event_type IN ('earn', 'refund_back') AND amount_sar > 0)
    OR (event_type IN ('redeem', 'expire') AND amount_sar < 0)
    OR (event_type = 'adjust')   -- can be either sign
    OR (event_type IN ('diamond_shield_granted', 'diamond_shield_skipped_paying_paid_plan',
                        'diamond_shield_revoked_on_downgrade')
        AND amount_sar = 0)
  ),
  CONSTRAINT client_loyalty_ledger_admin_reason_required_for_adjust CHECK (
    event_type != 'adjust' OR admin_reason IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_subscription_required_for_grant CHECK (
    event_type != 'diamond_shield_granted' OR source_subscription_id IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_change_log_required_for_diamond CHECK (
    event_type NOT IN ('diamond_shield_granted', 'diamond_shield_skipped_paying_paid_plan',
                        'diamond_shield_revoked_on_downgrade')
    OR source_change_log_id IS NOT NULL
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

#### `bookings` — 2 new columns (cashback redemption tracking)

```sql
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cashback_redemption_sar DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (cashback_redemption_sar >= 0),
  ADD COLUMN IF NOT EXISTS cashback_earned_sar DECIMAL(12, 2) DEFAULT NULL
    CHECK (cashback_earned_sar IS NULL OR cashback_earned_sar >= 0);

-- D7 cap: redemption <= 50% of total_amount AND total_amount - redemption >= 1
ALTER TABLE bookings
  ADD CONSTRAINT bookings_cashback_redemption_cap_check CHECK (
    cashback_redemption_sar <= total_amount * 0.5
    AND (total_amount - cashback_redemption_sar) >= 1
  );

CREATE INDEX IF NOT EXISTS idx_bookings_payment_confirmed_for_loyalty
  ON bookings (payment_status_confirmed_at DESC, client_id)
  WHERE payment_status = 'paid' AND client_id IS NOT NULL;
```

The `payment_status_confirmed_at` column is assumed to exist
from Phase 6/14. If it doesn't yet, this spec also defines it
(Round 1 may extract this into its own schema delta).

### §3.4 Triggers (2 new)

#### `on_bookings_payment_paid_award_cashback`

AFTER UPDATE on `bookings` when `payment_status` transitions to
'paid' (only on UPDATE WHEN NEW.payment_status = 'paid' AND
OLD.payment_status != 'paid'). Calls `award_cashback_for_booking`
and `evaluate_client_privilege_tier`.

```sql
CREATE OR REPLACE FUNCTION on_bookings_payment_paid_award_cashback()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tier_eval_result JSONB;
BEGIN
  -- Award cashback (if eligible per D16)
  IF NEW.client_id IS NOT NULL
     AND NEW.source_discriminator IN ('charter', 'cargo', 'medevac')
     AND NOT (NEW.source_discriminator = 'medevac' AND COALESCE(NEW.is_covered, false))
  THEN
    PERFORM award_cashback_for_booking(NEW.client_id, NEW.id);
  END IF;

  -- Re-evaluate tier
  IF NEW.client_id IS NOT NULL THEN
    v_tier_eval_result := evaluate_client_privilege_tier(NEW.client_id);
    -- Cross-product Diamond grant happens inside evaluate_client_privilege_tier
    -- when it logs an upgrade to diamond.
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_payment_paid_award_cashback ON bookings;
CREATE TRIGGER trg_bookings_payment_paid_award_cashback
  AFTER UPDATE OF payment_status ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status != 'paid')
  EXECUTE FUNCTION on_bookings_payment_paid_award_cashback();
```

#### `on_bookings_payment_refunded_reverse_cashback`

AFTER UPDATE when `payment_status` transitions from 'paid' to
'refunded'. Posts `refund_back` ledger event reversing the earn.

```sql
-- Defined in §4 as part of refund flow.
```

### §3.5 RLS policies

- `client_loyalty_ledger`: clients read OWN rows only (filter on
  `client_id = auth.uid()::UUID` mapped via session cookie helper).
  Admin role reads all (via SECURITY DEFINER RPC; no direct
  table access). No INSERT/UPDATE/DELETE from any non-service
  role.
- `privilege_tier_change_log`: clients read OWN rows. Admin via
  SECURITY DEFINER RPC. Append-only via RPC.
- `privilege_tier_thresholds`: PUBLIC SELECT (everyone can see
  threshold table; UPDATE service_role only).
- `clients` new columns: existing RLS continues (client owns row).
  Cashback balance is sensitive — return `0` to other clients (per
  Phase 9 RLS).

---

## §4 RPC layer

### §4.1 `calculate_client_qualified_spend_12m(p_client_id UUID) RETURNS DECIMAL(14,2)`

Pure read-only. Sums `bookings.amount_paid_sar` where:

- `client_id = p_client_id`
- `payment_status = 'paid'`
- `payment_status_confirmed_at > NOW() - INTERVAL '12 months'`
- `source_discriminator IN ('charter', 'cargo', 'medevac')` per D16
- NOT (source_discriminator = 'medevac' AND is_covered = true)

```sql
CREATE OR REPLACE FUNCTION calculate_client_qualified_spend_12m(
  p_client_id UUID
)
RETURNS DECIMAL(14,2)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount_paid_sar), 0)::DECIMAL(14,2)
  FROM bookings
  WHERE client_id = p_client_id
    AND payment_status = 'paid'
    AND payment_status_confirmed_at > NOW() - INTERVAL '12 months'
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

    -- D11: Diamond cross-product grant
    IF v_target_tier = 'diamond' THEN
      v_subscription_id := auto_grant_diamond_shield_subscription(
        p_client_id, v_change_log_id
      );
    END IF;
    -- D11: Diamond downgrade — schedule revoke (end_date or grace,
    -- whichever later); detail in §4.7.
    IF v_current_tier = 'diamond' AND v_target_tier != 'diamond' THEN
      PERFORM schedule_diamond_shield_revoke(p_client_id, v_change_log_id);
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

### §4.4 `redeem_cashback_for_booking(p_client_id UUID, p_booking_id UUID, p_redemption_amount DECIMAL) RETURNS JSONB`

Caller-bound: called from `accept_offer` Server Actions when client
elects to redeem balance. Validates D7 caps + sufficient balance.

INSERTs `redeem` ledger event + UPDATEs
`clients.cashback_balance_sar` (decrement) + sets
`bookings.cashback_redemption_sar`.

### §4.5 `admin_force_privilege_tier(p_client_id UUID, p_new_tier client_privilege_tier, p_session_metadata JSONB, p_reason TEXT, p_lock_until DATE DEFAULT NULL) RETURNS JSONB`

Admin manual override. Same audit pattern as Phase 12 §4.10
`admin_read_medevac_request_detail`: SECURITY DEFINER, audit
INSERT before tier change, cookie fingerprint required, fail-closed
on missing metadata.

### §4.6 `expire_old_loyalty_credits() RETURNS JSONB`

Daily cron. Scans `client_loyalty_ledger` for `earn` events with
`cashback_expiry_at < NOW()` AND not yet expired (no later `expire`
event for same earn — tracked via FIFO matching). INSERTs
`expire` events to clear oldest unredeemed credits.

### §4.7 `auto_grant_diamond_shield_subscription(p_client_id UUID, p_change_log_id UUID) RETURNS UUID`

D11/D12 cross-product hook. Helper called by §4.2 + admin force
when target tier = diamond. Returns subscription_id or NULL if
skipped due to existing paid plan.

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
downgrade.

### ACL contract for all RPCs above

```sql
REVOKE ALL ON FUNCTION <name>(<args>) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION <name>(<args>) TO service_role;
```

Probe 41 asserts all 4 privilege checks per RPC (Phase 12 Round 9
pattern).

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
- `lib/empty-legs/matching.ts` — modify scoring with
  `privilege_tier_boost_hours` (D13)
- `lib/empty-legs/matching-tier-boost.ts` — extracted pure logic
  for testing
- `app/(admin)/admin/(protected)/operators/canary/page.tsx` — add
  8th `<ChannelHealth>` card for privilege cron health
- `vercel.json` — 2 new cron entries
- Tests covering matching tier boost, expire logic, evaluate-all
  drain pattern.

**Probes**: Probes 45 (Diamond × Shield), 46 (downgrade Diamond
revoke), 47 (EL early access), 48 (admin force + lock).

---

## §6 Founder probes

8 probes (41-48), continuing from Phase 12 (probes 33-40).

### Probe 41 — Schema state (PR 1, before flag flip)

Single SQL script. ~50 checks covering:

**ENUMs (4)**:
- `client_privilege_tier` (4 labels)
- `loyalty_ledger_event_type` (8 labels)
- `privilege_tier_change_reason` (6 labels)
- `privilege_admin_action_type` (4 labels)

**Tables + RLS (3)**:
- `privilege_tier_thresholds` (RLS on, 4-row seed)
- `client_loyalty_ledger` (RLS on)
- `privilege_tier_change_log` (RLS on)

**Constraints (named, 8)**:
- `client_loyalty_ledger_amount_sign_check`
- `client_loyalty_ledger_admin_reason_required_for_adjust`
- `client_loyalty_ledger_subscription_required_for_grant`
- `client_loyalty_ledger_change_log_required_for_diamond`
- `client_loyalty_ledger_expiry_only_on_earn`
- `privilege_tier_change_log_admin_required`
- `privilege_tier_change_log_grace_only_on_downgrade`
- `privilege_tier_change_log_lock_only_on_admin_force`
- `bookings_cashback_redemption_cap_check`

**Triggers (1)**:
- `trg_bookings_payment_paid_award_cashback`

**Indexes (5)**:
- `idx_client_loyalty_ledger_client`
- `idx_client_loyalty_ledger_booking`
- `idx_client_loyalty_ledger_expiry_sweep`
- `idx_privilege_tier_change_log_client`
- `idx_clients_privilege_tier`
- `idx_clients_below_threshold_grace`
- `idx_bookings_payment_confirmed_for_loyalty`
- `idx_privilege_tier_change_log_pending_grace`

**Helper + RPCs (10)** — full ACL check per Phase 12 Round 9:
- `tier_rank`, `step_down_one` (IMMUTABLE + PARALLEL SAFE)
- `calculate_client_qualified_spend_12m`
- `evaluate_client_privilege_tier`
- `award_cashback_for_booking`
- `redeem_cashback_for_booking`
- `admin_force_privilege_tier`
- `expire_old_loyalty_credits`
- `auto_grant_diamond_shield_subscription`
- `schedule_diamond_shield_revoke`

**Columns on clients (7)**:
- privilege_tier, assigned_at, qualified_spend_12m, below_since,
  tier_locked_until, cashback_balance_sar, two_factor_enabled

**Columns on bookings (2)**:
- cashback_redemption_sar, cashback_earned_sar

**Env vars (1)**:
- `ENABLE_PRIVILEGE` exists (string, value either 'true' or 'false')

**Total: 50 named checks**.

### Probe 42 — Earn cashback on payment confirmation

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
   - **New `medevac_subscriptions` row**:
     - plan='diamond'
     - annual_fee_at_signup_sar=0
     - status='active'
     - covered_events_at_signup=-1 (unlimited)
     - covered_members has owner self-seeded
   - **New `client_loyalty_ledger` row** event_type='diamond_shield_granted'
     with `source_subscription_id` = new subscription.

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
5. Verify outbox metadata: `tier_boost_applied=true`,
   `privilege_tier_at_match` populated.
6. Wait 12h → silver appears in next tick (D14 — re-merge to FCFS).

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

After flag flip in step 3, run **one-time backfill SQL** to
evaluate all existing clients:

```sql
-- For each client with payment_status='paid' bookings in last 12 months
SELECT evaluate_client_privilege_tier(id) FROM clients
WHERE id IN (
  SELECT DISTINCT client_id FROM bookings
  WHERE payment_status = 'paid' AND payment_status_confirmed_at > NOW() - INTERVAL '12 months'
);
```

Expected: most clients evaluated to gold/platinum based on historical
spend. Audit `privilege_tier_change_log` for the bulk-evaluation
batch.

---

## §8 Codex review history

Spec under active Codex review; see the table below for the
current resolved-round ledger. Each round's fix commits are
squash-mergeable on top of the round-0 draft; inline
`Round N PR #<spec-pr> [P1/P2] #M fix` citations throughout this
document point back to the row below.

| Round | Findings | Severity mix | Resolved at |
|---|---|---|---|
| 0 | (initial draft) | — | (this commit) |

**Aggregate to date:** 0 findings closed; 0 outstanding P1.
