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
