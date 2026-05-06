# Operator Flow Smoke Test (Phase 4)

## Purpose

End-to-end manual check of the Phase 4 operator portal:
**lead → promote → dispatch → operator submits → admin accepts**.
Confirms every state transition, every RPC failure path the UI
exposes, and the re-dispatch race guard.

## When to run

- Before every deploy that touches `app/(admin)/admin/(protected)/trips/**`,
  `app/operator/offer/[token]/**`, `app/(admin)/admin/actions/trips.ts`,
  `lib/operator/token.ts`, `lib/supabase/queries/trips.ts`,
  `lib/supabase/queries/phase4-offers.ts`, or
  `supabase/migrations/20260504000003_phase_4_operator_portal.sql`.
- Weekly on production once Phase 4 is live.
- After rotating `OPERATOR_TOKEN_SECRET` (every outstanding
  dispatch link is invalidated by the rotation).

## Setup

You need:

- A working preview or production URL (`<host>` below).
- Admin login credentials.
- Two browser windows: one signed into the admin (Window A), one
  fully fresh / private (Window B — the "operator").
- A test phone number you control on WhatsApp (E.164, e.g.
  `+966500000000`). The dispatch link will be sent there.
- Browser DevTools open on Window A.
- Access to the Supabase SQL editor for the post-conditions.

## Steps

### A. Promote a lead → trip request

1. [ ] In Window A, sign into `/admin/login` and navigate to
       `/admin/leads`.
2. [ ] Open any lead in `new` / `contacted` / `quoted` status.
3. [ ] In the right-hand "تحويل إلى طلب رحلة" panel, pick a cabin
       class (e.g. `mid`), optionally add notes, click
       "تأكيد التحويل".
4. [ ] Browser redirects to `/admin/trips/<id>` of a freshly
       created trip with status badge "بانتظار الإرسال".
5. [ ] Customer name + phone on the trip detail card match the
       source lead.
6. [ ] In Supabase, confirm:
       ```sql
       SELECT id, status, customer_source,
              preferences->>'lead_trip_type' AS source_type,
              client_id, customer_name
         FROM trip_requests
        WHERE id = '<trip_id>';
       ```
       → `status = 'pending'`, `customer_source = 'lead'`,
       `source_type` matches the original lead's trip_type
       (`one_way` / `round_trip` / `multi_city`),
       `client_id IS NULL`, `customer_name` populated.
7. [ ] Source lead is now `status = 'converted'` and
       `converted_at` is non-null.

### B. Dispatch to one operator

8. [ ] Still on `/admin/trips/<id>`, in the "إرسال للمشغّل" panel,
       enter your test E.164 phone (`+966...`) and click
       "إرسال للمشغّل".
9. [ ] The panel reveals two copy-able fields:
       **رابط المشغّل** and **رابط واتساب**, plus an absolute
       expiry timestamp ("ينتهي الرابط في ...").
10. [ ] The trip status badge is now "أُرسل للمشغّل".
11. [ ] In Supabase:
        ```sql
        SELECT status, dispatch_nonce, dispatch_expires_at,
               dispatch_target_phone, dispatched_at
          FROM trip_requests
         WHERE id = '<trip_id>';
        ```
        → `status = 'distributed'`, `dispatch_nonce` is a 32-hex
        string, `dispatch_expires_at` ≈ now + 72 h,
        `dispatch_target_phone` matches what you entered,
        `dispatched_at` non-null.

### C. Operator opens the link and submits an offer

12. [ ] Copy the **رابط المشغّل** value. Open it in Window B
        (fresh browser, no admin cookie).
13. [ ] The page renders the operator portal layout (gold AERIS
        wordmark, Arabic copy, RTL). The trip summary shows route,
        dates, passengers, cabin class. **Customer name and
        phone are NOT shown.**
14. [ ] Fill in the offer form:
        - Operator name: any (e.g., "شركة اختبار").
        - Operator phone: any E.164.
        - Total price: ≥ 1000 (e.g., `45000`).
        - Departure ETA: any future datetime ≥ trip departure.
        - Validity hours: e.g. `24`.
        - Notes (optional).
15. [ ] Submit. Page renders the green
        "تم استلام عرضك" success panel.
16. [ ] Back in Window A, refresh `/admin/trips/<id>`. The
        "العروض المستلمة" section now shows one card with the
        operator's name, price, ETA, validity. The trip status
        badge is now "وصل عرض".
17. [ ] In Supabase:
        ```sql
        SELECT id, status, total_price_sar, source_dispatch_nonce
          FROM phase4_operator_offers
         WHERE trip_request_id = '<trip_id>';
        ```
        → exactly one row, `status = 'pending'`,
        `source_dispatch_nonce` equals the trip's
        `dispatch_nonce`.

### D. Re-dispatch race guard (Codex iteration 3 fix #1)

18. [ ] In Window A, click "إعادة الإرسال للمشغّل" with a
        different (or same) E.164 phone. A new operator URL is
        generated.
19. [ ] In Supabase, confirm `trip_requests.dispatch_nonce` has
        changed to a new value.
20. [ ] In Window B, open the **previous** operator URL (the one
        from step 12). It must render the friendly
        "هذا الرابط منتهي الصلاحية" page — no form, no trip
        details.
21. [ ] If you submitted the form on the previous URL anyway (via
        a stale tab still open from step 14):
        ```sql
        SELECT count(*) FROM phase4_operator_offers
         WHERE trip_request_id = '<trip_id>';
        ```
        → unchanged (the RPC's `FOR UPDATE` re-check rejected the
        submit with `error = 'token_stale'`). The tab on Window B
        renders an Arabic-RTL error in the form's red banner.

### E. Submit a second offer with the new link, then accept

22. [ ] Open the **new** operator URL (from step 18) in Window B.
        Submit a second offer with a different price.
23. [ ] Window A shows two offer cards. Both `status = 'pending'`.
24. [ ] Click "قبول العرض" on one of the cards. Confirm the
        browser dialog.
25. [ ] After the action, the chosen card has the green "مقبول"
        badge; the other card has the red "مرفوض" badge; the trip
        status badge is "محجوز".
