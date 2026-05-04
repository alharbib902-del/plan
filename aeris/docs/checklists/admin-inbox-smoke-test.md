# Admin Inbox Smoke Test

## Purpose

Manual end-to-end check of the admin lead inbox: login, list, detail,
status change, internal notes, sign-out, unauthenticated redirect, and
cookie-tamper behaviour. UI-only — no programmatic Server Action
endpoint probing in this list (that belongs in future automated tests).

## When to run

- Before every deploy that touches `lib/admin/*`,
  `lib/supabase/queries/leads.ts`, `app/(admin)/**`, or
  `components/admin/**`.
- Weekly on production, even if nothing changed (catches drift in
  auth cookies, env, and Supabase availability).
- After rotating `ADMIN_INBOX_PASSWORD` or `ADMIN_AUTH_SECRET`.

## Setup

You need:

- A working preview or production URL (`<host>` below).
- A test lead row that already exists in `lead_inquiries` (submit one
  via `/request` if needed).
- Browser DevTools open (Application → Cookies pane).
- The current `ADMIN_INBOX_PASSWORD`.

## Steps

### Login

1. [ ] Open `<host>/admin/leads` in a clean tab (no cookie set).
       → You are redirected to `<host>/admin/login`.
2. [ ] Submit the form with a wrong password.
       → Arabic error renders: `كلمة المرور غير صحيحة.`
3. [ ] Submit with the correct password.
       → You land on `<host>/admin/leads`.
4. [ ] In DevTools, confirm a cookie named `aeris_admin` exists with
       `HttpOnly = true`, `SameSite = Lax`, `Path = /admin`. On a
       production HTTPS host, `Secure = true`. On localhost HTTP,
       `Secure = false`.

### Lead list

5. [ ] The list shows recent leads with: request number, customer
       name, phone (clickable), origin → destination, departure date,
       status badge, "وصل في" timestamp.
6. [ ] Click each status filter tab (`الكل · جديد · تم التواصل · تم
       التسعير · تحوّل لحجز · مغلق`).
       → URL updates to `?status=...`, the list narrows accordingly,
       counts on tabs match the visible rows.

### Lead detail

7. [ ] Click "فتح" (or the row on mobile) for any lead.
       → `/admin/leads/<id>` renders with full detail card, status
       sidebar, internal notes block.
8. [ ] Phone displays in human-readable form (e.g. `+966 55 123 4567`).
9. [ ] "واتساب للعميل" button's `href` is
       `https://wa.me/9665XXXXXXXX?text=...` — the digits **must
       start with `966`** even if the customer entered `0551234567`
       or `551234567`. Hover to inspect.

### Status change

10. [ ] Pick a lead currently in `جديد`. Change status to `تم التواصل`.
        → Page reloads. Badge now reads `تم التواصل`.
11. [ ] In Supabase SQL Editor, confirm:
        - `status = 'contacted'`.
        - `last_contacted_at IS NOT NULL` and is within the last
          minute.
12. [ ] Change status back to `جديد`.
        → Badge resets. (Note: `last_contacted_at` is **not**
        cleared by design — going back to `new` does not erase the
        history of having been contacted.)

### Internal notes

13. [ ] Type a note like `Test note — <YYYY-MM-DD HH:MM>` and click
        "حفظ الملاحظة".
        → The note appears in the existing-notes block, prefixed with
        an ISO timestamp like `[2026-04-25T...] Test note — ...`.
14. [ ] Add a second note. Both notes are now visible, separated by
        newlines, in chronological order.
15. [ ] In Supabase, confirm `internal_notes` contains both lines.

### Cookie-tamper UI check (replaces direct-POST probe)

16. [ ] Keep the lead detail tab open. Open DevTools → Application →
        Cookies → delete the `aeris_admin` cookie.
17. [ ] In the still-open tab, change the status from the dropdown.
        → You are redirected to `/admin/login` (no successful update).
18. [ ] Type a new note and click "حفظ الملاحظة".
        → You are redirected to `/admin/login` (no save).
19. [ ] In Supabase, confirm the lead row's `status` and
        `internal_notes` are exactly what they were before step 16.
        Nothing changed.
20. [ ] Reload `<host>/admin/leads` — redirects to `/admin/login`.
21. [ ] Reload `<host>/admin/leads/<id>` — redirects to `/admin/login`.

### Sign-out

22. [ ] Sign in again. Click "تسجيل الخروج" in the header.
        → `aeris_admin` cookie is removed; you land on
        `/admin/login`.
23. [ ] Direct-load `<host>/admin/leads` — still redirects to
        `/admin/login`.

## Pass criteria

- Every box above is ticked.
- No 5xx response anywhere in the flow.
- Status filter counts match the visible row counts on every tab.
- WhatsApp links use `wa.me/966…` format (international, no leading
  `+`, no leading `0`).
- Cookie-tamper steps 17–21 do **not** result in any DB write.
- The Arabic copy renders RTL with no layout breakage at 375 px
  (mobile viewport).

## If it fails

- **Login fails with the right password:**
  - Confirm `ADMIN_INBOX_PASSWORD` env in Vercel matches what you
    typed (case-sensitive, leading/trailing spaces matter).
  - If the friendly Arabic "الإعدادات غير مكتملة" screen appears
    instead of the login form, the env var is missing or empty in
    that environment — fix in the Vercel dashboard.
- **Status filter counts disagree with row counts:**
  - Check `lib/supabase/queries/leads.ts → countLeadsByStatus()`.
- **WhatsApp link still shows `wa.me/0551234567`:**
  - The `normalizeWhatsAppPhone()` helper is not being used. Verify
    `lib/utils/whatsapp-admin.ts` and
    `lib/notifications/lead-email.ts` both call it.
- **Cookie-tamper write succeeds (steps 17 or 18):**
  - **Critical.** This means a mutation Server Action is missing its
    `await requireAdminSession()` first line. Find which action lacks
    it (`app/(admin)/admin/actions/leads.ts` or `admin-auth.ts`),
    add it, and re-run.
- **Cookie has `Secure = false` in production:**
  - Check `lib/admin/auth.ts → getAdminCookieOptions()`. The cookie
    must be `secure` when `process.env.NODE_ENV === 'production'`.
