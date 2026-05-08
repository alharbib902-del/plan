# Claude Task

## Current Phase

Phase 7: Empty Legs — full marketplace + matching + Dutch auction
+ notifications.

## Status

**Iteration 15 of the draft. Awaiting Codex review. No
implementation yet.**

This spec replaces the prior Phase 4.2 PWA Foundation entry.
Phase 4.2 PR landed and merged ahead of Phase 6.x; Phase 6.0,
6.1, and 6.2 then closed end-to-end on production (last sha
`f5ce88f`, 2026-05-08). Phase 7 is the next locked roadmap
item per `docs/CLAUDE-WORK-LOG.md` Phase 6.2 closure.

## Iteration history

- **Iteration 1 (2026-05-08, awaiting acceptance %, not
  accepted).** Codex flagged 4 P1 + 2 P2:
  (1) `lead_inquiries.empty_legs_opt_in BOOLEAN NOT NULL
  DEFAULT TRUE` would retroactively mark every historical
  lead as eligible for the new empty-leg marketing category
  without explicit consent;
  (2) the spec's notification audit columns
  (`recipient_lead_inquiry_id`, `metadata->>'leg_id'`,
  `channel = 'whatsapp_link'`) do not exist on the
  initial-schema `notifications` table, which is keyed on
  `user_id NOT NULL` and unusable for guest `lead_inquiries`
  recipients;
  (3) `cancelMyReservation` Server Action had no backing
  RPC — `expire_empty_leg_reservation` is for already-expired
  holds and `cancel_empty_leg` is admin-side terminal
  cancel; no token-bound release of an active customer hold
  existed;
  (4) `adminMarkSoldManual` claimed a multi-RPC Server Action
  transaction that Supabase JS does not support;
  (5) `booking_payment_status` reality omitted `'refunded'`
  from the original schema's three values;
  (6) PR 1 fence said "no application code" while listing TS
  type, test, and CI changes — self-contradictory.
- **Iteration 2 (2026-05-08, awaiting acceptance %, not
  accepted).** All six iteration-1 findings resolved; see
  audit table at the end of the spec. Net changes: opt-in
  default flipped to `FALSE` with the checkbox now unchecked
  across both forms; dedicated `empty_leg_notifications`
  table added in PR 1 §12 and every notification audit /
  frequency-cap reference retargeted to it; new RPC
  `release_empty_leg_reservation` added at §7.2.6; new RPC
  `admin_mark_empty_leg_sold` added at iteration-2's §7.2.10
  (renumbered to §7.2.11 in iteration 3 after the new
  `admin_release_empty_leg_reservation` slotted in at
  §7.2.7) collapsing the manual-sold flow into a single
  transaction; schema
  reality updated to list all four `booking_payment_status`
  values; PR 1 fence rephrased to "no runtime UI/RPC code".
  Acceptance criteria renumbered from 70 to 73 items
  (+1 schema, +2 RPCs); sections after RPCs shifted by +3.
  Codex iteration-2 round 1 then flagged 4 P1 + 2 P2:
  (1) Schema reality §`lead_inquiries` was a second
  source-of-truth location that still said
  `DEFAULT TRUE` — caught only the §7.1 §9 + §Resolved
  Decisions copies in iteration 1;
  (2) PR 2e's `candidate-pool.ts` selected a non-existent
  `lead_inquiries.customer_email` column and the
  notifications module promised Resend email sends — query
  could not compile and emails could not send;
  (3) the `operator_empty_leg_sessions` table had no
  migration owner — neither PR 1 nor PR 2c shipped DDL
  for it;
  (4) §7.2 still introduced PR 2a as "seven publics + one
  helper" while iteration 1 had grown the count to 10 + 1;
  (5) Founder Probe 15 expected a 1-minute SLA against a
  30-minute cron;
  (6) `reserve_empty_leg`'s body mentioned an
  `increment_empty_leg_views` RPC that PR 2d never scoped.