26. [ ] In Supabase:
        ```sql
        SELECT status, decided_at FROM phase4_operator_offers
         WHERE trip_request_id = '<trip_id>'
         ORDER BY created_at;
        SELECT status FROM trip_requests WHERE id = '<trip_id>';
        ```
        → exactly one offer is `accepted`, every other offer is
        `rejected`, all `decided_at` are populated, trip status
        is `booked`.

### F. Expired-offer guard (Codex iteration 2 fix #2)

A surgical SQL probe of the `accept_phase4_offer` expiry guard.
Run on a separate trip (not the one you just booked).

27. [ ] Promote a fresh lead, dispatch, submit one offer (same
        as steps 1-15 above on a different lead).
28. [ ] Manually expire that offer:
        ```sql
        UPDATE phase4_operator_offers
           SET expires_at = NOW() - INTERVAL '1 minute'
         WHERE trip_request_id = '<other_trip_id>'
           AND status = 'pending';
        ```
29. [ ] In Window A on `/admin/trips/<other_trip_id>`, click
        "قبول العرض" on that offer.
30. [ ] The button surfaces an Arabic-RTL error mapped from
        `error = 'offer_expired'`.
31. [ ] In Supabase:
        ```sql
        SELECT status, decided_at FROM phase4_operator_offers
         WHERE id = '<expired_offer_id>';
        SELECT status FROM trip_requests
         WHERE id = '<other_trip_id>';
        ```
        → offer status is now `expired`, `decided_at` populated;
        trip status is unchanged from before the click.

### G. Tampered token

32. [ ] Take the operator URL from step 12. Flip a single
        character of the token (e.g., change the last char of the
        signature half). Open it in Window B.
33. [ ] The page renders the friendly
        "هذا الرابط منتهي الصلاحية" page. No row was written to
        `phase4_operator_offers`.

## Pass criteria

- Every box above is checked.
- Every Supabase post-condition holds.
- No row was written to `phase4_operator_offers` in steps 21
  (race guard) or 33 (tampered token).
- The accepted offer in step 26 is a single row; siblings are
  `rejected`, never `accepted`.

## If it fails

- **Step 4 redirect goes back to `/admin/leads/<id>` instead of
  `/admin/trips/<id>`:**
  - The `promoteLead` Server Action returned a non-redirect
    error path. Look at the work log's known-issues for any
    matching error code, then check
    `app/(admin)/admin/actions/trips.ts → promoteLead`.
- **Step 11 shows `dispatch_nonce IS NULL`:**
  - `persistDispatchState` in `lib/supabase/queries/trips.ts`
    failed silently. Check Supabase logs for the failed UPDATE
    and the `[trips] persistDispatchState failed` line.
- **Step 16 shows the trip status still `distributed`:**
  - The `submit_phase4_operator_offer` RPC's status-promotion
    branch did not fire. Inspect the function definition and
    verify the `IF v_trip.status IN ('pending', 'distributed')`
    block exists.
- **Step 17 shows multiple rows for the same trip:**
  - That is fine if multiple operators submitted via different
    dispatch nonces. It is **not** fine if all rows have the
    same `source_dispatch_nonce` — that would mean the form was
    re-submittable from one URL, which the RPC should not allow
    when nonces are checked correctly.
- **Step 21 shows count INCREASED — race guard failed:**
  - **Critical.** The `FOR UPDATE` lock or the
    `dispatch_nonce IS DISTINCT FROM p_token_nonce` predicate
    is not behaving. Inspect `submit_phase4_operator_offer` in
    `supabase/migrations/20260504000003_phase_4_operator_portal.sql`
    and confirm the function in production matches.
- **Step 25 shows multiple offers `accepted`:**
  - **Critical.** The `accept_phase4_offer` sibling-rejection
    branch didn't fire, or two `acceptOffer` Server Action calls
    raced past the function's row lock. Re-run with the SQL log
    enabled.
- **Step 30 shows the offer accepted instead of erroring:**
  - The `expires_at > v_now` guard in `accept_phase4_offer` is
    missing. This is the Codex iteration 2 fix #2 regression —
    treat as P1.
- **Step 33 actually shows a form / trip details:**
  - The HMAC verification in `lib/operator/token.ts` is broken
    or `OPERATOR_TOKEN_SECRET` is unset. Treat as P1; rotate the
    secret before re-deploying.

---

# Phase 5 — Trip Distribution Engine activation runbook

