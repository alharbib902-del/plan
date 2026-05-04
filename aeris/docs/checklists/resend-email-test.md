# Resend Email Test

## Purpose

Verify the founder lead-notification email path:

- The valid-key path actually delivers a well-rendered Arabic-RTL
  email with a working deep link.
- The missing-key path is a **silent no-op** — no email, no error,
  no broken submission.
- The invalid-key path logs a controlled `[lead-email] resend send
  failed` and still does not break the submission.

`notifyAdminOfNewLead()` in `lib/notifications/lead-email.ts` is
best-effort by design (Phase 2 plan). Phase 3 must NOT add logging or
change app behaviour to satisfy this checklist — verify the existing
code, do not adjust it.

## When to run

- After any change to `lib/notifications/lead-email.ts`.
- After any change to `app/actions/flight-request.ts`.
- After rotating `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, or
  `LEAD_NOTIFICATION_TO`.
- After any change to the Resend domain DNS / verified sender setup.

## Setup

You need:

- A working preview or production deployment.
- Access to the inbox at `LEAD_NOTIFICATION_TO` (or
  `RESEND_FROM_EMAIL` if `LEAD_NOTIFICATION_TO` is unset).
- Server logs visible (Vercel → project → Deployments → the active
  deployment → Logs). Filter by `[lead-email]` and
  `[flight-request]`.
- The current `RESEND_API_KEY` (kept securely; only used to set/unset
  in the Vercel env, not pasted anywhere else).

## Steps

### 1. Valid key — happy path

1. [ ] In Vercel env (or local `.env.local`), `RESEND_API_KEY` is
       set to a real key (starts with `re_`, length ≥ 30 chars).
       `RESEND_FROM_EMAIL` is set to a verified sender on a
       Resend-verified domain.
2. [ ] Submit a real test request via `<host>/request` with:
       - Name: `Test Founder Notify`
       - Phone: `0551234567` (Saudi local — exercises
         `normalizeWhatsAppPhone`)
       - Origin: `RUH`, Destination: `DXB`, departure ≥ today.
       - Passengers: 2, trip type: `ذهاب فقط`.
       - Notes: any short Arabic text.
       → Success UI shows the DB-issued reference (`AER-…`).
3. [ ] Within ~10 seconds, an email arrives at the configured
       `LEAD_NOTIFICATION_TO` (or `RESEND_FROM_EMAIL` fallback)
       with subject `طلب رحلة جديد · AER-… · Test Founder Notify`.
4. [ ] In Gmail web: the email renders **right-to-left** with the
       gold/navy theme; nothing wraps weirdly. The "هاتف" line shows
       both a `tel:` link and a "واتساب" link.
5. [ ] The "واتساب" link's `href` starts with
       `https://wa.me/966551234567?text=` (digits start with `966`,
       not `0` or `+`).
6. [ ] Click "فتح الطلب في لوحة Aeris" → opens
       `<host>/admin/leads/<id>` in the browser. After admin login,
       the lead opens correctly.
7. [ ] In Vercel logs, **no** `[lead-email] resend send failed`
       error for this request.
8. [ ] (Optional, second client) Outlook Web renders the email with
       acceptable RTL layout — minor desktop-Outlook quirks are
       tolerable, but Arabic text is not garbled or LTR-flipped.

### 2. Missing key — silent no-op (Codex iteration 2 fix)

9. [ ] In Vercel env, **unset** `RESEND_API_KEY` (or set it to the
        placeholder `re_xxxxxxxxxxxx` from `.env.example`). Re-deploy
        if needed for the env change to take effect on the running
        instance.
10. [ ] Submit another `/request` form on that deployment. Use a
        distinct customer name like `Test No-Key Notify`.
        → Success UI renders with a real DB-issued reference number.
11. [ ] In Supabase, confirm a new row in `lead_inquiries` for
        `customer_name = 'Test No-Key Notify'`.
12. [ ] In Vercel logs:
        - **No** email is sent (you cannot prove a negative directly,
          but the inbox should not receive anything tied to this
          submission).
        - **No** `[lead-email] resend send failed` line for this
          submission.
        - The current code returns silently when the key is missing
          or still the placeholder; the absence of the failure log
          *is* the pass signal. Do not require any other log line.

### 3. Invalid key — controlled failure, submission still succeeds

13. [ ] In Vercel env, set `RESEND_API_KEY` to a deliberately
        invalid value (e.g. `re_DELIBERATELY_INVALID_FOR_TEST_AAAAA`,
        length ≥ 30 so the secret-scan regex would catch it if it
        were real, but it is fake). Re-deploy.
14. [ ] Submit another `/request` form. Customer name
        `Test Bad-Key Notify`.
        → Success UI renders with a real DB-issued reference number.
15. [ ] In Supabase, confirm the row was inserted.
16. [ ] In Vercel logs, exactly one `[lead-email] resend send failed`
        line appears for this submission, with the underlying Resend
        SDK error attached.
17. [ ] **Restore** the real `RESEND_API_KEY` in Vercel env and
        re-deploy. Repeat step 1 once to confirm the happy path is
        live again.

## Pass criteria

- Section 1: real email delivered, RTL rendering OK, WhatsApp link
  uses `966…` digits, deep link opens the right `/admin/leads/<id>`.
- Section 2: missing key does not break submissions; no failure log;
  no email; the lead is still in the DB.
- Section 3: invalid key produces exactly one controlled
  `[lead-email] resend send failed` log per submission, the form
  still succeeds, the lead is still in the DB, and the real key is
  restored at the end.

## If it fails

- **No email arrives in section 1, but logs are clean:**
  - Verify the sender is on a Resend-verified domain.
  - Check the recipient's spam folder.
  - Confirm `LEAD_NOTIFICATION_TO` points where you think it does.
- **Form submission fails (5xx) in any section:**
  - **Critical.** `notifyAdminOfNewLead()` is supposed to never
    throw to the caller. Inspect `app/actions/flight-request.ts`
    and confirm the `try/catch` around the call is intact. Phase 2
    contract: the email path is best-effort and must not break the
    form.
- **Section 2 produces a `[lead-email] resend send failed` line:**
  - The current code is supposed to return early when the key is
    missing or the placeholder. Inspect the early-return guard in
    `lib/notifications/lead-email.ts`. If it changed, restore the
    Phase 2 behaviour. **Do not "fix" by adding a `skipped — no
    key` log line — that is out of scope for Phase 3.**
- **WhatsApp link in the email shows `wa.me/0551234567` or
  `wa.me/+966…`:**
  - The email is not running through `normalizeWhatsAppPhone`. Fix
    `lib/notifications/lead-email.ts` to use the helper from
    `lib/utils/format.ts`.
- **Deep link opens 404 or wrong lead:**
  - Verify `NEXT_PUBLIC_SITE_URL` in the deployment matches the
    public URL of the running deployment. Verify the lead `id` was
    correctly read from the DB `RETURNING` clause in the form
    Server Action.
