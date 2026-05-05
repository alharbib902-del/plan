# Production Readiness

## Purpose

Master pre-deploy gate. Every production push must pass this list.
This file aggregates the five focused checklists; do not skip a
sub-list because "nothing changed there" — environment drift is real.

## When to run

- Before every production deploy (Vercel `main` → Production).
- After any rotation of `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
  `ADMIN_INBOX_PASSWORD`, or `ADMIN_AUTH_SECRET`.
- After any incident.

## Steps

### 1. Local build health

1. [ ] `cd aeris && npm ci` → exits `0`. (Use `npm ci` to mirror what
       CI runs; `npm install` is acceptable for first-time setup
       only.)
2. [ ] `npm run type-check` → exits `0`.
3. [ ] `npm run build` → exits `0`. In the route table at the end:
       - `/`, `/request`, `/_not-found` are `○ Static`.
       - `/admin/login`, `/admin/leads`, `/admin/leads/[id]` are
         **`ƒ Dynamic`**. If any admin route shows `○ Static`, stop
         and investigate.
4. [ ] `npm run lint:strict` → exits `0` with no warnings or errors.
       (Optional convenience: `pwsh scripts/preflight.ps1` runs
       steps 2-4 in sequence.)

### 2. CI gate

5. [ ] [ci-pipeline.md](ci-pipeline.md) — every item passes; the
       commit being promoted has a green **CI** run on GitHub
       Actions.

### 3. Sub-checklists

6. [ ] [security-hardening.md](security-hardening.md) — every item
       passes.
7. [ ] [supabase-migration-verification.md](supabase-migration-verification.md) —
       every item passes against the staging DB *and* production DB.
8. [ ] [admin-inbox-smoke-test.md](admin-inbox-smoke-test.md) —
       run on the preview deploy that will be promoted to production.
8a. [ ] [operator-flow-smoke-test.md](operator-flow-smoke-test.md) —
        run on the preview deploy. Required once Phase 4 ships. If
        the deploy does not touch Phase 4 surfaces and the previous
        run is < 7 days old, the spot-checks at steps 1-17 (promote
        + dispatch + submit + accept happy path) are sufficient.
8b. [ ] [pwa-audit.md](pwa-audit.md) — run if this deploy touches
        any PWA surface (`app/manifest.ts`, `public/sw.js`,
        `public/icons/**`, `app/offline/**`, `components/pwa/**`,
        `app/layout.tsx`). Quarterly otherwise. **No Lighthouse
        score involved** — concrete `curl` + DevTools checks only.
9. [ ] [resend-email-test.md](resend-email-test.md) — at least the
       valid-key path verified after this build is on preview.
10. [ ] [env-vars-vercel-supabase.md](env-vars-vercel-supabase.md) —
        env variables present in **production** scope match the
        required-set table in that file.

### 4. Operational readiness

11. [ ] Secrets older than **90 days** are rotated. (Track the date
        each was last rotated in a private note; do not commit.)
12. [ ] Rollback plan known: previous deploy is one click away in
        Vercel ("Promote to Production" on the prior deployment).
13. [ ] Founder is reachable on WhatsApp during the next 2 hours
        post-deploy in case a real lead lands.
14. [ ] If migrations were applied to production this round, a
        Supabase point-in-time snapshot was taken **before** the
        migration ran.
15. [ ] [`docs/security/npm-audit-triage.md`](../security/npm-audit-triage.md)
        is current. If the last triage is older than one quarter, or
        `npm audit --json` now reports a different total or new
        advisory, refresh the file before deploying.

## Pass criteria

- Every box above checked.
- All five sub-checklists fully green (no skipped items).
- No item answered "N/A" without a written reason in the deploy notes.

## If it fails

- **Step 1.x fails (build/lint/type-check):** do not deploy. Fix
  locally, re-run from step 1.
- **Step 2 fails (CI red on the commit being promoted):** do not
  deploy. Open the failing run on GitHub Actions, follow
  [ci-pipeline.md](ci-pipeline.md) *If it fails*, push the fix, and
  re-run this whole list from step 1.
- **Step 3.x fails (a sub-checklist):** open the failing sub-list,
  follow its own *If it fails* section, then re-run this whole list
  from step 1.
- **Step 4.x fails (operational):** rotate the stale secret /
  prepare the rollback / wait for founder availability. Do not deploy
  on a Friday afternoon if step 13 cannot be answered yes. If
  step 15 fails, refresh
  [`docs/security/npm-audit-triage.md`](../security/npm-audit-triage.md)
  before deploying.
- **Already deployed and a sub-list now fails in production:**
  - Roll back via Vercel ("Promote" the previous production deployment).
  - File the failure detail in the deploy notes.
  - Run this list again on a fresh build before re-deploying.