> **Read this whole section before starting.** Phase 5 ships
> behind the `PHASE5_ADMIN_UI` env-var gate (added in PR #10).
> Until the gate is flipped, the admin trip detail page renders
> the legacy Phase 4 view and `/operator/offer/[token]`
> still accepts only v=1 tokens *in practice*, because no v=2
> tokens are ever generated. Activation is a sequenced flip:
>
>   1. Verify the migration is applied to the target Supabase
>      project.
>   2. Confirm the gate-off baseline is healthy (Phase 4 still
>      works).
>   3. Set `PHASE5_ADMIN_UI=true` in Vercel for the target
>      environment and trigger a redeploy.
>   4. Run the e2e flow on the deployed preview / production.
>   5. Run the re-dispatch + stale-link probes.
>
> **Do NOT skip step 1 or step 2.** Step 1 catches the
> "merged code, missing schema" failure mode; step 2 catches
> "the env-var typo silently broke the legacy path".

## Setup

You need:

- The target Vercel deployment URL (`<host>` below). For
  production this is `https://aeris-flax.vercel.app/` (or
  the eventual `https://aeris.sa/` once DNS is configured —
  see the Phase 4 Production Activation entry in
  [`CLAUDE-WORK-LOG.md`](../CLAUDE-WORK-LOG.md)).
- Admin login credentials for `<host>/admin/login`.
- **Three** browser windows: one signed into admin (Window A),
  two fresh / private Chrome incognito windows (Window B and
  Window C — two "operators").
- **Three** test phone numbers you control on WhatsApp (E.164,
  e.g. `+966500000001`, `+966500000002`, `+966500000003`).
  Throwaway is fine — the dispatch never actually sends a
  WhatsApp message; admin copies the link manually.
- Supabase SQL editor access on the target project.

## Pre-flip — migration verification

Run BEFORE setting `PHASE5_ADMIN_UI=true`. These probes catch
the "code shipped, schema missing" failure mode.

1. [ ] In Supabase → SQL Editor, run:
       ```sql
       SELECT typname FROM pg_type
        WHERE typname IN ('dispatch_target_status', 'dispatch_round_status');
       ```
       → 2 rows. If 0 rows, migration
       `20260505000004_phase_5_distribution.sql` was not
       applied to this Supabase project — apply it before
       continuing.
2. [ ] Tables exist:
       ```sql
       SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN (
          'trip_dispatch_rounds',
          'trip_dispatch_targets',
          'phase5_operator_offers'
        )
        ORDER BY relname;
       ```
       → 3 rows, all with `relrowsecurity = t`.
3. [ ] **Zero policies** on the three new tables (deny-all,
       service-role-only):
       ```sql
       SELECT tablename, count(*) AS policy_count
         FROM pg_policies
        WHERE tablename IN (
          'trip_dispatch_rounds',
          'trip_dispatch_targets',
          'phase5_operator_offers'
        )
        GROUP BY tablename;
       ```
       → 0 rows (no policies on any of the three).
4. [ ] `current_dispatch_round_id` column on `trip_requests`:
       ```sql
       SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'trip_requests'
          AND column_name  = 'current_dispatch_round_id';
       ```
       → 1 row, `data_type = uuid`, `is_nullable = YES`.
5. [ ] All three Phase 5 RPCs have `SECURITY DEFINER` and a
       pinned `search_path`:
       ```sql
       SELECT p.proname, p.prosecdef AS sec_def, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'open_phase5_dispatch_round',
            'submit_phase5_operator_offer',
            'accept_offer'
          )
        ORDER BY p.proname;
       ```
       → 3 rows, all with `sec_def = t` and
       `config = ["search_path=public, pg_temp"]`.
6. [ ] EXECUTE privileges (the P1 fix from Phase 4 round 1
       must hold for Phase 5 too):
       ```sql
       SELECT p.proname AS function_name,
              r.rolname AS role,
              has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
         FROM pg_proc p
        CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(rolname)
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'open_phase5_dispatch_round',
            'submit_phase5_operator_offer',
            'accept_offer'
          )
        ORDER BY p.proname, r.rolname;
       ```
       → 9 rows. For every function: `service_role = true`;
       `anon = false`; `authenticated = false`. **Any `true`
       on anon or authenticated is a P1 — STOP and investigate
       before flipping the gate.**

## Pre-flip — gate-OFF baseline

Run BEFORE setting `PHASE5_ADMIN_UI=true`. These probes catch
"the env-var typo silently broke the Phase 4 path".

7. [ ] In Window A, sign into `<host>/admin/login`. Open any
       trip in `pending` / `distributed` state at
       `<host>/admin/trips/<id>`. The dispatch panel header
       should read **"إرسال للمشغّل"** (singular — Phase 4
       layout). The form should be a SINGLE phone field with
       a "إرسال للمشغّل" button. The offers list, if any
       offers exist, should render the legacy `Phase4OfferCard`
       layout (no "قديم" or "جولة حالية" pills — those are
       Phase 5-only).
8. [ ] Run a Phase 4 dispatch (single phone, copy the URL).
       Confirm the existing Phase 4 e2e (sections A–G above,
       steps 1–33) still works end-to-end.

If steps 7–8 fail, do NOT proceed. The gate is already on, or
there is a regression in the Phase 4 path. Roll the env back
or fix the regression first.

## Flip the gate

9. [ ] In Vercel → Project → Settings → Environment Variables,
       add `PHASE5_ADMIN_UI=true` to the target environment
       (Production OR Preview, not both unless you intend
       both). Mark it as a regular (non-secret) value — it's
       a feature flag, not a credential.
10. [ ] Trigger a redeploy on the target environment so the
        env var takes effect. (Vercel does NOT pick up env
        changes for already-built deployments.)
11. [ ] After the redeploy completes, hard-refresh
        `<host>/admin/trips/<id>` in Window A. The dispatch
        panel header should now read **"إرسال للمشغّلين"**
        (plural). The form should be a multi-row list of phone
        inputs with `+`/`–` controls and a counter showing
        `1/8`. If still showing the singular Phase 4 form, the
        env var didn't propagate — re-check step 9 + 10.

## Phase 5 e2e — multi-dispatch + parallel submit + accept

12. [ ] In Window A, on a fresh `pending` trip (promote a
        new lead or use an empty trip), enter **two** test
        phones into the multi-row form. Click "إرسال إلى
        المشغّلين".
13. [ ] The panel reveals **two** copy-able cards, each with:
        - the operator phone (LTR-formatted),
        - **رابط المشغّل** input + Copy button,
        - **رابط واتساب** input + Open + Copy buttons,
        - "ينتهي" timestamp ~72 hours from now.
14. [ ] Trip status badge changes from "بانتظار الإرسال" or
        "أُرسل للمشغّل" to **"أُرسل للمشغّل"** (Phase 5 keeps
        the same wording). Header text above the cards reads
        "الجولة الحالية (2 مشغّلين)".
15. [ ] In Supabase:
        ```sql
        SELECT id AS trip_id, status, current_dispatch_round_id
          FROM trip_requests WHERE id = '<trip_id>';
        SELECT id, status, opened_at, closed_at, closed_reason
          FROM trip_dispatch_rounds
         WHERE trip_request_id = '<trip_id>'
         ORDER BY opened_at DESC LIMIT 1;
        SELECT id, target_phone, status, sent_at, expires_at
          FROM trip_dispatch_targets
         WHERE dispatch_round_id = (
                SELECT current_dispatch_round_id FROM trip_requests WHERE id = '<trip_id>'
              )
         ORDER BY sent_at;
        ```
        → trip status `distributed` (or unchanged if it was
        already `distributed`/`offered`),
        `current_dispatch_round_id` non-null. One round row,
        `status = 'open'`. Two target rows, each
        `status = 'pending'`, with the phones you entered.

### Refresh-durability probe (acceptance #14a)

16. [ ] Hard-refresh `<host>/admin/trips/<id>` (Ctrl+R / Cmd+R).
        The same two cards re-render with **byte-identical**
        operator URLs and WhatsApp deep links. (The page is
        rebuilding the URLs from the persisted target rows
        via `issueOperatorTokenFromTarget`; both calls derive
        `issued_at` from the same `target.sent_at` so the
        HMAC is identical.)
17. [ ] (Optional) Close the browser tab entirely and re-open
        the trip URL from the address bar. Same two cards
        appear again.
18. [ ] (Optional SQL probe.) `SELECT id, sent_at FROM
        trip_dispatch_targets WHERE dispatch_round_id = '<round>'
        ORDER BY sent_at;` — confirm `sent_at` was persisted
        as the Server Action's `batch_now` (not the DB-side
        `NOW()` clock; same value across both rows in the same
        batch).