- **Iteration 3 (2026-05-08, awaiting acceptance %, not
  accepted).** All six iteration-2 findings resolved; see
  audit table at the end of the spec. Net changes: schema
  reality `lead_inquiries` block rewritten to enumerate the
  actual columns + the corrected `DEFAULT FALSE`; email
  channel removed entirely from Phase 7 customer
  notifications (templates dropped, candidate-pool query
  reduced, channel CHECK tightened to `'whatsapp_link'`
  only, founder probe shifted from email+wa to wa only,
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS` kill-switch added);
  new PR 1 §13 creates the `operator_empty_leg_sessions`
  table with hash + expiry + soft-revoke columns + 2
  indexes + service-role RLS; §7.2 PR 2a heading +
  summary table corrected to list 10 publics + 1 helper;
  §7.6 PR 2e gains a "Synchronous match-trigger on
  publish" sub-section documenting the fire-and-forget
  POST from publish Server Actions; `views_count`
  mutation dropped from Phase 7 — column stays unused.
  Open Questions reduced from 8 → 7 (Operator session
  storage shape resolved by this round's P1 #3) and the
  email-capture sub-clause of §5 removed.
  Codex iteration-3 round 1 then flagged 3 P1 + 3 P2:
  (1) PR 2e's Files (Edit) list never named
  `app/actions/empty-legs.ts` or
  `app/actions/operator-empty-legs.ts`, so the
  synchronous match-trigger from publish Server Actions
  could never actually be wired;
  (2) the admin Case-2 "إلغاء التحفظ" button called
  `expire_empty_leg_reservation`, which is cron-only and
  no-ops on still-active holds — the button could not
  release an active hold;
  (3) PR 2d's Founder Probe 11 still required
  "receive a notification email" after iteration-2
  removed the email channel + matching/notifications do
  not ship until PR 2e — probe was impossible at PR 2d;
  (4) Resolved Decisions §6 still said
  "every email + WhatsApp text" and one Files entry
  said "every notification email + WhatsApp link" after
  iteration-2 dropped the email channel;
  (5) candidate-pool query did not enforce Risk R3's
  promised 90-day cutoff;
  (6) PR 2e's expire-windows cron description said
  `expire_empty_leg_window` is "the 10th RPC" + "PR 2a
  ships 7 + 1 helper + the empty-stub event hook = 9"
  — both counts stale after iteration-2's growth.
- **Iteration 4 (2026-05-08, awaiting acceptance %, not
  accepted).** All six iteration-3 findings resolved; see
  audit table at the end of the spec. Net changes: PR 2e
  Files (Edit) extended to include
  `app/actions/empty-legs.ts` +
  `app/actions/operator-empty-legs.ts` with explicit
  fire-and-forget POST contract (acceptance #49 added);
  new RPC §7.2.7 `admin_release_empty_leg_reservation`
  for force-releasing active holds (acceptance #19
  added); admin Case-2 button + Server Action
  `adminReleaseReservation` rewired to it (acceptance
  #33 added); the §7.2.X numbering cascaded —
  cancel_empty_leg moved to §7.2.8,
  expire_empty_leg_reservation to §7.2.9, etc. through
  §7.2.12; Founder Probe 11 reworded to a manually-minted
  opt-out token check; Founder Probe 18 extended to
  cover end-to-end opt-out via real wa.me notification;
  remaining "email + WhatsApp text" wording purged;
  candidate-pool query gains
  `created_at >= NOW() − INTERVAL '90 days'`; PR 2e cron
  description rewritten to acknowledge PR 2a ships 11
  publics + 1 helper after iteration-3 added
  admin_release, with `expire_empty_leg_window` as the
  12th public in PR 2e's own migration (acceptance #60
  added). Acceptance criteria count grew 73 → 77 (+1
  RPC, +1 admin Server Action, +1 sync trigger, +1
  expire-window grants). Codex iteration-4 round 1 then
  flagged 3 P1 + 3 P2:
  (1) `notifications.ts` after the email-removal only
  wrote audit rows — no deliverable founder-facing
  surface meant Phase 7's "notifications sent" claim
  was phantom;
  (2) PR 2d's `test:empty-legs-token` script + CI step
  were attached to PR 2e's Files (Edit), making the
  test un-runnable + outside CI for one PR cycle;
  (3) Founder Probe 5 still required "10 publics + 1
  helper" after iteration-3 grew PR 2a to 11 publics;
  (4) Probe 11's correction note still mentioned the
  removed email channel — stale wording in active probe
  text;
  (5) Risk R10 still described "customer's email
  promised that price" — stale email language;
  (6) `expire_empty_leg_reservation` body still said
  "Could also be called ad hoc by admin to release a
  stuck reservation" — contradicted iteration-3 P1 #2's
  dedicated admin-release RPC.
- **Iteration 5 (2026-05-08, awaiting acceptance %, not
  accepted).** All six iteration-4 findings resolved;
  see audit table at the end of the spec. Net changes:
  a deliverable founder-facing outreach surface added —
  PR 1 §12 extends `empty_leg_notifications` with
  `wa_url TEXT NOT NULL` + `outreach_sent_at TIMESTAMPTZ
  NULL` + a partial index on the pending rows; PR 2b
  adds the `/admin/empty-legs/outreach-queue` page, the
  `outreach-row.tsx` component, the `markOutreachSent`
  Server Action, and a sidebar nav entry; PR 2e adds
  `lib/empty-legs/founder-batch-email.ts` +
  `notification-templates/founder-batch-email.ts`,
  rewrites `notifications.ts` to enqueue + trigger the
  batch alert + write `wa_url` + `outreach_sent_at =
  NULL`, and adds an env var
  `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO`. Acceptance
  criteria count grew 77 → 80 (+1 outreach queue page,
  +1 mark-sent action, +1 founder batch alert email).
  Founder Probes 17 reworded to assert the queue state;
  Probes 18/19/20 added (founder batch email, outreach
  queue dispatch, end-to-end opt-out). PR 2d gains
  `package.json` + `.github/workflows/ci.yml` edits for
  `test:empty-legs-token` (Codex iteration-4 P1 #2 fix);
  PR 2e Files (Edit) corrected to NOT include them.
  Founder Probe 5 rewritten to enumerate all 11 PR-2a
  publics by name and require explicit grants on each
  (Codex iteration-4 P1 #3 fix). Probe 11 wording
  tightened (Codex iteration-4 P2 #1 fix). Risk R10
  reworded around wa.me prefilled outreach text only
  (Codex iteration-4 P2 #2 fix).
  `expire_empty_leg_reservation` body marked "cron-
  callable ONLY" + "ad hoc admin" sentence removed
  (Codex iteration-4 P2 #3 fix). Codex iteration-5
  round 1 then flagged 2 P1 + 3 P2:
  (1) Notification blackout's wording let
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS=false` consume
  queue state (frequency cap + per-leg dedupe)
  without producing deliverable wa.me links — and
  conflicted with the `wa_url TEXT NOT NULL` constraint;
  (2) Canary plan deliberately notified real customers
  with wa.me URLs whose `/empty-legs/[leg_number]`
  destinations returned 404 because the marketplace
  flag was still off;
  (3) `idx_empty_leg_notifications_lead_leg_unique`
  was named UNIQUE but created as a non-unique index;
  (4) Founder batch email was a silent no-op on
  missing `RESEND_API_KEY` — the deliverable surface
  could look healthy while the founder was no longer
  alerted;
  (5) `app/actions/empty-legs.ts` block still said
  "4 admin Server Actions" after iteration-3 + 4
  added two more.
- **Iteration 6 (2026-05-08, awaiting acceptance %, not
  accepted).** All five iteration-5 findings resolved;
  see audit table at the end of the spec. Net changes:
  notification blackout rewritten to fail-closed —
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS=false` causes the
  matcher to return early before any candidate-pool
  read or audit-row INSERT; new acceptance #65;
  `lib/empty-legs/matching.ts` opens with the explicit
  env-flag short-circuit. Canary plan rewritten — both
  `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` and
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS` stay `false` until
  founder smoke-confirms outbox + cron telemetry, then
  flips both flags simultaneously. PR 1 §12's
  `idx_empty_leg_notifications_lead_leg_unique` now
  `UNIQUE` (DB-side guarantee, not just application-
  level EXISTS). PR 1 gains §14 — new singleton table
  `empty_leg_outreach_alert_status` for healthy/config-
  missing/send-failed status; founder batch email
  UPDATEs it on every send attempt; PR 2b outreach
  queue page reads it + renders red banner when status
  `<> 'healthy'`; Founder Probe 18 made gate-failing on
  missing config; Sentry receives structured error on
  every failure. PR 2b admin Server Actions count
  corrected from 4 → 6. Acceptance criteria count grew
  80 → 83 (+1 alert-status table, +1 banner-render,
  +1 fail-closed matcher). Codex iteration-6 round 1
  then flagged 1 P1 + 3 P2:
  (1) The fail-closed path said "no
  `empty_leg_notifications` rows are written when
  notifications are disabled" but still drained
  `empty_leg_events_outbox` and set
  `processed_at = NOW()` — meaning publish/price-drop
  events were silently lost for the entire blackout
  window;
  (2) Founder Probe 4 still asked for "the two indexes"
  on `empty_leg_notifications` after iteration-4 + 5
  grew the count to 3 (24h lookup + UNIQUE lead+leg
  + outreach-pending);
  (3) `lib/empty-legs/__tests__/frequency-cap.test.ts`
  description still said "mock `notifications` reader"
  after iteration-2 P1 #2 retargeted to
  `empty_leg_notifications`;
  (4) Open Question §6 said "stage 1 week behind PR 2e"
  while the canary plan + Implementation Order said
  "~24 hours" — implementers + closure checklist would
  disagree on the gate duration.
- **Iteration 7 (2026-05-08, awaiting acceptance %, not
  accepted).** All four iteration-6 findings resolved;
  see audit table at the end of the spec. Net changes:
  notification blackout extended — outbox rows that
  match a `'notifications_disabled'` skip stay
  `processed_at = NULL` so they replay on next cron
  tick after the flag flips back; matching engine
  description + acceptance #65 spell this out;
  Rollout safety adds a "Outbox backlog bound"
  paragraph + a one-line operational ritual for the
  >7-day-blackout recovery case (Codex iteration-6
  P1 #1 fix). Founder Probe 4 enumerates all three
  indexes by name — the 24h lookup, the UNIQUE
  lead+leg, and the outreach-pending partial (Codex
  iteration-6 P2 #1 fix). `frequency-cap.test.ts`
  contract retargeted to mock `empty_leg_notifications`
  reader keyed on `lead_inquiry_id + leg_id + sent_at`
  (Codex iteration-6 P2 #2 fix). Open Question §6
  rewritten — canonical gate is "founder-discretionary
  with a 24-hour minimum"; the prior 1-week vs 24-hour
  conflict is reconciled (Codex iteration-6 P2 #3 fix).
  Codex iteration-7 round 1 then flagged 3 P1 + 1 P2:
  (1) Acceptance #56 still said the match-trigger route
  marks each outbox row `processed_at = NOW()`
  unconditionally — contradicting the iteration-6 fail-
  closed contract that ordered the row stay unprocessed
  on `notifications_disabled`;
  (2) The candidate query filtered by
  `lead_inquiries.last_empty_leg_notified_at` but no
  write path actually updated that column — the 24-hour
  cap could only be enforced via the separate
  `empty_leg_notifications.sent_at` read in
  `frequency-cap.ts`, leaving a window where one
  candidate could be selected for multiple legs in
  24 hours;
  (3) Canary plan published internal-only test legs
  while notifications were disabled; the outbox rows
  for those test legs stayed unprocessed and would
  replay against real customers when both flags
  flipped — no marker existed to exclude test legs
  from the matching engine;
  (4) Founder Probe 15 expected a queue row within
  one minute but didn't state the precondition that
  both `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` and
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS` must be flipped
  to `true` first (otherwise the matcher fail-closes).
- **Iteration 8 (2026-05-08, awaiting acceptance %, not
  accepted).** All four iteration-7
  findings resolved; see audit table at the end of the
  spec. Net changes: acceptance #58 (was #56) now
  reads "marks each row `processed_at = NOW()` only
  when matching actually ran" with explicit reference
  to the `'notifications_disabled'` exception (Codex
  iteration-7 P1 #1 fix). PR 1 gains §16 — new DB
  trigger `empty_leg_notifications_update_last_notified`
  that atomically updates `lead_inquiries.last_empty_leg_notified_at`
  inside the same transaction as every
  `empty_leg_notifications` INSERT (Codex iteration-7
  P1 #2 fix); acceptance #15 + #65 added/reworded.
  PR 1 gains §11 — new column
  `empty_legs.suppress_notifications BOOLEAN NOT NULL
  DEFAULT FALSE` that the matcher excludes from
  candidate cycles (Codex iteration-7 P1 #3 fix);
  matching.ts description gains a "Suppress-
  notifications leg filter" sub-section; admin publish
  form gets a "رحلة اختبار داخلية — لا ترسل تنبيهات"
  checkbox in PR 2b; acceptance #12 + #31 + #59 added/
  reworded. Founder Probe 15 split into Probe 15
  (pre-flip flag-off assertion) and Probe 16 (post-
  flip matching engine output) with explicit flag
  preconditions on each (Codex iteration-7 P2 #1 fix);
  Probes 17/18/19/20/21 renumbered. Acceptance
  criteria count grew 83 → 85 (+1 suppress_notifications
  column, +1 trigger). Schema sections grew 14 → 16
  (added §11 suppress + §16 trigger; renumbered §11
  RLS → §12, §12 notifications → §13, §13 sessions →
  §14, §14 alert-status → §15).
  Codex iteration-8 round 1 then flagged 2 P1 + 2 P2:
  (1) Implementation Order Step 6 still said "the
  matching engine fail-closes (skip + outbox drain
  only)" — directly contradicting iteration-7 P1 #1's
  outbox-replay contract;
  (2) The canary plan's Step 2 said "internal-only test
  legs" but did not explicitly require ticking the new
  `suppress_notifications` checkbox or verifying the
  column — the test legs could publish as normal legs
  whose outbox rows would replay to real customers on
  flag flip;
  (3) Implementation Order Step 1 (PR 1) reverted to
  "No application code" — stale wording that earlier
  iterations had settled as "no runtime UI/RPC code";
  (4) PR 1 founder probes verified `empty_leg_notifications`
  shape but never explicitly verified the iteration-6
  alert-status singleton seed/enum or the iteration-8
  AFTER INSERT trigger wiring — production could miss
  either piece silently and only fail at PR 2e.
- **Iteration 9 (2026-05-08, awaiting acceptance %, not
  accepted).** All four iteration-8
  findings resolved; see audit table at the end of the
  spec. Net changes: Implementation Order Step 6
  rewritten — "the matching engine **skips without
  marking outbox rows processed**" with explicit
  exception for `suppress_notifications=TRUE`
  (Codex iteration-8 P1 #1 fix). Canary Step 2
  rewritten with explicit "checkbox TICKED" requirement
  + Step 3 verification queries that prove
  `suppress_notifications = TRUE`, outbox rows
  `processed_at = NOW()`, and zero
  `empty_leg_notifications` rows for the suppressed
  legs (Codex iteration-8 P1 #2 fix). Implementation
  Order Step 1 reworded to "No runtime UI/RPC code"
  with explicit list of what PR 1 ships + Probes
  1, 2, 3, 4, 4a, 4b enumerated (Codex iteration-8 P2
  #1 fix). Founder Probes 4a + 4b added — 4a verifies
  the `empty_leg_outreach_alert_status` singleton seed
  + status-CHECK + singleton-lock; 4b verifies the
  `empty_leg_notifications_update_last_notified` AFTER
  INSERT trigger wiring + the
  `_update_lead_inquiry_last_notified` function's
  SECURITY DEFINER + zero-grantees posture + a
  synthetic-INSERT smoke test (Codex iteration-8 P2 #2
  fix). Acceptance criteria count unchanged (85);
  only Implementation Order + canary + probe text
  reworded.
  Codex iteration-9 round 1 then flagged 1 P1 + 2 P2:
  (1) Probe 15 (Pre-flip flag-off assertion) published
  a test leg without requiring `suppress_notifications =
  TRUE` and verified the outbox row stayed
  `processed_at = NULL` — but that pending row would
  replay to real customers after both flags flipped,
  re-introducing the iteration-7 P1 #3 hazard at the
  probe layer;
  (2) Probe 4b's "smoke test" asked the founder to
  INSERT a synthetic `empty_leg_notifications` row
  against a known `lead_inquiries.id` only, but the
  table also requires a valid `leg_id` FK to
  `empty_legs(id)` — on a fresh / quiet production
  state the smoke could fail for fixture reasons
  rather than trigger wiring;
  (3) The trigger section's prose said
  `last_empty_leg_notified_at = NOW()` while the SQL
  body assigned `NEW.sent_at` — probes asserting
  against `now()` would trip on the tiny time
  difference.
- **Iteration 10 (2026-05-08, awaiting acceptance %, not
  accepted).** All three iteration-9 findings resolved;
  see audit table at
  the end of the spec. Net changes: Probe 15 rewritten
  to require the test leg use
  `suppress_notifications = TRUE` (the canary's marker
  applied at probe layer too) + verifies three
  conditions: `suppress_notifications = TRUE`, zero
  audit rows for the leg, and outbox `processed_at`
  non-NULL (suppression branch intentionally marks
  processed). The probe leg now stays in production
  forever as a suppressed entry, so even after flag
  flip the leg-eligibility filter (per acceptance #59)
  excludes it from any future cycle — no real-customer
  replay possible (Codex iteration-9 P1 #1 fix). Probe
  4b's smoke test rewritten with an explicit
  `BEGIN ... ROLLBACK` transaction-scoped fixture: the
  founder INSERTs a throwaway `empty_legs` row first
  (all required columns spelled out), then the
  notification row referencing both that leg and an
  existing `lead_inquiries` row, then asserts
  `last_empty_leg_notified_at = NEW.sent_at`, then
  rolls back — production is left untouched (Codex
  iteration-9 P2 #1 fix). PR 1 §16 trigger description
  + acceptance #65 + Probe 4b assertion harmonized to
  use `NEW.sent_at` everywhere instead of `NOW()`
  (Codex iteration-9 P2 #2 fix). Acceptance criteria
  count unchanged (85); only Probes 4b + 15 +
  acceptance #65 + §16 prose reworded.
  Codex iteration-10 round 1 then flagged 3 P1:
  (1) The matcher's `ENABLE_EMPTY_LEGS_NOTIFICATIONS
  !== 'true'` check at the top short-circuited BEFORE
  the per-leg `suppress_notifications` check — so
  canary suppressed test legs took the
  `notifications_disabled` branch, stayed unprocessed,
  and would replay against real customers on flag
  flip — exactly the iteration-7 P1 #3 + iteration-9
  P1 #1 hazard the marker was supposed to prevent;
  (2) PR 1 added `departure_airport_freeform_snapshot`
  + `arrival_airport_freeform_snapshot` columns +
  presence CHECKs but did NOT drop `NOT NULL` from
  the existing IATA columns. Schema reality has both
  as `VARCHAR(10) NOT NULL REFERENCES airports(iata_code)`
  — so freeform-only publish inputs and Probe 4b's
  throwaway fixture would fail before any presence
  check ran;
  (3) PR 2c minted operator session tokens for known
  `operators.id` rows but the `operators` table is
  empty in production and Phase 7 had no PR/probe
  creating an operator row first — every operator-
  portal smoke step would fail for fixture reasons.
- **Iteration 11 (2026-05-08, awaiting acceptance %, not
  accepted).** All three iteration-10
  findings resolved; see audit table at the end of the
  spec. Net changes: matching.ts + acceptance #67 +
  §Rollout-safety blackout description rewritten with
  per-leg ordered branches — branch (a)
  `suppress_notifications` runs FIRST per leg + marks
  outbox processed; branch (b)
  `notifications_disabled` runs second for non-
  suppressed legs only + leaves outbox unprocessed;
  branch (c) candidate matching runs last for non-
  suppressed legs with the flag enabled. The order
  matters for mixed-batch outbox cycles where canary
  legs and real legs co-exist (Codex iteration-10
  P1 #1 fix). PR 1 §3 rewritten: explicitly drops
  `NOT NULL` from `empty_legs.departure_airport` +
  `empty_legs.arrival_airport`, keeps the FKs to
  `airports(iata_code)` so populated values still
  resolve. Acceptance #3 reworded to verify
  nullability (Codex iteration-10 P1 #2 fix). PR 2c
  Files (Add) gain `app/(admin)/admin/(protected)/empty-legs/operators/page.tsx`
  + `app/actions/operators.ts` for the
  `adminCreateOperator` Server Action. Founder Probe
  9 added (Operator bootstrap) + the prior Probe 9
  becomes Probe 10 (Operator session token);
  subsequent probes 10–21 ↦ 11–22 (Codex iteration-10
  P1 #3 fix). Acceptance criteria count unchanged
  (85); only Implementation Order + Rollout safety +
  matching.ts + acceptance #3 + #67 + Probes 9-22
  reworded/reordered.
  Codex iteration-11 round 1 then flagged 2 P1 + 1 P2:
  (1) The iteration-10 operator-bootstrap surface
  INSERTed an `operators` row with `id, name,
  contact_email, contact_phone, status` — but the
  real `operators` schema requires `user_id NOT NULL
  REFERENCES users(id)` + `commercial_registration` +
  `gaca_license` + `license_expiry` and has no `name`
  column (it's `company_name`). Probe 9's
  `SELECT id, name FROM operators` would also fail;
  (2) PR 1's lead-in promised "every CREATE TABLE is
  IF NOT EXISTS" + Probe 1 required migration
  re-runnability, but the concrete SQL snippets for
  `empty_leg_notifications`, `operator_empty_leg_sessions`,
  and `empty_leg_outreach_alert_status` used plain
  `CREATE TABLE` — re-running PR 1 would fail on
  existing relations;
  (3) Stale probe references: acceptance #66 said
  "Founder Probe 19 fails until configured" but the
  founder-batch email probe was now Probe 20 after
  iteration-11 P1 #3's bootstrap-probe insertion;
  similarly "real wa.me opt-out is verified in
  Probe 21" while the end-to-end opt-out probe was
  now Probe 22.
- **Iteration 12 (2026-05-08, awaiting acceptance %, not
  accepted).** All three iteration-11
  findings resolved; see audit table at the end of the
  spec. Net changes: per Codex's prescribed iteration-11
  P1 #1 second option, PR 1 §14 added —
  `phase7_operator_stubs` table with
  `id`/`company_name`/`contact_email`/`contact_phone`/
  `status`/optional `notes` columns + active-status
  partial index + service-role RLS. PR 1 §15
  (`operator_empty_leg_sessions`) FK retargeted from
  `operators(id)` to `phase7_operator_stubs(id)`. PR
  2c bootstrap surface page + `adminCreatePhase7OperatorStub`
  Server Action retargeted to the stub table. Probe 9
  rewritten with `SELECT id, company_name, status FROM
  phase7_operator_stubs`. Acceptance #14 (new) +
  #15 (new) + renumbering of #16 + #17 (Codex
  iteration-11 P1 #1 fix). Three plain `CREATE TABLE`
  snippets in PR 1 §13 + §15 + §16 changed to
  `CREATE TABLE IF NOT EXISTS`; same fix applied to
  every `CREATE INDEX` (5 indexes); trigger creation
  prefixed with `DROP TRIGGER IF EXISTS` (Codex
  iteration-11 P1 #2 fix). Stale probe references
  in acceptance #68 (was "Probe 19" → "Probe 20")
  and PR 2d's Probe 12 ("Probe 21" → "Probe 22")
  updated (Codex iteration-11 P2 #1 fix). Acceptance
  criteria count grew 85 → 87 (+2 schema items —
  `phase7_operator_stubs` table + the redirected FK
  on `operator_empty_leg_sessions`); sections after
  Schema shift +2 each.
  Codex iteration-12 round 1 then flagged 2 P1 + 1 P2:
  (1) PR 1 created `phase7_operator_stubs` and retargeted
  sessions there, but `empty_legs` still had only
  nullable `operator_id` (for the real `operators`
  table) plus operator snapshots — no column linked a
  leg to a stub. `operatorPublishEmptyLeg` had nowhere
  to persist the stub id from the session, so the
  operator portal could not scope list/edit/cancel
  actions to the session's stub;
  (2) `operator_empty_leg_sessions.operator_id` referenced
  `phase7_operator_stubs(id)` but kept the legacy
  column name `operator_id` — overloading the real
  `operators.id` concept and inviting accidental joins
  against the wrong table; HMAC payload also still used
  `{ operator_id }`;
  (3) Probe 10 only verified list rendering + tampered-
  token rejection — it never proved the critical
  stub-scoped behavior (publish-via-stub-A creates a
  leg owned by stub A; stub-B-session cannot list /
  update / cancel it).
- **Iteration 13 (2026-05-08, awaiting acceptance %, not
  accepted).** All three iteration-12
  findings resolved; see audit table at the end of the
  spec. Net changes: PR 1 §1 extended to add
  `empty_legs.operator_stub_id UUID NULL REFERENCES
  phase7_operator_stubs(id) ON DELETE SET NULL` plus a
  partial `idx_empty_legs_operator_stub` index, alongside
  the existing `operator_id`/`operator_*_snapshot`
  relaxation (Codex iteration-12 P1 #1 fix). The
  `publish_empty_leg` RPC parameter list extended with
  `operator_stub_id UUID NULLABLE`; the operator portal's
  list/publish/edit/cancel pages + Server Actions
  filter on this column; cross-stub attempts return
  opaque `'leg_not_found'`. PR 1 §15 column +
  `lib/operator/empty-leg-session-token.ts` payload
  renamed from `operator_id` to `operator_stub_id`
  (Codex iteration-12 P1 #2 fix); index renamed
  `idx_operator_empty_leg_sessions_operator` →
  `idx_operator_empty_leg_sessions_stub`. Acceptance
  #1 + #15 + #43 reworded to enforce the stub key.
  Founder Probe 10 expanded with a concrete
  isolation test: mint two stubs/sessions, publish
  a leg via the first, verify the second session
  cannot see / update / cancel it (Codex iteration-12
  P2 #1 fix). Acceptance criteria count unchanged
  (87) — only #1, #15, #43, and Probe 10 reworded;
  no new items, no shifts.
  Codex iteration-13 round 1 then flagged 1 P1 + 1 P2:
  (1) PR 1 §1 added
  `empty_legs.operator_stub_id UUID REFERENCES
  phase7_operator_stubs(id)`, but
  `phase7_operator_stubs` is not created until §14 —
  a single migration following the section order
  would fail because PostgreSQL cannot add an FK to a
  relation that does not exist yet;
  (2) Acceptance #60 said outbox rows are marked
  processed only when matching ran, with only a
  `'notifications_disabled'` exception — but #69's
  per-leg ordered branches say
  `'suppress_notifications'` skips ALSO mark
  processed (intentional skip, not a deferred state).
- **Iteration 14 (2026-05-08, awaiting acceptance %, not
  accepted).** All two iteration-13
  findings resolved; see audit table at the end of
  the spec. Net changes: PR 1 §1 split — column
  `operator_stub_id UUID` is added without an FK in
  §1 (just `ADD COLUMN`); the FK constraint
  `empty_legs_operator_stub_fk` + the partial
  `idx_empty_legs_operator_stub` index land in §14
  in a new "FK + index wiring" sub-block AFTER
  `phase7_operator_stubs` is created, both wrapped
  in idempotent guards (`pg_constraint` DO block
  for the FK, `IF NOT EXISTS` for the index). Per
  Codex iteration-13 P1 #1's prescribed second
  option ("add the column nullable without the FK
  in section 1 and add the FK constraint after
  section 14 in an idempotent DO block").
  Acceptance #1 reworded to point at both §1 +
  §14's wiring sub-block. Acceptance #60 reworded
  to spell out both exceptions: rows are marked
  processed when matching ran OR when the suppress
  branch intentionally skipped; only non-suppressed
  `'notifications_disabled'` rows leave
  `processed_at = NULL` for replay (Codex
  iteration-13 P2 #1 fix). Acceptance criteria count
  unchanged (87); only #1 + #60 reworded; PR 1 §1 +
  §14 reorganized.
  Codex iteration-14 round 1 then flagged 0 P1 + 2 P2:
  (1) The PR 1 `types/database.ts` file fence only
  enumerated `empty_legs`, `lead_inquiries`, and
  `empty_leg_notifications` — but PR 1 also creates
  `phase7_operator_stubs`, `operator_empty_leg_sessions`,
  and `empty_leg_outreach_alert_status`, all of which
  later PRs read/write through typed Supabase helpers
  that need their row types regenerated;
  (2) Implementation Order Step 4 still said the
  founder "mints a session for the first real
  operator out-of-band" — sending the founder back
  toward the real `operators` table that Phase 7
  explicitly avoids per iteration-11 P1 #1 +
  iteration-12 P1 #1's `phase7_operator_stubs` model.
- **Iteration 15 (this draft).** All two iteration-14
  findings resolved; see audit table at the end of
  the spec. Net changes: PR 1 `types/database.ts`
  file fence rewritten to require the file is
  **regenerated after the full PR 1 migration
  applies** with explicit enumeration of every
  new/changed column + every new row type
  (`empty_leg_notifications`,
  `phase7_operator_stubs`,
  `operator_empty_leg_sessions`,
  `empty_leg_outreach_alert_status`). Run
  `npm run db:types` post-migration; commit the
  regenerated file as part of the PR 1 diff (Codex
  iteration-14 P2 #1 fix). Implementation Order
  Step 4 (PR 2c) rewritten — founder
  creates/verifies a `phase7_operator_stubs` row via
  the PR 2c bootstrap surface
  (`/admin/empty-legs/operators` +
  `adminCreatePhase7OperatorStub` Server Action),
  then mints the operator session for that stub and
  runs Probe 10 (Codex iteration-14 P2 #2 fix).
  Acceptance criteria count unchanged (87); no
  reword of acceptance items; only PR 1 file fence
  + Implementation Order Step 4 prose updated.

## Objective

Ship `Aeris Empty Legs` end-to-end: an operator publishes a
return-leg seat at a discount, the platform discovers eligible
customers and notifies them, customers see a public marketplace,
reserve a leg with a short hold, then confirm via the existing
WhatsApp coordination flow into a real `bookings` row.

Concretely Phase 7 must:

1. **Reshape `empty_legs`** to the same `payment_status`-pluggable
   shape Phase 6.2 normalized for `bookings` (operator + aircraft
   FKs nullable + snapshot columns; financial state lives on the
   linked booking row, not on the leg).
2. **Add a 7-RPC `SECURITY DEFINER` mutation layer**: publish,
   update price, cancel, reserve, confirm-to-booking, expire-
   reservation, recompute-Dutch-auction-tick. All atomic, all
   service-role-only EXECUTE, all paired with the canonical
   `_recompute_*` helper pattern from Phase 6.2.
3. **Ship admin surfaces** (`/admin/empty-legs` list + detail +
   create/edit) wired to thin Server Actions that call the RPCs.
4. **Ship a token-gated operator self-serve portal**
   (`/operator/empty-legs/<token>`). No operator-account flow —
   admin mints a 30-day session token per operator until
   Phase 8's full auth lands. Surfaces: list this operator's
   legs, create new, edit price, cancel.
5. **Ship a public marketplace** (`/empty-legs`) — read-only
   listing of `available` legs, RTL-Arabic, no auth, with
   per-leg detail page and a 10-minute reserve flow that
   captures a customer name + phone snapshot, locks the leg,
   and surfaces a WhatsApp confirm link to the founder.
6. **Ship a rule-based matching engine + Dutch auction
   tick + outreach queue**: on `empty_leg_published` and
   `empty_leg_price_dropped` events, score eligible customers
   from `lead_inquiries` history against the leg, pick top 50,
   emit a WhatsApp wa.me URL per candidate **into the
   founder-facing outreach queue** (`empty_leg_notifications`
   table with `outreach_sent_at IS NULL`) respecting opt-in
   + per-customer 24h frequency cap. The matching engine
   ALSO sends a single batched founder-facing email (via
   the existing Resend stack — same brand template as
   `lib/notifications/lead-email.ts`) summarizing the new
   pending outreach rows so the founder is alerted out of
   band. The founder dispatches each wa.me URL manually
   via WhatsApp Business and marks the row as sent on the
   admin outreach queue page (`/admin/empty-legs/outreach-queue`).
   This is the actual customer-delivery surface (Codex
   iteration-4 P1 #1 fix: prior draft only wrote audit rows
   with no deliverable founder-facing surface, which left
   "notifications sent" as a phantom claim. Per Codex's
   prescribed first option — "add an actual deliverable
   founder-facing send queue/surface for these wa.me links"
   — Phase 7 now ships an admin queue + a founder batch
   alert email + a "تم الإرسال" mark-sent action; customer-
   side email channel is still removed per iteration-2 P1
   #2). Dutch auction tick is a Vercel Cron route that
   walks every `available` leg every 30 minutes and flips
   `current_discount_pct` along an accelerating quadratic
   curve toward a configured floor.

Payment integration stays deferred to Phase 11; an Empty-Legs
sale creates a `bookings` row that inherits the Phase 6.2
default `payment_status = 'pending_offline'` and waits for
HyperPay/Moyasar/ZATCA to wire it.

## Business Goal

Empty Legs is the highest-margin discovery surface Aeris ships:
operators recover deadhead cost on legs that would otherwise fly
empty, customers fly private at 30–60% off retail charter, and
Aeris brokers it. Without a marketplace, operators have to
broadcast empties manually over WhatsApp groups; without
matching, customers learn about discount inventory by chance.

The spec is written for **founder + 1 active operator + ~50–200
candidate customers** as the day-1 surface — enough scale to
prove the funnel without needing operator self-onboarding (a
Phase 8 problem) and without needing the AI scoring layer that
PostHog usage data would unlock once installs accumulate
(Phase 7.x sub-iteration if needed; explicitly not in Phase 7).

## Schema reality (state before Phase 7)

This section is the source of truth for what the DB looks like
the day Phase 7 PR 1 ships. Every assumption Phase 7 makes about
existing columns / constraints / RPCs is grounded here. Codex
should sanity-check this section first; if any item below is
wrong, the rest of the spec is built on sand.

### `empty_legs` table (initial schema, never written to in production)

`supabase/migrations/20260422000001_initial_schema.sql:369-399`
defines:

- `id UUID PK`
- `leg_number VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('EL')`
  (auto-issues `EL-XXXX` on insert)
- `parent_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL`
  — already nullable; covers both reposition (no parent) and
  return-leg-of-confirmed-trip (parent booking exists)
- `operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE`
  — currently NOT NULL, will be relaxed in PR 1 because the
  `operators` table is empty in production (same condition that
  forced Phase 6.2 PR 1's `bookings.operator_id` relaxation per
  iteration-1 P1 #1 of that spec)
- `aircraft_id UUID NOT NULL REFERENCES aircraft(id)` —
  same NOT-NULL relaxation needed
- `departure_airport VARCHAR(10) NOT NULL REFERENCES airports(iata_code)`
  + `arrival_airport VARCHAR(10) NOT NULL REFERENCES airports(iata_code)`
  — IATA-strict. Phase 6.0 PR 2 added freeform-fallback for
  `trip_requests` cities without an IATA match; PR 1 will mirror
  that pattern here so `empty_legs` accepts a freeform shape too.
- `departure_window_start TIMESTAMPTZ NOT NULL`,
  `departure_window_end TIMESTAMPTZ NOT NULL`,
  `flexibility_hours INTEGER DEFAULT 3`
- `original_price DECIMAL(12,2) NOT NULL`,
  `current_discount_pct DECIMAL(4,2) DEFAULT 40 CHECK (0..90)`,
  `current_price DECIMAL(12,2) NOT NULL`
- `max_passengers INTEGER NOT NULL`
- `status empty_leg_status DEFAULT 'available'`
- `views_count INTEGER DEFAULT 0`,
  `notifications_sent INTEGER DEFAULT 0`
- `created_at TIMESTAMPTZ DEFAULT NOW()`,
  `expires_at TIMESTAMPTZ`,
  `updated_at TIMESTAMPTZ DEFAULT NOW()`
- 3 indexes: `idx_empty_legs_status` (partial,
  `WHERE status='available'`), `idx_empty_legs_operator`,
  `idx_empty_legs_airports`
- `empty_legs_updated_at` trigger
- RLS enabled
- 1 RLS policy: `empty_legs_public_available` —
  `FOR SELECT USING (status='available' OR
   operator_id IN (SELECT id FROM operators WHERE user_id = auth.uid()))`

### `empty_leg_status` ENUM

`('available', 'reserved', 'sold', 'expired')` — defined in
the initial schema. PR 1 extends with `'cancelled'` (admin/
operator-initiated, distinct from `'expired'` which is window-
elapsed).

### Related tables Phase 7 reads/links

- **`bookings`** — Phase 6.2-shaped. `client_id`, `operator_id`,
  `aircraft_id`, `vat_amount`, `commission_amount`,
  `operator_payout` all nullable. `payment_status` default
  `'pending_offline'`. `trip_request_id` partial-unique-indexed
  (`bookings_trip_request_unique`). `source_offer_table` CHECK
  pinned to `('phase4', 'phase5')` — **PR 1 must extend this
  CHECK to include `'phase7_empty_leg'`** so the empty-leg
  confirm path can write a `bookings` row with that
  discriminator.
- **`booking_addons`** — Phase 6.2-shaped. Empty-Legs MVP does
  NOT attach add-ons (out of scope; see §Out of Scope), so PR 1
  touches nothing here.
- **`addon_catalog`** — Phase 6.2 file C; not touched.
- **`trip_requests`** — Phase 6.0-shaped, has both `iata` and
  freeform fields; `legs JSONB` for multi-city. **Empty Legs do
  NOT create a `trip_requests` row** — they are operator-side
  inventory, not customer-asked trips. The booking row created
  on confirm has `trip_request_id = NULL` (this currently fails
  the `bookings_route_origin_present_check` because the present-
  check guards `trip_request_id IS NULL OR (route … present)`,
  so a NULL trip with present route still passes — verified by
  re-reading the constraint in `20260508000007_phase_6_2_addons.sql:304`).
- **`lead_inquiries`** — Phase 6.0 customer-side captures. The
  matching engine reads it as the candidate-customer pool.
  Columns: `id`, `request_number`, `customer_name`,
  `customer_phone`, `trip_type`, `origin`, `destination`,
  `departure_date`, `return_date`, `passengers`, `notes`,
  `created_at` (and Phase 6.1 preferences columns). **No
  `customer_email` column exists** (Codex iteration-2 P1 #2
  fix: prior draft referenced a non-existent
  `customer_email` in PR 2e's candidate-pool reader). No
  consent column exists yet — **PR 1 adds
  `lead_inquiries.empty_legs_opt_in BOOLEAN NOT NULL DEFAULT
  FALSE`** (Codex iteration-1 P1 #1 fix; existing rows
  backfill `FALSE` automatically — historical leads
  predate this marketing category) and
  `lead_inquiries.last_empty_leg_notified_at TIMESTAMPTZ
  NULL` for the frequency cap.
- **`notifications`** — initial-schema table
  (`20260422000001_initial_schema.sql:484-496`). Actual
  shape (Codex iteration-1 P1 #2 fix; the prior draft
  invented column names that do not exist):
  `id UUID PK`,
  `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
  `type notification_type NOT NULL` (column name is `type`,
  not `notification_type` — the ENUM happens to share the
  name; the ENUM contains `('booking', 'offer', 'empty_leg',
  'payment', 'loyalty', 'marketing')`),
  `channel notification_channel NOT NULL` (ENUM contains
  `('in_app', 'email', 'sms', 'whatsapp')` — note
  `'whatsapp'`, not `'whatsapp_link'`),
  `title VARCHAR(200) NOT NULL`, `body TEXT NOT NULL`,
  `data JSONB DEFAULT '{}'::jsonb` (column name is `data`,
  not `metadata`), `is_read`, `sent_at`, `read_at`,
  `created_at`. **The `user_id NOT NULL FK to users` makes
  this table unusable for Phase 7's notification audit** —
  Phase 7's recipients are guest `lead_inquiries` rows
  (no `users.id` to point at). Phase 7 **does NOT write to
  `notifications`**; instead PR 1 §13 adds a dedicated
  `empty_leg_notifications` table keyed on `lead_inquiry_id`
  + `leg_id` so the frequency cap + per-leg dedupe can
  read against guest-shaped rows.
- **`audit_logs`** — initial-schema table. PR 1 wires triggers
  on `empty_legs` price changes + status flips to write here
  for forensic trail.
- **`users`** — initial-schema, role-gated. Phase 7 does NOT
  add an account flow; `users` is read by RLS policies but not
  written by Phase 7 RPCs.

### `booking_payment_status` ENUM

Initial schema (`20260422000001_initial_schema.sql:27`) defined
`('pending', 'paid', 'refunded')`. Phase 6.2 PR 1 File A added
`'pending_offline'`. Production state today is the four values
`('pending', 'paid', 'refunded', 'pending_offline')`. Phase 7
adds none — an Empty-Legs sale uses `'pending_offline'` just
like an `accept_offer` booking. (Codex iteration-1 P2 #1 fix:
the `'refunded'` value was omitted from this section in the
prior draft.)

### `bookings.source_offer_table` CHECK

Currently `IN ('phase4', 'phase5') OR NULL`. **PR 1 extends to
`IN ('phase4', 'phase5', 'phase7_empty_leg') OR NULL`**. The
extension is idempotent (uses the same `pg_constraint`
DROP-and-recreate pattern Phase 6.2 used; alternatively, a
named replacement constraint).

### `accept_offer` RPC

Phase 6.2 PR 2a body. Untouched by Phase 7. Empty-Legs writes
its own bookings row via a new RPC (`confirm_empty_leg_reservation`,
§7.2.5), NOT via `accept_offer`.

### Infrastructure

- **`@anthropic-ai/sdk`** in `package.json`. Phase 7 does NOT
  call Claude — matching is rule-based per §Resolved Decisions.
- **`inngest`** in `package.json`, no workflows shipped. Phase 7
  uses **Vercel Cron + Next.js API routes**, NOT Inngest, per
  §Resolved Decisions.
- **`resend`** in `package.json` and used in
  `lib/notifications/lead-email.ts` (Phase 6.0 founder-
  notification email — admin alert when a new lead arrives;
  this path is **independent** of Phase 7 customer
  notifications and is not changed). Phase 7 customer
  notifications do NOT use Resend (Codex iteration-2 P1 #2
  fix: customer-side email channel removed because
  `lead_inquiries.customer_email` does not exist). The
  Phase 7 wa.me-link generator borrows
  `lib/notifications/lead-email.ts`'s pre-filled-message
  composition pattern + `normalizeWhatsAppPhone` helper but
  emits a WhatsApp URL, not an email body.
- **`vercel.json`** is currently a 4-line stub:
  `{ "$schema": …, "framework": "nextjs" }`. Phase 7 PR 2e adds
  a `crons` array — three entries, all Vercel-Cron-protected by
  `Authorization: Bearer $CRON_SECRET`.
- **`app/api/`** does NOT exist yet. Phase 7 PR 2e creates it
  for cron routes + the matching-engine internal trigger route.
- **`lib/operator/token.ts`** is the canonical HMAC-token
  reference. Phase 7 PR 2c adds `lib/operator/empty-leg-session-token.ts`
  in the same shape.
- **`lib/checkout/customer-token.ts`** is the customer-token
  reference. Phase 7 PR 2d adds `lib/empty-legs/reservation-token.ts`
  in the same shape, scoped to a single empty-leg + reservation
  expiry.

## Resolved Decisions

These are the founder's product decisions on 2026-05-08 that
gate the spec. Codex should treat them as input, not as
contestable open questions.

1. **Scope — full Phase 7, not foundation-only.** All 6 PRs
   ship inside Phase 7. No PR is deferred to a Phase 7.1 / 7.2
   sub-iteration. The PR sequence below is purely a safe
   merge order — every PR's UI lands behind a kill-switch flag
   that defaults OFF until the dependent PR ships, so PRs are
   independently reviewable and reversible.
2. **Publishing surface — admin AND operator self-serve.**
   Operator full-account auth is a Phase 8 problem, not Phase 7.
   PR 2c ships a **token-gated session model**: admin mints a
   30-day operator session token, hands it to the operator out-
   of-band (WhatsApp), operator's portal lives at
   `/operator/empty-legs/<token>`. If the operator ecosystem is
   not real yet on day 1, the entire `/operator/empty-legs/*`
   subtree is gated by `ENABLE_OPERATOR_PORTAL` env flag
   (default `false` in production until first operator session
   is minted). Admin surfaces (PR 2b) work with or without any
   operator session existing — admin can publish + cancel +
   reprice on behalf of any operator.
3. **Dutch auction — deterministic accelerating curve, floor
   exposed.** Curve formula:
   `current_discount_pct = floor + (initial − floor) × (1 − elapsed)^2`
   where `elapsed = (NOW() − auction_window_start_at) /
   (auction_window_end_at − auction_window_start_at)`, clamped
   to `[0, 1]`. Defaults: `initial = 40`, `floor = 70`. The
   `^2` term means the discount accelerates as the window
   closes (small price moves early, big drops near departure).
   These defaults are an opening proposal — Codex review
   should challenge the floor (70%) and curve order (²), or
   accept as-is.
4. **Marketplace — public `/empty-legs` ships in Phase 7.**
   Not deferred to Phase 7.1. RLS already permits public read
   of `status = 'available'` rows; the page composes against
   that policy with anon Supabase client.
5. **Matching engine — rule-based in Phase 7, AI scoring
   deferred sublayer.** PR 2e ships a deterministic 4-factor
   weighted score (geography, time, capacity, discount
   attractiveness). An optional Claude-API scoring sublayer is
   reserved as a `lib/empty-legs/matching-ai.ts` stub that PR
   2e leaves un-imported; flipping it on requires a separate
   spec + PR (Phase 7.x or Phase 8) and is gated by
   `ENABLE_EMPTY_LEGS_AI_SCORING` env flag.
6. **Notifications — WhatsApp link only in Phase 7
   (Codex iteration-2 P1 #2 fix: email channel removed
   because `lead_inquiries.customer_email` does not exist
   and Phase 7 does not add it; manual outreach is the
   founder's escape valve), with consent + per-customer
   24h frequency cap + opt-out.**
   - **Consent storage default is `FALSE` (opt-IN model;
     Codex iteration-1 P1 #1 fix).** Column:
     `lead_inquiries.empty_legs_opt_in BOOLEAN NOT NULL
     DEFAULT FALSE`. Existing rows backfill to `FALSE` —
     historical leads predate this marketing category and
     have not consented to it, so they stay out of the
     candidate pool until they explicitly opt in. The
     `/request` form gains a single Arabic-RTL checkbox
     "أبلغوني عند توفر رحلة فارغة بسعر مخفض" that defaults
     **UNCHECKED**; submitting writes `TRUE` only when the
     customer ticks it. The reserve form on
     `/empty-legs/<leg_number>/reserve` carries the same
     unchecked checkbox so a fresh reservation can opt the
     customer in if they choose. Matching is restricted to
     `empty_legs_opt_in = TRUE` rows (acceptance #61).
   - Frequency cap: ≤ 1 notification per 24-hour rolling
     window per `lead_inquiries.id` (counted from the
     dedicated `empty_leg_notifications` table per Codex
     iteration-1 P1 #2 fix — see §7.1 §12). Codex iteration 1
     argued ≤ 3 instead of ≤ 1 as a follow-up; spec keeps
     ≤ 1 as the conservative default until Codex round 2
     pushes back explicitly.
   - Opt-out link: every WhatsApp prefilled text / wa.me
     notification body (Codex iteration-3 P2 #1 fix:
     "email + WhatsApp text" wording removed since the email
     channel was dropped in iteration-2 P1 #2) includes a
     signed opt-out URL (`/empty-legs/opt-out/<token>`) that
     the customer can click without auth. Unsubscribes flip
     `empty_legs_opt_in` to FALSE on that row.

## Scope

Phase 7 ships in 6 PRs, merged in order, each independently
reviewable. Every PR's UI surface is behind an explicit
feature flag so the merge sequence is safe even mid-rollout.

### 7.1 PR 1 — Schema reshape (DDL + ENUM extension only)

Reshape `empty_legs` to match the Phase 6.2 booking-row
nullability + snapshot pattern, extend two ENUMs, add
auction-curve + reservation-hold + customer-booking-link
columns, install audit triggers, add the consent + frequency
columns on `lead_inquiries`, add the dedicated
`empty_leg_notifications` table (P1 #2 fix from Codex
iteration 1 — see §7.1 §12 below), extend the
`bookings.source_offer_table` CHECK to accept
`'phase7_empty_leg'`. **No RPCs in this PR.** **No runtime
UI/RPC code in this PR** — only DDL + the parity-test
scaffold + CI step + the shared TS type module that the
RPC migration in PR 2a imports. (Codex iteration-1 P2 #2
fix: the prior draft said "no application code" while
listing TS type, test, and CI changes; rephrased per Codex's
prescribed wording.)

Files:

- `supabase/migrations/20260509000010_phase_7_empty_legs_reshape.sql`
  (one file — no need to split unlike Phase 6.2 PR 1's
  three-file split; ENUM `ADD VALUE` for `'cancelled'` and
  `'phase7_empty_leg'` ships in this same file because no
  `SET DEFAULT` of the new enum values appears here, so
  PostgreSQL's read-after-add restriction does not bite. If
  Codex disagrees, split into File A (ENUM ADD VALUEs) +
  File B (column work + CHECK extension + triggers) per the
  Phase 6.2 PR 1 pattern.)
- `types/database.ts` — **regenerated after the full
  PR 1 migration applies** (Codex iteration-14 P2 #1
  fix: prior wording listed only `empty_legs`,
  `lead_inquiries`, and `empty_leg_notifications` but
  PR 1 actually creates `phase7_operator_stubs`,
  `operator_empty_leg_sessions`, and
  `empty_leg_outreach_alert_status` too — later PRs
  read/write all six tables through typed Supabase
  helpers, so the regen must cover every new/changed
  table). Concretely the file gains: extended
  `EmptyLegStatusValue` (adds `'cancelled'`); extended
  `bookings.source_offer_table` literal union (adds
  `'phase7_empty_leg'`); every new `empty_legs`
  column (snapshots, Dutch-auction columns,
  reservation-hold columns, route-freeform columns,
  `customer_booking_id`, `suppress_notifications`,
  `operator_stub_id`); every new `lead_inquiries`
  column (`empty_legs_opt_in`,
  `last_empty_leg_notified_at`); row types for
  `empty_leg_notifications`, `phase7_operator_stubs`,
  `operator_empty_leg_sessions`, and
  `empty_leg_outreach_alert_status`. Run
  `npm run db:types` against production after PR 1
  migration applies; commit the regenerated file as
  part of the PR 1 diff (Codex iteration-1 P1 #2 fix
  established the typed-helper pattern; iteration-14
  P2 #1 fix completes the table coverage).
- `lib/empty-legs/types.ts` — new shared type module with
  the public Empty Leg row type used across PR 2a-e.
- `lib/empty-legs/__tests__/auction-curve.test.ts` — new tsx
  test runner asserting the deterministic Dutch-auction
  formula's outputs at fixed elapsed-pct sample points
  (0%, 25%, 50%, 75%, 100%) — a Layer-1 parity test like
  Phase 6.2's `catalog-vs-seed.test.ts`. The DDL doesn't
  ship the formula — the formula lives in TS in PR 2a's
  RPC body — but PR 1 lands the test scaffold so PR 2a's
  RPC migration arrives with the parity gate already wired.
- `package.json` — add `"test:empty-legs-curve": "tsx
  lib/empty-legs/__tests__/auction-curve.test.ts"`.
- `.github/workflows/ci.yml` — add `npm run
  test:empty-legs-curve` step. (The CI workflow is otherwise
  frozen per the standing rule; Phase 6.2 added similar test
  steps without violating it.)

The migration's 17 numbered sections (idempotent; every
constraint addition is wrapped in a `pg_constraint` DO block;
every column is `IF NOT EXISTS`; every ENUM value is
`pg_enum`-checked; every `CREATE TABLE` is `IF NOT EXISTS`;
every `CREATE INDEX` is `IF NOT EXISTS` (Codex iteration-11
P1 #2 fix); every singleton-row INSERT uses
`ON CONFLICT DO NOTHING`; every trigger uses
`CREATE OR REPLACE FUNCTION` + a `DROP TRIGGER IF EXISTS`
guard before `CREATE TRIGGER`):

1. **Relax `empty_legs.operator_id` + add stub-ownership
   column (column-only here; FK + index land in §14
   after the target table is created — Codex iteration-13
   P1 #1 fix)** — drop NOT NULL on `operator_id`; add
   `operator_name_snapshot VARCHAR(120)`,
   `operator_phone_snapshot VARCHAR(20)`,
   `operator_email_snapshot VARCHAR(120)` columns;
   **add `operator_stub_id UUID` (NULLABLE, no FK
   here)** so the column exists before any later
   section needs to reference it. The FK constraint to
   `phase7_operator_stubs(id)` and the partial index
   are added in §14 — see "FK + index wiring" below —
   because PostgreSQL cannot create an FK to a
   relation that does not exist yet, and
   `phase7_operator_stubs` is not created until §14.
   Mirror Phase 6.2 PR 1 §2 for the snapshot pattern;
   the new `operator_stub_id` is Phase-7-specific and
   has no Phase 6.2 analog.

   The two ownership columns coexist:
   - `operator_id UUID NULL REFERENCES operators(id)`
     — reserved for Phase 8's real-operator FK; stays
     `NULL` throughout Phase 7.
   - `operator_stub_id UUID NULL` (FK + index added in
     §14) — Phase 7 ownership key. Set by
     `operatorPublishEmptyLeg` from the session's
     `operator_stub_id` (after three-layer token
     validation). Admin-created legs may leave it
     `NULL` (admin owns the leg directly) or set it
     to a known stub if the admin is publishing on
     behalf of an operator. The operator portal's
     read/edit/cancel actions filter
     `WHERE operator_stub_id = :session_stub_id` —
     legs from other stubs are invisible and
     uneditable from this session, returning the
     opaque `'invalid_session'` or
     `'leg_not_found'` error.
2. **Relax `empty_legs.aircraft_id`** — drop NOT NULL; add
   `aircraft_snapshot TEXT`. Mirror Phase 6.2 PR 1 §3.
3. **Relax `empty_legs.departure_airport` and
   `empty_legs.arrival_airport` to nullable + add
   freeform airport-fallback columns** (Codex
   iteration-10 P1 #2 fix: prior wording added the
   freeform columns + presence CHECKs but did NOT drop
   `NOT NULL` from the existing IATA columns. Schema
   reality `empty_legs` has both as
   `VARCHAR(10) NOT NULL REFERENCES airports(iata_code)`
   from the initial schema — freeform-only publish
   inputs and the Probe 4b throwaway fixture would
   fail before the new presence CHECKs ever ran):
   - `ALTER TABLE empty_legs ALTER COLUMN
     departure_airport DROP NOT NULL`
   - `ALTER TABLE empty_legs ALTER COLUMN
     arrival_airport DROP NOT NULL`
   - Add columns:
     `departure_airport_freeform_snapshot VARCHAR(120)`,
     `arrival_airport_freeform_snapshot VARCHAR(120)`.
   - Add route-presence CHECKs identical in shape to
     `bookings_route_origin_present_check` /
     `bookings_route_destination_present_check`: at
     least one of (iata, freeform) per side is
     non-NULL.

   The IATA FKs (`REFERENCES airports(iata_code)`) stay
   in place — when the IATA column IS populated, it
   must still resolve to a real airport. Mirrors
   Phase 6.2 PR 1's `bookings.route_*` route-snapshot
   relaxation per the same pattern.
4. **Add `empty_leg_status` ENUM value `'cancelled'`**.
   `pg_enum`-guarded.
5. **Extend `bookings.source_offer_table` CHECK** to include
   `'phase7_empty_leg'`. Drop-and-recreate the constraint
   (idempotent re-create; the previous Phase 6.2 PR 1
   shipped it as `bookings_source_offer_check`).
6. **Reservation-hold columns on `empty_legs`**:
   - `reservation_token_hash VARCHAR(64)` (sha256 hex)
   - `reservation_expires_at TIMESTAMPTZ`
   - `reservation_customer_name_snapshot VARCHAR(120)`
   - `reservation_customer_phone_snapshot VARCHAR(20)`
   Plus a paired CHECK
   `empty_legs_reservation_pair_check`: all four columns are
   NULL or all four are non-NULL — no half-state. Mirror
   Phase 6.2 PR 1 §6's checkout-token-pair-check pattern.
7. **Customer-booking link** — `customer_booking_id UUID
   REFERENCES bookings(id) ON DELETE SET NULL`. Set when
   `confirm_empty_leg_reservation` flips `status` to `'sold'`.
8. **Dutch auction columns**:
   - `auction_initial_discount_pct DECIMAL(4,2) NOT NULL
     DEFAULT 40 CHECK (>= 10 AND <= 50)`
   - `auction_floor_discount_pct DECIMAL(4,2) NOT NULL
     DEFAULT 70 CHECK (>= 50 AND <= 90)`
   - Plus a CHECK `empty_legs_auction_bounds_check`:
     `auction_floor_discount_pct >= auction_initial_discount_pct`
     (the floor must be a deeper discount than the start, by
     definition of an auction-down curve).
   - `auction_curve VARCHAR(20) NOT NULL DEFAULT 'accelerating'`
     with CHECK `IN ('linear', 'accelerating')`.
   - `auction_window_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
     (defaults to row insertion time, but RPCs may pass
     explicit values).
   - `auction_window_end_at TIMESTAMPTZ NOT NULL` (no default;
     RPC always computes it from `departure_window_start`
     minus a configurable lead-time. Migration adds the column
     `NOT NULL` only AFTER backfilling existing rows; since
     `empty_legs` is empty in production, the backfill is a
     no-op and the constraint can land NOT NULL directly. If
     production turns out to have rows, abort PR 1 and split
     this column add into a nullable add + backfill +
     SET NOT NULL across two migrations.)
   - `last_price_drop_at TIMESTAMPTZ` (NULL until first tick).
   - Plus a CHECK
     `empty_legs_auction_window_order_check`:
     `auction_window_end_at > auction_window_start_at`.
9. **`lead_inquiries` consent + frequency columns** (Codex
   iteration-1 P1 #1 fix: default flipped from `TRUE` to
   `FALSE`):
   - `empty_legs_opt_in BOOLEAN NOT NULL DEFAULT FALSE`.
     Existing rows backfill to `FALSE` automatically (the
     `ADD COLUMN ... DEFAULT FALSE` rewrite uses the column
     default for every existing row in PostgreSQL ≥ 11).
     Historical leads stay out of the candidate pool until
     they re-engage and explicitly opt in via the `/request`
     form's now-unchecked checkbox or the reserve form on
     `/empty-legs/<leg_number>/reserve`.
   - `last_empty_leg_notified_at TIMESTAMPTZ NULL`.
   - Index `idx_lead_inquiries_empty_legs_eligible` partial
     `WHERE empty_legs_opt_in = TRUE` on `customer_phone` to
     accelerate the matching engine's candidate-pool scan.
     Partial index excludes the (large, opt-FALSE) majority
     of historical rows.
10. **`audit_logs` trigger on `empty_legs`** — fires AFTER
    UPDATE on `current_price`, `current_discount_pct`,
    `status`, `reservation_token_hash`. Writes
    `(operation, table_name='empty_legs', row_id, before, after)`.
    Idempotent function definition (`CREATE OR REPLACE`).
11. **`empty_legs.suppress_notifications` column** (Codex
    iteration-7 P1 #3 fix) — Add
    `suppress_notifications BOOLEAN NOT NULL DEFAULT FALSE`
    to `empty_legs`. Per Codex's prescribed third option
    ("add a real `internal_only/suppress_notifications`
    marker that the matcher always excludes"), this
    column lets the founder publish canary / internal-
    test legs that the matching engine SHALL exclude
    from candidate notification regardless of flag
    state. The matching engine's leg-eligibility check
    in `lib/empty-legs/matching.ts` adds
    `WHERE suppress_notifications = FALSE` to the legs
    it considers. The admin publish form in PR 2b adds
    a checkbox "رحلة اختبار داخلية — لا ترسل تنبيهات"
    that defaults UNCHECKED on the production publish
    flow but is CHECKED on the canary's test-leg
    publishes. The column is also a soft override the
    founder can flip on a regular leg if a notification
    cycle needs to be skipped for ops reasons.

    The column avoids the canary's "test-leg outbox
    backlog drains real customer notifications after
    flag flip" failure mode (Codex iteration-7 P1 #3
    finding): even after both flags flip and the
    backlog drains, the matcher excludes the
    suppress_notifications=TRUE legs entirely — no
    audit row, no wa.me URL, no founder batch entry.
12. **Re-create the existing RLS policy** —
    `empty_legs_public_available` is from initial schema and
    permits anon SELECT only when `status='available'`. Phase
    7 keeps that posture but the new `'cancelled'` value is
    automatically excluded (it's neither `'available'` nor
    matches the operator-by-`auth.uid` clause). No policy
    change needed; section is a no-op assertion to make the
    review explicit.
13. **`empty_leg_notifications` dedicated table** (Codex
    iteration-1 P1 #2 fix). The initial-schema
    `notifications` table is keyed on `user_id NOT NULL
    REFERENCES users(id)` and is unusable for guest
    recipients. Phase 7's matching engine notifies
    `lead_inquiries` rows (no `users.id` linkage), so PR 1
    creates a dedicated audit table:

    ```sql
    CREATE TABLE IF NOT EXISTS empty_leg_notifications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      lead_inquiry_id UUID NOT NULL
        REFERENCES lead_inquiries(id) ON DELETE CASCADE,
      leg_id UUID NOT NULL
        REFERENCES empty_legs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (
        event_type IN ('published', 'price_dropped')
      ),
      channel TEXT NOT NULL CHECK (
        channel IN ('whatsapp_link')
      ),  -- Codex iteration-2 P1 #2 fix: 'email' removed
          -- because lead_inquiries.customer_email does not
          -- exist; Phase 7 ships WhatsApp-link only.
      wa_url TEXT NOT NULL,
        -- The full pre-filled wa.me URL the matching engine
        -- generated. Stored so the admin outreach queue can
        -- render a click-through link without re-deriving
        -- the URL from leg + lead_inquiry data. Codex
        -- iteration-4 P1 #1 fix.
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- When the matching engine WROTE this row.
      outreach_sent_at TIMESTAMPTZ,
        -- When the founder confirmed they DISPATCHED the
        -- WhatsApp message to the customer (via WhatsApp
        -- Business or another out-of-band channel) and
        -- clicked "تم الإرسال" on the admin outreach queue.
        -- NULL = pending outreach; non-NULL = dispatched.
        -- Codex iteration-4 P1 #1 fix: prior draft only
        -- wrote audit rows; this column makes the queue
        -- inbox/outbox state explicit.
      external_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_empty_leg_notifications_lead_24h
      ON empty_leg_notifications(lead_inquiry_id, sent_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_empty_leg_notifications_lead_leg_unique
      ON empty_leg_notifications(lead_inquiry_id, leg_id);
        -- Codex iteration-5 P2 #1 fix: was a non-unique
        -- index whose name implied uniqueness. Phase 7's
        -- per-leg dedupe contract is "a candidate is
        -- never notified about the same leg twice" — the
        -- DB-side guarantee belongs here as a UNIQUE
        -- constraint, not just an application-level
        -- EXISTS check that a retry/race could slip past.
        -- A retry that races the dedupe SELECT now hits
        -- a `unique_violation` PG error; the matching
        -- engine catches that error and treats it as
        -- a successful skip (the row already exists).
    CREATE INDEX IF NOT EXISTS idx_empty_leg_notifications_outreach_pending
      ON empty_leg_notifications(sent_at DESC)
      WHERE outreach_sent_at IS NULL;
        -- Backs the admin outreach queue's "pending"
        -- listing; partial index keeps it tiny because
        -- dispatched rows drop out (Codex iteration-4
        -- P1 #1 fix).

    ALTER TABLE empty_leg_notifications ENABLE ROW LEVEL SECURITY;
    -- No policies: service-role-only access (anon + authenticated
    -- get nothing; matches the audit-log posture of PR 1 §10).
    ```

    The three indexes back the frequency-cap reads
    (`lead_inquiry_id` + 24h-sliding window via `sent_at
    DESC`), the per-leg-dedupe reads (`lead_inquiry_id +
    leg_id` lookup), and the admin outreach queue's
    pending-rows listing (`sent_at DESC` partial on
    `outreach_sent_at IS NULL`). PR 2e's `frequency-cap.ts`
    reads from this table; PR 2b's outreach queue page
    reads + writes the `outreach_sent_at` column; the
    previously-spec'd `notifications`-table write is
    removed entirely from Phase 7 scope.
14. **`phase7_operator_stubs` table** (Codex iteration-11
    P1 #1 fix). Schema reality says the initial-schema
    `operators` table requires `user_id NOT NULL
    REFERENCES users(id)`, `company_name`,
    `commercial_registration`, `gaca_license`,
    `license_expiry` — none of which Phase 7's lightweight
    "admin mints a session for a known operator" model
    can populate without a full operator-onboarding flow
    (Phase 8 territory). Iteration-10 P1 #3 wired a
    bootstrap surface that INSERTed into `operators`
    with `id, name, contact_email, contact_phone, status`
    — but `name` doesn't exist on `operators` (the column
    is `company_name`) and the four NOT NULL fields above
    were missing entirely; the INSERT would fail. Per
    Codex's prescribed second option ("add a dedicated
    Phase 7 operator-stub table instead of inserting into
    `operators`"), PR 1 ships a Phase-7-scoped stub:

    ```sql
    CREATE TABLE IF NOT EXISTS phase7_operator_stubs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_name VARCHAR(200) NOT NULL,
      contact_email VARCHAR(255) NOT NULL,
      contact_phone VARCHAR(20) NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_phase7_operator_stubs_active
      ON phase7_operator_stubs(created_at DESC)
      WHERE status = 'active';

    ALTER TABLE phase7_operator_stubs
      ENABLE ROW LEVEL SECURITY;
    -- No policies: service-role-only access. The admin
    -- bootstrap form + the session-mint dropdown both
    -- read/write via the admin Supabase client.
    ```

    Schema notes:
    - Column names mirror the real `operators` table
      (`company_name`, `contact_email`, `contact_phone`,
      `status`) so the migration to real operators in
      Phase 8 is a SQL-level rename + linkage instead of
      a column-name remapping. Optional `notes` column
      lets the founder leave free-text context per stub
      (e.g. "WhatsApp +966...").
    - The status `CHECK` permits `'active'` (the
      default; eligible for session mint) or
      `'archived'` (no longer eligible — soft delete
      without losing audit history).
    - Partial index `(created_at DESC) WHERE status =
      'active'` backs the admin listing in PR 2c's
      bootstrap page.
    - `operators` table itself is **untouched** by
      Phase 7. Phase 8's operator-account onboarding
      flow will create real `operators` rows + (when
      ready) migrate session FK targets from
      `phase7_operator_stubs(id)` to `operators(id)` in
      a one-shot lookup table.

    **FK + index wiring for `empty_legs.operator_stub_id`**
    (Codex iteration-13 P1 #1 fix: the column was added
    in §1 without an FK because PostgreSQL cannot
    reference a relation that does not exist yet. Now
    that `phase7_operator_stubs` is created above, this
    sub-block adds the FK constraint + the partial index
    in idempotent DO blocks):

    ```sql
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'empty_legs_operator_stub_fk'
          AND conrelid = 'empty_legs'::regclass
      ) THEN
        EXECUTE $sql$
          ALTER TABLE empty_legs
            ADD CONSTRAINT empty_legs_operator_stub_fk
            FOREIGN KEY (operator_stub_id)
            REFERENCES phase7_operator_stubs(id)
            ON DELETE SET NULL
        $sql$;
      END IF;
    END$$;

    CREATE INDEX IF NOT EXISTS idx_empty_legs_operator_stub
      ON empty_legs(operator_stub_id, status)
      WHERE operator_stub_id IS NOT NULL;
    ```

    The DO block is the same pattern Phase 6.2 PR 1
    used for cross-table CHECK / FK additions (every
    `pg_constraint` lookup keyed on `conname`). Re-runs
    of the migration are no-ops; the partial index
    uses `IF NOT EXISTS` per the standing PR 1
    idempotency rule.
15. **`operator_empty_leg_sessions` table** (Codex
    iteration-2 P1 #3 fix; iteration-11 P1 #1 fix
    re-points the FK from `operators(id)` to
    `phase7_operator_stubs(id)`). The prior draft put
    the storage decision behind §7.4 PR 2c's open
    question §1 but assigned no DDL owner — neither
    PR 1 nor PR 2c had a migration to create it, so
    the operator portal would ship with no place to
    persist or revoke session hashes. Per Codex's
    prescribed fix ("assign the required DDL to PR 1
    or PR 2c"), the storage decision is **resolved here
    in PR 1 in favor of the dedicated table** (the
    spec's iteration-1 default), and the DDL ships in
    this same PR 1 migration:

    ```sql
    CREATE TABLE IF NOT EXISTS operator_empty_leg_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      operator_stub_id UUID NOT NULL
        REFERENCES phase7_operator_stubs(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Codex iteration-12 P1 #2 fix: column named
    -- `operator_stub_id` (not `operator_id`) so the
    -- name matches its FK target — the Phase-7 stub
    -- table, NOT the real `operators` table. Phase 8's
    -- onboarding flow will introduce a separate
    -- `operator_id` column when it lands real
    -- `operators(id)` references.

    CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_empty_leg_sessions_hash
      ON operator_empty_leg_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_operator_empty_leg_sessions_stub
      ON operator_empty_leg_sessions(operator_stub_id, expires_at DESC)
      WHERE revoked_at IS NULL;
    -- Index name renamed from
    -- `idx_operator_empty_leg_sessions_operator` to
    -- `_stub` per Codex iteration-12 P1 #2 fix.

    ALTER TABLE operator_empty_leg_sessions
      ENABLE ROW LEVEL SECURITY;
    -- No policies: service-role-only access. The admin
    -- mint/revoke surface and the operator-action token
    -- validation both run server-side with the admin
    -- Supabase client. anon + authenticated get nothing.
    ```

    Schema notes:
    - `operator_stub_id` is the FK target into
      `phase7_operator_stubs(id)` (Codex iteration-11
      P1 #1 fix; iteration-12 P1 #2 fix renamed from
      `operator_id` so the name matches the FK target
      and prevents accidental joins against the real
      `operators` table). One stub can have multiple
      non-revoked sessions concurrently (operator on
      phone + laptop), per Open Question §1's
      iteration-1 default.
    - `token_hash` is the SHA-256 of the raw HMAC token
      minted by `lib/operator/empty-leg-session-token.ts`
      (PR 2c). Unique-indexed for the layer-2 validation
      lookup (the layer-2 check is `SELECT 1 FROM
      operator_empty_leg_sessions WHERE token_hash = X
      AND expires_at > NOW() AND revoked_at IS NULL`).
    - `revoked_at` supports soft revoke from the admin
      "list operator sessions" page; a revoked row stays
      for audit but no longer authorizes actions.
    - The partial index on
      `(operator_stub_id, expires_at DESC) WHERE
      revoked_at IS NULL` accelerates the admin "active
      sessions for stub X" listing.

    Open Question §1 is now resolved by Codex iteration-2
    P1 #3 fix and removed from the open list.
16. **`empty_leg_outreach_alert_status` singleton table**
    (Codex iteration-5 P2 #2 fix). The founder batch
    email path needs a known-good row to UPDATE on every
    send attempt so the admin outreach queue page can
    render a red "config missing / sends failing" banner
    instead of silently letting the founder miss
    pending dispatches. Singleton constraint: `id INT`
    + `CHECK (id = 1)` so the application can
    `UPSERT` into a stable row.

    ```sql
    CREATE TABLE IF NOT EXISTS empty_leg_outreach_alert_status (
      id INT PRIMARY KEY DEFAULT 1
        CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'healthy'
        CHECK (status IN (
          'healthy', 'config_missing', 'send_failed'
        )),
      last_failure_at TIMESTAMPTZ,
      last_failure_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO empty_leg_outreach_alert_status
      (id, status) VALUES (1, 'healthy')
      ON CONFLICT (id) DO NOTHING;

    ALTER TABLE empty_leg_outreach_alert_status
      ENABLE ROW LEVEL SECURITY;
    -- No policies: service-role-only access (matches the
    -- empty_leg_notifications + audit_logs posture).
    ```

    The application contract:
    - On every successful Resend send, UPDATE to
      `status = 'healthy', last_failure_at = NULL,
      last_failure_reason = NULL, updated_at = NOW()`.
    - On missing `RESEND_API_KEY` or unresolved batch
      recipient, UPDATE to
      `status = 'config_missing', last_failure_at =
      NOW(), last_failure_reason = '<which env is
      missing>', updated_at = NOW()`.
    - On Resend API send failure (4xx/5xx), UPDATE to
      `status = 'send_failed', last_failure_at = NOW(),
      last_failure_reason = '<error code or message
      excerpt, max 500 chars>'`.

    PR 2b's outreach queue page reads this singleton on
    every render and renders a banner when
    `status <> 'healthy'`.
17. **`empty_leg_notifications` AFTER INSERT trigger
    that updates `lead_inquiries.last_empty_leg_notified_at`
    to the inserted row's `NEW.sent_at`**
    (Codex iteration-7 P1 #2 fix; iteration-9 P2 #2
    wording fix: prior prose said "to NOW()" while the
    SQL body assigned `NEW.sent_at` — `NEW.sent_at` is
    the correct source because it tracks the
    notification row's own timestamp exactly, but the
    prose + acceptance + probes must say so
    consistently so smoke-tests do not assert against
    `now()` and trip on a tiny time mismatch). The
    prior draft's candidate-pool query filtered by
    `lead_inquiries.last_empty_leg_notified_at` but no
    write path actually updated that column — the
    24-hour cap could only be enforced via the separate
    `empty_leg_notifications.sent_at` read in
    `frequency-cap.ts`, leaving a window where one
    candidate could be selected for multiple legs in
    24 hours if the application-level frequency-cap
    check was bypassed. Per Codex's iteration-7
    prescribed first option ("update
    `last_empty_leg_notified_at` atomically with the
    queue insert"), PR 1 ships a DB trigger that does
    this atomically without burdening every caller:

    ```sql
    CREATE OR REPLACE FUNCTION _update_lead_inquiry_last_notified()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      UPDATE lead_inquiries
        SET last_empty_leg_notified_at = NEW.sent_at
        WHERE id = NEW.lead_inquiry_id;
      RETURN NULL;  -- AFTER trigger; return value ignored.
    END;
    $$;

    REVOKE ALL ON FUNCTION _update_lead_inquiry_last_notified()
      FROM PUBLIC, anon, authenticated, service_role;

    DROP TRIGGER IF EXISTS empty_leg_notifications_update_last_notified
      ON empty_leg_notifications;
    CREATE TRIGGER empty_leg_notifications_update_last_notified
      AFTER INSERT ON empty_leg_notifications
      FOR EACH ROW
      EXECUTE FUNCTION _update_lead_inquiry_last_notified();
    ```

    Atomicity comes from PostgreSQL: the trigger fires
    inside the same transaction as the
    `empty_leg_notifications` INSERT — the row never
    becomes visible without
    `lead_inquiries.last_empty_leg_notified_at` being
    updated. The matching engine no longer needs a
    separate UPDATE call; acceptance #67's "After
    matching engine completes for a leg, every notified
    `lead_inquiries` row's `last_empty_leg_notified_at`
    is updated to the inserted row's `sent_at`" is now
    satisfied by the trigger, not by application code.
    (Iteration-9 P2 #2 wording fix: text harmonized to
    `NEW.sent_at` instead of `NOW()` so probes assert
    against the same timestamp the SQL writes; the two
    values are normally identical because
    `empty_leg_notifications.sent_at` defaults to
    `NOW()` on INSERT, but `NEW.sent_at` is the
    contract because it makes the smoke-test assertion
    deterministic.)

    The function is REVOKEd from every role including
    service_role to mirror the
    `_recompute_booking_totals` pattern from Phase 6.2
    (the trigger context runs as the function-owner
    role; direct `rpc()` calls return permission-denied).

**11 SECURITY DEFINER public functions + 1 internal helper**
(Codex iteration-3 P2 #3 fix updated the count from
"10 publics + 1 helper" to reflect the iteration-3 addition
of `admin_release_empty_leg_reservation`. PR 2e then adds a
12th public — `expire_empty_leg_window` — in its own
migration; that one is owned by PR 2e per §7.6.) Mirror
Phase 6.2 PR 2a's `_recompute_booking_totals` pattern
exactly (REVOKE from every role including service_role for
the helper; service-role-only EXECUTE on every public).

Files:

- `supabase/migrations/20260510000011_phase_7_empty_legs_rpcs.sql`
  (single file)
- `lib/empty-legs/auction-curve.ts` — TypeScript implementation
  of the Dutch-auction formula. The plpgsql RPC `_recompute_empty_leg_price`
  ports the same formula in SQL; the TS module is what the
  parity test (`auction-curve.test.ts`) exercises. Drift is
  a Codex-blocking finding, same posture as the
  `addon_catalog`-vs-`lib/addons/catalog.ts` parity rule from
  Phase 6.2.

The 11 publics + 1 helper (PR 2a):

| # | Function | Section | Caller |
|:-:|---|---|---|
| 1 | `_recompute_empty_leg_price` (helper) | §7.2.1 | internal only — REVOKEd from every role |
| 2 | `publish_empty_leg` | §7.2.2 | admin Server Action + operator Server Action |
| 3 | `update_empty_leg_price` | §7.2.3 | admin + operator Server Actions |
| 4 | `reserve_empty_leg` | §7.2.4 | public marketplace `reserveEmptyLeg` |
| 5 | `confirm_empty_leg_reservation` | §7.2.5 | admin "confirm reservation" Server Action |
| 6 | `release_empty_leg_reservation` | §7.2.6 | public `cancelMyReservation` Server Action |
| 7 | `admin_release_empty_leg_reservation` | §7.2.7 | admin "إلغاء التحفظ" button (Codex iteration-3 P1 #2 fix) |
| 8 | `cancel_empty_leg` | §7.2.8 | admin + operator cancel Server Actions |
| 9 | `expire_empty_leg_reservation` | §7.2.9 | cron route `/api/cron/empty-legs/expire-reservations` |
| 10 | `tick_empty_leg_dutch_auction` | §7.2.10 | cron route `/api/cron/empty-legs/dutch-auction-tick` |
| 11 | `admin_mark_empty_leg_sold` | §7.2.11 | admin `adminMarkSoldManual` Server Action |
| 12 | `publish_empty_leg_event` | §7.2.12 | called by `publish_empty_leg` + `tick_*` (PR 2a stub; PR 2e replaces body) |

PR 2e adds one further public function (`expire_empty_leg_window`)
in its own migration — see §7.6's expire-windows cron file
for grants/probes for that 12th public.

#### 7.2.1 `_recompute_empty_leg_price(p_leg_id UUID)` — internal helper

REVOKEd from PUBLIC + anon + authenticated + service_role.
Caller MUST hold a row lock on `empty_legs(p_leg_id)` first.

Body:

1. SELECT `auction_initial_discount_pct`,
   `auction_floor_discount_pct`, `auction_curve`,
   `auction_window_start_at`, `auction_window_end_at`,
   `original_price`, `status` from `empty_legs(p_leg_id)`.
2. If `status <> 'available'`, return early (no price changes
   on `reserved` / `sold` / `expired` / `cancelled` rows).
3. If `NOW() <= auction_window_start_at`, leave price untouched
   (auction hasn't opened).
4. If `NOW() >= auction_window_end_at`, set
   `current_discount_pct = auction_floor_discount_pct`;
   `current_price = original_price * (1 - floor/100)`; UPDATE.
5. Otherwise compute `elapsed = (NOW() − start) / (end − start)`
   clamped to `[0, 1]`. For curve `'linear'`,
   `pct = initial + (floor − initial) × elapsed`. For curve
   `'accelerating'`,
   `pct = floor + (initial − floor) × (1 − elapsed)^2`
   (i.e. `floor − (floor − initial) × (1 − elapsed)^2` —
   verify both forms produce the same monotone-increasing
   discount; Codex iteration 1 should sanity-check the algebra).
6. UPDATE `current_discount_pct = pct`,
   `current_price = original_price * (1 − pct/100)`,
   `last_price_drop_at = NOW()` if the new pct strictly
   exceeds the old pct (skip the timestamp update on no-op
   ticks so the audit-log trigger doesn't fire trivially).

#### 7.2.2 `publish_empty_leg(...)` — admin OR operator publishes

Accepts: `operator_id UUID NULLABLE` (admin-driven publishes
may pass NULL → snapshot only),
`operator_stub_id UUID NULLABLE` (Codex iteration-12 P1 #1
fix: Phase 7 ownership key — `operatorPublishEmptyLeg`
Server Action passes the session's stub id; admin Server
Action passes NULL or a known stub id),
`operator_name TEXT`, `operator_phone TEXT`,
`operator_email TEXT`,
`aircraft_id UUID NULLABLE`, `aircraft_text TEXT`,
`parent_booking_id UUID NULLABLE`,
`departure_airport_iata TEXT NULLABLE`,
`departure_airport_freeform TEXT NULLABLE`,
`arrival_airport_iata TEXT NULLABLE`,
`arrival_airport_freeform TEXT NULLABLE`,
`departure_window_start TIMESTAMPTZ`,
`departure_window_end TIMESTAMPTZ`,
`flexibility_hours INT DEFAULT 3`,
`original_price DECIMAL(12,2)`, `max_passengers INT`,
`auction_initial_discount_pct DECIMAL DEFAULT 40`,
`auction_floor_discount_pct DECIMAL DEFAULT 70`,
`auction_curve TEXT DEFAULT 'accelerating'`,
`auction_window_lead_hours INT DEFAULT 6` (subtracted from
`departure_window_start` to compute `auction_window_end_at`).
Returns JSON `{ ok, leg_id, leg_number, current_price }`.

Validations (all return structured errors, none raise):

- At least one of `(departure_airport_iata,
  departure_airport_freeform)` is non-empty (mirror PR 1
  CHECK at the RPC layer for friendlier errors).
- Same for arrival side.
- `departure_window_end > departure_window_start`.
- `original_price > 0`, `max_passengers BETWEEN 1 AND 19`.
- `auction_initial_discount_pct < auction_floor_discount_pct`.
- `auction_window_end_at > NOW()` (rejects publishing a leg
  whose auction window already closed — the founder must
  push `departure_window_start` forward or shorten
  `auction_window_lead_hours`).

INSERTs the row with `status = 'available'`, computes
`current_discount_pct = auction_initial_discount_pct`,
`current_price = original_price × (1 − initial/100)`. Calls
`_recompute_empty_leg_price` defensively (no-op at insertion
time but symmetric with the rest of the family).

After INSERT, **PR 2a calls a publish-event hook stub**
(`PERFORM publish_empty_leg_event(v_leg_id, 'published')`) — the
event hook is defined as an empty SECURITY DEFINER function in
this same migration so PR 2a is independently complete.
PR 2e re-creates the function body to fan out to the matching
engine. This pattern keeps PR 2a green on its own without
needing PR 2e merged.

#### 7.2.3 `update_empty_leg_price(p_leg_id, p_new_price)` — admin/operator manual reprice

Locks the leg row, validates `status = 'available'`, validates
the new price is between `original_price × (1 − floor/100)`
(the deepest possible discount the auction would ever reach)
and `original_price` (no markup above the original). Flips
`current_price = p_new_price`, recomputes
`current_discount_pct` from `p_new_price` against
`original_price`, sets `last_price_drop_at = NOW()` if the new
price is strictly less than the old. Calls
`PERFORM publish_empty_leg_event(p_leg_id, 'price_dropped')`
on price decrease (NOT on price stay-or-rise — frequency cap
defense in depth: a manual-reprice that doesn't drop the price
must not re-fire matching).

#### 7.2.4 `reserve_empty_leg(p_leg_id, p_token_hash, p_expires_at, p_customer_name, p_customer_phone)` — public reserve

Called by the public marketplace's reserve Server Action after
the customer fills the form. The reservation token itself is
HMAC-signed and minted application-side (`lib/empty-legs/reservation-token.ts`);
the RPC receives only the sha256 hash + expiry (mirror Phase
6.2's `bookings.checkout_token_hash` pattern — DB never sees
the raw token).

Body:

1. Lock the leg row.
2. Reject if `status <> 'available'` →
   `leg_not_available`.
3. Reject if the leg's `auction_window_end_at <= NOW()` →
   `leg_window_closed`.
4. Set `status = 'reserved'`,
   `reservation_token_hash = p_token_hash`,
   `reservation_expires_at = p_expires_at`,
   `reservation_customer_name_snapshot = p_customer_name`,
   `reservation_customer_phone_snapshot = p_customer_phone`.
5. Does NOT touch `views_count`. The column exists from the
   initial schema but **Phase 7 leaves it unused** (Codex
   iteration-2 P2 #2 fix: prior draft deferred a dangling
   `increment_empty_leg_views` RPC to PR 2d but never scoped
   the function/action/test/probe; the simpler resolution is
   to drop view-count mutation from Phase 7 entirely. The
   column stays at `DEFAULT 0` and is available for a future
   phase if/when view tracking becomes a product need.).

Returns `{ ok, leg_id, reservation_expires_at }`.

#### 7.2.5 `confirm_empty_leg_reservation(p_leg_id, p_token_hash)` — admin confirms

Called by admin after the WhatsApp coordination call confirms
the reservation. Cannot be called by the customer — admin-
only (the customer confirms intent verbally; founder converts
to a booking). The action handler enforces admin auth before
calling this RPC.

Body:

1. Lock the leg row.
2. Reject if `status <> 'reserved'` →
   `leg_not_reserved`.
3. Reject if `reservation_expires_at <= NOW()` →
   `reservation_expired` (defense in depth; the cron
   `expire_empty_leg_reservation` should have flipped
   `status` back to `'available'` already, but the race-
   case check here is defensive).
4. Reject if `reservation_token_hash <> p_token_hash` →
   `reservation_token_mismatch` (a fresh reservation on
   this leg would have overwritten the hash — defense
   against admin confirming a stale reservation).
5. INSERT a `bookings` row with the same column shape as
   `accept_offer`'s step 9 — the snapshot fields come from
   the leg row instead of an offer row. Specifically:
   `client_id = NULL`,
   `customer_name_snapshot = reservation_customer_name_snapshot`,
   `customer_phone_snapshot = reservation_customer_phone_snapshot`,
   `operator_id = empty_legs.operator_id` (may be NULL),
   `operator_name_snapshot = empty_legs.operator_name_snapshot`,
   `operator_phone_snapshot = empty_legs.operator_phone_snapshot`,
   `operator_email_snapshot = empty_legs.operator_email_snapshot`,
   `aircraft_id = empty_legs.aircraft_id` (may be NULL),
   `aircraft_snapshot = empty_legs.aircraft_snapshot`,
   `route_origin_iata = empty_legs.departure_airport`,
   `route_destination_iata = empty_legs.arrival_airport`,
   `route_origin_freeform_snapshot = empty_legs.departure_airport_freeform_snapshot`,
   `route_destination_freeform_snapshot = empty_legs.arrival_airport_freeform_snapshot`,
   `passengers_count_snapshot = empty_legs.max_passengers` (the
   reservation form does NOT capture passenger count separately
   — Phase 7 treats max_passengers as the booked count; the
   admin can adjust later via a future trip-edit flow,
   explicitly out of Phase 7 scope),
   `return_scheduled = NULL` (Empty Legs are one-way by
   definition; round-trip empties are out of scope),
   `source_offer_table = 'phase7_empty_leg'`,
   `source_offer_id = empty_legs.id` (re-used as discriminator
   target — the existing CHECK only constrains
   `source_offer_table`, not the FK semantics),
   `base_amount = current_price`,
   `addons_amount = 0`,
   `total_amount = current_price`,
   `vat_amount = NULL`, `commission_amount = NULL`,
   `operator_payout = NULL` (Phase 11 territory),
   `payment_status = 'pending_offline'` (default),
   `flight_status = 'confirmed'`,
   `departure_scheduled = empty_legs.departure_window_start`,
   `trip_request_id = NULL` (Empty Legs are not customer-
   asked trips), `checkout_token_hash = NULL`,
   `checkout_token_expires_at = NULL`.

   **PR 1 §3 introduced the route-presence CHECKs** —
   `bookings_route_origin_present_check` and
   `bookings_route_destination_present_check`. With
   `trip_request_id = NULL`, those checks pass vacuously.
   But the booking row still has at least one of (iata,
   freeform) per side from the leg's snapshot, so an extra
   defensive presence assertion at the RPC layer (raise on
   both NULL) is warranted — friendlier error than the
   raw constraint violation.
6. UPDATE the `empty_legs` row:
   `status = 'sold'`,
   `customer_booking_id = <the inserted booking id>`,
   clear `reservation_*` columns (set to NULL, satisfying
   the paired CHECK).
7. Returns `{ ok, leg_id, booking_id }`.

#### 7.2.6 `release_empty_leg_reservation(p_leg_id UUID, p_token_hash VARCHAR)` — customer releases active hold

Codex iteration-1 P1 #3 fix: PR 2d's `cancelMyReservation`
Server Action had no backing RPC. This is the token-bound
release of a still-active customer hold, distinct from
`expire_empty_leg_reservation` (for already-expired holds)
and `cancel_empty_leg` (admin/operator terminal cancel of
the leg itself). Validates the reservation token's hash
matches the row's `reservation_token_hash` and clears only
the reservation fields — the leg returns to `'available'`
and remains marketable.

Body:

1. Lock the leg row.
2. Reject if `status <> 'reserved'` →
   `leg_not_reserved` (covers already-released, expired,
   sold, cancelled — same opaque error contract; the
   customer cannot tell which).
3. Reject if `reservation_token_hash <> p_token_hash` →
   `reservation_token_mismatch`. Defense against a stale
   token on a leg whose reservation was already replaced
   by a fresh one.
4. Flip `status = 'available'`; clear all four reservation
   columns (the paired CHECK forces all-NULL together).
5. PERFORM `_recompute_empty_leg_price` (the leg may have
   missed Dutch-auction ticks while held; the recompute
   snaps `current_price` back onto the curve at NOW()).
6. Returns `{ ok, leg_id }`.

Same SECURITY DEFINER + service-role-only EXECUTE posture
as the rest of the family.

#### 7.2.7 `admin_release_empty_leg_reservation(p_leg_id UUID)` — admin force-releases an active hold

Codex iteration-3 P1 #2 fix. The PR 2b admin Case-2 surface
exposes an "إلغاء التحفظ" button. The prior draft wired
that button to `expire_empty_leg_reservation`, which is a
cron-only path: it returns `{ ok: true, no_op: true }` when
`reservation_expires_at > NOW()` (i.e. on a still-active
hold). The visible admin button could not actually release
an active hold. Per Codex's prescribed fix ("a dedicated
`admin_release_empty_leg_reservation` RPC"), this is the
admin counterpart to §7.2.6's customer-side
`release_empty_leg_reservation` — same effect (clear the
reservation, flip back to `'available'`), but without the
token-hash check (admin runs as service-role and does not
hold the customer's token). `expire_empty_leg_reservation`
is reserved for cron-expired holds only.

Body:

1. Lock the leg row.
2. Reject if `status <> 'reserved'` →
   `leg_not_reserved` (covers already-released, expired,
   sold, cancelled — same opaque-error contract as the
   customer path).
3. Flip `status = 'available'`; clear all four reservation
   columns (the paired CHECK forces all-NULL together).
4. PERFORM `_recompute_empty_leg_price` (the leg may have
   missed Dutch-auction ticks while held; the recompute
   snaps `current_price` back onto the curve at NOW()).
5. Returns `{ ok, leg_id }`.

Same SECURITY DEFINER + service-role-only EXECUTE posture
as the rest of the family. Auditing of who-clicked-the-
button lives at the Server Action layer (admin auth log)
plus the audit trigger from PR 1 §10 catches the status
flip.

#### 7.2.8 `cancel_empty_leg(p_leg_id, p_reason TEXT)` — admin/operator cancel

Allowed when `status IN ('available', 'reserved')`. Rejected
on `'sold'` (admin uses a separate booking-cancellation flow,
not in Phase 7 — explicitly out of scope) or already
`'cancelled'` / `'expired'` with `leg_terminal`.

Body:

1. Lock leg row.
2. Validate status.
3. UPDATE `status = 'cancelled'`. Clear reservation columns
   if `'reserved'`. Write a row to `audit_logs` with
   `operation = 'cancel_empty_leg'` and the reason text
   (the audit trigger from PR 1 §10 catches the status flip
   automatically; the reason is appended by a manual
   `INSERT INTO audit_logs` because triggers don't see RPC
   parameters).

#### 7.2.9 `expire_empty_leg_reservation(p_leg_id)` — cron-callable ONLY

Called by the Vercel Cron route every 5 minutes for any leg
whose `status = 'reserved'` AND
`reservation_expires_at <= NOW()`. **Cron-only path** —
admin-side force-release of an active hold uses
`admin_release_empty_leg_reservation` (§7.2.7) instead;
this RPC's `reservation_expires_at > NOW()` guard returns
no-op, so wiring an admin button to it would not work.
(Codex iteration-4 P2 #3 fix: prior draft said "Could also
be called ad hoc by admin to release a stuck reservation" —
that sentence contradicted iteration-3 P1 #2 which created
a dedicated admin-release RPC; sentence removed to prevent
implementers from re-wiring admin UI to the cron path.)

Body:

1. Lock leg row.
2. If `status <> 'reserved'`, return early
   (`{ ok: true, no_op: true }`).
3. If `reservation_expires_at > NOW()`, return early
   (`{ ok: true, no_op: true }` — caller may have raced
   with a fresh reservation).
4. Flip `status = 'available'` (NOT `'expired'` — the
   reservation expiry is distinct from the auction-window
   expiry; a leg whose reservation just expired is still
   marketable until its auction window closes).
5. Clear `reservation_*` columns.
6. Call `_recompute_empty_leg_price` (price may have moved
   while the leg was held; the recompute snaps it back to
   the curve's current value).

#### 7.2.10 `tick_empty_leg_dutch_auction(p_leg_id)` — cron-callable

Called by the Vercel Cron route every 30 minutes for every
`status = 'available'` leg whose `last_price_drop_at IS NULL`
or `last_price_drop_at < NOW() − 30 minutes`. Idempotent:
re-running on the same minute returns no-op.

Body:

1. Lock leg row.
2. If `status <> 'available'`, return early.
3. Capture `current_discount_pct` BEFORE the recompute.
4. PERFORM `_recompute_empty_leg_price`.
5. Re-read the row's `current_discount_pct` AFTER.
6. If the new pct strictly exceeds the captured pct,
   PERFORM `publish_empty_leg_event(p_leg_id, 'price_dropped')`.
   Otherwise no event fires.

Returns `{ ok, leg_id, old_pct, new_pct, fired_event }`.

#### 7.2.11 `admin_mark_empty_leg_sold(p_leg_id UUID, p_customer_name TEXT, p_customer_phone TEXT)` — single-RPC manual sold path

Codex iteration-1 P1 #4 fix. The prior draft had
`adminMarkSoldManual` mint a token + call `reserve_empty_leg`
+ call `confirm_empty_leg_reservation` "in a single Server
Action transaction" — Supabase JS does not provide a
transaction across multiple `rpc()` calls, so the prior
shape was non-atomic and could leave the leg in `'reserved'`
with no booking row if the second call failed. **Per Codex's
prescribed fix: move the whole manual-sold flow into one
SECURITY DEFINER RPC.** This RPC bypasses the reservation
state entirely — admin path skips the customer-hold layer
because the founder already collected verbal commit over
WhatsApp before invoking it.

Body:

1. Lock the leg row.
2. Reject if `status <> 'available'` →
   `leg_not_available` (a leg already `'reserved'` should
   go through the regular `confirm_empty_leg_reservation`
   path; admin attempting to manual-sell a held leg gets
   a clear error instead of silently overwriting the
   reservation customer).
3. Reject if `auction_window_end_at <= NOW()` →
   `leg_window_closed`.
4. INSERT a `bookings` row using the EXACT same column list
   + value expressions as `confirm_empty_leg_reservation`'s
   step 5 (the two functions stay in lockstep — if one
   changes, both change in the same migration). The
   customer-name + customer-phone snapshots come from the
   RPC parameters instead of the leg's
   `reservation_*_snapshot` columns (which are NULL on an
   `'available'` leg).
5. UPDATE `empty_legs` row:
   `status = 'sold'`,
   `customer_booking_id = <inserted booking id>`.
6. Returns `{ ok, leg_id, booking_id }`.

Same SECURITY DEFINER + `search_path = public, pg_temp` +
service-role-only EXECUTE posture as the family. Atomic by
construction (one transaction = one RPC call); no race
window between reservation + confirm.

#### 7.2.12 `publish_empty_leg_event(p_leg_id, p_event_type)` — empty stub in PR 2a

PR 2a defines this as a no-op SECURITY DEFINER function. PR 2e's
migration `CREATE OR REPLACE`s it with the body that writes a
row to the `empty_leg_events_outbox` table (per §7.6 default —
outbox over NOTIFY because outbox survives Vercel cold starts).
PR 2a only requires the empty stub.

### 7.3 PR 2b — Admin surfaces

UI + thin Server Actions for the admin role. Behind feature
flag `ENABLE_EMPTY_LEGS_ADMIN_UI` (default `true` once PR 2a
is on production; `false` until then). Mirrors the Phase 6.2
admin add-ons surface organization.

Files (Add):

- `app/(admin)/admin/(protected)/empty-legs/page.tsx` — list
  with filter chips by status (default: `available + reserved`).
- `app/(admin)/admin/(protected)/empty-legs/[id]/page.tsx` —
  detail + actions (cancel, edit price, mark-sold-manual,
  view reservation details).
- `app/(admin)/admin/(protected)/empty-legs/new/page.tsx` —
  create form.
- `app/(admin)/admin/(protected)/empty-legs/outreach-queue/page.tsx`
  — pending wa.me URLs (admin Supabase client query
  against `empty_leg_notifications` rows where
  `outreach_sent_at IS NULL`, ordered `sent_at DESC`).
  Each row renders: candidate's `customer_name` +
  `customer_phone` (joined from `lead_inquiries`), leg's
  `leg_number` + route + current price (joined from
  `empty_legs`), the wa.me click-through link, and a
  "تم الإرسال" button that calls `markOutreachSent`
  Server Action. Rows that have been marked sent drop
  out of the listing (the partial index in PR 1 §13
  excludes them). Codex iteration-4 P1 #1 fix:
  customer-delivery surface for the wa.me URLs that
  the matching engine emits.

  **Health banner** (Codex iteration-5 P2 #2 fix): the
  page reads `empty_leg_outreach_alert_status` (PR 1
  §14) on every render. When `status <> 'healthy'`, a
  red banner renders at the top with the Arabic-RTL
  text "تنبيه: تنبيهات المؤسس معطلة — راجع إعدادات
  Resend" plus `last_failure_reason` excerpt + the
  count of pending wa.me URLs whose `sent_at < NOW() −
  INTERVAL '24 hours'` (rows the founder is missing
  alerts for). The banner makes the silent-no-op
  failure mode visible instead of letting it hide
  behind a healthy-looking queue.
- `components/admin/empty-legs/outreach-row.tsx` —
  one-row card for the queue page. Codex iteration-4
  P1 #1 fix.
- `app/actions/empty-legs.ts` — 6 admin Server Actions
  (Codex iteration-5 P2 #3 fix: count corrected from "4
  admin Server Actions" — iteration-3 P1 #2 added
  `adminReleaseReservation` and iteration-4 P1 #1 added
  `markOutreachSent`, growing the list 4 → 5 → 6):
  `adminPublishEmptyLeg`, `adminUpdatePrice`, `adminCancel`,
  `adminMarkSoldManual` (a fallback for legs sold over
  WhatsApp without going through the marketplace reserve
  flow — calls the single-RPC
  `admin_mark_empty_leg_sold(leg_id, customer_name,
  customer_phone)` from §7.2.11. Server Action is a thin
  wrapper: validate inputs with Zod, call the one RPC,
  surface the structured error / booking_id. Atomicity is
  guaranteed by the RPC's single-transaction body — the
  Server Action never wraps multiple `rpc()` calls per
  Codex iteration-1 P1 #4),
  `adminReleaseReservation` (Codex iteration-3 P1 #2 fix:
  thin wrapper around `admin_release_empty_leg_reservation`
  from §7.2.7; called by the Case-2 "إلغاء التحفظ" button
  to force-release a still-active customer hold),
  `markOutreachSent(notification_id UUID)` (Codex
  iteration-4 P1 #1 fix: thin wrapper that UPDATEs the
  `empty_leg_notifications` row's `outreach_sent_at =
  NOW()`. Called by the outreach queue page's "تم الإرسال"
  button. Idempotent — second click on an already-marked
  row is a no-op).
- `components/admin/empty-legs/list-filters.tsx`
- `components/admin/empty-legs/leg-row.tsx`
- `components/admin/empty-legs/leg-detail.tsx`
- `components/admin/empty-legs/publish-form.tsx`
- `components/admin/empty-legs/cancel-button.tsx`
- `components/admin/empty-legs/price-edit-form.tsx`
- `lib/admin/empty-legs/queries.ts` — read-side queries for
  the admin pages (admin Supabase client, no RLS surface).
- `lib/validators/empty-legs.ts` — Zod schemas for every form
  + Server Action input.
- `lib/i18n/empty-legs-ar.ts` — every Arabic-RTL string in
  one place per the Phase 6.2 i18n discipline.

Files (Edit):

- `components/layout/admin-sidebar.tsx` — add nav entries
  "الرحلات الفارغة" + "قائمة المراسلات" (the outreach
  queue, Codex iteration-4 P1 #1 fix), both gated by
  `ENABLE_EMPTY_LEGS_ADMIN_UI`.
- `app/(admin)/admin/page.tsx` — add admin-dashboard summary
  card "رحلات فارغة قيد العرض / محجوزة" with counts.
- `.env.example` — add `ENABLE_EMPTY_LEGS_ADMIN_UI`,
  `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE`,
  `ENABLE_OPERATOR_PORTAL`,
  `ENABLE_EMPTY_LEGS_AI_SCORING`,
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS` (Codex iteration-2
  P1 #2 fix: kill switch for the customer-notification
  emit step — see Rollout safety),
  `EMPTY_LEGS_OPERATOR_TOKEN_SECRET`,
  `EMPTY_LEGS_RESERVATION_TOKEN_SECRET`,
  `EMPTY_LEGS_OPT_OUT_TOKEN_SECRET`,
  `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` (Codex iteration-4
  P1 #1 fix: optional override for the founder batch
  alert email recipient; defaults to `LEAD_NOTIFICATION_TO`
  from Phase 6.0 if unset),
  `CRON_SECRET`.

Three-case admin gate (mirror Phase 6.2's 3-case addons gate):

- **Case 1** — leg `'available'`: render publish/edit/cancel
  surfaces, render Dutch-auction trajectory chart (read-only
  visualization of the curve from start to floor with
  `NOW()` marker).
- **Case 2** — leg `'reserved'`: render reservation-detail
  card with customer name + phone, "اتصل بالعميل" wa.me
  button, "تأكيد الحجز" button (calls the manual confirm
  Server Action), "إلغاء التحفظ" button (Codex iteration-3
  P1 #2 fix: this button calls a thin admin Server Action
  that invokes `admin_release_empty_leg_reservation` from
  §7.2.7 — NOT `expire_empty_leg_reservation`, which is
  cron-only and returns no-op on still-active holds).
- **Case 3** — leg `'sold'`: render the linked booking row
  reference + "فتح الحجز في لوحة الحجوزات" button (deep-
  links to the booking detail page when that page exists;
  for Phase 7 the deep link is a placeholder pointing at
  `/admin/bookings/<id>`, even though the bookings admin
  page is technically Phase 6.2 territory — verify it
  exists before shipping).

### 7.4 PR 2c — Operator self-serve portal

Token-gated session model, no operator-account flow. Behind
feature flag `ENABLE_OPERATOR_PORTAL` (default `false`).

Files (Add):

- `app/operator/empty-legs/[token]/page.tsx` — operator's
  list page, scoped to this session's stub (Codex
  iteration-12 P1 #1 fix). Reads `empty_legs WHERE
  operator_stub_id = :session_stub_id`; legs from other
  stubs (or admin-created legs with NULL stub) are NOT
  visible.
- `app/operator/empty-legs/[token]/new/page.tsx` — publish
  form. The Server Action `operatorPublishEmptyLeg` passes
  the session's `operator_stub_id` to the
  `publish_empty_leg` RPC so the inserted leg's
  `operator_stub_id` is the session's stub.
- `app/operator/empty-legs/[token]/[id]/page.tsx` — edit/
  cancel page, scoped to this session's stub. Server
  Actions return `'leg_not_found'` (opaque) if the
  requested leg's `operator_stub_id` does not match the
  session's stub — prevents one stub from editing
  another's legs.
- `app/actions/operator-empty-legs.ts` — 3 operator Server
  Actions: `operatorPublishEmptyLeg`, `operatorUpdatePrice`,
  `operatorCancel`. Each takes the operator session token
  as the first argument; validates via the shared
  `validateOperatorEmptyLegSession` helper which extracts
  the session's `operator_stub_id` and returns it to the
  caller. **All three actions enforce stub-scoping**
  (Codex iteration-12 P1 #1 fix):
  - `operatorPublishEmptyLeg` passes the session's
    `operator_stub_id` to `publish_empty_leg` RPC; the
    inserted leg's `operator_stub_id` is set to that
    value.
  - `operatorUpdatePrice` and `operatorCancel` first
    SELECT the target leg WHERE `id = :leg_id AND
    operator_stub_id = :session_stub_id`; if the
    SELECT returns zero rows, the action returns
    opaque `'leg_not_found'` (NOT
    `'unauthorized'` — the customer cannot tell whether
    the leg exists at all under another stub).
- `lib/operator/empty-leg-session-token.ts` — HMAC-signed
  session token, payload
  `{ v: 1, operator_stub_id, issued_at, exp }` with
  30-day default TTL (Codex iteration-12 P1 #2 fix:
  payload field renamed from `operator_id` to
  `operator_stub_id` so the name matches the FK target —
  the Phase 7 stub table, NOT the real `operators` table).
  Mirror the `lib/operator/token.ts` shape but with a
  SEPARATE secret (`EMPTY_LEGS_OPERATOR_TOKEN_SECRET`) for
  rotation independence (mirror the customer-token
  separate-secret rationale from Phase 6.2).
- `app/(admin)/admin/(protected)/empty-legs/operators/page.tsx`
  — admin-side surface to **bootstrap `phase7_operator_stubs`
  rows** (Codex iteration-10 P1 #3 fix +
  iteration-11 P1 #1 fix: schema reality says the real
  `operators` table requires `user_id NOT NULL
  REFERENCES users(id)` + `commercial_registration` +
  `gaca_license` + `license_expiry` — none of which
  Phase 7 can populate without the full Phase 8
  operator-onboarding flow. Per Codex iteration-11 P1 #1's
  prescribed second option, the bootstrap surface
  inserts into the dedicated `phase7_operator_stubs`
  table from PR 1 §14, not into the real `operators`
  table). Lists existing stubs from
  `phase7_operator_stubs` (filter `status = 'active'`)
  + exposes a Zod-validated form to INSERT a new stub
  with `company_name`, `contact_email`, `contact_phone`
  (and an optional `notes` text). The form posts to a
  thin admin Server Action
  `adminCreatePhase7OperatorStub` that wraps a single
  INSERT. This page is the prerequisite for the
  operator-session-mint page below — the session-mint
  dropdown reads from this list.
- `app/(admin)/admin/(protected)/empty-legs/operator-sessions/page.tsx`
  — admin-side surface to mint a new operator session
  token for a known `phase7_operator_stubs.id` (must
  exist via the bootstrap surface above). Renders the
  minted token once (raw token is admin-display-only;
  DB stores only the hash, mirroring the
  bookings.checkout_token_hash pattern).
- `app/actions/phase7-operator-stubs.ts` — single admin
  Server Action
  `adminCreatePhase7OperatorStub(company_name,
  contact_email, contact_phone, notes?)` that INSERTs
  a `phase7_operator_stubs` row + returns the new id.
  Codex iteration-10 P1 #3 fix + iteration-11 P1 #1
  fix — bootstrap path explicit, target table is the
  Phase-7-scoped stub.
- `lib/operator/empty-leg-session-store.ts` — DB-side hash
  storage helpers (insert + lookup-by-hash + soft-revoke
  + list-active-by-operator). Reads/writes the
  `operator_empty_leg_sessions` table created in PR 1 §15
  (Codex iteration-2 P1 #3 fix: DDL ownership moved to
  PR 1 to mirror the Phase 6.2 discipline of "all schema
  in PR 1"; storage decision resolved in favor of the
  dedicated table). **No DDL in this PR 2c** — application
  code only.

Three-layer token validation on every operator action:
- Layer 1 — HMAC signature + payload exp.
- Layer 2 — session row exists in
  `operator_empty_leg_sessions` with matching hash.
- Layer 3 — session row's `expires_at > NOW()`.

### 7.5 PR 2d — Public marketplace + reserve flow

Anon-readable RTL Arabic listing + per-leg detail + 10-minute
reserve. Behind `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` flag
(default `false` until PR 2c lands).

Files (Add):

- `app/(public)/empty-legs/page.tsx` — list of `available`
  legs ordered by `auction_window_end_at ASC` (most-urgent
  first); filter chips: departure city (set of distinct
  airports across `available` rows), passenger count
  (≥ N), price ceiling.
- `app/(public)/empty-legs/[leg_number]/page.tsx` — detail
  page keyed by `leg_number` (the human-readable
  `EL-XXXX`) NOT by UUID, for shareable URLs. Shows route,
  window, current price, current discount pct, current
  Dutch-auction trajectory ("سيصل إلى X ريال خلال Y ساعة").
- `app/(public)/empty-legs/[leg_number]/reserve/page.tsx` —
  reserve form (customer name + phone + UNCHECKED opt-in
  checkbox for empty-legs notifications, matching the
  `/request` form per Codex iteration-1 P1 #1; ticking
  writes `lead_inquiries.empty_legs_opt_in = TRUE` on the
  `lead_inquiries` row this reservation creates).
- `app/(public)/empty-legs/[leg_number]/reserved/page.tsx` —
  post-reservation page showing reservation expiry
  countdown + "اتصل بنا للتأكيد" wa.me button to the
  founder's phone (`+966558048004`, per CLAUDE.md).
- `app/(public)/empty-legs/opt-out/[token]/page.tsx` —
  opt-out lander; the token is a single-purpose HMAC token
  signed by `EMPTY_LEGS_OPT_OUT_TOKEN_SECRET` carrying
  `{ v: 1, lead_inquiry_id, issued_at }` (no exp — opt-out
  links never expire). Page asks "أتأكدت؟" and a button
  flips `lead_inquiries.empty_legs_opt_in` to FALSE.
- `app/actions/empty-legs-public.ts` — 3 anon-callable Server
  Actions: `reserveEmptyLeg(leg_number, name, phone,
  opt_in)`, `cancelMyReservation(leg_number,
  reservation_token)` (calls
  `release_empty_leg_reservation(leg_id, sha256(token))`
  per §7.2.6 and Codex iteration-1 P1 #3),
  `confirmOptOut(opt_out_token)`.
- `lib/empty-legs/reservation-token.ts` — HMAC-signed,
  payload `{ v: 1, leg_id, issued_at, exp }` with 10-minute
  TTL. Mirror customer-token shape; SEPARATE secret
  (`EMPTY_LEGS_RESERVATION_TOKEN_SECRET`).
- `lib/empty-legs/opt-out-token.ts` — HMAC-signed, payload
  `{ v: 1, lead_inquiry_id, issued_at }`, no expiry. Used
  in every WhatsApp prefilled text / wa.me notification
  body (Codex iteration-3 P2 #1 fix: "notification email
  + WhatsApp link" wording removed since the email channel
  was dropped in iteration-2 P1 #2). Separate secret per
  the rotation-independence rule.
- `components/public/empty-legs/leg-card.tsx`
- `components/public/empty-legs/leg-detail.tsx`
- `components/public/empty-legs/auction-trajectory.tsx`
- `components/public/empty-legs/reserve-form.tsx`
- `components/public/empty-legs/countdown.tsx`

Files (Edit):

- `app/(public)/layout.tsx` — add nav link "رحلات فارغة"
  visible only when `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE`
  is true.
- `app/(public)/page.tsx` — add a "اكتشف رحلات فارغة"
  CTA card on the home page.
- `components/forms/request-form.tsx` (Phase 6.0/6.1
  request form) — add the "أبلغوني عند توفر رحلة فارغة بسعر
  مخفض" Arabic-RTL checkbox at the bottom of the form,
  defaulting **UNCHECKED** (Codex iteration-1 P1 #1 fix:
  prior draft defaulted CHECKED, which would have set
  `TRUE` on every new submission without explicit consent
  for the new marketing category). Submitting writes
  `lead_inquiries.empty_legs_opt_in = TRUE` only when the
  customer explicitly ticked it; unticked submissions
  keep the column at the schema default `FALSE`.

CI parity test (Codex iteration-4 P1 #2 fix: package.json +
CI workflow edits moved into PR 2d's fence so the
`test:empty-legs-token` script is runnable + CI-enforced
the moment PR 2d merges; prior draft listed these edits
under PR 2e which left the test outside CI for one PR
cycle):

- `lib/empty-legs/__tests__/reservation-token.test.ts` —
  HMAC mint+verify roundtrip + expiry rejection +
  signature-tamper rejection.
- `package.json` (Edit) — add
  `"test:empty-legs-token": "tsx
  lib/empty-legs/__tests__/reservation-token.test.ts"`
  script entry. Owned by PR 2d.
- `.github/workflows/ci.yml` (Edit) — add the
  `npm run test:empty-legs-token` step. Owned by PR 2d.

### 7.6 PR 2e — Matching engine + Dutch auction cron + notifications

**Synchronous match-trigger on publish** (Codex iteration-2
P2 #1 fix). The prior draft set Founder Probe 15's SLA at
"within 1 minute after publish" but only fanned out matching
through the 30-minute-interval cron — the SLA would fail
intermittently. Per Codex's prescribed fix, PR 2e adds a
**synchronous trigger path** for the `published` event:

- After `adminPublishEmptyLeg` (PR 2b) and
  `operatorPublishEmptyLeg` (PR 2c) Server Actions receive a
  successful `publish_empty_leg` RPC response, they fire-
  and-forget POST to
  `/api/empty-legs/internal/match-trigger` with
  `{ leg_ids: [<new_leg_id>], event: 'published' }`. Server
  Action returns to the caller without waiting for the
  match-trigger response (latency budget for the publish
  form stays bounded; matching delivery is best-effort
  within seconds).
- The match-trigger route is idempotent: if the cron's
  outbox drain happens to race the synchronous fire, the
  outbox row's `processed_at` is set on whichever request
  wins, and the loser's batch finds zero unprocessed rows
  for that leg. No double-notification (the per-leg dedupe
  in `frequency-cap.ts` is the second line of defense).
- The `price_dropped` event continues to flow through the
  outbox + cron path only (no synchronous trigger from
  `update_empty_leg_price` or
  `tick_empty_leg_dutch_auction` — price-drop SLA stays at
  the 30-minute cron interval, which matches the founder
  probe's expectation since price ticks themselves only
  fire on the 30-minute cron).


Files (Add):

- `app/api/cron/empty-legs/dutch-auction-tick/route.ts` —
  Next.js route handler. Authorizes `Authorization: Bearer
  $CRON_SECRET`; iterates every leg with `status =
  'available'` AND (`last_price_drop_at IS NULL` OR
  `last_price_drop_at < NOW() − 30 minutes`); calls
  `tick_empty_leg_dutch_auction` per leg; collects
  `fired_event` rows and POSTs a single internal-trigger
  request to `/api/empty-legs/internal/match-trigger` with
  the price-drop set.
- `app/api/cron/empty-legs/expire-reservations/route.ts` —
  same auth posture; finds every leg
  `WHERE status = 'reserved' AND reservation_expires_at <= NOW()`;
  calls `expire_empty_leg_reservation`.
- `app/api/cron/empty-legs/expire-windows/route.ts` —
  finds every leg
  `WHERE status = 'available' AND auction_window_end_at <= NOW()`;
  flips `status = 'expired'` via a small inline
  `expire_empty_leg_window` RPC defined in this PR's
  migration (Codex iteration-3 P2 #3 fix: count corrected.
  PR 2a ships 11 publics + 1 helper after iteration-3 added
  `admin_release_empty_leg_reservation`. PR 2e then adds
  this 12th public, `expire_empty_leg_window`, in its own
  migration because its only caller is the cron route
  shipped in this same PR. SECURITY DEFINER + service-role-
  only EXECUTE; same grants posture as the PR 2a family).
- `app/api/empty-legs/internal/match-trigger/route.ts` —
  internal route gated by `Authorization: Bearer
  $CRON_SECRET`. Receives `{ leg_ids: UUID[],
  event: 'published' | 'price_dropped' }`; runs the
  matching engine for each leg.
- `lib/empty-legs/matching.ts` — rule-based matcher.
  **Per-leg ordered branch contract** (Codex
  iteration-10 P1 #1 fix: prior wording put the
  `ENABLE_EMPTY_LEGS_NOTIFICATIONS !== 'true'` check at
  the top of the matcher, returning
  `'notifications_disabled'` before any leg-level read
  — but Probe 15 + the canary plan rely on
  `suppress_notifications=TRUE` legs being detected
  and marked `processed_at = NOW()` even while
  notifications are disabled. With the prior order,
  suppressed test legs took the disabled branch and
  stayed unprocessed — exactly the replay hazard the
  marker was supposed to prevent. Per Codex's
  prescribed fix ["Reorder the contract so each outbox
  leg first checks `empty_legs.suppress_notifications`;
  if true, mark processed with no notification rows.
  Only non-suppressed legs should then hit the
  notifications-disabled replay path"], the matcher
  now iterates the outbox `leg_ids` and for EACH leg
  applies the branches in this order):

  1. **Suppress-notifications check** (per-leg, runs
     regardless of env-flag state). SELECT
     `suppress_notifications` FROM `empty_legs(id)`.
     If TRUE → return
     `{ ok: true, skipped: 'suppress_notifications', leg_id }`
     for that leg AND the match-trigger route DOES mark
     the outbox row `processed_at = NOW()` (the
     suppression is intentional, not a deferred-
     matching state — replay would be wrong; mirrors
     iteration-7 P1 #3 contract).
  2. **Notifications-disabled flag check** (per-leg,
     only runs for non-suppressed legs). If
     `process.env.ENABLE_EMPTY_LEGS_NOTIFICATIONS !== 'true'`
     → return
     `{ ok: true, skipped: 'notifications_disabled', leg_id }`
     for that leg AND the match-trigger route does
     **NOT** mark the outbox row processed — the row
     stays `processed_at = NULL` and replays on the
     next cron tick after the flag flips back to
     `true` (mirrors iteration-6 P1 #1 contract).
     Frequency cap + per-leg dedupe state is therefore
     not consumed while the flag is off, and
     `wa_url`-NOT-NULL cannot be violated.
  3. **Candidate matching** (per-leg, only runs for
     non-suppressed legs with the flag enabled).
     Imports candidate-pool reader from
     `lib/empty-legs/candidate-pool.ts`, scoring weights
     from `lib/empty-legs/score-weights.ts`,
     frequency-cap reader from
     `lib/empty-legs/frequency-cap.ts`, and returns the
     top 50 candidate `lead_inquiries.id` per leg.
     Each candidate's wa.me URL is generated and the
     `empty_leg_notifications` row is INSERTed; on
     successful completion the match-trigger route
     marks the outbox row `processed_at = NOW()`.

  **Why the order matters**: a single batch of outbox
  rows can mix suppressed canary test legs with real
  legs published while a flag-flip is in progress.
  Putting the suppress check FIRST per-leg means
  canary test legs are deterministically marked
  processed (so they cannot replay) while real legs
  in the same batch correctly hit the
  notifications-disabled branch and stay pending. The
  prior whole-matcher short-circuit treated all legs
  in a flag-off cycle uniformly, which broke this
  invariant.
- `lib/empty-legs/candidate-pool.ts` — `SELECT id,
  customer_name, customer_phone, origin, destination,
  departure_date, return_date, passengers,
  last_empty_leg_notified_at, empty_legs_opt_in FROM
  lead_inquiries WHERE empty_legs_opt_in = TRUE AND
  created_at >= NOW() − INTERVAL '90 days' AND
  (last_empty_leg_notified_at IS NULL OR
   last_empty_leg_notified_at < NOW() − INTERVAL '24 hours')`.
  (Codex iteration-2 P1 #2 fix: prior draft selected a
  `customer_email` column that does not exist on
  `lead_inquiries`. Per Codex's prescribed fix, Phase 7
  removes the email channel entirely — see
  `lib/empty-legs/notifications.ts` below; the candidate
  pool now reads only the columns that actually exist.)
  (Codex iteration-3 P2 #2 fix: 90-day cutoff added to
  the canonical query — it was promised in Risk R3's
  mitigation but missing from the query itself; without
  it, dormant leads from > 90 days ago would receive
  cold WhatsApp outreach and damage founder/operator
  credibility.)
- `lib/empty-legs/score-weights.ts` — exported constants:
  `GEO_WEIGHT = 40`, `TIME_WEIGHT = 30`, `CAPACITY_WEIGHT = 20`,
  `DISCOUNT_WEIGHT = 10`. Sum to 100. Score is integer
  0..100. Comments document each factor's range.
- `lib/empty-legs/frequency-cap.ts` — composes the 24-hour
  window check + the per-leg dedupe (don't notify the same
  customer twice on the same leg, even on `price_dropped`
  re-matching). Reads from the dedicated
  `empty_leg_notifications` table (PR 1 §13; Codex
  iteration-1 P1 #2 fix — previously named the
  `notifications` table whose `user_id NOT NULL` shape is
  unusable for guest `lead_inquiries`):
  `SELECT COUNT(*) FROM empty_leg_notifications WHERE
   lead_inquiry_id = X AND sent_at > NOW() − INTERVAL '24
   hours'` for the rate cap, and
  `EXISTS (SELECT 1 FROM empty_leg_notifications WHERE
   lead_inquiry_id = X AND leg_id = Y)` for the per-leg
  dedupe.
- `lib/empty-legs/notifications.ts` — **wa.me URL +
  outreach-queue write + founder batch alert**
  (Codex iteration-4 P1 #1 fix: prior draft only wrote
  audit rows; now also enqueues for founder dispatch and
  triggers the batch alert. Customer-side email channel
  remains removed per iteration-2 P1 #2). The module:
  1. Composes a wa.me URL containing a pre-filled
     Arabic-RTL message body that references the leg
     number, route, current price, current discount, the
     marketplace deep-link, and the opt-out URL.
  2. INSERTs one row into `empty_leg_notifications`
     (PR 1 §13) with `lead_inquiry_id`, `leg_id`,
     `event_type` ∈ `('published', 'price_dropped')`,
     `channel = 'whatsapp_link'` (the only allowed value
     per PR 1 §13 CHECK), `wa_url = <the URL>`,
     `outreach_sent_at = NULL` (the row enters the queue
     pending the founder's manual dispatch),
     `external_message_id = NULL` (no Resend id; wa.me
     has no provider message id), and `sent_at = NOW()`.
  3. After all rows for one matching cycle are written,
     calls `lib/empty-legs/founder-batch-email.ts` with
     the cycle's leg ids; that module sends ONE batched
     Resend email to the founder summarizing the pending
     outreach. Frequency-cap reads in subsequent matching
     cycles see step 2's rows; founder dispatches via
     the admin outreach queue (`/admin/empty-legs/outreach-queue`,
     PR 2b) and marks each row's `outreach_sent_at` to
     NOW() on click.
- `lib/empty-legs/notification-templates/leg-published-whatsapp.ts`
  (text only, used to compose the wa.me URL).
- `lib/empty-legs/notification-templates/leg-price-dropped-whatsapp.ts`
- `lib/empty-legs/founder-batch-email.ts` — Codex
  iteration-4 P1 #1 fix. After a matching cycle finishes
  writing rows to `empty_leg_notifications`, the matching
  engine calls this module with the cycle's leg ids. The
  module composes ONE Resend email to the founder
  (recipient = `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` env
  var, defaulting to `LEAD_NOTIFICATION_TO` from Phase 6.0
  if unset) summarizing the new pending outreach rows:
  one section per leg, each section listing the
  candidates' names, phone numbers, the click-through
  wa.me URLs, and a deep-link to
  `/admin/empty-legs/outreach-queue` so the founder can
  jump straight to the queue. Reuses the brand template
  from `lib/notifications/lead-email.ts` (dark navy +
  gold + Playfair `AERIS` heading + RTL Arabic).

  **Visible degraded state on missing config** (Codex
  iteration-5 P2 #2 fix: prior wording made the missing-
  `RESEND_API_KEY` path a silent no-op, which would hide
  the fact that the founder is no longer being alerted
  to pending wa.me dispatches; this contradicts the
  spec's claim that the bridge from "audit row" to
  "founder dispatches outreach" is reliable):
  - On every send attempt, log a structured event
    `console.error('[empty-legs.founder-batch] config missing', { resend_api_key: !!apiKey, batch_to: batchTo })`
    when either `RESEND_API_KEY` is missing/empty OR the
    resolved batch recipient is missing/empty. The log
    is captured by Sentry (already in dependencies) so
    the founder sees a structured error, not silent
    drift.
  - Write a small status row to a new tiny table
    `empty_leg_outreach_alert_status(id, status,
    last_failure_at, last_failure_reason, updated_at)`
    (singleton: id is hardcoded) — `status` ∈
    `('healthy', 'config_missing', 'send_failed')`. The
    matching engine's email-send wrapper updates this
    row after every attempt. The admin outreach queue
    page (PR 2b) reads this row on every render and
    shows a red banner "تنبيه: تنبيهات المؤسس معطلة —
    راجع إعدادات Resend" when `status <> 'healthy'`,
    plus the count of pending wa.me URLs that have NOT
    been dispatched in the last 24h (those are what the
    founder is missing alerts for).
  - **Founder Probe 18 fails until configured** — the
    probe MUST receive a real Resend email; if it does
    not, the probe is RED and PR 2e cannot be marked
    smoke-passed.

  PR 1's §13 will be amended to also create
  `empty_leg_outreach_alert_status` (singleton table —
  `id INT PRIMARY KEY DEFAULT 1` + `CHECK (id = 1)`) so
  the application code has a guaranteed-existing row to
  UPDATE. See updated PR 1 §16 in this iteration.
- `lib/empty-legs/notification-templates/founder-batch-email.ts`
  — HTML composition for the founder batch alert (Codex
  iteration-4 P1 #1 fix).
- `lib/empty-legs/__tests__/matching.test.ts` — table-driven
  scenario tests: deterministic candidate-pool fixtures
  asserting top-N selection on a fixed leg shape. Layer-1
  (no DB), runs as `npm run test:empty-legs-matching`.
- `lib/empty-legs/__tests__/frequency-cap.test.ts` — mock
  `empty_leg_notifications` reader (Codex iteration-6
  P2 #2 fix: prior wording said "mock `notifications`
  reader" which contradicted the iteration-2 P1 #2
  retargeting away from the initial-schema
  `notifications` table that has `user_id NOT NULL` and
  cannot key on guest leads); the test mocks a
  reader that returns `{ lead_inquiry_id, leg_id,
  sent_at }` rows from `empty_leg_notifications` and
  asserts the 24h-window + per-leg-dedupe logic
  against those.
- `supabase/migrations/20260511000012_phase_7_empty_legs_match_event.sql`
  — `CREATE OR REPLACE` of `publish_empty_leg_event` with
  the real body: writes a row to `empty_leg_events_outbox`
  (a tiny new table also created in this migration with
  columns `id UUID PK, leg_id UUID FK, event_type TEXT,
  emitted_at TIMESTAMPTZ DEFAULT NOW(), processed_at
  TIMESTAMPTZ`). The cron route drains this outbox in a
  single SELECT-FOR-UPDATE-SKIP-LOCKED batch; processed rows
  get `processed_at = NOW()`. **Open question §3: outbox
  vs. PostgreSQL NOTIFY for the event channel.** The spec's
  default is the outbox table because it survives Vercel's
  serverless cold-starts that NOTIFY can't reach.
- `app/api/empty-legs/__tests__/cron-auth.test.ts` — cron
  routes reject missing/wrong `$CRON_SECRET` header with
  401 + return body `{ ok: false, error: 'unauthorized' }`.
  Layer-1 (no DB).

Files (Edit):

- `vercel.json` — add the 3 cron entries:
  ```
  {
    "crons": [
      { "path": "/api/cron/empty-legs/dutch-auction-tick",
        "schedule": "*/30 * * * *" },
      { "path": "/api/cron/empty-legs/expire-reservations",
        "schedule": "*/5 * * * *" },
      { "path": "/api/cron/empty-legs/expire-windows",
        "schedule": "0 * * * *" }
    ]
  }
  ```
- `app/actions/empty-legs.ts` — extend
  `adminPublishEmptyLeg` to fire-and-forget POST to
  `/api/empty-legs/internal/match-trigger` after a
  successful `publish_empty_leg` RPC response (Codex
  iteration-3 P1 #1 fix: the synchronous-trigger path
  documented at the top of §7.6 was wired in spec but the
  Server Action file was never listed in PR 2e's Files
  (Edit) — without this entry the 1-minute publish SLA
  could not be wired). This file shipped originally in
  PR 2b; PR 2e edits it to add the synchronous match-
  trigger call. The Server Action returns to the caller
  WITHOUT awaiting the POST response so the form-submission
  latency budget stays bounded.
- `app/actions/operator-empty-legs.ts` — same edit shape:
  extend `operatorPublishEmptyLeg` with the synchronous
  match-trigger fire-and-forget. Originally shipped in
  PR 2c; PR 2e edits it. (Codex iteration-3 P1 #1 fix.)
- `package.json` — add `test:empty-legs-matching`,
  `test:empty-legs-frequency-cap`, `test:empty-legs-cron-auth`
  script entries. (Codex iteration-4 P1 #2 fix:
  `test:empty-legs-token` moved to PR 2d's fence — that
  script + its CI step ship with PR 2d, not here.)
- `.github/workflows/ci.yml` — add the 3 new test steps
  for the matching/frequency/cron-auth tests above
  (`test:empty-legs-token` step lands in PR 2d).
- `.env.example` — every secret + flag introduced across
  Phase 7 (already enumerated in PR 2b's edits; PR 2e
  appends the cron secret + AI-scoring flag).

## Out of Scope (explicit)

Phase 7 does NOT ship any of:

- **Payment integration** — HyperPay / Moyasar / Apple Pay /
  mada / STC Pay / ZATCA invoice / refund flow / webhooks.
  All Phase 11 territory. Empty-Legs sales create bookings
  rows with `payment_status = 'pending_offline'` — the
  founder collects payment over WhatsApp / bank transfer
  out of band.
- **Operator account onboarding flow** — operator self-
  signup, password recovery, profile editing. PR 2c uses
  admin-minted session tokens; full account is Phase 8.
- **AI scoring beyond rule-based** — the
  `lib/empty-legs/matching-ai.ts` stub is a placeholder; the
  feature flag `ENABLE_EMPTY_LEGS_AI_SCORING` exists but
  flipping it on is a separate Phase 7.x or Phase 8 spec.
- **Round-trip empty legs** — Phase 7 supports one-way only.
  Round-trip (departure window AND return window on the
  same leg) is a future expansion that doubles the schema
  surface.
- **Multi-leg empty itineraries** — a leg goes from one
  airport to one airport. Multi-stop empties (A→B→C) need
  a different shape than `empty_legs` and are out of scope.
- **Empty-leg add-ons** — booking add-ons (catering,
  transfer, etc.) are Phase 6.2 territory and are NOT
  attached automatically when an empty-leg sale creates a
  booking row. Admin can attach add-ons manually post-sale
  via the existing Phase 6.2 admin add-ons surface; this
  works because `confirm_empty_leg_reservation` writes a
  `bookings` row that the Phase 6.2 admin add-ons page
  reads transparently.
- **Push notifications** — web push, native push, iOS APNS,
  Android FCM. Phase 5+ if at all.
- **AI-generated empty-leg copy** — every notification
  template is hand-written Arabic-RTL. Claude-generated copy
  is a future optimization, not Phase 7.
- **Loyalty point award** on empty-leg booking — Phase 10.
- **Realtime updates** — the public marketplace and admin
  list are pure SSR + manual refresh. Supabase Realtime
  subscriptions are Phase 8+.
- **E2E tests (Playwright)** — Phase 8/9 territory per the
  Week-8 advisor marker. Phase 7 ships TS-level layer-1
  parity tests only.
- **Empty-leg cancellation refunds** — once
  `status = 'sold'`, the booking row is in Phase 11
  payment-flow territory.
- **Mobile app** — out of scope for the entire roadmap until
  Phase 12+.
- **Designer-quality marketplace polish** — Phase 7 ships
  functional Arabic-RTL marketplace with brand colors
  (gold/navy). Polished hero imagery + custom typography
  per leg + animations are deferred.
- **Pricing-engine integration with the broader Aeris
  Dynamic Pricing engine described in CLAUDE.md** — the
  Dutch auction here is leg-local. The wider pricing engine
  (Privilege-tier discounts, peak-hour multipliers,
  first-time-user discount) is Phase 8+ and feeds the
  marketplace's price display only — Phase 7's auction tick
  is independent.

## Acceptance Criteria

Phase 7 is acceptable only if every numbered item below is
true at PR-2e merge time. Numbers are unique across the
entire phase — no section reuse.

(Iteration 2 renumber: +1 in Schema for the new
`empty_leg_notifications` table from Codex P1 #2 fix; +2 in
RPCs for the new `release_empty_leg_reservation` and
`admin_mark_empty_leg_sold` from Codex P1 #3 + P1 #4 fixes.
Total 70 → 73 items. Sections after RPCs shifted by +3.)

(Iteration 3 renumber: +1 in RPCs for new
`admin_release_empty_leg_reservation` (Codex iteration-3
P1 #2); +1 in Admin surfaces for new `adminReleaseReservation`
Server Action acceptance (Codex iteration-3 P1 #2); +1 in
Matching/cron for new synchronous match-trigger wiring
(Codex iteration-3 P1 #1); +1 in Matching/cron for new
`expire_empty_leg_window` 12th-public acceptance (Codex
iteration-3 P2 #3). Total 73 → 77 items. Sections after
RPCs shift by +1, sections after Admin shift by +2,
sections after Marketplace shift by +2, sections after
Matching shift by +4.)

(Iteration 4 renumber: +2 in Admin surfaces for the new
outreach queue page (#34) and the `markOutreachSent`
acceptance (#35) — Codex iteration-4 P1 #1 fix; +1 in
Matching/cron for the founder batch alert acceptance
(#62) — Codex iteration-4 P1 #1 fix. Total 77 → 80 items.
Sections after Admin shift by +2; Operator portal now
36-40, Public marketplace 41-48, Matching/cron 49-63,
Quality 64-69, Branch 70-72, Doc 73-75, Scope 76-80.)

(Iteration 5 renumber: +1 in Schema for new
`empty_leg_outreach_alert_status` singleton table
(#13) — Codex iteration-5 P2 #2 fix; +1 in Admin
surfaces for the new health-banner-render acceptance
(#37) — Codex iteration-5 P2 #2 fix; +1 in Matching/cron
for the new fail-closed-when-flag-off acceptance
(#65) — Codex iteration-5 P1 #1 fix. Total 80 → 83 items.
Schema 1-13, RPCs 14-27, Admin 28-37, Operator 38-42,
Marketplace 43-50, Matching/cron 51-66, Quality 67-72,
Branch 73-75, Doc 76-78, Scope 79-83.)

(Iteration 8 renumber: +1 in Schema for new
`empty_legs.suppress_notifications` column (#12) —
Codex iteration-7 P1 #3 fix; +1 in Schema for new
last-notified trigger (#15) — Codex iteration-7 P1 #2
fix. Total 83 → 85 items. Schema 1-15, RPCs 16-29,
Admin 30-39, Operator 40-44, Marketplace 45-52,
Matching/cron 53-68, Quality 69-74, Branch 75-77,
Doc 78-80, Scope 81-85.)

(Iteration 11 renumber: +1 in Schema for new
`phase7_operator_stubs` table (#15) — Codex
iteration-11 P1 #1 fix. Total 85 → 86 items. Schema
1-16, RPCs 17-30, Admin 31-40, Operator 41-45,
Marketplace 46-53, Matching/cron 54-69, Quality 70-75,
Branch 76-78, Doc 79-81, Scope 82-86.)

### Schema (PR 1)

1. `empty_legs.operator_id` is nullable; the three
   `operator_*_snapshot` columns exist with the type sizes
   listed in §7.1 §1; **`empty_legs.operator_stub_id UUID
   NULL` exists** (column added in §7.1 §1 without an FK
   to avoid the iteration-13 P1 #1 forward-reference
   problem, since `phase7_operator_stubs` is created
   later in §7.1 §14); the FK constraint
   `empty_legs_operator_stub_fk` to
   `phase7_operator_stubs(id) ON DELETE SET NULL` is
   added in §7.1 §14's "FK + index wiring" sub-block
   (Codex iteration-12 P1 #1 + iteration-13 P1 #1
   fixes: Phase 7 ownership key — `operator_id`
   reserved for Phase 8's real-operator FK and stays
   NULL throughout Phase 7); the partial index
   `idx_empty_legs_operator_stub` on
   `(operator_stub_id, status) WHERE operator_stub_id IS
   NOT NULL` is also created in §7.1 §14's wiring
   sub-block.
2. `empty_legs.aircraft_id` is nullable;
   `aircraft_snapshot TEXT` exists.
3. `empty_legs.departure_airport` and
   `empty_legs.arrival_airport` are nullable (Codex
   iteration-10 P1 #2 fix); the
   `departure_airport_freeform_snapshot` and
   `arrival_airport_freeform_snapshot` columns exist;
   the two route-presence CHECKs are installed; the
   IATA FKs (`REFERENCES airports(iata_code)`) remain
   so populated IATA values still resolve to real
   airports.
4. `empty_leg_status` ENUM contains `'cancelled'`.
5. `bookings.source_offer_table` CHECK accepts
   `'phase7_empty_leg'`.
6. The four reservation-hold columns + the paired
   `empty_legs_reservation_pair_check` exist.
7. `empty_legs.customer_booking_id UUID REFERENCES
   bookings(id) ON DELETE SET NULL` exists.
8. The eight Dutch-auction columns exist; both
   `empty_legs_auction_bounds_check` and
   `empty_legs_auction_window_order_check` are active.
9. `lead_inquiries.empty_legs_opt_in BOOLEAN NOT NULL
   DEFAULT FALSE` (Codex iteration-1 P1 #1 fix: default
   flipped from `TRUE` to `FALSE`) and
   `lead_inquiries.last_empty_leg_notified_at TIMESTAMPTZ`
   exist; the partial index is created. Existing rows
   backfill to `FALSE` automatically.
10. `empty_legs` has an audit trigger writing to
    `audit_logs` on price/status/reservation changes.
11. Re-running the migration produces no schema diff (founder
    Probe 1).
12. `empty_legs.suppress_notifications BOOLEAN NOT NULL
    DEFAULT FALSE` exists (Codex iteration-7 P1 #3 fix).
    The matching engine excludes legs with
    `suppress_notifications = TRUE` from the candidate
    cycle entirely — no audit row, no wa.me URL, no
    founder batch entry — even after both flags flip
    and any backlog drains. The admin publish form's
    canary checkbox writes this column.
13. `empty_leg_notifications` table exists (Codex iteration-1
    P1 #2 fix) with the columns + CHECKs + indexes + RLS
    posture listed in §7.1 §13, **including the
    `wa_url TEXT NOT NULL` column, the `outreach_sent_at
    TIMESTAMPTZ NULL` column, and the
    `idx_empty_leg_notifications_outreach_pending` partial
    index** (Codex iteration-4 P1 #1 fix: queue/inbox
    state explicit on the audit row so the admin queue
    can read pending rows efficiently). The
    `idx_empty_leg_notifications_lead_leg_unique` index
    is created `UNIQUE` on `(lead_inquiry_id, leg_id)`
    (Codex iteration-5 P2 #1 fix: was non-unique despite
    the name); a retry/race attempting a duplicate
    insert receives a PG `unique_violation` and the
    matching engine treats it as a successful skip.
14. `phase7_operator_stubs` table exists (Codex
    iteration-11 P1 #1 fix) with the columns + CHECK
    + RLS posture listed in §7.1 §14: `id UUID PK`,
    `company_name VARCHAR(200) NOT NULL`,
    `contact_email VARCHAR(255) NOT NULL`,
    `contact_phone VARCHAR(20) NOT NULL`,
    `status TEXT NOT NULL DEFAULT 'active' CHECK
    IN ('active', 'archived')`, optional `notes TEXT`,
    `created_at` + `updated_at` timestamps, plus the
    partial active-status index. Service-role-only RLS.
15. `operator_empty_leg_sessions.operator_stub_id` FK
    references `phase7_operator_stubs(id)` (Codex
    iteration-11 P1 #1 fix retargeted FK from
    `operators(id)`; iteration-12 P1 #2 fix renamed
    column from `operator_id` to `operator_stub_id` so
    the column name matches its FK target).
    Service-role-only RLS, two indexes per §7.1 §15
    (`idx_operator_empty_leg_sessions_hash` UNIQUE on
    `token_hash`; `idx_operator_empty_leg_sessions_stub`
    partial on `(operator_stub_id, expires_at DESC)
    WHERE revoked_at IS NULL`).
16. `empty_leg_outreach_alert_status` singleton table
    exists (Codex iteration-5 P2 #2 fix) with the
    `id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1)`,
    the `status` CHECK constraint enumerating
    `('healthy', 'config_missing', 'send_failed')`, the
    seeded `(1, 'healthy')` row, and service-role-only
    RLS posture.
17. `empty_leg_notifications_update_last_notified` AFTER
    INSERT trigger exists on `empty_leg_notifications`
    (Codex iteration-7 P1 #2 fix). Inserting a row
    atomically UPDATEs `lead_inquiries.last_empty_leg_notified_at
    = NEW.sent_at` for the matched lead. The function
    `_update_lead_inquiry_last_notified()` is REVOKEd
    from every role including service_role.

### RPCs (PR 2a)

18. `_recompute_empty_leg_price(UUID)` exists; REVOKEd from
    PUBLIC + anon + authenticated + service_role.
19. `publish_empty_leg(...)` exists; SECURITY DEFINER +
    `search_path = public, pg_temp`; service-role-only
    EXECUTE; structured-error contract on every validation
    failure (no raises).
20. `update_empty_leg_price(UUID, DECIMAL)` exists; same
    grants posture.
21. `reserve_empty_leg(UUID, VARCHAR, TIMESTAMPTZ, VARCHAR,
    VARCHAR)` exists; same grants posture.
22. `confirm_empty_leg_reservation(UUID, VARCHAR)` exists;
    same grants posture; INSERTs a `bookings` row with
    `source_offer_table = 'phase7_empty_leg'` and
    `payment_status = 'pending_offline'`.
23. `release_empty_leg_reservation(UUID, VARCHAR)` exists
    (Codex iteration-1 P1 #3 fix); same grants posture;
    validates the reservation-token hash and clears only
    the four reservation columns; flips `status` back to
    `'available'`; rejects mismatch with
    `reservation_token_mismatch` and rejects non-reserved
    rows with `leg_not_reserved`.
24. `admin_release_empty_leg_reservation(UUID)` exists
    (Codex iteration-3 P1 #2 fix); same grants posture;
    admin counterpart to #21 — flips `status = 'available'`
    + clears all four reservation columns + recomputes
    price, WITHOUT a token-hash check (admin runs as
    service-role and does not hold the customer's token);
    rejects non-reserved rows with `leg_not_reserved`.
25. `cancel_empty_leg(UUID, TEXT)` exists; same grants
    posture.
26. `expire_empty_leg_reservation(UUID)` exists; idempotent
    (re-running on a non-`'reserved'` row returns
    `{ ok: true, no_op: true }`); cron-only path —
    returns no-op when `reservation_expires_at > NOW()`,
    so Phase 7 admin UI does not call it directly (uses
    #24 instead per Codex iteration-3 P1 #2).
27. `tick_empty_leg_dutch_auction(UUID)` exists; idempotent;
    fires `publish_empty_leg_event` only on strict price
    drop.
28. `admin_mark_empty_leg_sold(UUID, TEXT, TEXT)` exists
    (Codex iteration-1 P1 #4 fix); same grants posture;
    single-transaction body that INSERTs the bookings row
    + flips `status = 'sold'` + writes `customer_booking_id`
    atomically. The Server Action that calls it does NOT
    wrap multiple `rpc()` calls.
29. `publish_empty_leg_event(UUID, TEXT)` exists as a no-op
    stub; PR 2e replaces the body.
30. The Layer-1 test `npm run test:empty-legs-curve` passes
    against fixed sample points (0%, 25%, 50%, 75%, 100%
    elapsed).
31. Concurrent `reserve_empty_leg` + `confirm_empty_leg_reservation`
    on the same leg row are serialized by the row lock —
    one wins, the other returns the appropriate structured
    error (`leg_not_available` or `reservation_token_mismatch`).

### Admin surfaces (PR 2b)

32. `/admin/empty-legs` page lists all legs with status-
    filter chips, default `available + reserved`. Hidden by
    `ENABLE_EMPTY_LEGS_ADMIN_UI = false` (returns 404).
33. `/admin/empty-legs/new` form publishes a leg via
    `adminPublishEmptyLeg` Server Action. Zod-validated
    inputs. Form includes a "رحلة اختبار داخلية — لا
    ترسل تنبيهات" Arabic-RTL checkbox that defaults
    UNCHECKED on production publish; ticking writes
    `empty_legs.suppress_notifications = TRUE` (Codex
    iteration-7 P1 #3 fix — canary's test-leg
    publishes tick this).
34. `/admin/empty-legs/[id]` renders the 3-case gate
    (Available / Reserved / Sold) with the listed
    affordances.
35. The admin Dutch-auction trajectory chart renders the
    curve from window start to window end with `NOW()`
    marker.
36. Admin sidebar nav entry "الرحلات الفارغة" + "قائمة
    المراسلات" is visible when the flag is on, hidden
    when off.
37. `adminMarkSoldManual` Server Action correctly creates a
    booking row + flips the leg to `'sold'` via the
    single-RPC `admin_mark_empty_leg_sold` from acceptance
    #28 (Codex iteration-1 P1 #4 fix: prior draft claimed a
    multi-RPC Server Action transaction; replaced by a
    single SECURITY DEFINER RPC).
38. Case-2 "إلغاء التحفظ" admin button calls
    `adminReleaseReservation` Server Action which invokes
    `admin_release_empty_leg_reservation` from acceptance
    #24 (Codex iteration-3 P1 #2 fix: prior draft wired
    this button to `expire_empty_leg_reservation` which
    is cron-only and no-ops on still-active holds).
39. `/admin/empty-legs/outreach-queue` page renders all
    `empty_leg_notifications` rows with
    `outreach_sent_at IS NULL`, ordered `sent_at DESC`,
    each showing the candidate's name + phone, the leg's
    `leg_number` + route + current price, the wa.me
    click-through link, and a "تم الإرسال" button.
    Hidden by `ENABLE_EMPTY_LEGS_ADMIN_UI = false`
    (returns 404). Codex iteration-4 P1 #1 fix —
    customer-delivery surface for the wa.me URLs.
40. The "تم الإرسال" button calls `markOutreachSent`
    Server Action which UPDATEs the audit row's
    `outreach_sent_at = NOW()`. Idempotent: re-clicking
    on an already-marked row is a server-side no-op
    (the UPDATE finds zero matching rows by the WHERE
    clause `outreach_sent_at IS NULL`). The clicked row
    drops out of the queue listing on next render.
    Codex iteration-4 P1 #1 fix.
41. The outreach queue page reads
    `empty_leg_outreach_alert_status` (PR 1 §16) on every
    render and renders the red banner "تنبيه: تنبيهات
    المؤسس معطلة — راجع إعدادات Resend" when
    `status <> 'healthy'`, plus the `last_failure_reason`
    excerpt + the count of pending wa.me URLs whose
    `sent_at < NOW() − INTERVAL '24 hours'`. Codex
    iteration-5 P2 #2 fix.

### Operator portal (PR 2c)

42. `app/operator/empty-legs/[token]/page.tsx` returns 404
    when `ENABLE_OPERATOR_PORTAL = false`.
43. With the flag on, an admin-minted operator session
    token grants list + publish + edit + cancel access
    scoped to the session's `operator_stub_id` only
    (Codex iteration-12 P1 #1 + P1 #2 fix: scoping key
    is the stub-FK column, not the legacy `operator_id`).
    `operatorPublishEmptyLeg` Server Action passes the
    session's `operator_stub_id` to `publish_empty_leg`
    RPC so the inserted leg's
    `empty_legs.operator_stub_id` equals the session's
    stub id. `operatorUpdatePrice` and `operatorCancel`
    pre-filter target legs by
    `WHERE id = :leg_id AND operator_stub_id =
    :session_stub_id` and return the opaque
    `'leg_not_found'` on cross-stub attempts (NOT
    `'unauthorized'` — the customer cannot tell whether
    the leg exists under another stub).
44. Three-layer token validation
    (HMAC sig + DB hash + DB expiry) is enforced on every
    operator Server Action; all three failures surface as
    `'invalid_session'` opaque error.
45. The admin "mint operator session" page renders the raw
    token once on creation; reloading the page does not
    re-display it (the DB stores hash only).
46. Admin can revoke an operator session by setting
    `revoked_at` on the row in `operator_empty_leg_sessions`
    (per PR 1 §15 schema; Codex iteration-2 P1 #3 fix).

### Public marketplace (PR 2d)

47. `/empty-legs` returns 404 when
    `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = false`.
48. With the flag on, anon users see a list of `available`
    legs ordered by urgency. RLS on `empty_legs` enforces
    that no `reserved`/`sold`/`expired`/`cancelled` row leaks
    to anon (verified by direct REST probe in
    Founder Probe 8).
49. `/empty-legs/[leg_number]` detail page renders route +
    window + current price + auction trajectory.
50. The reserve form requires customer name + phone + opt-
    in checkbox. Submitting it calls `reserveEmptyLeg` →
    mints a 10-minute reservation token (HMAC) → calls
    `reserve_empty_leg` RPC with the token hash → flips
    the leg to `'reserved'` → returns the customer to
    `/empty-legs/[leg_number]/reserved` with a countdown.
51. The post-reservation page shows a 10-minute countdown
    and a wa.me button to the founder phone with a pre-
    filled Arabic message including the leg number.
52. The opt-out lander
    (`/empty-legs/opt-out/[token]`) flips
    `lead_inquiries.empty_legs_opt_in` to FALSE for the
    inquiry encoded in the token. The token is HMAC-signed,
    no expiry. The page is anon-accessible.
53. The `/request` form's new opt-in checkbox is RTL +
    Arabic, defaults **UNCHECKED** (Codex iteration-1 P1 #1
    fix), and writes `lead_inquiries.empty_legs_opt_in =
    TRUE` only when the customer explicitly ticked it;
    unticked submissions leave the column at the schema
    default `FALSE`. The reserve form on
    `/empty-legs/<leg_number>/reserve` carries the same
    unchecked checkbox and same write semantics.
54. `npm run test:empty-legs-token` passes the HMAC
    mint+verify+tamper tests; both the script entry in
    `package.json` and the CI step in
    `.github/workflows/ci.yml` ship in PR 2d (Codex
    iteration-4 P1 #2 fix: prior draft attached these
    edits to PR 2e, leaving the test outside CI for one
    PR cycle).

### Matching + cron + notifications (PR 2e)

55. The 3 Vercel Cron entries are present in `vercel.json`
    with the schedules listed in §7.6.
56. Every cron route rejects missing-or-wrong
    `Authorization: Bearer $CRON_SECRET` with HTTP 401 and
    `{ ok: false, error: 'unauthorized' }`. Verified by
    `npm run test:empty-legs-cron-auth`.
57. Both `adminPublishEmptyLeg` (in `app/actions/empty-legs.ts`)
    and `operatorPublishEmptyLeg` (in
    `app/actions/operator-empty-legs.ts`) fire-and-forget
    POST `/api/empty-legs/internal/match-trigger` after a
    successful `publish_empty_leg` RPC response, with
    `Authorization: Bearer $CRON_SECRET` (Codex iteration-3
    P1 #1 fix: PR 2e's Files (Edit) explicitly lists both
    Server Action files; without these edits the
    1-minute publish SLA from Founder Probe 16 cannot be
    met).
58. `tick_empty_leg_dutch_auction` running on a leg whose
    discount strictly increased writes a row to the
    `empty_leg_events_outbox` with `event_type =
    'price_dropped'`.
59. `publish_empty_leg` writes a row to the outbox with
    `event_type = 'published'` after every successful
    insert.
60. The `/api/empty-legs/internal/match-trigger` route
    drains the outbox in batch (SKIP LOCKED), runs the
    matching engine per leg, and marks each row
    `processed_at = NOW()` **when matching actually ran
    OR when the suppress branch intentionally skipped**
    (Codex iteration-7 P1 #1 fix + iteration-13 P2 #1
    fix: the only path that LEAVES `processed_at = NULL`
    is non-suppressed legs that hit the
    `'notifications_disabled'` branch per acceptance
    #69 — those rows stay eligible for replay on the
    next cron tick after the flag flips back to `true`.
    `'suppress_notifications'` skips DO mark processed
    because the suppression is intentional, not a
    deferred state — replay against real customers
    after flag flip would be wrong; prior wording
    omitted this exception and contradicted #69's
    suppress-branch contract). Idempotent — the
    synchronous fire from #57 + the cron drain cannot
    double-notify (per-leg dedupe in #62 is the second
    line of defense).
61. Matching engine selects ≤ 50 candidates per leg from
    legs WHERE `suppress_notifications = FALSE` (Codex
    iteration-7 P1 #3 fix: canary / internal-test legs
    that ticked the suppress checkbox are excluded
    entirely — even after both flags flip and any
    backlog drains). Each candidate is from
    `lead_inquiries` with
    `empty_legs_opt_in = TRUE` AND
    `created_at >= NOW() − INTERVAL '90 days'` (Codex
    iteration-3 P2 #2 fix: 90-day cutoff enforced in the
    canonical query, mirroring Risk R3 mitigation) AND
    (`last_empty_leg_notified_at IS NULL OR < NOW() − 24h`).
62. Per-leg dedupe: a candidate already notified about
    this specific leg is excluded on a `price_dropped`
    re-match. Implemented as `EXISTS (SELECT 1 FROM
    empty_leg_notifications WHERE lead_inquiry_id = X AND
    leg_id = Y)` (Codex iteration-1 P1 #2 fix); enforced
    at the DB layer by the `UNIQUE` index
    `idx_empty_leg_notifications_lead_leg_unique` from
    PR 1 §13 — a retry/race that slips past the EXISTS
    check still receives a PG `unique_violation` and the
    matching engine treats it as a successful skip
    (Codex iteration-5 P2 #1 fix: enforce uniqueness at
    the schema, not just the application layer).
63. `npm run test:empty-legs-matching` passes the
    table-driven scenarios.
64. `npm run test:empty-legs-frequency-cap` passes the
    per-customer 24h cap + per-leg dedupe scenarios.
65. Every wa.me prefilled outreach text carries the opt-
    out URL with a valid HMAC opt-out token embedded in
    the message body (Codex iteration-2 P1 #2 fix: email
    channel removed; iteration-4 P2 #1 fix: wording
    tightened to "wa.me prefilled outreach text").
66. `empty_leg_notifications` table writes one row per
    outbound notification with `lead_inquiry_id`, `leg_id`,
    `event_type` ∈ `('published', 'price_dropped')`,
    `channel = 'whatsapp_link'` (the CHECK constraint in
    PR 1 §13 permits only this single value after Codex
    iteration-2 P1 #2 fix), `wa_url` populated with the
    full pre-filled URL, `outreach_sent_at = NULL`
    (Codex iteration-4 P1 #1 fix: row enters the queue
    pending the founder's manual dispatch),
    `external_message_id = NULL` (wa.me has no provider
    message id), `sent_at = NOW()`.
67. After matching engine completes for a leg, every
    notified `lead_inquiries` row's
    `last_empty_leg_notified_at` is updated to the
    inserted notification row's `NEW.sent_at`
    **atomically** by the
    `empty_leg_notifications_update_last_notified`
    AFTER INSERT trigger (PR 1 §17; Codex iteration-7
    P1 #2 fix + iteration-9 P2 #2 wording fix: prior
    text said "updated to NOW()" while the trigger
    body assigns `NEW.sent_at` — harmonized to
    `NEW.sent_at` everywhere so probes assert against
    the same timestamp the SQL writes). The trigger
    fires inside the same transaction as the
    `empty_leg_notifications` INSERT, so the column is
    never out of sync with the queue write — even on
    application crash between the two writes.
68. After the matching engine writes audit rows for one
    cycle, `lib/empty-legs/founder-batch-email.ts` sends
    one batched Resend email to the founder
    (`EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` env var, falling
    back to `LEAD_NOTIFICATION_TO`) summarizing the new
    pending outreach with one section per leg + a deep-
    link to `/admin/empty-legs/outreach-queue`. **Visible
    degraded state** (Codex iteration-5 P2 #2 fix:
    missing `RESEND_API_KEY` or unresolved batch
    recipient is no longer a silent no-op): every send
    attempt UPDATEs the singleton
    `empty_leg_outreach_alert_status` row (PR 1 §16) to
    `'healthy'` on success, `'config_missing'` on
    missing env, or `'send_failed'` on Resend API error.
    The admin outreach queue page renders a red banner
    when status `<> 'healthy'`. Sentry receives a
    structured `console.error` event on every failure.
    Founder Probe 20 fails until configured (Codex
    iteration-11 P2 #1 fix: was Probe 19 before
    iteration-11's operator-bootstrap renumbering).
    Codex
    iteration-4 P1 #1 fix: this is the deliverable
    founder-facing surface that turns "audit row" into
    "outreach the founder will actually act on".
69. **Notification fail-closed when flag off + outbox
    replay (per-leg ordered branches)** (Codex
    iteration-5 P1 #1 fix + iteration-6 P1 #1 fix +
    iteration-10 P1 #1 fix: the matcher now applies
    the suppress-check BEFORE the flag-check
    per-leg, so canary suppressed legs are
    deterministically processed even while the flag
    is off): for each outbox leg id, the matcher
    branches in this order — (a) if
    `empty_legs.suppress_notifications = TRUE`, return
    `'suppress_notifications'` and DO mark
    `empty_leg_events_outbox.processed_at = NOW()`
    (suppression is intentional, replay would be
    wrong); (b) else if
    `ENABLE_EMPTY_LEGS_NOTIFICATIONS=false`, return
    `'notifications_disabled'` and do **NOT** mark
    the outbox row processed (rows stay
    `processed_at = NULL` for replay on the next cron
    tick after flag flips back to `true`); (c) else
    run the candidate-pool / frequency-cap /
    notification-write pipeline + mark the outbox row
    processed on success. No `empty_leg_notifications`
    rows are written under (a) or (b); frequency cap
    + per-leg dedupe + `wa_url`-NOT-NULL all
    preserved. Cron + Dutch-auction tick still run so
    price trajectories update; only the outreach +
    outbox-drain side is gated.
70. `expire_empty_leg_window(UUID)` exists in PR 2e's
    migration (Codex iteration-3 P2 #3 fix: 12th public
    function — PR 2a ships 11 publics + 1 helper after
    iteration-3 added `admin_release_empty_leg_reservation`;
    PR 2e adds this 12th in its own migration because its
    only caller is the cron route shipped in this same PR).
    SECURITY DEFINER + service-role-only EXECUTE; flips
    `status = 'expired'` for legs whose
    `auction_window_end_at <= NOW()`.

### Quality gates (every PR)

71. `npm ci` exits 0.
72. `npm run type-check` exits 0.
73. `npm run lint:strict` exits 0.
74. `npm run build` exits 0; the new public + admin +
    operator routes appear in the route table; the 3 cron
    routes appear under `λ` (Edge / Server Function).
75. `npm audit --json` count + severity breakdown unchanged
    from the Phase 6.2 closure baseline. **No new
    dependencies** in any PR; the Phase 7 implementation
    uses `inngest`'s already-installed types only if
    needed (otherwise Vercel Cron is sufficient and Inngest
    stays unused — preferred per §Resolved Decisions §5
    rationale).
76. Lockfile (`package-lock.json`) byte-identical to current
    `main` after each PR (no new deps).

### Branch protection

77. Every Phase 7 PR is reviewed by Codex to 100/100 before
    merge.
78. Every PR is merged via GitHub UI from a feature branch
    `phase-7/<pr-name>` rebased onto latest `main` at
    merge time. No `--force` push, no `--no-verify`.
79. Every PR's CI runs the full test suite + the new test
    scripts added in that PR.

### Documentation

80. `docs/CLAUDE-WORK-LOG.md` gains a Phase 7 closure entry
    after PR 2e merges, mirroring the Phase 6.2 closure
    entry shape (PR sequence table + production smoke
    results + coverage of paths NOT visually exercised +
    operational hygiene follow-up + What ships / What does
    not ship / Next phase).
81. `docs/checklists/empty-legs-smoke-test.md` is added with
    a numbered manual smoke checklist exercising:
    publish-as-admin → public marketplace shows it →
    reserve as anon → admin confirm → `bookings` row
    appears → `empty_legs.status = 'sold'` → admin
    cancellation flow → admin force-release of an
    active hold via #24/#38 → outreach queue dispatch
    via #39/#40.
82. `docs/checklists/README.md` indexes the new checklist.

### Scope discipline

83. No payment integration code anywhere in Phase 7
    (verified by grep against HyperPay / Moyasar / ZATCA
    package or url references in any PR diff).
84. No new npm dependencies in any PR.
85. No changes to the Phase 6.2 add-ons surface (no
    edits to `lib/addons/*`, `app/(checkout)/booking/[token]/*`,
    or `app/actions/checkout-prep.ts`).
86. No changes to the Phase 4/5 dispatch RPCs or the
    `accept_offer` body.
87. No new Sentry config; existing config unchanged.

## Risks Register

| # | Risk | Likelihood | Impact | Mitigation |
|:-:|---|---|---|---|
| R1 | The Dutch-auction curve formula floors out too aggressively (70%) and the founder loses operator goodwill — operators feel underpriced near departure. | Medium | High (operator churn). | Floor + initial are columns, not constants — admin can override per-leg via the publish form. Spec ships defaults; operations adjust live. |
| R2 | Notification frequency cap is too tight (≤ 1 / 24h) and customers miss good legs that price-drop after their last notification. | Medium | Medium. | Cap is configurable via `score-weights.ts`-level constant; an opening default of 1 is conservative. Codex iteration may push to 3. |
| R3 | Matching engine emits WhatsApp wa.me URLs to inactive `lead_inquiries` (e.g. 6-month-old leads) and damages founder/operator credibility (cold outreach to dormant numbers). | Medium | Medium (trust). | Add a hard cutoff: only `lead_inquiries` created in the last 90 days are eligible. Spec encodes this in `candidate-pool.ts`. (Iteration 2: previously cited Resend sender reputation; email channel is removed in Codex iteration-2 P1 #2 fix, so the risk shape shifted to WhatsApp credibility instead of email deliverability.) |
| R4 | `confirm_empty_leg_reservation` race with `expire_empty_leg_reservation` on a leg whose reservation just expired. | Low | Medium (false confirms). | Both RPCs hold the row lock; whichever wins flips the status atomically. The defensive `reservation_expires_at <= NOW()` check inside `confirm` provides defense in depth. Acceptance #22 covers this. |
| R5 | Vercel Cron misses a tick (free-tier cron has no SLA) — Dutch auction stalls. | Medium | Low (price stays stale until next tick fires). | The cron is idempotent and ticks every 30 minutes; a missed tick recovers on the next. The marketplace shows the auction trajectory so customers see the curve, not just the current snapshot — visible recovery. |
| R6 | RLS misconfiguration leaks reserved-rows' customer phone snapshots to anon. | Low | High (privacy + trust). | The existing RLS policy `empty_legs_public_available` permits SELECT only when `status = 'available'`, which excludes `'reserved'` rows entirely. Founder Probe 6 verifies this with a direct anon REST probe. |
| R7 | Operator session token leak — a 30-day token in operator hands gets shared / posted. | Medium | High (operator can mint legs as that operator). | Three-layer validation including DB hash; admin can revoke via session row delete. Tokens are single-use displayable (admin sees raw once, then hash only). 30 days is a tradeoff against re-mint friction; if Codex pushes back, drop to 7 days. |
| R8 | The `bookings.source_offer_table` CHECK constraint extension (PR 1 §5) fails idempotency under existing rows. | Low | Medium (migration aborts). | The existing `bookings_source_offer_check` is recreated DROP-and-recreate; the existing rows have `source_offer_table` ∈ `('phase4', 'phase5', NULL)`, all of which the new CHECK still permits. Verified by founder Probe 1. |
| R9 | The `_recompute_empty_leg_price` plpgsql formula drifts from `lib/empty-legs/auction-curve.ts`. | Medium | Medium (admin trajectory chart shows wrong curve vs. RPC-calculated price). | Both ports + parity test (`npm run test:empty-legs-curve`) at fixed sample points. Codex iteration must verify both ports. |
| R10 | Matching engine emits a wa.me URL; customer clicks reserve; leg flips to reserved — but the WhatsApp prefilled outreach text already mentioned a price; meanwhile the auction already dropped further by the time the customer reserves. | Low | Low (customer happy, price slightly different). | The wa.me URL lands on `/empty-legs/[leg_number]` which always shows the live current price. The WhatsApp outreach copy is "starting at X SAR — current price visible on the page" rather than promising a specific price. Codex iteration should verify the template copy enforces this. (Iteration 4: previously cited a customer email; email channel was removed in iteration-2 P1 #2, so the risk shape narrowed to wa.me prefilled text only.) |
| R11 | `customer_booking_id` ON DELETE SET NULL means a booking deletion silently nulls the leg's link. | Low | Low (deleted bookings are vanishingly rare in production). | Acceptable per Phase 6.2 ON DELETE pattern on `parent_booking_id`. Audit logs capture the booking deletion event regardless. |

## Open Questions

These need Codex iteration input before implementation. (Two
of the original 9 — the opt-in retroactive default and the
operator session storage shape — were resolved by Codex
iteration 1 P1 #1 and iteration 2 P1 #3 respectively, and
removed from this list. See the audit tables at the end of
the spec.)

1. **Outbox vs. NOTIFY for the event channel** — spec default
   is the outbox table (`empty_leg_events_outbox`) drained
   by cron. Alternative is PostgreSQL `LISTEN/NOTIFY`
   subscribed by the Next.js API route. Tradeoff: NOTIFY is
   instantaneous but unreliable across Vercel cold-starts;
   outbox is durable but has up-to-30-second latency
   (the cron interval; reduced to <1-minute for the
   `published` event by §7.6's synchronous match-trigger
   path — see Codex iteration-2 P2 #1 fix).
2. **Frequency cap default** — `≤ 1 per 24h` vs.
   `≤ 3 per 24h`. Spec defaults to 1 (conservative). Codex
   iteration should pick a number based on what
   WhatsApp-credibility / industry benchmarks support
   (iteration 2: scope narrowed from email deliverability
   to WhatsApp credibility per the email-channel removal).
3. **Auction floor default** — 70% off retail. Aggressive.
   Aviation industry typical empties discount: 25–75%, with
   60–70% common at urgent reposition. Codex should
   sanity-check the 70% floor against operator-margin
   feasibility (operator must cover at least fuel + crew on
   the empty seat).
4. **Auction curve order** — `^2` (quadratic-accelerating).
   Alternatives: linear, `^3` (more aggressive end-of-window
   drops). Codex iteration should pick.
5. **Customer reservation form fields** — Phase 7 captures
   only name + phone. Should it also capture passenger
   count (admin currently inherits `max_passengers`
   snapshot)? Spec defaults to name + phone only (lowest-
   friction form). (Iteration 2: the email-capture branch
   of this question is moot — email channel removed per
   Codex iteration-2 P1 #2; remaining open is passenger
   count only.)
6. **`ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` rollout
   duration** — Codex iteration-6 P2 #3 fix: the
   prior open question proposed "1 week behind PR 2e"
   while the canary plan in §Rollout safety + the
   Implementation Order both said "~24 hours". The
   canonical gate is now **founder-discretionary with
   a 24-hour minimum**: PR 2e ships with both
   `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = false` AND
   `ENABLE_EMPTY_LEGS_NOTIFICATIONS = false`; founder
   monitors `empty_leg_events_outbox` row counts +
   cron telemetry + `empty_leg_outreach_alert_status`
   for **at least 24 hours**, then flips both flags
   simultaneously per the canary plan. Founder may
   extend the gate to a week if telemetry surfaces
   anomalies — that decision is operational, not
   prescribed by the spec.
7. **Audit log retention** — `audit_logs` rows from PR 1's
   trigger could grow fast under cron-driven price ticks
   (every 30 minutes per available leg = ~48 rows/leg/day).
   Should the trigger only fire on status-or-reservation
   changes (NOT on price ticks) to control growth? Spec
   defaults to logging every change; Codex iteration may
   push to skip price-only ticks.

## Codex iteration 1 — findings (resolved in iteration 2)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | `lead_inquiries.empty_legs_opt_in BOOLEAN NOT NULL DEFAULT TRUE` (PR 1 §9) + checkbox defaulting CHECKED on `/request` (PR 2d) would retroactively mark every existing lead as eligible for outbound empty-leg WhatsApp/email notifications without explicit consent for the new marketing category. | Storage default flipped to `FALSE` (PR 1 §9; existing rows backfill `FALSE`). Both checkboxes (`/request` form and `/empty-legs/<leg_number>/reserve` form) now default UNCHECKED — only an explicit tick writes `TRUE`. Matching restricted to `TRUE` rows (acceptance #50). Resolved Decisions §6 reframed as opt-IN model. Open Question §9 (PDPL retroactive consent) removed — Codex's P1 finding answered it. |
| 2 | The acceptance criteria expected `notifications` rows with `recipient_lead_inquiry_id`, `metadata->>'leg_id'`, and `channel IN ('email','whatsapp_link')`, but the existing `notifications` table has `user_id NOT NULL`, `type` (column name), `channel notification_channel` (`whatsapp` not `whatsapp_link`), and `data` JSONB (not `metadata`). Phase 7 candidates are guest `lead_inquiries`, so PR 2e cannot write these audit rows as specified. | Schema reality §`notifications` rewritten with the actual column shape from `20260422000001_initial_schema.sql:484-496` and an explicit "Phase 7 does NOT write to `notifications`" line. PR 1 §12 adds a dedicated `empty_leg_notifications` table keyed on `lead_inquiry_id` + `leg_id` + `event_type` + `channel` with two indexes for the frequency-cap reads. Frequency-cap module (`lib/empty-legs/frequency-cap.ts`) and notification module (`lib/empty-legs/notifications.ts`) retargeted. Acceptance #51 + #55 rewritten. |
| 3 | PR 2d's `cancelMyReservation(leg_number, reservation_token)` Server Action had no backing RPC. `expire_empty_leg_reservation` is for already-expired holds; `cancel_empty_leg` is admin-side terminal cancel of the leg itself. Customer cannot release an active hold. | New RPC §7.2.6 `release_empty_leg_reservation(p_leg_id UUID, p_token_hash VARCHAR)` per Codex's exact prescribed signature. Validates the reservation-token hash + clears only the four reservation columns + flips status back to `available`. Acceptance #18 added. PR 2d Server Action retargeted to call this RPC. |
| 4 | `adminMarkSoldManual` was described as minting a reservation token, calling `reserve_empty_leg`, then calling `confirm_empty_leg_reservation` "in a single Server Action transaction". Supabase JS does not provide cross-RPC transactions, so this is non-atomic. | New RPC §7.2.10 `admin_mark_empty_leg_sold(p_leg_id UUID, p_customer_name TEXT, p_customer_phone TEXT)` collapses the whole flow into one SECURITY DEFINER body — admin path bypasses the reservation state entirely (founder collects verbal commit over WhatsApp before invoking, so no hold layer needed). Acceptance #22 added; #31 (was #28) rewritten to require single-RPC dispatch. |
| 5 | Schema reality said `booking_payment_status` is `('pending_offline', 'pending', 'paid')`, but the production ENUM also contains `'refunded'` from the original initial schema. | Schema reality §`booking_payment_status` rewritten to list all four values + an explicit "Phase 7 adds none" line per Codex's prescribed wording. |
| 6 | PR 1 fence said "no application code" while the same section adds `types/database.ts`, `lib/empty-legs/types.ts`, a TS test, `package.json`, and CI workflow changes — self-contradictory. | Fence rephrased to "no runtime UI/RPC code" per Codex's prescribed wording, with an explicit list of what PR 1 DOES land (DDL + parity-test scaffold + CI step + shared TS type module imported by PR 2a). |

## Codex iteration 2 — findings (resolved in iteration 3)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Schema reality §`lead_inquiries` (line 205-210) still said PR 1 adds `lead_inquiries.empty_legs_opt_in BOOLEAN DEFAULT TRUE`, despite Resolved Decisions §6 + PR 1 §9 already corrected to `DEFAULT FALSE`. The schema-reality block is a source of truth that founder probes read against — leaving it stale would re-seed the original P1. | Block rewritten per Codex's prescribed fix: enumerates the actual `lead_inquiries` columns (no `customer_email`), updates the consent column to `BOOLEAN NOT NULL DEFAULT FALSE`, adds the explicit "existing rows backfill `FALSE` automatically" line. |
| 2 | PR 2e's `lib/empty-legs/candidate-pool.ts` selected a non-existent `lead_inquiries.customer_email` column, and the notification module promised Resend email sends. The query could not compile and email notifications could not send. | Per Codex's prescribed fix ("remove the email channel from Phase 7 and make WhatsApp-link/manual outreach the only notification path"): candidate-pool query reduced to actual columns; `lib/empty-legs/notifications.ts` rewritten as WhatsApp-link-only; the two `*-email.ts` notification templates dropped from PR 2e Files; `empty_leg_notifications.channel` CHECK in PR 1 §12 tightened to `IN ('whatsapp_link')`; Resolved Decisions §6 reframed; acceptance #54 + #55 reworded; founder probe #18 shifted from email+WA to WA only; new env flag `ENABLE_EMPTY_LEGS_NOTIFICATIONS` added as a kill switch; `RESEND_API_KEY` reference removed from Rollout safety. The Phase 6.0 founder-notification email path (`lib/notifications/lead-email.ts`) is independent and unchanged. |
| 3 | `operator_empty_leg_sessions` table had no migration owner. PR 2c added pages/actions/store helpers only; three-layer token validation had nowhere to persist or revoke session hashes. | Per Codex's prescribed fix ("assign the required DDL to PR 1 or PR 2c"): storage decision resolved here in favor of the dedicated table (the iteration-1 default); DDL added to PR 1 as new §13 — table + 2 indexes + service-role-only RLS; Open Question §1 (Operator session storage shape) removed from the open list and acknowledged in the iteration-2 audit. PR 2c's `lib/operator/empty-leg-session-store.ts` description explicitly states "no DDL in this PR 2c — application code only". |
| 4 | §7.2 PR 2a heading still said "Seven SECURITY DEFINER public functions + one internal helper" while iteration 1 had grown the count to 10 publics + 1 helper (added `release_empty_leg_reservation` + `admin_mark_empty_leg_sold`). Heading drift would mislead implementers about grants, type registry, and probe design. | Heading + intro rewritten per Codex's prescribed fix to "10 SECURITY DEFINER public functions + 1 internal helper". A summary table added enumerating all 10 publics + the helper + their §-anchors and primary callers, so the count is now visible in one place at the top of the section. Founder probe 5 already mentions "10 publics + 1 helper" — that phrasing now matches the heading. |
| 5 | Founder Probe 15 expected a notification "within 1 minute" while PR 2e fanned matching out only via the 30-minute-interval cron — probe would fail intermittently. | Per Codex's prescribed fix ("add a synchronous trigger path and document it in §7.6"): §7.6 PR 2e gains a "Synchronous match-trigger on publish" sub-section. Both `adminPublishEmptyLeg` (PR 2b) and `operatorPublishEmptyLeg` (PR 2c) Server Actions fire-and-forget POST `/api/empty-legs/internal/match-trigger` immediately after `publish_empty_leg` succeeds. The match-trigger route is idempotent so the synchronous fire + cron drain cannot double-notify. `price_dropped` event continues to flow via the cron path only — its SLA matches the cron interval since the price-tick itself fires from the cron. Founder Probe 15 reworded to point at the synchronous path. |
| 6 | `reserve_empty_leg`'s body said "deferred to PR 2d as a small dedicated RPC `increment_empty_leg_views`", but PR 2d's file list / RPC list / acceptance criteria / probes never included this function — dangling reference. | Per Codex's prescribed fix's first option ("remove view-count mutation from Phase 7"): `views_count` mutation dropped entirely. The `views_count` column from the initial schema stays at `DEFAULT 0` and is unused in Phase 7; available for a future phase if/when view tracking becomes a product need. `reserve_empty_leg` step 5 reworded to make this explicit. |

## Codex iteration 3 — findings (resolved in iteration 4)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | §7.6 PR 2e added a "Synchronous match-trigger on publish" sub-section after iteration-2 P2 #1, but PR 2e's Files (Edit) list did not include `app/actions/empty-legs.ts` or `app/actions/operator-empty-legs.ts`. Those Server Actions ship in PR 2b/2c; without explicitly editing them in PR 2e, the new 1-minute publish SLA could never be wired. | Per Codex's prescribed fix ("Add both action files to PR 2e's file fence and acceptance/probes"): PR 2e Files (Edit) extended with both Server Action paths and an explicit fire-and-forget POST contract (`Authorization: Bearer $CRON_SECRET`, no-await, latency-bounded). Acceptance #49 added enumerating both paths. |
| 2 | PR 2b Case-2 admin "إلغاء التحفظ" button called `expire_empty_leg_reservation`, but that RPC returns `{ ok: true, no_op: true }` when `reservation_expires_at > NOW()` — the visible button could not actually release an active hold. | Per Codex's prescribed first option ("a dedicated `admin_release_empty_leg_reservation` RPC"): new RPC §7.2.7 — admin counterpart to the customer-side §7.2.6 `release_empty_leg_reservation` but without the token-hash check. Subsequent §7.2.X renumbered through §7.2.12. PR 2b Case-2 description retargeted; admin Server Action `adminReleaseReservation` added to PR 2b Files (Add). Acceptance #19 + #33 added. `expire_empty_leg_reservation` body unchanged but acceptance #21 reaffirmed it as cron-only. |
| 3 | PR 2d Founder Probe 11 still said "receive a notification email with the opt-out link" after iteration-2 P1 #2 removed the email channel; matching/notifications also do not ship until PR 2e, so an end-to-end notification probe at PR 2d was impossible regardless. | Per Codex's prescribed first option ("validate the opt-out lander with a manually minted opt-out token"): Probe 11 reworded — service-role psql/Node mints a one-shot opt-out token, opens the lander in incognito, confirms the flip via service-role psql query. End-to-end opt-out via a real wa.me notification is verified later in Probe 18 (post-PR-2e). |
| 4 | Resolved Decisions §6 still said "every email + WhatsApp text includes a signed opt-out URL" + `lib/empty-legs/opt-out-token.ts` Files entry said "every notification email + WhatsApp link" — stale email wording from iteration 2. | Per Codex's prescribed wording ("every WhatsApp prefilled text / wa.me notification body"): both locations rewritten using that exact phrasing. |
| 5 | Risk R3's mitigation promised "only `lead_inquiries` created in the last 90 days are eligible. Spec encodes this in `candidate-pool.ts`" but the canonical query in §7.6 only filtered on `empty_legs_opt_in` + `last_empty_leg_notified_at`. | Per Codex's prescribed first option ("Add `created_at >= NOW() - INTERVAL '90 days'` to the canonical query and acceptance/probes"): query updated. Acceptance #53 (was #50) extended with the same clause. R3 mitigation now matches the query. |
| 6 | PR 2e expire-windows cron description said `expire_empty_leg_window` is "the 10th RPC; PR 2a only ships 7 + 1 helper + the empty-stub event hook = 9" — but iteration-2 grew PR 2a to 10 publics + 1 helper, and iteration-3 P1 #2 grew it further to 11 publics + 1 helper. | Per Codex's prescribed fix ("Update this count and clarify whether `expire_empty_leg_window` is the 11th public function shipped in PR 2e, including grants/probes for it"): PR 2e cron description rewritten to enumerate "PR 2a ships 11 publics + 1 helper after iteration-3" + "PR 2e adds this 12th public, `expire_empty_leg_window`, in its own migration". §7.2 PR 2a summary table acknowledges PR 2e's 12th in a trailing line. Acceptance #60 added enumerating the 12th public's existence + grants. |

## Codex iteration 4 — findings (resolved in iteration 5)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | After the email-channel removal, `notifications.ts` only wrote audit rows + claimed an out-of-band channel or future WhatsApp Business API was what actually delivered. That meant Phase 7 no longer SENT notifications — it only generated outreach/audit rows. The objective + acceptance + founder probes still expected candidates to be notified within 1 minute. | Per Codex's prescribed first option ("add an actual deliverable founder-facing send queue/surface for these wa.me links"): PR 1 §12 extended with `wa_url TEXT NOT NULL` + `outreach_sent_at TIMESTAMPTZ NULL` + a partial pending-rows index; PR 2b adds `/admin/empty-legs/outreach-queue` page + `markOutreachSent` Server Action + `outreach-row.tsx` component + sidebar entry; PR 2e adds `lib/empty-legs/founder-batch-email.ts` + a Resend founder-batch template; `notifications.ts` rewritten to enqueue + trigger batch + write `wa_url` + `outreach_sent_at = NULL`; new env var `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO`; acceptance #34 + #35 + #62 added; Founder Probes 18 + 19 + 20 added. Phase 7 now has a real customer-delivery surface — founder gets the batch alert, opens the queue, dispatches each wa.me URL via WhatsApp Business, marks the row sent. Customer-side email channel remains removed per iteration-2 P1 #2. |
| 2 | PR 2d added `lib/empty-legs/__tests__/reservation-token.test.ts` + said `npm run test:empty-legs-token` script was added, but the `package.json` + CI workflow edits that wire that script were under PR 2e — the gate was un-runnable in PR 2d. | Per Codex's prescribed fix ("Move `package.json` and `.github/workflows/ci.yml` updates for `test:empty-legs-token` into PR 2d's file fence"): both edits added to PR 2d's CI parity test block; PR 2e's Files (Edit) corrected to exclude the token-test script + step. Acceptance #48 reworded to require both edits to ship in PR 2d. |
| 3 | Founder Probe 5 still required "10 publics + 1 helper" after iteration-3 P1 #2 grew PR 2a to 11 publics — the production grant probe could miss or reject the new `admin_release_empty_leg_reservation` RPC. | Per Codex's prescribed fix ("Update the probe to require exactly 11 public functions + the revoked helper, and explicitly include `admin_release_empty_leg_reservation` in the grants check"): Probe 5 rewritten to enumerate all 11 PR-2a publics by name + require service-role-only EXECUTE on each + zero grantees on the helper. PR 2e's 12th public (`expire_empty_leg_window`) is verified separately in Probe 14's expire-windows section. |
| 4 | Probe 11's correction note still carried the words "notification email" + "removed the email channel" — stale wording in the active probe text even though the probe body itself was correct. | Per Codex's prescribed fix ("Reword it to use the manually minted opt-out token described in the iteration-4 summary"): correction note removed in favor of the audit-trail line at the end ("prior wording carried a multi-line correction note referencing the removed email channel; full audit trail lives in the iteration-3 + iteration-4 findings tables"). Probe body itself unchanged. |
| 5 | Risk R10 still said "the customer's email already promised that price" + "the email + WhatsApp link land on `/empty-legs/[leg_number]`" — stale email language after iteration-2 P1 #2 dropped the email channel. | Per Codex's prescribed fix ("rewrite around the WhatsApp prefilled outreach text / wa.me link only"): R10 rewritten — "wa.me URL emitted by matching engine" + "WhatsApp prefilled outreach text already mentioned a price" + "wa.me URL lands on `/empty-legs/[leg_number]`" + an iteration-4 footnote explaining the shift. |
| 6 | `expire_empty_leg_reservation` body still said "Could also be called ad hoc by admin to release a stuck reservation", contradicting iteration-3 P1 #2 which created `admin_release_empty_leg_reservation` specifically for admin force-release + kept expiry cron-only. | Per Codex's prescribed fix ("Tighten this text so implementers do not wire admin UI back to the cron-expiry RPC"): heading changed to "cron-callable ONLY"; "ad hoc admin" sentence removed and replaced with explicit "admin-side force-release of an active hold uses `admin_release_empty_leg_reservation` (§7.2.7) instead". |

## Codex iteration 5 — findings (resolved in iteration 6)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Notification blackout in §Rollout safety said the engine still records audit-row intents but skips the wa.me URL emit step when `ENABLE_EMPTY_LEGS_NOTIFICATIONS=false`. That conflicted with `empty_leg_notifications.wa_url TEXT NOT NULL`; worse, it consumed the 24h frequency cap + per-leg dedupe without delivering a founder-dispatchable outreach link. | Per Codex's prescribed first option ("when `ENABLE_EMPTY_LEGS_NOTIFICATIONS=false`, do not create `empty_leg_notifications` rows at all"): blackout rewritten to fail-closed. The matcher in `lib/empty-legs/matching.ts` checks the env flag at the top and returns `{ ok: true, skipped: 'notifications_disabled' }` BEFORE any candidate-pool read or audit-row INSERT. Frequency cap + per-leg dedupe state is therefore not consumed; `wa_url`-NOT-NULL constraint is preserved; outbox rows still drain to keep the queue from piling up. New acceptance #65 enforces. |
| 2 | Canary plan in §Rollout safety published legs while `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = false` AND notified real `lead_inquiries` customers — their wa.me URLs landed on 404 pages. That is a broken customer experience by design, not a safe canary. | Per Codex's prescribed first option ("Keep notifications off until the public marketplace flag is on"): canary plan rewritten. Step 1 — PR 2e merges with both `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE=false` AND `ENABLE_EMPTY_LEGS_NOTIFICATIONS=false`; matcher fail-closes (per fix #1 above). Step 2 — founder publishes 1–2 internal-only test legs to exercise outbox + crons; no wa.me URL is generated. Step 3 — founder verifies for ~24h. Step 4 — both flags flip **simultaneously**. The "real customer hits 404" failure mode is impossible because no wa.me URL exists until the marketplace is also live. Implementation Order updated to require co-flipping. |
| 3 | `idx_empty_leg_notifications_lead_leg_unique` was named UNIQUE in the DDL but created as a plain non-unique index. The per-leg dedupe contract ("a candidate is never notified about the same leg twice") relied on application-level `EXISTS` only — a retry/race could insert duplicate rows. | Per Codex's prescribed fix ("Add a unique index/constraint matching the intended policy, likely `(lead_inquiry_id, leg_id)`"): index changed to `CREATE UNIQUE INDEX` on `(lead_inquiry_id, leg_id)`. Acceptance #12 + #58 both updated. The matching engine catches `unique_violation` errors and treats them as successful skips. PR 1 §12 DDL now ships the UNIQUE keyword; the application-level EXISTS check stays as the friendlier first-line surface but the DB layer is the authoritative guarantee. |
| 4 | The founder batch email's missing-`RESEND_API_KEY` path was a silent no-op. Phase 7's customer-delivery surface depends on the founder seeing the alert email; a silent failure would let the outreach queue look healthy while no one was alerted. | Per Codex's prescribed fix ("Treat missing `RESEND_API_KEY` / `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` as visible degraded state: log structured error, expose a banner/count on the outreach queue, and make the founder probe fail until configured"): all three actions taken. PR 1 §14 adds singleton table `empty_leg_outreach_alert_status` with status enum `('healthy', 'config_missing', 'send_failed')`. `lib/empty-legs/founder-batch-email.ts` UPDATEs the singleton on every send attempt + emits structured `console.error` to Sentry on failure. PR 2b's `outreach-queue` page reads the singleton on every render + renders a red Arabic-RTL banner when status `<> 'healthy'`. Founder Probe 18 reworded as gate-failing — PR 2e cannot be marked smoke-passed if the email is not received. New acceptance #13 + #37 + revised #62 enforce. |
| 5 | PR 2b's `app/actions/empty-legs.ts` block still introduced "4 admin Server Actions" after iteration-3 P1 #2 added `adminReleaseReservation` and iteration-4 P1 #1 added `markOutreachSent` — count was 6, not 4. | Per Codex's prescribed fix ("Update the heading/count and any related quality-gate wording to include all five admin actions"): block heading corrected from "4 admin Server Actions" → "6 admin Server Actions" with an explicit footnote enumerating which iterations added which two new actions. (Codex finding said "all five" — there are actually 6 because iteration-4 P1 #1's `markOutreachSent` also belongs in this block; the count is 4 → 5 → 6.) |

## Codex iteration 6 — findings (resolved in iteration 7)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | The iteration-5 fail-closed path said no `empty_leg_notifications` rows are written when notifications are disabled, but it still drained `empty_leg_events_outbox` + set `processed_at = NOW()`. That meant the same legs would not be matched later when the flag turned `true` — publish + price-drop events lost across the entire blackout window, contradicting the canary plan's promise of clean replay. | Per Codex's prescribed first option ("do not mark outbox rows processed while notifications are disabled"): the match-trigger route now distinguishes the "matching ran" path (sets `processed_at = NOW()`) from the "matcher returned `notifications_disabled`" path (leaves `processed_at = NULL`). The unprocessed rows are eligible for replay on the next cron tick after the flag flips back. Rollout safety adds an "Outbox backlog bound" paragraph + a one-line operational ritual for the >7-day-blackout recovery case (`DELETE FROM empty_leg_events_outbox WHERE emitted_at < NOW() - INTERVAL '7 days' AND processed_at IS NULL`). Acceptance #65 + the matching.ts description in §7.6 spell out the contract. |
| 2 | Founder Probe 4 still required "the two indexes" on `empty_leg_notifications` after iteration-4 P1 #1 + iteration-5 P2 #1 grew the index count to 3 — the 24h-lookup, the UNIQUE lead+leg, and the outreach-pending partial. The probe could miss or confuse the new pending-queue index. | Per Codex's prescribed fix ("Update the probe to require all three indexes by name"): Probe 4 rewritten — `\d+ empty_leg_notifications` shows all three indexes by name with their column lists + UNIQUE / partial-WHERE clauses called out. Each index is anchored back to the iteration that introduced it for traceability. |
| 3 | `lib/empty-legs/__tests__/frequency-cap.test.ts` description still said "mock `notifications` reader" after iteration-2 P1 #2 retargeted Phase 7 outreach to the dedicated `empty_leg_notifications` table — reintroducing the table-shape confusion that had been resolved earlier. | Per Codex's prescribed fix ("Rename the test contract to mock/read `empty_leg_notifications` and assert against `sent_at`, `lead_inquiry_id`, and `leg_id` from that table"): the test description rewritten — mock now reads `empty_leg_notifications` and returns `{ lead_inquiry_id, leg_id, sent_at }` rows; assertions exercise the 24h-window + per-leg-dedupe logic against those. |
| 4 | Open Question §6 said the staged rollout keeps the marketplace flag off for **one week** after PR 2e, while §Implementation Order + §Rollout safety canary plan said the founder monitors telemetry for **~24 hours** before flipping both flags. Implementers + the closure checklist would disagree on the canonical gate duration. | Per Codex's prescribed fix ("Pick one canonical gate duration, or state that the duration is founder-discretionary with a minimum"): Open Question §6 rewritten — canonical gate is "**founder-discretionary with a 24-hour minimum**". Founder may extend to a week if telemetry surfaces anomalies — that decision is operational, not prescribed by the spec. The 24-hour minimum aligns with the Implementation Order + canary plan. |

## Codex iteration 7 — findings (resolved in iteration 8)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Acceptance #56 said the match-trigger route drains the outbox and marks each row `processed_at = NOW()` — contradicting the iteration-6 fail-closed contract that ordered rows stay unprocessed on `'notifications_disabled'` skip. The implementation contract section is what implementers code from, so this could reintroduce the event-loss bug. | Per Codex's prescribed fix ("Add the explicit exception here: only mark rows processed when matching actually ran; leave rows unprocessed when notifications are disabled"): acceptance #58 (was #56) reworded — "marks each row `processed_at = NOW()` **only when matching actually ran** ... leave rows unprocessed when the matcher returned `'notifications_disabled'`". The matching.ts description in §7.6 already enforces this; #58 now matches. |
| 2 | The candidate query in `lib/empty-legs/candidate-pool.ts` filtered by `lead_inquiries.last_empty_leg_notified_at`, but no write path actually updated that column. The 24-hour cap could only be enforced via the separate `empty_leg_notifications.sent_at` read in `frequency-cap.ts` — leaving a window where a single matching cycle that bypassed the application-level cap could select the same candidate for multiple legs in 24 hours. | Per Codex's prescribed first option ("update `last_empty_leg_notified_at = NOW()` atomically with the queue insert"): PR 1 gains §16 — a DB trigger `empty_leg_notifications_update_last_notified` that fires AFTER INSERT on `empty_leg_notifications` and UPDATEs `lead_inquiries.last_empty_leg_notified_at = NEW.sent_at` inside the same PostgreSQL transaction. Atomicity is guaranteed at the DB layer; application code does not need to remember the second UPDATE. Acceptance #15 (new) + #65 (was #61, now references the trigger explicitly) enforce. |
| 3 | The canary plan published internal-only test legs with `ENABLE_EMPTY_LEGS_NOTIFICATIONS = false`. Per iteration-6 P1 #1 fix, the outbox rows for those test legs stayed unprocessed. When both flags later flipped, the backlog drained and would notify real customers about those internal test legs unless they had expired or been manually purged. | Per Codex's prescribed third option ("add a real `internal_only/suppress_notifications` marker that the matcher always excludes"): PR 1 gains §11 — new column `empty_legs.suppress_notifications BOOLEAN NOT NULL DEFAULT FALSE`. The matching engine's leg-eligibility check excludes `suppress_notifications = TRUE` legs entirely (no audit row, no wa.me URL, no founder batch entry — the outbox row is marked `processed_at = NOW()` because the suppression is intentional, not a deferred state). Admin publish form in PR 2b gets a "رحلة اختبار داخلية — لا ترسل تنبيهات" Arabic-RTL checkbox that defaults UNCHECKED on production publish; the canary's test-leg publishes tick it. matching.ts gains a "Suppress-notifications leg filter" sub-section. New acceptance #12 + #31 + #59 (was #57) enforce. |
| 4 | Founder Probe 15 expected a queue row within 1 minute, but the rollout safety section says PR 2e initially deploys with `ENABLE_EMPTY_LEGS_NOTIFICATIONS = false` and the matcher fail-closes — the queue row would never appear and the probe would fail spuriously. The probe lacked the explicit precondition that both `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` and `ENABLE_EMPTY_LEGS_NOTIFICATIONS` must be flipped to `true` first. | Per Codex's prescribed fix ("The probe should explicitly say it runs only after the founder flips both marketplace and notifications flags, or add a separate pre-flip probe that asserts no queue rows are created while the flag is disabled"): both. New Probe 15 (Pre-flip flag-off assertion) — verifies that with both flags `false`, NO `empty_leg_notifications` row is written for a published leg AND the outbox row stays `processed_at IS NULL`. New Probe 16 (Matching engine output, post-flip) carries the explicit "this probe runs ONLY after the founder has flipped BOTH flags" header. Probes 17–21 renumbered accordingly; cross-references in #58, #66, and the founder-batch-email contract updated. |

## Codex iteration 8 — findings (resolved in iteration 9)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Implementation Order Step 6 said the matching engine "fail-closes (skip + outbox drain only)" while notifications are disabled — that directly contradicted iteration-7 P1 #1's contract that disabled notifications must leave `processed_at = NULL` so events replay after the flags flip. The Implementation Order is the authoritative deploy contract, so the stale wording could resurrect the event-loss bug. | Per Codex's prescribed fix ("Update this line to say the matcher skips without marking outbox rows processed, except for `suppress_notifications=TRUE` legs where suppression is intentional"): Step 6 reworded — "**skips without marking outbox rows processed**" + explicit exception "the only exception is `suppress_notifications = TRUE` legs (Codex iteration-7 P1 #3 fix), where the outbox row IS marked `processed_at = NOW()` because the suppression is intentional, not a deferred-matching state". Now matches the §Rollout safety + §7.6 contracts. |
| 2 | The canary plan said "internal-only test legs" but the actionable steps never explicitly required ticking the new `suppress_notifications` checkbox or verifying the column. If the founder published these as normal legs while notifications were disabled, their outbox rows would stay pending and replay to real customers after both flags flipped — defeating the iteration-7 P1 #3 marker entirely. | Per Codex's prescribed fix ("Make the canary step explicit: publish test legs with `suppress_notifications=TRUE`, verify the column, and verify their outbox rows are processed/skipped as suppressed before enabling notifications"): canary Step 2 reworded with bold "with the 'رحلة اختبار داخلية — لا ترسل تنبيهات' checkbox TICKED" requirement + Step 3 expanded with three explicit verification queries: (1) `suppress_notifications = TRUE` per leg, (2) outbox rows `processed_at` non-NULL (suppression branch marks them processed), (3) zero `empty_leg_notifications` rows for the suppressed legs. The matcher's suppression branch (per acceptance #59 + §7.6 matching.ts contract) is what makes this safe. |
| 3 | Implementation Order Step 1 (PR 1) said "No application code" — drift from earlier iterations (iteration-1 P2 #2 had settled the wording as "no runtime UI/RPC code" + scope ships TS scaffolding + Probe 4). The implementation checklist is what implementers code from; stale wording at this layer could prompt a "PR 1 ships zero `.ts` files" misread. | Per Codex's prescribed fix ("Update the implementation order to match the current file fence and to call out Probes 1-4"): Step 1 rewritten — "**No runtime UI/RPC code** ... PR 1 ships DDL + the parity-test scaffold + the CI step + the shared TS type module that PR 2a imports. Founder Probes 1, 2, 3, 4, 4a, 4b verify schema state in production". Step 2 (PR 2a) parallel-updated to enumerate "Founder Probes 5, 6, 7". |
| 4 | PR 1 founder probes verified `empty_legs` shape, the `bookings.source_offer_table` CHECK extension, and the `empty_leg_notifications` shape with all 3 indexes — but never explicitly verified the iteration-6 P2 #2 `empty_leg_outreach_alert_status` singleton seed/enum or the iteration-8 P1 #2 AFTER INSERT trigger wiring. Either schema piece could be missing or misconfigured in production and only surface in PR 2e (where the trigger is invoked + the alert-status row is read). | Per Codex's prescribed fix ("Add explicit PR1 probe checks for the trigger/function wiring and the alert-status seeded row/status enum"): two new probes added in the after-PR-1 section. Probe 4a verifies the singleton row exists with `id = 1, status = 'healthy'`, the status CHECK enumerates the three allowed values, and a violation `INSERT (id=2)` is rejected by the CHECK (singleton-lock proof). Probe 4b verifies the trigger exists with `event_manipulation = 'INSERT'` + `action_timing = 'AFTER'`, the function `_update_lead_inquiry_last_notified` is SECURITY DEFINER + zero grantees, and a synthetic-INSERT-then-rollback smoke test confirms the `lead_inquiries.last_empty_leg_notified_at` flips to the inserted `sent_at` value. Implementation Order Step 1 + Iteration 9 history both call out the new probes by number. |

## Codex iteration 9 — findings (resolved in iteration 10)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Probe 15 (Pre-flip flag-off assertion) published a test leg with both flags `false` and verified the outbox row stayed `processed_at = NULL` (the iteration-7 P1 #1 fail-closed signal). But that unsuppressed pending row was exactly the iteration-7 P1 #3 + iteration-8 P1 #2 hazard — when both flags later flipped, the cron would drain the row, the matcher would run, real `lead_inquiries` candidates would receive wa.me URLs for a probe-only leg. The probe was meant to verify safety; instead it staged the unsafe state. | Per Codex's prescribed first option ("Make this probe either use `suppress_notifications=TRUE` and expect intentional processing/no rows"): Probe 15 reworded — the test leg is published with the "رحلة اختبار داخلية" checkbox TICKED so `suppress_notifications = TRUE`. The verify-block now expects three conditions: (a) `suppress_notifications = TRUE` (publish-form wired through), (b) zero `empty_leg_notifications` rows for the leg (suppression branch + fail-closed both exclude it), (c) outbox `processed_at` non-NULL (suppression branch intentionally marks processed — distinct from the unsuppressed flag-off case). The probe leg stays in production permanently with `suppress_notifications = TRUE` so the leg-eligibility filter (acceptance #59) excludes it from every future matching cycle even after flag flip. |
| 2 | Probe 4b's smoke test asked the founder to INSERT a synthetic `empty_leg_notifications` row against a known `lead_inquiries.id`, but `empty_leg_notifications` also requires a valid `leg_id` FK to `empty_legs(id)`. On a fresh/quiet production state (which is exactly what PR 1 ships into — `empty_legs` is unused per Schema reality §) the smoke would fail for fixture reasons rather than trigger wiring, masking the very wiring check the probe was added to perform. | Per Codex's prescribed fix ("Spell out a transaction-scoped fixture: `BEGIN`, create or select a valid test `empty_legs.id`, insert the notification row, assert `last_empty_leg_notified_at`, then `ROLLBACK`"): Probe 4b's smoke step rewritten with a full transaction-scoped fixture: `BEGIN` → INSERT throwaway `empty_legs` row with every required column populated → SELECT an existing `lead_inquiries` row → capture a `fixed_sent_at` timestamp via `SELECT NOW()` → INSERT the `empty_leg_notifications` row referencing both → assert the lead's `last_empty_leg_notified_at = :fixed_sent_at` → `ROLLBACK`. Production is left byte-identical. |
| 3 | The PR 1 §16 trigger description prose said the trigger updates `lead_inquiries.last_empty_leg_notified_at = NOW()` atomically, but the actual SQL body assigned `NEW.sent_at`. The two values are normally identical (because `empty_leg_notifications.sent_at` defaults to `NOW()` on INSERT) but smoke probes asserting against `now()` would trip on a tiny time mismatch. | Per Codex's prescribed fix ("`NEW.sent_at` is the better source because it tracks the notification row exactly, but the prose/acceptance should say that consistently so implementers and probes do not assert a tiny time mismatch against `now()`"): all three locations harmonized to `NEW.sent_at`: (a) PR 1 §16 prose ("...updates `lead_inquiries.last_empty_leg_notified_at` to the inserted row's `NEW.sent_at`"), (b) acceptance #65 ("updated to the inserted notification row's `NEW.sent_at`"), (c) Probe 4b's smoke-test assertion (`last_empty_leg_notified_at = :fixed_sent_at`, where `:fixed_sent_at` is the explicit timestamp the INSERT set). |

## Codex iteration 10 — findings (resolved in iteration 11)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | The matcher's `ENABLE_EMPTY_LEGS_NOTIFICATIONS !== 'true'` check ran at the top of the matcher and returned `'notifications_disabled'` BEFORE any per-leg work. But Probe 15 + the canary plan rely on `suppress_notifications=TRUE` legs being detected and their outbox rows marked `processed_at = NOW()` even while notifications are disabled. With the prior order, suppressed canary legs took the `notifications_disabled` branch and stayed `processed_at = NULL` — the iteration-7 P1 #3 + iteration-9 P1 #1 marker promised replay-safe canaries but the prior matcher order broke that promise. | Per Codex's prescribed fix ("Reorder the contract so each outbox leg first checks `empty_legs.suppress_notifications`; if true, mark processed with no notification rows. Only non-suppressed legs should then hit the notifications-disabled replay path"): matching.ts + acceptance #67 + §Rollout safety blackout block rewritten with per-leg ordered branches — branch (a) `suppress_notifications` runs FIRST per leg and DOES mark outbox processed; branch (b) `notifications_disabled` runs second for non-suppressed legs only and leaves outbox unprocessed; branch (c) candidate matching runs last. Mixed-batch cycles now work correctly: canary legs are deterministically processed while real legs in the same cycle correctly defer to replay. |
| 2 | PR 1 §3 added `departure_airport_freeform_snapshot` + `arrival_airport_freeform_snapshot` columns + presence CHECKs but did NOT drop `NOT NULL` from `empty_legs.departure_airport` + `empty_legs.arrival_airport`. Schema reality `empty_legs` has both as `VARCHAR(10) NOT NULL REFERENCES airports(iata_code)` — so a freeform-only publish input or Probe 4b's throwaway fixture (which uses freeform-only) would fail with a NOT NULL violation before any presence CHECK ran. | Per Codex's prescribed fix ("PR 1 must relax both IATA columns to nullable and the acceptance/probes should verify that nullability, mirroring the Phase 6.2 bookings route-snapshot fix"): PR 1 §3 rewritten — explicit `ALTER TABLE empty_legs ALTER COLUMN departure_airport DROP NOT NULL` + same for `arrival_airport`. The IATA FKs to `airports(iata_code)` stay in place so populated values still resolve. Mirrors the Phase 6.2 PR 1 `bookings.route_*` route-snapshot relaxation. Acceptance #3 reworded to assert nullability. Probe 4b's freeform-only fixture now compiles. |
| 3 | PR 2c minted operator session tokens for a known `operators.id`, but Schema reality says the `operators` table is empty in production and Phase 7 had no PR/probe creating or verifying an operator row before this surface needed one. Every operator-portal smoke step (mint session, validate token, list operator's legs) would fail for fixture reasons rather than wiring reasons. | Per Codex's prescribed fix ("Add an explicit bootstrap contract: either PR 2c includes an admin-only create/seed-operator surface, or the founder must create/verify a real `operators` row via a pre-PR2c probe before minting the session token"): both. PR 2c Files (Add) gain `app/(admin)/admin/(protected)/empty-legs/operators/page.tsx` (admin listing + create-operator form) + `app/actions/operators.ts` (`adminCreateOperator` Server Action that INSERTs the `operators` row). The session-mint page reads operators from this listing. Founder Probe 9 added (Operator bootstrap) — verifies the listing renders, the form INSERTs, and the new `operators.id` is captured for use in the next probe. Prior Probe 9 (Operator session token) renumbered to Probe 10; subsequent probes 10–21 cascaded to 11–22; cross-references in #67 + the founder-batch-email contract + audit text updated. |

## Codex iteration 11 — findings (resolved in iteration 12)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | The iteration-10 operator-bootstrap surface said it INSERTs an `operators` row with `id, name, contact_email, contact_phone, status` — but the real `operators` table from the initial schema requires `user_id NOT NULL REFERENCES users(id)` + `company_name` (not `name`) + `commercial_registration` + `gaca_license` + `license_expiry`. Probe 9's `SELECT id, name FROM operators` would also fail. The bootstrap path could not actually insert anything. | Per Codex's prescribed second option ("add a dedicated Phase 7 operator-stub table instead of inserting into `operators`"): PR 1 §14 added — `phase7_operator_stubs` table with the minimum fields the lightweight Phase 7 model needs (`id`, `company_name`, `contact_email`, `contact_phone`, `status` ∈ `('active', 'archived')`, optional `notes`). Column names mirror the real `operators` table so Phase 8's onboarding flow can migrate stubs into real operators with a SQL-level rename + linkage instead of a column-name remap. PR 1 §15 (`operator_empty_leg_sessions`) FK retargeted from `operators(id)` to `phase7_operator_stubs(id)`. PR 2c bootstrap surface + `adminCreatePhase7OperatorStub` Server Action + Probe 9 all retargeted to the stub table. Acceptance #14 (new — table exists) + #15 (new — FK redirect) + renumber of #16 (alert_status, was #14) and #17 (trigger, was #15). Total acceptance: 85 → 87. |
| 2 | PR 1's lead-in promised "every `CREATE TABLE` is `IF NOT EXISTS`" and Probe 1 required migration re-runnability, but the concrete SQL snippets for `empty_leg_notifications`, `operator_empty_leg_sessions`, and `empty_leg_outreach_alert_status` all used plain `CREATE TABLE`. Re-running PR 1 would fail on existing relations. | Per Codex's prescribed fix ("Make every new table snippet explicitly `CREATE TABLE IF NOT EXISTS`, or wrap creation in equivalent idempotent DO blocks"): all three table snippets changed to `CREATE TABLE IF NOT EXISTS`. Same fix applied to all 5 `CREATE INDEX` statements (idempotency rule extended to `CREATE INDEX IF NOT EXISTS`). The trigger creation in §17 prefixed with `DROP TRIGGER IF EXISTS empty_leg_notifications_update_last_notified ON empty_leg_notifications;` so re-runs do not collide. PR 1 lead-in updated to enumerate the new `CREATE INDEX IF NOT EXISTS` rule alongside the existing `CREATE TABLE IF NOT EXISTS` rule. |
| 3 | Acceptance #66 (founder-batch alert) still said "Founder Probe 19 fails until configured" — but iteration-11 P1 #3's operator-bootstrap probe insertion shifted the founder-batch email probe to #20. Acceptance probe-cross-ref in PR 2d's Probe 12 still said "End-to-end opt-out via a real wa.me notification is verified in Founder Probe 21" — but that probe was now Probe 22 after the same renumbering. | Per Codex's prescribed fix ("the probe numbers should match the active list"): both cross-refs corrected — acceptance #66 → "Founder Probe 20 fails until configured" with an iteration-11 P2 #1 audit annotation; PR 2d Probe 12 → "Probe 22 after PR 2e ships" with the same annotation. (After iteration-12's +2 acceptance-shift, these probe numbers stay correct because Probe numbers are independent of acceptance numbers — only acceptance #s shifted.) |

## Codex iteration 12 — findings (resolved in iteration 13)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | PR 1 created `phase7_operator_stubs` and retargeted sessions there, but `empty_legs` still had only nullable `operator_id` (reserved for the real `operators` table) plus operator name/phone/email snapshots — no column linked a leg to a stub. `operatorPublishEmptyLeg` had nowhere to persist the stub id from the session token, so the operator portal could not reliably list/edit/cancel legs scoped to the session. | Per Codex's prescribed fix ("Add `empty_legs.operator_stub_id UUID REFERENCES phase7_operator_stubs(id)` in PR 1, set it from `operatorPublishEmptyLeg`, and scope operator portal reads/actions by that key; admin-created legs can keep it NULL unless assigned to a stub"): PR 1 §1 extended with `empty_legs.operator_stub_id UUID NULL REFERENCES phase7_operator_stubs(id) ON DELETE SET NULL` + a partial `idx_empty_legs_operator_stub(operator_stub_id, status) WHERE operator_stub_id IS NOT NULL` index. The `publish_empty_leg` RPC accepts `operator_stub_id UUID NULLABLE`. The operator portal's list/publish/edit/cancel pages + Server Actions in PR 2c filter `WHERE operator_stub_id = :session_stub_id`; cross-stub attempts return opaque `'leg_not_found'`. Admin-created legs may leave `operator_stub_id` NULL or set it to a known stub if publishing on behalf of an operator. The two ownership columns (`operator_id` for Phase 8's real-operator FK, `operator_stub_id` for Phase 7's lightweight ownership) coexist without aliasing. Acceptance #1 + #43 reworded. |
| 2 | `operator_empty_leg_sessions.operator_id` referenced `phase7_operator_stubs(id)` (after iteration-11 P1 #1 retargeted the FK) but kept the legacy column name `operator_id` — overloading the real `operators.id` concept and inviting implementers to either join against the real `operators` table or write a stub id into `empty_legs.operator_id`. The HMAC token payload also still used `{ operator_id }`. | Per Codex's prescribed fix ("Rename the session column/index/helpers/token payload to `operator_stub_id` throughout PR 1/PR 2c, leaving `operator_id` reserved for the future real-operator FK"): renames applied throughout — (a) PR 1 §15 column `operator_id` → `operator_stub_id`; (b) PR 1 §15 index `idx_operator_empty_leg_sessions_operator` → `idx_operator_empty_leg_sessions_stub`; (c) `lib/operator/empty-leg-session-token.ts` HMAC payload `{ operator_id }` → `{ operator_stub_id }`; (d) `validateOperatorEmptyLegSession` helper extracts and returns `operator_stub_id`; (e) acceptance #15 reworded to assert the column name + index name. The legacy `operator_id` namespace is reserved for Phase 8's real-operator FK throughout Phase 7. |
| 3 | Probe 10 only verified that the operator list page rendered + a tampered token returned `'invalid_session'`. After iteration-12 P1 #1 introduced `phase7_operator_stubs` ownership, the critical behavior is that publishing through one operator session creates a leg owned by that stub and is invisible/uneditable from another stub session. The prior probe never exercised this isolation. | Per Codex's prescribed fix ("Add a probe: publish via the Probe 9 stub token, assert the chosen ownership key equals that stub id, then mint a second stub/session and verify the first leg is not listed and update/cancel returns an opaque unauthorized result"): Probe 10 expanded — (a) mint session `T_A` for Probe 9's stub `S_A`, publish a leg via the publish form, verify via service-role psql that the leg's `operator_stub_id = S_A`; (b) mint a second stub `S_B` (via the admin bootstrap form) + session `T_B`; (c) visit `/operator/empty-legs/<T_B>` and verify the `T_A` leg is NOT listed; (d) attempt `operatorUpdatePrice` and `operatorCancel` via `T_B` targeting `T_A`'s leg id and verify each returns the opaque `'leg_not_found'` (NOT `'unauthorized'` — preserves the iteration-12 P1 #1 contract). |

## Codex iteration 13 — findings (resolved in iteration 14)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | PR 1 §1 added `empty_legs.operator_stub_id UUID REFERENCES phase7_operator_stubs(id)` inline with the column ADD, but `phase7_operator_stubs` is not created until §14. A single migration following the section order would fail at §1 because PostgreSQL cannot add an FK to a relation that does not exist yet. | Per Codex's prescribed second option ("add the column nullable without the FK in section 1 and add the FK constraint after section 14 in an idempotent DO block"): §1 now adds `operator_stub_id UUID` as a bare column (no FK clause). §14 gains a "FK + index wiring" sub-block AFTER the `CREATE TABLE phase7_operator_stubs` statement that adds the FK constraint `empty_legs_operator_stub_fk` to `phase7_operator_stubs(id) ON DELETE SET NULL` inside a `pg_constraint`-guarded DO block (mirrors Phase 6.2 PR 1's cross-table FK pattern), and creates the `idx_empty_legs_operator_stub` partial index. Acceptance #1 reworded to point at both §1 (column) + §14 (FK + index). Migration re-runs are still no-ops. |
| 2 | Acceptance #60 said the match-trigger route marks outbox rows `processed_at = NOW()` only when matching actually ran, with only a `'notifications_disabled'` exception. That contradicted #69's per-leg ordered-branch contract, where `'suppress_notifications'` skips ALSO mark `processed_at = NOW()` (the suppression is intentional, not a deferred state — replay against real customers after flag flip would be wrong). | Per Codex's prescribed fix ("Add the suppress exception here too: mark processed when matching ran OR when the suppress branch intentionally skipped; leave rows unprocessed only for non-suppressed `notifications_disabled` rows"): #60 reworded — "marks each row `processed_at = NOW()` **when matching actually ran OR when the suppress branch intentionally skipped**" + "the only path that LEAVES `processed_at = NULL` is non-suppressed legs that hit the `'notifications_disabled'` branch per acceptance #69". Now matches §7.6 matching.ts's per-leg ordered branches + #69's contract. |

## Codex iteration 14 — findings (resolved in iteration 15)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | The PR 1 `types/database.ts` file fence only called out `empty_legs`, `lead_inquiries`, and `empty_leg_notifications`, but PR 1 also creates `phase7_operator_stubs` (§14), `operator_empty_leg_sessions` (§15), and `empty_leg_outreach_alert_status` (§16). Later PRs read/write all six tables through typed Supabase helpers — without their row types in `types/database.ts`, the implementer would either hand-roll types or skip type-checking on the new surfaces, both of which break the Phase 6.2 typed-helper discipline. | Per Codex's prescribed fix ("Reword this bullet to say `types/database.ts` is regenerated after the full PR 1 migration and includes every new/changed table"): the bullet rewritten — "**regenerated after the full PR 1 migration applies**" + explicit enumeration of every new/changed column on `empty_legs` + `lead_inquiries` AND every new row type on `empty_leg_notifications`, `phase7_operator_stubs`, `operator_empty_leg_sessions`, `empty_leg_outreach_alert_status`. The bullet now also instructs running `npm run db:types` against production post-migration and committing the regenerated file as part of the PR 1 diff. |
| 2 | Implementation Order Step 4 (PR 2c) said "Founder mints a session for the first real operator out-of-band" — but the accepted Phase 7 model after iteration-11 P1 #1 + iteration-12 P1 #1 uses `phase7_operator_stubs` plus the admin bootstrap page and Probe 9. The stale wording could send the founder back toward the real `operators` table that Phase 7 explicitly avoids. | Per Codex's prescribed fix ("Update Step 4 to say: create/verify a `phase7_operator_stubs` row via the PR 2c bootstrap surface, then mint the operator session for that stub and run Probe 10"): Step 4 reworded — "Founder creates/verifies a `phase7_operator_stubs` row via the PR 2c bootstrap surface (`/admin/empty-legs/operators` + `adminCreatePhase7OperatorStub` Server Action), then mints the operator session for that stub and runs Probe 10 to verify stub-scoped publishing + cross-stub isolation". The "out-of-band" wording is purged. |

## Quality Gates

Run from `aeris/` after every PR:

```
npm ci
npm run type-check
npm run lint:strict
npm run build
npm run test:addons              # Phase 6.2, no regression
npm run test:checkout-whatsapp   # Phase 6.2, no regression
npm run test:checkout-site-url   # Phase 6.2, no regression
```

Plus the PR-specific new test scripts:

- After PR 1: `npm run test:empty-legs-curve`
- After PR 2a: same as PR 1.
- After PR 2b: same.
- After PR 2c: nothing new.
- After PR 2d: + `npm run test:empty-legs-token`
- After PR 2e: + `npm run test:empty-legs-matching` +
  `npm run test:empty-legs-frequency-cap` +
  `npm run test:empty-legs-cron-auth`

All scripts must exit 0. CI runs them all on every PR.

## Implementation Order

The 6 PRs merge sequentially. Each PR independently passes
Codex review before the next starts.

1. **PR 1** — schema reshape. No runtime UI/RPC code (Codex
   iteration-1 P2 #2 fix wording; iteration-8 P2 #1
   restored after the line drifted back to "No
   application code"). PR 1 ships DDL + the parity-test
   scaffold + the CI step + the shared TS type module
   that PR 2a imports. Founder Probes 1, 2, 3, 4, 4a,
   4b verify schema state in production
   (`empty_legs` shape, `bookings.source_offer_table`
   CHECK, `empty_leg_notifications` shape with all 3
   indexes, `empty_leg_outreach_alert_status` singleton
   seed + status enum, AFTER INSERT trigger wiring).
2. **PR 2a** — RPCs + auction-curve TS port + parity test.
   Founder Probes 5, 6, 7 verify RPC grants + parity +
   release / admin-release / manual-sold smoke.
3. **PR 2b** — admin surfaces. Founder smoke-tests admin
   publish + cancel flow on production. The
   `ENABLE_EMPTY_LEGS_ADMIN_UI` flag flips to `true` once
   admin smoke passes.
4. **PR 2c** — operator portal. Founder
   creates/verifies a `phase7_operator_stubs` row via
   the PR 2c bootstrap surface
   (`/admin/empty-legs/operators` + `adminCreatePhase7OperatorStub`
   Server Action), then mints the operator session
   for that stub and runs Probe 10 to verify
   stub-scoped publishing + cross-stub isolation
   (Codex iteration-14 P2 #2 fix: prior wording said
   "session for the first real operator out-of-band"
   which sent the founder back toward the real
   `operators` table that Phase 7 explicitly avoids
   per iteration-11 P1 #1 + iteration-12 P1 #1's
   Phase-7-scoped stub model). Flag
   `ENABLE_OPERATOR_PORTAL` stays `false` until the
   operator confirms they can publish a test leg
   through their stub-scoped session.
5. **PR 2d** — public marketplace. Flag stays `false`
   on production until PR 2e ships and the canary plan
   in §Rollout safety completes (Codex iteration-5 P1 #2
   fix: prior plan flipped this flag late while
   notifications fired against 404 — not safe).
6. **PR 2e** — matching engine + cron + notifications.
   Crons land in `vercel.json`; on first deploy they begin
   firing immediately. Both `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE`
   and `ENABLE_EMPTY_LEGS_NOTIFICATIONS` stay `false` —
   the matching engine **skips without marking outbox
   rows processed** (Codex iteration-8 P1 #1 fix:
   prior wording said "skip + outbox drain only" which
   contradicted the iteration-7 outbox-replay
   contract); the only exception is
   `suppress_notifications = TRUE` legs (Codex
   iteration-7 P1 #3 fix), where the outbox row IS
   marked `processed_at = NOW()` because the suppression
   is intentional, not a deferred-matching state.
   Founder monitors `empty_leg_events_outbox` row
   counts + cron telemetry for at least 24 hours, then
   flips **both flags simultaneously** per the canary
   plan.

After PR 2e: Phase 7 closure work-log entry mirroring the
Phase 6.2 closure entry shape (PR sequence table + smoke
results + coverage of paths not visually exercised +
operational hygiene + what ships / does not ship + next
phase = Phase 8 operator account flow).

## Founder Probes

Run by the founder (NOT by Claude) against production
Supabase + Vercel deployment after each PR.

(Iteration 2: probes renumbered to add coverage for the new
`empty_leg_notifications` table + the new RPCs + the new
checkbox-unchecked behavior. Probes 1–3 unchanged; new probes
4, 7, 12, and 17 added; older probes 4–14 shifted accordingly.)

### After PR 1

1. **Migration idempotency**: re-run the migration; psql
   diff shows no schema delta.
2. **`empty_legs` shape**: `\d+ empty_legs` shows the new
   columns (snapshots, reservation hold, customer-booking
   link, Dutch auction columns, freeform-airport columns)
   with the right types + nullability.
3. **`bookings.source_offer_table` CHECK**: insert a test
   row with `source_offer_table = 'phase7_empty_leg'` and
   a valid UUID; expect success. Roll back.
4. **`empty_leg_notifications` shape** (Codex iteration-1
   P1 #2 fix + iteration-4 P1 #1 queue columns +
   iteration-5 P2 #1 unique constraint + iteration-6 P2
   #1 enumeration fix): `\d+ empty_leg_notifications`
   shows the columns + CHECKs + **all three indexes by
   name**:
   - `idx_empty_leg_notifications_lead_24h`
     (`(lead_inquiry_id, sent_at DESC)`, non-unique)
   - `idx_empty_leg_notifications_lead_leg_unique`
     (`(lead_inquiry_id, leg_id)`, **UNIQUE** —
     iteration-5 P2 #1 fix)
   - `idx_empty_leg_notifications_outreach_pending`
     (`(sent_at DESC)` partial `WHERE outreach_sent_at
     IS NULL` — iteration-4 P1 #1 fix)

   RLS is enabled with no policies (service-role-only
   access).
4a. **`empty_leg_outreach_alert_status` singleton seed +
    enum** (Codex iteration-8 P2 #2 fix: prior PR 1
    probe set verified the table existed only via the
    broad `\d+` shape check; iteration-5 P2 #2's
    operational health-banner contract relies on the
    seeded `(1, 'healthy')` row + the status CHECK
    enumerating `('healthy', 'config_missing',
    'send_failed')`, both of which warrant explicit
    verification before PR 2e depends on them):
    - Run `SELECT * FROM empty_leg_outreach_alert_status`
      via service-role psql; verify exactly one row
      with `id = 1` and `status = 'healthy'`.
    - Run `\d+ empty_leg_outreach_alert_status`; verify
      the `status` CHECK constraint enumerates the three
      allowed values + the `id INT PRIMARY KEY DEFAULT 1
      CHECK (id = 1)` constraint.
    - Attempt `INSERT INTO empty_leg_outreach_alert_status
      (id, status) VALUES (2, 'healthy')`; expect a
      CHECK-constraint violation (proves the singleton
      lock).
4b. **`empty_leg_notifications_update_last_notified`
    trigger wiring** (Codex iteration-8 P2 #2 fix +
    iteration-7 P1 #2 contract + iteration-9 P2 #1
    fixture spell-out: the atomic-update contract
    relies on the trigger firing AFTER INSERT on every
    notification row; if the trigger were silently
    dropped or pointed at the wrong function, the
    24-hour cap would silently lose its DB-side
    enforcement):
    - Run `\dft+ empty_leg_notifications` (or
      `SELECT trigger_name, event_manipulation,
      action_statement FROM information_schema.triggers
      WHERE event_object_table = 'empty_leg_notifications'`);
      verify the trigger
      `empty_leg_notifications_update_last_notified`
      exists with `event_manipulation = 'INSERT'` and
      `action_timing = 'AFTER'`.
    - Run `\df+ _update_lead_inquiry_last_notified`;
      verify the function is `SECURITY DEFINER` with
      `search_path = public, pg_temp` and zero grantees
      (REVOKEd from PUBLIC + anon + authenticated +
      service_role).
    - **Smoke test (transaction-scoped fixture)** —
      Codex iteration-9 P2 #1 fix: prior wording asked
      the founder to "INSERT a synthetic row" against a
      known `lead_inquiries.id` only, but
      `empty_leg_notifications` also requires a valid
      `leg_id` FK to `empty_legs(id)`. On a fresh /
      quiet production state the smoke could fail for
      fixture reasons rather than trigger wiring. Per
      Codex's prescribed fix ("Spell out a transaction-
      scoped fixture"), run the following from a
      service-role psql session:

      ```sql
      BEGIN;

      -- 1. Create a throwaway leg fixture (idempotent
      --    column shape; the row is rolled back at the
      --    end). All required columns + non-NULL
      --    snapshots populated; suppress_notifications
      --    irrelevant for the trigger-wiring check
      --    because we INSERT the notification directly,
      --    bypassing the matcher.
      INSERT INTO empty_legs (
        operator_name_snapshot, aircraft_snapshot,
        departure_airport_freeform_snapshot,
        arrival_airport_freeform_snapshot,
        departure_window_start, departure_window_end,
        original_price, current_price,
        max_passengers, status,
        auction_initial_discount_pct,
        auction_floor_discount_pct,
        auction_window_start_at,
        auction_window_end_at
      ) VALUES (
        'PROBE-4b operator', 'PROBE-4b aircraft',
        'PROBE-4b origin', 'PROBE-4b dest',
        NOW() + INTERVAL '7 days',
        NOW() + INTERVAL '7 days 6 hours',
        10000, 6000,
        4, 'available',
        40, 70,
        NOW(), NOW() + INTERVAL '7 days'
      ) RETURNING id \gset

      -- 2. Pick any existing lead_inquiries row.
      SELECT id AS lead_id, last_empty_leg_notified_at
        AS prev_last
        FROM lead_inquiries
        ORDER BY created_at DESC
        LIMIT 1 \gset

      -- 3. Capture the timestamp we will assert
      --    against.
      SELECT NOW() AS fixed_sent_at \gset

      -- 4. Insert the notification row with that
      --    timestamp.
      INSERT INTO empty_leg_notifications (
        lead_inquiry_id, leg_id,
        event_type, channel,
        wa_url, sent_at
      ) VALUES (
        :'lead_id', :'id',
        'published', 'whatsapp_link',
        'https://wa.me/probe-4b', :'fixed_sent_at'
      );

      -- 5. Assert the trigger updated the lead's
      --    last_empty_leg_notified_at to NEW.sent_at
      --    (NOT to NOW() — Codex iteration-9 P2 #2
      --    harmonization).
      SELECT
        last_empty_leg_notified_at = :'fixed_sent_at'
          AS trigger_fired
        FROM lead_inquiries
        WHERE id = :'lead_id';
      -- Expect: trigger_fired = TRUE.

      ROLLBACK;
      ```

      The `BEGIN ... ROLLBACK` envelope guarantees the
      probe leaves no production data behind: the
      throwaway leg + notification row + the lead's
      momentary `last_empty_leg_notified_at` flip are
      all undone on rollback. If `trigger_fired` is
      `FALSE` or the INSERT raises a FK error, the
      probe fails; investigate before proceeding to
      PR 2a.

### After PR 2a

5. **RPC grants** (Codex iteration-4 P1 #3 fix: count
   updated to reflect iteration-3's
   `admin_release_empty_leg_reservation` addition): from a
   service-role psql session, run
   `\df+ public.*empty_leg*` and verify the schema contains
   **exactly 11 PR-2a public functions plus the 1 REVOKEd
   helper**, named:

   1. `_recompute_empty_leg_price` (helper — REVOKEd from
      every role; zero grantees)
   2. `publish_empty_leg`
   3. `update_empty_leg_price`
   4. `reserve_empty_leg`
   5. `confirm_empty_leg_reservation`
   6. `release_empty_leg_reservation`
   7. `admin_release_empty_leg_reservation`
   8. `cancel_empty_leg`
   9. `expire_empty_leg_reservation`
   10. `tick_empty_leg_dutch_auction`
   11. `admin_mark_empty_leg_sold`
   12. `publish_empty_leg_event` (PR 2a stub; PR 2e
       replaces body)

   For each of the 11 publics, verify EXECUTE is granted to
   `service_role` ONLY (no PUBLIC, no anon, no
   authenticated). For the helper, verify zero grantees.
   PR 2e adds a 12th public (`expire_empty_leg_window`) in
   its own migration — that one is verified separately in
   Founder Probe 14's expire-windows section.
6. **Parity test**: `npm run test:empty-legs-curve` passes
   locally against production-shape data.
7. **Release + admin-release + manual-sold RPCs** (Codex
   iteration-1 P1 #3 + P1 #4 + iteration-3 P1 #2 fixes):
   from a service-role psql session, call
   `release_empty_leg_reservation` against a test
   `'available'` leg → expect `leg_not_reserved`. Reserve
   the leg (via `reserve_empty_leg` with a known token
   hash), then call `release_empty_leg_reservation` with a
   wrong hash → expect `reservation_token_mismatch`; with
   the right hash → expect `{ ok: true }` and the leg
   flips back to `'available'` with cleared reservation
   columns. Reserve again, then call
   `admin_release_empty_leg_reservation` with NO token →
   expect `{ ok: true }` and the leg flips back to
   `'available'` with cleared reservation columns
   (verifies the admin path bypasses the customer's token
   check). Then call `admin_mark_empty_leg_sold` against a
   fresh `'available'` leg → expect a single-transaction
   success: `bookings` row exists, leg `status = 'sold'`,
   `customer_booking_id` populated.

### After PR 2b

8. **Admin publish + RLS**: publish a test leg via admin UI
   in production; query the leg as anon via REST API
   (`/rest/v1/empty_legs?id=eq.<uuid>` with anon key) —
   should return the row only when `status = 'available'`.
   Reserve it manually via admin UI; re-query as anon —
   should return empty (RLS hides reserved rows).

### After PR 2c

9. **Operator bootstrap** (Codex iteration-10 P1 #3
   fix + iteration-11 P1 #1 fix: schema reality says
   the real `operators` table requires fields Phase 7
   cannot populate; per iteration-11 P1 #1's
   prescribed second option, Phase 7 uses a dedicated
   `phase7_operator_stubs` table — see PR 1 §14):
   visit `/admin/empty-legs/operators` in admin auth;
   verify the listing page renders (initially empty);
   submit the create-stub form with a real operator's
   `company_name` + `contact_email` + `contact_phone`
   + optional notes; verify the new row appears in
   the listing AND in service-role psql:
   `SELECT id, company_name, status FROM
   phase7_operator_stubs ORDER BY created_at DESC
   LIMIT 1` returns the new stub with
   `status = 'active'`. Capture the new
   `phase7_operator_stubs.id` for Probe 10.
10. **Operator session token + stub-scoped publishing**
    (Codex iteration-12 P2 #1 fix: prior probe only
    verified list rendering + tampered-token rejection;
    iteration-12 P1 #1's stub-ownership column needs an
    explicit isolation test): mint a session token
    `T_A` for the stub created in Probe 9 (call its id
    `S_A`); visit `/operator/empty-legs/<T_A>` in
    incognito; verify list page renders empty
    initially (or only legs whose `operator_stub_id =
    S_A`). Try the URL with a tampered token byte;
    verify `'invalid_session'` opaque error.

    Then publish a leg through the publish form
    (`/operator/empty-legs/<T_A>/new`). Verify via
    service-role psql:
    `SELECT id, operator_stub_id FROM empty_legs WHERE
    leg_number = :probed_leg_number` returns the new
    leg with `operator_stub_id = S_A`.

    **Isolation check**: from the admin bootstrap page,
    create a second stub `S_B` (separate
    `phase7_operator_stubs` row); mint a session token
    `T_B` for `S_B`. Visit
    `/operator/empty-legs/<T_B>` in incognito; verify
    the list page does NOT include the leg published
    via `T_A` (cross-stub leak would be a P1 leak).
    Attempt `operatorUpdatePrice` and `operatorCancel`
    via `T_B` targeting `T_A`'s leg id; verify each
    returns the opaque `'leg_not_found'` (NOT
    `'unauthorized'` — the customer cannot tell whether
    the leg exists under a different stub) per the
    iteration-12 P1 #1 contract in §7.4 Files (Add).

### After PR 2d

11. **Public marketplace**: visit `/empty-legs` in incognito;
    verify the test leg appears with the right RTL Arabic
    copy. Click reserve; fill name + phone; submit; verify
    the leg flips to `reserved` in the admin list and the
    reservation expires in 10 minutes.
12. **Opt-out lander (manually-minted-token check)**: from
    a service-role psql or Node session, mint a one-shot
    opt-out token via `lib/empty-legs/opt-out-token.ts`'s
    mint helper for a known `lead_inquiries.id`. Open
    `/empty-legs/opt-out/<token>` in incognito; verify the
    page renders the "أتأكدت؟" confirmation lander; click
    confirm; query `lead_inquiries` keyed on the same id
    via service-role psql and verify
    `empty_legs_opt_in = FALSE`. End-to-end opt-out via
    a real wa.me notification is verified in Founder
    Probe 22 after PR 2e ships (Codex iteration-11 P2 #1
    fix: was Probe 21 before iteration-11's operator-
    bootstrap renumbering). (Codex iteration-4 P2 #1
    fix: prior wording carried a multi-line correction
    note referencing the removed email channel; full
    audit trail lives in the iteration-3 + iteration-4
    findings tables, so the probe body itself is now
    just the action and the assertion.)
13. **Checkbox unchecked behavior** (Codex iteration-1
    P1 #1 fix): submit `/request` without ticking the
    empty-legs checkbox; verify the resulting
    `lead_inquiries` row has `empty_legs_opt_in = FALSE`.
    Submit `/request` again WITH the checkbox ticked;
    verify the new row has `empty_legs_opt_in = TRUE`.
    Both row reads use a service-role psql query against
    `lead_inquiries` keyed on `request_number`.

### After PR 2e

14. **Cron auth**: hit `/api/cron/empty-legs/dutch-auction-tick`
    without the auth header; expect 401. Hit it with the
    `$CRON_SECRET` from Vercel env; expect 200.
15. **Auction tick visibility**: publish a test leg with a
    short auction window (e.g. 6 hours start to end); wait
    30 minutes; verify the marketplace shows a new lower
    price; verify a row appears in
    `empty_leg_events_outbox` with
    `event_type = 'price_dropped'`.
16. **Pre-flip flag-off assertion** (Codex iteration-7
    P2 #1 fix + iteration-9 P1 #1 fix: defense-in-
    depth check that the fail-closed path actually
    fail-closes in production before any flag flip;
    iteration-9 P1 #1 fix specifically requires the
    test leg use `suppress_notifications=TRUE` so it
    cannot replay against real customers after the
    flag flip — prior wording published an unsuppressed
    test leg whose outbox row would stay pending and
    notify real leads once notifications turned on,
    re-introducing the iteration-7 P1 #3 hazard at the
    probe layer): WITH both
    `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = false` AND
    `ENABLE_EMPTY_LEGS_NOTIFICATIONS = false` (the
    deploy state for PR 2e per the canary plan),
    publish a test leg via the admin UI **with the
    "رحلة اختبار داخلية — لا ترسل تنبيهات" checkbox
    TICKED** so
    `empty_legs.suppress_notifications = TRUE` on the
    inserted row. Wait 30 minutes for the cron cycle;
    then verify all of:
    - `SELECT suppress_notifications FROM empty_legs
      WHERE id = :probe_leg_id` returns `TRUE` (proves
      the publish-form checkbox wired through, mirrors
      canary Step 3's check).
    - `SELECT COUNT(*) FROM empty_leg_notifications
      WHERE leg_id = :probe_leg_id` returns 0 (no
      audit rows for a suppressed leg, regardless of
      flag state — defense in depth: even if the
      `notifications_disabled` short-circuit broke,
      the `suppress_notifications` filter would still
      exclude this leg).
    - `SELECT processed_at FROM empty_leg_events_outbox
      WHERE leg_id = :probe_leg_id` returns a
      non-NULL timestamp (suppression branch
      intentionally marks the row processed —
      iteration-7 P1 #3 contract). This DIFFERS from
      the unsuppressed-flag-off case (where rows stay
      `processed_at = NULL` for replay) precisely
      because suppression is a deliberate skip, not a
      deferred-matching state.
    Founder may now proceed to flip both flags. The
    probe leg stays in production with
    `suppress_notifications = TRUE` forever, so even
    after both flags flip the matcher's leg-eligibility
    filter (per acceptance #61) excludes it from any
    future cycle — no replay against real customers is
    possible.
17. **Matching engine output (post-flip)** (Codex
    iteration-7 P2 #1 fix: this probe runs ONLY after
    the founder has flipped BOTH
    `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = true` AND
    `ENABLE_EMPTY_LEGS_NOTIFICATIONS = true` per the
    canary plan; with either flag still off, the
    matcher fail-closes per acceptance #69 + Probe 16
    — the queue row this probe expects would never
    appear): with one or more eligible
    `lead_inquiries` rows in the candidate pool (rows
    that were submitted with the checkbox explicitly
    ticked), publish a test leg; verify a wa.me URL
    audit row appears in `empty_leg_notifications`
    for the top candidate(s) within 1 minute, with
    `wa_url` populated and `outreach_sent_at IS NULL`
    (Codex iteration-4 P1 #1 fix: queue state is the
    actual Phase 7 customer-delivery surface). The
    synchronous POST from `adminPublishEmptyLeg` to
    `/api/empty-legs/internal/match-trigger` is what
    keeps the SLA inside 1 minute (Codex iteration-2
    P2 #1 fix); the 30-minute cron is the fallback
    path that catches outbox rows the synchronous fire
    missed.
18. **Frequency cap**: re-publish a similar leg within 24h
    of the first notification; verify the same candidate
    is NOT re-notified.
19. **`empty_leg_notifications` audit row** (Codex
    iteration-1 P1 #2 fix + iteration-2 P1 #2 narrowing
    + iteration-4 P1 #1 queue-state additions): after
    each successful send in Probe 17, query
    `empty_leg_notifications` keyed on `lead_inquiry_id` +
    `leg_id`; verify exactly one row exists with
    `channel = 'whatsapp_link'` (the only allowed value),
    the expected `event_type`, `wa_url` populated with a
    valid wa.me URL,
    `outreach_sent_at IS NULL` (queued, not yet
    dispatched), and `external_message_id = NULL` (wa.me
    has no provider message id).
20. **Founder batch alert email — gate-failing**
    (Codex iteration-4 P1 #1 fix + iteration-5 P2 #2
    fix: this probe FAILS PR 2e smoke if the email is
    not received): after Probe 17 produces audit rows,
    verify the founder receives ONE Resend email
    (`EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` recipient)
    summarizing the new pending outreach with one
    section per leg + a deep-link to
    `/admin/empty-legs/outreach-queue`. Opening the
    email in Gmail / iCloud client confirms RTL Arabic
    + brand styling. If the email is NOT received
    within ~2 minutes:
    - Query `empty_leg_outreach_alert_status` via
      service-role psql; verify `status = 'config_missing'`
      or `'send_failed'` with a populated
      `last_failure_reason`.
    - Open `/admin/empty-legs/outreach-queue` in
      production admin auth; verify the red banner
      renders.
    - Treat this probe as RED — PR 2e is NOT
      smoke-passed. Resolve the missing env var or
      Resend account issue and re-run Probe 20.
21. **Outreach queue dispatch + mark-sent** (Codex
    iteration-4 P1 #1 fix): visit
    `/admin/empty-legs/outreach-queue` in production
    admin auth; verify pending audit rows from Probe 19
    appear with the candidate's name + phone, leg
    metadata, and a click-through wa.me link. Click the
    link; verify it opens WhatsApp with the pre-filled
    Arabic-RTL message containing the leg number, route,
    current price, current discount, the marketplace
    deep-link, and the opt-out URL. Click "تم الإرسال"
    on the same row; verify the row drops out of the
    queue (`outreach_sent_at` is now non-NULL via
    service-role psql query). Re-load the page; verify
    the row no longer appears.
22. **End-to-end opt-out** (Codex iteration-3 P1 #3 fix
    + iteration-4 P1 #1 narrowing — full end-to-end
    opt-out is verified here, since PR 2d's probe 12
    was reduced to a manually-minted-token check after
    the email channel removal): inside the WhatsApp
    message body opened in Probe 21, click the opt-out
    URL; verify the `/empty-legs/opt-out/<token>` page
    renders, click confirm, and verify
    `lead_inquiries.empty_legs_opt_in` flipped to FALSE
    for the candidate. Re-publish a similar leg; verify
    the same candidate is excluded from the next match
    (defense in depth on top of Probe 18's frequency cap).

## Rollout safety

Every PR's UI surface is feature-flag-gated; flags default
`false` in production until founder smoke-confirms the
upstream PR. The full flag list:

| Flag | Default (prod) | Flipped by | When |
|---|---|---|---|
| `ENABLE_EMPTY_LEGS_ADMIN_UI` | `false` | Founder | After PR 2b smoke-tested |
| `ENABLE_OPERATOR_PORTAL` | `false` | Founder | After PR 2c + first operator session minted |
| `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` | `false` | Founder | After PR 2e + 24h clean cron telemetry |
| `ENABLE_EMPTY_LEGS_NOTIFICATIONS` | `false` | Founder | Co-flipped with public marketplace; standalone kill switch when needed (Codex iteration-2 P1 #2 fix) |
| `ENABLE_EMPTY_LEGS_AI_SCORING` | `false` | (deferred) | Phase 7.x — not in Phase 7 |

**Kill switches**:

- Cron stops: comment out the entry in `vercel.json` +
  redeploy. Auction freezes; marketplace continues to show
  current_price; notifications stop until cron returns.
- Marketplace blackout: flip
  `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = false`; the page
  returns 404. Existing reserved rows continue to expire on
  schedule.
- Notification blackout (Codex iteration-5 P1 #1 fix —
  fail-closed semantics defined + iteration-6 P1 #1
  fix — outbox replay preserved across blackout +
  iteration-10 P1 #1 fix — per-leg ordered branches
  so suppressed legs don't take the disabled path):
  when `ENABLE_EMPTY_LEGS_NOTIFICATIONS = false`, the
  matcher iterates outbox `leg_ids` and for EACH leg
  applies branches in this order:
  - **Branch (a) — suppress-notifications check.** If
    `empty_legs.suppress_notifications = TRUE` for
    that leg, the matcher returns
    `'suppress_notifications'` and the match-trigger
    route DOES mark the outbox row
    `processed_at = NOW()` (suppression is
    intentional, not a deferred state — replay would
    be wrong). No notification row is written for the
    leg.
  - **Branch (b) — notifications-disabled check** (per-
    leg, only runs for non-suppressed legs). The
    matcher returns `'notifications_disabled'` and the
    match-trigger route does **NOT** mark the outbox
    row processed (rows stay `processed_at = NULL`,
    eligible for replay on the next cron tick after
    the flag flips back to `true`). Per Codex
    iteration-6 P1 #1 prescribed first option ["do
    not mark outbox rows processed while notifications
    are disabled"]; iteration-10 P1 #1 corrects the
    prior whole-matcher short-circuit that hit
    suppressed legs as well, leaving them stuck.
  - Frequency cap + per-leg dedupe state is therefore
    NOT consumed for branch (b) legs; the
    `empty_leg_notifications.wa_url TEXT NOT NULL`
    constraint is preserved (no row insert means no
    NULL-violation risk).
  - Cron + Dutch-auction tick keep running so price
    trajectories continue to update; only the outbound
    outreach surface is paused for branch (b) legs.

  **Outbox backlog bound**: the Dutch-auction tick fires
  every 30 minutes per `'available'` leg, so a 24-hour
  blackout (the canary's minimum gate per Open Question
  §6) accumulates at most ~48 rows per leg in the
  outbox + N rows for any new publishes. On flag flip,
  the next cron tick within 30 minutes drains the
  backlog through the matching engine — the matching
  engine itself filters out legs whose
  `auction_window_end_at <= NOW()` (the candidate-pool
  query implicitly does this because expired-window
  legs flip to `'expired'` via the expire-windows cron),
  so stale-leg replay is naturally bounded. If the
  blackout extends beyond 7 days the founder should
  consider explicitly truncating the outbox with a
  service-role `DELETE FROM empty_leg_events_outbox
  WHERE emitted_at < NOW() - INTERVAL '7 days' AND
  processed_at IS NULL` before flipping the flag —
  documented as a one-line operational ritual, not a
  spec'd RPC, since this scenario is recovery, not
  steady state.
- Operator portal lockout: revoke all rows in
  `operator_empty_leg_sessions` (or the column variant);
  every operator URL returns `'invalid_session'` until new
  sessions are minted.

**Canary plan** (Codex iteration-5 P1 #2 fix: prior plan
deliberately notified real `lead_inquiries` customers
with wa.me URLs whose `/empty-legs/[leg_number]`
destination returned 404 because
`ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` was still
`false` — that is not a safe canary, it ships a broken
customer experience by design. Per Codex's prescribed
first option ["Keep notifications off until the public
marketplace flag is on"], the canary now keeps
notifications off until the marketplace is public):

1. PR 2e merges to production with both
   `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = false` AND
   `ENABLE_EMPTY_LEGS_NOTIFICATIONS = false`. Crons start
   firing immediately; auction trajectories begin
   updating; the matching engine returns the
   fail-closed `{ ok: true, skipped: 'notifications_disabled' }`
   on every cycle (Codex iteration-5 P1 #1).
2. Founder publishes 1–2 internal-only test legs via the
   admin UI **with the "رحلة اختبار داخلية — لا ترسل
   تنبيهات" checkbox TICKED** (Codex iteration-8 P1 #2
   fix: prior canary plan said "internal-only" but did
   not require the suppress_notifications marker; without
   it, the test legs' outbox rows would replay to real
   customers on flag flip per the iteration-7 P1 #3
   finding). The publish form writes
   `empty_legs.suppress_notifications = TRUE` for these
   rows. Each leg exercises:
   - `publish_empty_leg` → outbox row written with
     `event_type = 'published'`.
   - `tick_empty_leg_dutch_auction` cron → outbox row
     written with `event_type = 'price_dropped'`.
   - `expire_empty_leg_window` cron → status flip to
     `'expired'` after the auction window closes.
   No `empty_leg_notifications` row is written for
   these legs (suppress_notifications excludes them
   from candidate cycles per acceptance #61); no wa.me
   URL is generated; no customer is contacted.
3. Founder verifies for at least 24 hours:
   - `SELECT id, leg_number, suppress_notifications
     FROM empty_legs WHERE leg_number IN
     (<test_leg_numbers>)` returns the test legs with
     `suppress_notifications = TRUE` (proves the
     publish-form checkbox wired through).
   - `SELECT leg_id, event_type, processed_at FROM
     empty_leg_events_outbox WHERE leg_id IN
     (<test_leg_ids>)` returns the outbox rows; each
     row has `processed_at = NOW()` (a non-NULL
     timestamp), NOT `processed_at IS NULL` — Codex
     iteration-8 P1 #2 fix: the suppress-notifications
     branch in the matcher (per acceptance #61 + the
     §7.6 matching.ts contract) intentionally marks
     these processed because suppression is a
     deliberate skip, distinct from
     `notifications_disabled` which leaves rows
     pending replay.
   - `SELECT COUNT(*) FROM empty_leg_notifications
     WHERE leg_id IN (<test_leg_ids>)` returns 0 (no
     audit rows for suppressed legs).
   - Outbox + admin pages + cron telemetry are clean.
4. Founder flips both flags **simultaneously** —
   `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE = true` AND
   `ENABLE_EMPTY_LEGS_NOTIFICATIONS = true`. The
   marketplace opens publicly; the matching engine
   begins writing audit rows and emitting wa.me URLs
   to the outreach queue **for newly-published legs
   without `suppress_notifications`** — the suppressed
   canary test legs remain excluded forever (Codex
   iteration-7 P1 #3 + iteration-8 P1 #2 fix: the
   suppression marker + the canary verification step
   together guarantee no test-leg replay against real
   customers on flag flip). Founder dispatches the
   queue batch via WhatsApp Business and the customer-
   side `/empty-legs/[leg_number]` URLs resolve
   normally.

Both flags MUST be flipped in the same change window —
flipping notifications first while the marketplace is
still 404 reintroduces the broken-customer-experience
class of bug; flipping marketplace first is harmless but
delivers no value (the marketplace is just static cards
until matching ships outreach).

**Rollback**: any PR can be rolled back via revert PR. The
schema migrations (PR 1, PR 2a, PR 2e §match-event)
are forward-only; rollback is achieved by a follow-up
migration adding compensating DDL (e.g. `DROP COLUMN`s).
The PR 1 reshape is risk-light because no production rows
exist in `empty_legs` to lose. PR 2a's RPCs can be `DROP
FUNCTION`-ed safely as long as no Server Action depends on
them yet (PR 2b is the first dependent — so PR 2a
rollback before PR 2b is safe).

## Required Claude Output

Once Codex approves this iteration, Claude will:

- Open PR 1 against `main` from branch
  `phase-7/pr-1-schema-reshape`. Implement only PR 1's
  scope. Run all four quality gates plus
  `npm run test:empty-legs-curve` (the parity test scaffold
  PR 1 lands). Append a Phase 7 PR 1 entry to
  `docs/CLAUDE-WORK-LOG.md` with the standard shape (summary,
  files added/edited, command output, founder probes
  results pending). Stop. Wait for Codex review of PR 1.
- After PR 1 lands at 100/100 + merges, repeat for PR 2a,
  2b, 2c, 2d, 2e in order. Each PR is its own Codex review
  loop.
- After PR 2e merges, append the Phase 7 closure entry to
  `docs/CLAUDE-WORK-LOG.md` mirroring the Phase 6.2 closure
  entry: PR-sequence table, production smoke results,
  paths not visually exercised, operational hygiene
  follow-up, what ships / does not ship, next phase
  (Phase 8 operator account flow per the §Out of Scope
  list).
- Stop after the closure entry. Do NOT start Phase 7.x
  AI-scoring sublayer, Phase 8 operator account flow,
  Phase 10 loyalty integration, or Phase 11 payment
  integration without a separate task.

Founder Probes (§Founder Probes above) are NOT part of
Claude's output — they are the founder's manual
verification step on production after each PR.