### v=2 operator submit

19. [ ] Copy the **رابط المشغّل** of the first target. If the
        URL host is `aeris.sa` and DNS isn't configured yet,
        replace the host with the deployed Vercel URL host
        (the HMAC token is host-independent). Open in
        Window B (fresh Chrome incognito).
20. [ ] The page renders the operator portal: AERIS branding,
        Arabic RTL, trip summary (route, dates, passengers,
        cabin) — **with NO customer name or phone**. The form
        below is the standard offer form.
21. [ ] Fill the offer form with reasonable values
        (operator_name, operator_phone E.164, total_price_sar
        ≥ 1000, departure_eta ≥ trip departure, validity_hours
        24). Submit. The page renders the green "تم استلام
        عرضك" success panel.
22. [ ] In Supabase:
        ```sql
        SELECT id, trip_request_id, dispatch_target_id,
               operator_name, total_price_sar, status
          FROM phase5_operator_offers
         WHERE trip_request_id = '<trip_id>'
         ORDER BY created_at DESC;
        SELECT id, status, submitted_at FROM trip_dispatch_targets
         WHERE id = '<target_id>';
        SELECT status FROM trip_requests WHERE id = '<trip_id>';
        ```
        → exactly one Phase 5 offer row, `status = 'pending'`,
        `dispatch_target_id` matches the URL's target. Target
        row `status = 'submitted'` with `submitted_at` non-null.
        Trip status promoted to `offered`.
23. [ ] In Window C, open the SECOND target's operator URL
        (also from step 13). Submit a different offer (e.g.
        higher price). Page renders the success panel.
24. [ ] Supabase: now TWO rows in `phase5_operator_offers`,
        both `status = 'pending'`, each tied to its own
        `dispatch_target_id`. Both target rows now `submitted`.

### Unified comparison view + accept

25. [ ] Back in Window A, hard-refresh the trip detail page.
        The "العروض المستلمة" section shows BOTH offers,
        sorted by total_price_sar ascending (acceptance #17).
        Each card has a "جولة حالية" pill (since both targets
        belong to the trip's `current_dispatch_round_id`).
26. [ ] Click "قبول العرض" on the lower-priced offer. Confirm
        the JS dialog "هل أنت متأكد...".
27. [ ] After the accept:
        - chosen offer card flips to "مقبول" (green badge);
        - sibling offer card flips to "مرفوض" (red badge);
        - trip status badge becomes "محجوز";
        - dispatch panel disables / shows
          "هذه الرحلة مغلقة (محجوزة أو ملغاة)...".
28. [ ] In Supabase, single SQL probe:
        ```sql
        SELECT request_number, status FROM trip_requests
         WHERE id = '<trip_id>';
        SELECT id, status, decided_at FROM phase5_operator_offers
         WHERE trip_request_id = '<trip_id>'
         ORDER BY total_price_sar;
        SELECT id, status FROM trip_dispatch_targets
         WHERE trip_request_id = '<trip_id>';
        SELECT id, status, closed_at, closed_reason
          FROM trip_dispatch_rounds
         WHERE trip_request_id = '<trip_id>';
        ```
        → trip `status = 'booked'`. One offer `accepted`, one
        `rejected`, both `decided_at` non-null. All targets
        on the trip in terminal state (the two that submitted
        are `submitted`; any never-submitted ones would be
        `cancelled`). The round row is `closed`,
        `closed_reason = 'offer_accepted'`.

## Re-dispatch stale-link probes

Run on a SEPARATE trip (not the booked one above).

29. [ ] Promote a new lead → trip → multi-dispatch to two
        phones. Note the operator URLs (call them URL-A1 and
        URL-A2) and `dispatch_round_id` (call it ROUND-A).
30. [ ] In Window A, click "إعادة الإرسال إلى مشغّلين جدد"
        with two NEW phones. Get URL-B1, URL-B2 and ROUND-B.
31. [ ] In Supabase:
        ```sql
        SELECT current_dispatch_round_id FROM trip_requests WHERE id = '<trip_id>';
        SELECT id, status, closed_reason
          FROM trip_dispatch_rounds
         WHERE trip_request_id = '<trip_id>'
         ORDER BY opened_at;
        SELECT dispatch_round_id, status, count(*)
          FROM trip_dispatch_targets
         WHERE trip_request_id = '<trip_id>'
         GROUP BY dispatch_round_id, status
         ORDER BY 1, 2;
        ```
        → `current_dispatch_round_id` = ROUND-B (the new
        round). ROUND-A is `closed` with
        `closed_reason = 'redispatched'`. ROUND-A's two
        targets are `cancelled`. ROUND-B's two targets are
        `pending`.
32. [ ] In Window B, open URL-A1 (the now-stale link from
        ROUND-A). The page renders the friendly
        "هذا الرابط منتهي الصلاحية" page. **No row was
        written to `phase5_operator_offers`.**
33. [ ] In Window C, open URL-B1 (a fresh link from ROUND-B).
        The form renders normally. Submit a quick offer to
        confirm the new round still accepts submissions.
34. [ ] (Optional belt-and-suspenders.) Tampered-token probe
        on a v=2 link: take URL-B2, flip the LAST character
        of the signature half. Open in incognito. Page
        renders the friendly expired/invalid view. SQL probe
        confirms no offer row was inserted.

## Pass criteria (Phase 5 section)

- Steps 1–6: every probe returns the expected shape; EXECUTE
  privileges are correct on all 3 RPCs.
- Steps 7–8: gate-OFF baseline = Phase 4 still works. **STOP
  before step 9** if not.
- Step 11: after redeploy, dispatch panel switches to the
  multi-row Phase 5 layout. If still single-row, the env didn't
  propagate.
- Steps 12–24: multi-dispatch produces N target rows + N
  unique URLs; refresh reproduces the SAME URLs byte-identically;
  v=2 operator submit lands an offer in `phase5_operator_offers`
  with `dispatch_target_id` set; second operator submit doesn't
  invalidate the first; trip status moves forward to `offered`
  on the first submit and stays there.
- Steps 25–28: comparison view shows both offers sorted by
  price; accept flips chosen → `accepted`, sibling →
  `rejected`, target → `cancelled` (if not already
  submitted), round → `closed`, trip → `booked`.
- Steps 29–34: re-dispatch closes the prior round AND its
  pending targets in the same RPC transaction; the prior
  round's URLs render the friendly expired page; the new
  round's URLs work; tampered v=2 token rejected without DB
  write.

## If Phase 5 fails

- **Step 1–6 fails on the schema/privileges shape:** do NOT
  flip the gate. Re-apply the migration (or the relevant
  REVOKE/GRANT statements) and re-run from step 1.
- **Step 11 still shows the single-row Phase 4 form after
  redeploy:** the `PHASE5_ADMIN_UI` env var didn't propagate.
  Check Vercel env scope (Production vs Preview vs
  Development), confirm the redeploy actually rebuilt (check
  the deployment list timestamp), and that the value is
  literally `true` (lowercase, no quotes).
- **Step 16 shows DIFFERENT operator URLs after refresh:** the
  refresh-durability invariant is broken. Most likely cause is
  `sent_at` is being regenerated on the DB side instead of
  passed through from the Server Action's `batch_now`.
  Inspect `open_phase5_dispatch_round` in
  `supabase/migrations/20260505000004_phase_5_distribution.sql`
  and confirm the INSERT supplies `sent_at` explicitly. P1
  regression of iteration-3 P1 fix.
- **Step 22/24 shows the offer landed in
  `phase4_operator_offers` instead of `phase5_operator_offers`:**
  the operator portal v=2 branch isn't routing correctly. Check
  `app/operator/offer/[token]/actions.ts` for the
  `verified.version === 2` branch.
- **Step 27 shows multiple offers `accepted` after one accept
  click:** the `accept_offer` unified RPC isn't rejecting
  cross-table siblings, or the trip-row lock is missing.
  Critical regression. Inspect `accept_offer` in the migration.
- **Step 32 actually loads a working form on the stale URL:**
  either `target.dispatch_round_id` doesn't match
  `trip.current_dispatch_round_id` after re-dispatch (RPC bug),
  or the operator page's v=2 branch isn't checking round-currency
  (page bug). Both regressions of iteration-2 P2 fix.
- **Step 34 actually loads a working form on the tampered
  token:** HMAC verification in `lib/operator/token.ts` is
  broken or `OPERATOR_TOKEN_SECRET` differs between issuer and
  verifier. Treat as P1.

## Reverting the gate

If anything in steps 11–34 surfaces a regression you can't
fix immediately, roll back by **unsetting `PHASE5_ADMIN_UI`**
(or setting it to anything other than the literal `true`) in
Vercel and triggering a redeploy.

**Important — what the env unset DOES and does NOT do.** The
`PHASE5_ADMIN_UI` env var is read **only** by the admin trip
detail page (`/admin/trips/[id]`). It controls which view that
page renders (Phase 5 multi-row vs Phase 4 single-row). It has
**no effect** on the operator portal or on the Server Actions:

- ✅ The admin trip page reverts to the Phase 4 view. Multi-row
  dispatch and the unified comparison view disappear from the
  admin's screen.
- ✅ `dispatchTripV2` is no longer reachable through the UI
  (the multi-row form is gone), so no NEW v=2 dispatches will
  happen.
- ❌ Any v=2 operator URLs that **were already issued before
  the rollback** remain valid. The operator portal's v=2
  branch (PR #11) is wired regardless of the env var, so an
  operator opening one of those URLs will still see the offer
  form and can still submit. The submission lands in
  `phase5_operator_offers` via `submit_phase5_operator_offer`
  exactly as before.
- ❌ Those landed Phase 5 offers are then **invisible** to
  the rolled-back admin (the Phase 4 view's offer list reads
  only `phase4_operator_offers` via `listOffersByTrip`). They
  exist in the DB but the admin won't see or accept them in
  the UI.

This is not a data-loss bug — the offers persist correctly —
but it IS a "silent split-brain": operators may submit, the
trip state reflects their offers in the DB (target rows flip
to `submitted`, trip status promotes to `offered`), but the
admin can't act on them.

### When rollback is safe without an SQL rescue

- The flip happened in step 9, then a regression surfaced
  immediately in step 11 (the multi-row UI didn't render).
  No v=2 URLs ever reached an operator → nothing to rescue.
- Or: every v=2 URL you generated has already been submitted
  AND accepted in step 26. The accept already cancelled the
  remaining pending targets and closed the round. Nothing
  pending → nothing to rescue.

In those cases: `unset env → redeploy → Phase 4 baseline`. No
DB action required.

### When rollback REQUIRES an SQL rescue

If you flipped the gate, generated v=2 URLs, sent them to
operators, and now want to roll back **before** the flow
reaches a clean accept, you must close out the in-flight v=2
state at the SQL level. Otherwise operators may submit while
admin sees Phase 4 only.

#### Step 1 — see what's in flight

In Supabase SQL Editor:

```sql
-- Open dispatch rounds (still allowing operator submissions)
SELECT r.id AS round_id,
       r.trip_request_id,
       r.opened_at,
       count(*) FILTER (WHERE t.status = 'pending') AS pending_targets
  FROM trip_dispatch_rounds r
  LEFT JOIN trip_dispatch_targets t ON t.dispatch_round_id = r.id
 WHERE r.status = 'open'
 GROUP BY r.id
 ORDER BY r.opened_at DESC;

-- Pending Phase 5 offers (already submitted, awaiting admin
-- decision; rollback should NOT delete these — they're real
-- operator submissions)
SELECT trip_request_id, count(*)
  FROM phase5_operator_offers
 WHERE status = 'pending'
 GROUP BY trip_request_id;
```

If both queries return **zero rows**, no rescue needed — the
gate-only revert above is fine.

#### Step 2 — close out in-flight v=2 dispatches (SAFE rescue)

This block cancels still-pending v=2 targets and closes their
open rounds, so any in-flight v=2 URL submitted from now on
will hit the RPC's `target_not_pending` / `token_stale` path
and render the friendly expired page. **It does NOT delete
any submitted offers** — those are real operator data and
must be preserved for audit.

```sql
BEGIN;

-- Cancel pending Phase 5 targets (operators with these
-- URLs will see the expired-link page on next click).
UPDATE trip_dispatch_targets
   SET status = 'cancelled'
 WHERE status = 'pending';

-- Close open rounds with an explicit rollback marker so the
-- audit trail shows why.
UPDATE trip_dispatch_rounds
   SET status = 'closed',
       closed_at = NOW(),
       closed_reason = 'rollback'
 WHERE status = 'open';

-- (Optional) inspect what changed before COMMIT.
-- SELECT count(*) AS now_cancelled FROM trip_dispatch_targets WHERE status = 'cancelled';
-- SELECT count(*) AS now_closed    FROM trip_dispatch_rounds  WHERE status = 'closed';

COMMIT;
```

After this commits, every v=2 link that was outstanding
becomes useless on next click — the operator portal's v=2
re-check (`target.status === 'pending'`) fails and renders
ExpiredLink. Already-submitted Phase 5 offers stay in
`phase5_operator_offers` exactly as they were; if the founder
later wants to address them, flip the gate back ON
temporarily and accept/cancel through the normal admin UI.

#### Step 3 — only NOW unset the env

Set `PHASE5_ADMIN_UI` to anything other than the literal
`true` in Vercel and trigger a redeploy. The Phase 4 path
takes over the admin UI; no further v=2 dispatches will be
generated.

### What rollback does NOT do (regardless of SQL rescue)

- It does not drop the Phase 5 schema. The 3 new tables and
  3 new RPCs stay in `public`. Re-flipping the gate later
  picks up exactly where you left off.
- It does not invalidate v=1 (Phase 4) tokens. Phase 4
  dispatch + submit + accept paths keep working.
- It does not touch `phase4_operator_offers` or any Phase 4
  RPCs.

> **Recap of what activation does NOT include.** Phase 5
> activation is purely the admin + operator dispatch path.
> It does not change billing, payments, ZATCA invoicing, the
> empty-leg engine, the medevac surface, the cargo surface,
> or the loyalty program. None of those are wired to Phase 5
> tables.

---

# Phase 5.1 — Operator Experience Polish (preview checklist)

A short visual checklist for the Phase 5.1 implementation PR.
Runs against the **Vercel preview build of the PR itself**
(`<preview-url>` in this section), **not** production. Intent:
prove the new operator UX renders correctly under both v=2 and
v=1 paths and under both Arabic and English. Per Codex resolved
decision #6 this lives alongside the Phase 5 runbook above; it
does not replace any Phase 5 step.

The checklist mirrors `aeris/docs/CLAUDE-TASK.md` Phase 5.1
acceptance criteria #1–#14, condensed into the smallest
sequence that exercises every changed surface.

## Setup

Before running the checklist, on the Vercel preview build:

1. Sign in to `<preview-url>/admin/login` with founder
   credentials (same account used for Phase 5 activation).
2. Create one fresh test trip via the public form
   (`<preview-url>/request`) → promote it from
   `<preview-url>/admin/leads/<id>` → dispatch to **two**
   operator phone numbers from
   `<preview-url>/admin/trips/<id>` (Phase 5 multi-row
   dispatch panel). Capture both v=2 operator URLs.

These two URLs (call them URL-A and URL-B) plus a tampered
copy of URL-A are the test fixtures used below.

## Steps

### Phase 5.1-1 — Trip summary in Arabic (default)

Open URL-A in incognito (no `?lang=` param).

- [ ] Trip summary card shows departure as
      `dd/mm/yyyy hh:mm (بتوقيت الرياض)` — Asia/Riyadh time
      with explicit suffix (acceptance #1).
- [ ] Trip summary card shows a "هذا الرابط صالح حتى …" row
      with the token expiry, formatted the same way
      (acceptance #2).
- [ ] Form fields render with helper text below the required
      inputs (acceptance #9).
- [ ] AERIS header at the top shows the language toggle button
      labelled "EN" (acceptance #13 chrome).

### Phase 5.1-2 — Toggle to English

Click the "EN" toggle. URL becomes `URL-A?lang=en`.

- [ ] Header tagline switches to "Operator offer submission
      portal".
- [ ] Trip summary labels switch to English (Trip Details,
      Route, Departure, Passengers, Requested aircraft
      category, This link is valid until).
- [ ] Departure timestamp stays in Asia/Riyadh, suffix becomes
      "(Riyadh time)".
- [ ] Form labels + helper text + submit button switch to
      English.
- [ ] Toggle button label flips to "العربية" (acceptance #13).

### Phase 5.1-3 — Per-field validation

Still in English, submit the form **empty** (Submit Offer
button).

- [ ] Inline red error messages appear under each empty
      required field (operator name, phone, total price,
      departure ETA, validity hours) using the English
      translations (acceptance #10).
- [ ] No block-level red banner at the bottom of the form
      while inline errors are present (the `helper` and
      `error` slots are mutually exclusive per Field
      component).

Switch back to Arabic via toggle (`?lang=ar` removed).

- [ ] Same empty submit shows the Arabic translations of
      the same per-field errors.

### Phase 5.1-4 — Successful submit + success panel

Fill the form with valid data: operator name, phone
(+966500000099), total price 5000, departure ETA = a
near-future Asia/Riyadh timestamp, validity 24, aircraft
category Midsize, aircraft type "G650". Submit.

- [ ] Success panel renders with the green border styling.
- [ ] Summary card inside the success panel shows: request
      number (mono font), price `5,000 ريال` (or `5,000 SAR`
      under EN), aircraft `متوسطة — G650` (or
      `Midsize — G650`), departure ETA in Asia/Riyadh,
      validity `24 ساعة` (or `24 hours`) (acceptance #8).
- [ ] "احفظ هذه الصفحة كمرجع" / "Save this page for
      reference" note visible (per spec Risk 4).
- [ ] WhatsApp button visible at the bottom of the success
      panel.

### Phase 5.1-5 — ExpiredLink variants

Open URL-B in a fresh incognito window. Submit the form
successfully (any valid offer). The target row's status flips
to `submitted`.

Now reload URL-B in the same window.

- [ ] ExpiredLink renders with the **already_used** variant:
      title "تم استخدام هذا الرابط" (or English equivalent
      under `?lang=en`) (acceptance #5).

In the Supabase SQL Editor, run on the URL-A target row
(URL-A is still pending — URL-A was the form filled out in
Phase 5.1-4 above, so its target status is `submitted`; if
that's the case, dispatch a third URL-C from a fresh trip
and use it here instead, otherwise use URL-A):

```sql
UPDATE trip_dispatch_targets
SET expires_at = now() - interval '1 minute'
WHERE id = '<target id>';
```

Reload the URL whose target you just expired.

- [ ] ExpiredLink renders with the **expired** variant: title
      "انتهت مدة صلاحية هذا الرابط" (or English equivalent)
      (acceptance #3).

(Optional, if you have time and a third URL: trigger
re-dispatch from the admin UI on a fresh trip → reload an
old URL → ExpiredLink renders the **cancelled** variant.
This mirrors Phase 5 activation step 32.)

### Phase 5.1-6 — HMAC-fail still generic

Take any URL from above, mutate one base64url character in
the URL bar (same probe as Phase 5 activation step 34),
reload.

- [ ] ExpiredLink renders the **generic** title and body
      ("هذا الرابط منتهي الصلاحية" / "This link is no longer
      valid"), **not** any of the three variants
      (acceptance #6 — preserves the no-oracle property).

### Phase 5.1-7 — v=1 backwards compat (code-review-only acceptable)

Per Codex resolved decision #7: a live v=1 probe is generated
**only if practical** in the preview environment.

If you can dispatch a v=1 (Phase 4) test link from the legacy
path against a separate test trip:

- [ ] v=1 URL opens the same form + summary chrome as v=2.
- [ ] v=1 submit succeeds and renders the same SuccessPanel.
- [ ] Both Arabic and English render correctly under v=1.

If the legacy Phase 4 dispatch path isn't easily reachable
on the preview, **acceptance #11 is satisfied by code review**
of `app/operator/offer/[token]/page.tsx` v=1 branch confirming
the new prop surfaces (lang + operatorContext +
tripRequestNumber) are passed through unchanged. Note this in
the PR description.

## Pass criteria

All checked boxes above. The preview URL the boxes were
checked against goes into the Phase 5.1 work-log entry.

## What this checklist does NOT cover

- Real production traffic on `aeris-flax.vercel.app` —
  production verification is a **founder follow-up after merge**,
  not a PR acceptance gate (per spec Acceptance criteria
  header).
- DB / RPC / admin changes — Phase 5.1 touches none of these
  (per spec Out of scope).
- Phase 5 invariants (multi-dispatch atomicity, refresh-
  durable rebuild, accept atomicity, re-dispatch atomicity,
  tampered-token rejection at the security level) — those are
  the Phase 5 runbook above and are unchanged by Phase 5.1.

---

# Phase 6.0 — Airports Foundation, PR 2 (preview checklist)

A short visual checklist for Phase 6.0 PR 2 (UI wiring on
top of PR 1's schema + types + helpers). Runs against the
**Vercel preview build of the PR itself** (`<preview-url>`),
**not** production. Prerequisites:

- PR 1 has merged to main.
- Founder has applied
  `20260506000005_phase_6_airports.sql` to production
  Supabase and the 5 verification probes pass.
- The preview build is green and the `airports` table on
  the upstream Supabase has the 16 seeded airports (12
  initial + 4 KSA from PR 1).

This checklist mirrors `aeris/docs/CLAUDE-TASK.md` Phase 6.0
spec acceptance criteria #1–#13 (UX) into the smallest
sequence that exercises every changed surface. Non-UX
criteria #14–#17 are gated by the build/lint/type checks
in CI and the PR-2-scope `git diff main` check.

## Steps

### Phase 6.0-1 — `/request` picker renders + IATA submit

Open `<preview-url>/request` in incognito.

- [ ] The "من" combobox trigger is a styled button (not a
      free text input). Click it.
- [ ] Dropdown shows airports grouped by country, KSA
      first ("Saudi Arabia" header). At least 16 airports
      appear (12 initial + 4 PR 1 additions).
- [ ] Type "rua" or "ري" in the search box; the list
      filters in real time. Type "ynb"; YNB (Yanbu) appears.
- [ ] Pick "الرياض — مطار الملك خالد الدولي — RUH" as
      origin. The trigger button now shows
      "الرياض (RUH)".
- [ ] Pick "جدة — مطار الملك عبدالعزيز الدولي — JED" as
      destination.
- [ ] Fill the rest of the form (name, phone, dates,
      passengers) and submit.
- [ ] Success panel renders. In Supabase SQL Editor:
      `SELECT request_number, origin, destination,
      origin_iata, destination_iata FROM lead_inquiries
      ORDER BY created_at DESC LIMIT 1;`
- [ ] Returned row has `origin_iata = 'RUH'` AND
      `destination_iata = 'JED'` AND `origin` = "الرياض
      (RUH)" AND `destination` = "جدة (JED)" — the display
      label, not raw IATA. Acceptance #2.

### Phase 6.0-2 — Freeform fallback works

Reload `<preview-url>/request`.

- [ ] In the origin combobox, open the dropdown and click
      "أخرى — اكتب يدوياً" at the bottom.
- [ ] The trigger swaps to a text input with an edit-mode
      icon and a "↺" return button.
- [ ] Type "العُلا — مطار خاص" as origin. Pick a known
      IATA (DMM) for destination. Submit the rest.
- [ ] Success panel renders.
- [ ] Latest lead row has `origin_iata = NULL`,
      `origin = "العُلا — مطار خاص"`,
      `destination_iata = 'DMM'`,
      `destination = "الدمام (DMM)"`. Acceptance #3.

### Phase 6.0-3 — Validator rejects "neither" + "both"

Reload `/request`.

- [ ] Fill the rest of the form but leave the origin
      combobox untouched (no selection). Submit.
- [ ] Inline error renders under the origin field:
      "اختر مطاراً أو اكتب يدوياً." (the
      `origin_required` translation). Acceptance #4.
- [ ] Open browser DevTools → Network tab. Re-submit with
      both `origin_iata = 'RUH'` AND `origin_freeform = 'X'`
      forced via "Edit and resend" (or by manually crafting
      a fetch). Server returns
      `{ ok: false, fieldErrors: { origin: 'origin_ambiguous' } }`.
      Acceptance #5.

### Phase 6.0-4 — Validator rejects unknown IATA

In DevTools, craft a request payload with `origin_iata = 'ZZZ'`
(format-valid but not in the airports table). Submit.

- [ ] Server returns
      `{ ok: false, fieldErrors: { origin: 'origin_iata_unknown' } }`.
      The form translates to "هذا الرمز غير معروف. اختر من
      القائمة أو اكتب يدوياً." Acceptance #6.

### Phase 6.0-5 — Admin promote-lead writes the new legs shape

In `<preview-url>/admin/leads/<the-lead-from-step-6.0-1-id>`:

- [ ] Trigger the "تأكيد التحويل" button to promote the
      lead (with origin_iata=RUH, destination_iata=JED).
- [ ] In Supabase SQL Editor:
      `SELECT request_number, departure_airport,
      arrival_airport, legs FROM trip_requests ORDER BY
      created_at DESC LIMIT 1;`
- [ ] Row has `departure_airport = 'RUH'`,
      `arrival_airport = 'JED'`, and `legs` JSONB shape:
      `[{ "from": "RUH", "to": "JED", "from_freeform":
      null, "to_freeform": null, "date": "...", "time":
      null }]`. Acceptance #7.
- [ ] Promote the freeform-origin lead from step 6.0-2.
      The new trip row has `departure_airport = NULL`,
      `arrival_airport = 'DMM'`, and
      `legs[0].from = null, legs[0].from_freeform =
      "العُلا — مطار خاص", legs[0].to = 'DMM'`.
      Acceptance #8.

### Phase 6.0-6 — Operator portal renders airport labels

Dispatch the IATA-only trip from step 6.0-5 to one operator
phone via the Phase 5 admin dispatch panel. Capture the v=2
operator URL.

- [ ] Open the URL in a fresh incognito. Trip summary card
      shows route as "الرياض (RUH) ← جدة (JED)" — labels
      from the airports table, not raw IATA codes.
      Acceptance #9.
- [ ] Append `?lang=en` to the URL. Same row renders
      "Riyadh (RUH) → Jeddah (JED)". Acceptance #11.

### Phase 6.0-7 — Operator portal renders freeform fallback

Dispatch the freeform-origin trip from step 6.0-5 the same
way. Capture URL.

- [ ] Open in incognito. Trip summary route shows
      "العُلا — مطار خاص ← الدمام (DMM)". The freeform
      side renders verbatim with no IATA parenthetical, no
      "(غير معروف)" / "(unknown)" suffix, no crash.
      Acceptance #10.

### Phase 6.0-8 — Legacy `legs[]` shape still renders correctly

This is acceptance #13 — verifies that trips created BEFORE
Phase 6.0 (their legs JSONB has `from`/`to` as bare freeform
Arabic strings, no `from_freeform`/`to_freeform` keys at
all) continue to render through the legacy fallback path
without the helper attempting an IATA lookup.

If a pre-Phase-6.0 trip is still in the DB and you have a
v=2 URL for it:

- [ ] Open the URL in incognito. Route renders with the
      raw Arabic strings verbatim (e.g. "الرياض ← جدة"),
      no IATA parenthetical, no "(unknown)" suffix, no
      crash.

If no pre-Phase-6.0 v=2 URL is reachable, fall back to
**SQL fixture**: in Supabase SQL Editor, pick any current
trip_request and update its legs shape to legacy:
```sql
UPDATE trip_requests
SET legs = '[{"from":"الرياض","to":"جدة","date":"2026-06-01","time":null}]'::jsonb
WHERE id = '<a-test-trip-id>';
```
Re-open the trip's existing v=2 operator URL.

- [ ] Same render: "الرياض ← جدة" verbatim, no errors.

## Pass criteria

All checked boxes above. The preview URL the boxes were
checked against goes into the Phase 6.0 PR 2 work-log entry.

## What this checklist does NOT cover

- Real production traffic on `aeris-flax.vercel.app` —
  production verification is a **founder follow-up after
  merge**, not a PR acceptance gate.
- The `empty_legs` table — no Phase 6.0 changes touch it
  (per spec acceptance #12).
- The Phase 5 / Phase 5.1 invariants (multi-dispatch
  atomicity, refresh-durable rebuild, accept atomicity,
  re-dispatch atomicity, tampered-token rejection,
  language toggle) — those are unchanged by Phase 6.0
  and are covered by their own checklists above.
