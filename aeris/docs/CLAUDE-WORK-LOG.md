# Claude Work Log

Claude Opus updates this file after each task.

## Task

Phase 3.5.1: Branch Protection Ops

## Status

Completed (ready for Codex review).

This is a documentation-only follow-on to Phase 3.5. No app code, no
dependency changes, no workflow YAML changes. The deliverable is a
new "Branch Protection Setup" section inside the existing
`docs/checklists/ci-pipeline.md`.

## Summary

Phase 3.5 made CI runnable. Phase 3.5.1 makes CI **load-bearing** —
i.e., a red CI run physically prevents merge to `main`. That requires
a Branch Protection rule on `main`, which can only be configured
*after* the first push and *after* the first CI run gives GitHub a
status-check name to bind to. Phase 3.5.1 captures that procedure
precisely so the founder can run it once without guesswork.

## What Claude did NOT do

These are explicitly founder actions and were intentionally not
performed in this session:

- **Did not push to `origin`.** The push is the founder's call,
  including which exact commit set lands first. The repo is at
  `https://github.com/alharbib902-del/plan.git`; `origin/main` is at
  commit `6248a60` ("Add Aeris private aviation pitch deck"); the
  Aeris project files (`aeris/`, `.github/`, etc.) are still
  untracked locally. The founder decides when those are committed
  and pushed.
- **Did not configure the Branch Protection rule on GitHub.** That is
  a server-side operation against the GitHub API/UI, not a file in
  the repo.
- **Did not run the Verification PR.** That requires push + a real PR
  on GitHub; it is documented as a step the founder runs once after
  enabling the rule.

What Claude did do is document the entire procedure end-to-end so the
founder can run it without ambiguity, with both UI and `gh` CLI
paths, and with a clear Verification step that proves the rule is
live.

## Files Changed

### Edited

- `aeris/docs/checklists/ci-pipeline.md` — appended one new section
  **"Branch Protection Setup"** *after* the existing
  `Steps`, `Pass criteria`, and `If it fails` sections. The new
  section contains five sub-sections:
  1. **Push prerequisite** — six-step pre-push checklist (clean
     working tree, preflight passes, accepted-commit confirmation,
     `git push origin main`, watching the first CI run, fixing red
     before configuring the rule).
  2. **Setup via GitHub UI** — exact navigation
     (`/settings/branches`), exact toggle names matching GitHub's
     current labels (e.g. "Do not allow bypassing the above
     settings" — the renamed-from "Include administrators" toggle),
     exact text to type into the status-check search box
     (`Type-check, build, lint`).
  3. **Setup via `gh` CLI** — copy-pasteable `gh api -X PUT ...`
     invocation with full JSON body (`required_status_checks.strict
     = true`, `enforce_admins: true`, `required_linear_history:
     true`, `allow_force_pushes: false`, `allow_deletions: false`,
     `required_approving_review_count: 0`).
  4. **Verification** — concrete steps for a fake PR with a one-line
     TypeScript error, the exact UI signal that proves the rule
     blocks merge, and the mandatory cleanup (close PR, delete
     branch).
  5. **What this rule does and does not block** — a 9-row matrix
     covering merge-while-red, stale-branch merges, force-push,
     deletion, direct push, founder self-bypass, second-contributor
     review, new workflow contexts, and `npm audit` gating.
  6. **Activation record** — a fill-in block (date, by-whom, status
     check name, setup method, verification PR URL) that the founder
     completes once and that future Codex iterations can audit.

### Not edited

- `.github/workflows/ci.yml` — frozen from Phase 3.5; Phase 3.5.1
  authorizes no changes to the workflow YAML.
- `aeris/package.json`, `aeris/package-lock.json` — no dependency
  changes.
- `aeris/scripts/preflight.ps1` — frozen.
- `aeris/docs/security/npm-audit-triage.md` — frozen.
- `aeris/docs/checklists/README.md` — no change required; the new
  setup section is purely additive inside `ci-pipeline.md` and the
  index entry already points readers there.
- `aeris/docs/checklists/production-readiness.md` — no change. The
  master gate already references `ci-pipeline.md` as Step 5; the new
  Branch Protection Setup is one-time setup (not a recurring
  pre-deploy gate), so it lives inside the linked file rather than
  being lifted into the recurring master list.
- Other checklist files — no changes.
- Source under `app/`, `components/`, `lib/`, `types/`, `supabase/` —
  not touched.

## Commands the founder will run

These are **founder actions**, not Claude actions. Captured here so
Codex iteration N+1 has them on hand.

### Push prerequisite

```powershell
# From D:\Plan
git status                                # working tree clean, on main
pwsh aeris\scripts\preflight.ps1          # local quality gates green
git log -1 --oneline                      # confirm HEAD is the accepted commit
git push origin main                      # first push of Phase 1-3.5 work
# Then open: https://github.com/alharbib902-del/plan/actions
# and wait for the CI run to finish.
```

### Branch Protection (UI route)

```
Open: https://github.com/alharbib902-del/plan/settings/branches
→ Branch protection rules → Add rule
→ Branch name pattern: main
→ (toggle as documented in ci-pipeline.md → Branch Protection Setup → Setup via GitHub UI)
→ Create
```

### Branch Protection (`gh` CLI route, equivalent)

```bash
# After: gh auth login (with admin:repo scope)
gh api -X PUT \
  "repos/alharbib902-del/plan/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Type-check, build, lint"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

### Verification PR

```
Branch: verify/protection-rule
Change: a one-line TypeScript error (see ci-pipeline.md → Verification)
Expected on the PR page:
  - "Type-check, build, lint" check is ✗ red
  - Merge button disabled with "Required statuses must pass before merging"
Cleanup: close PR, delete branch locally and remotely
```

## GitHub URLs the founder will visit

- **Workflow runs:** `https://github.com/alharbib902-del/plan/actions`
- **CI workflow page:** `https://github.com/alharbib902-del/plan/actions/workflows/ci.yml`
- **Branch protection settings:** `https://github.com/alharbib902-del/plan/settings/branches`
- **New rule form:** `https://github.com/alharbib902-del/plan/settings/branch_protection_rules/new`

## Open Question Decisions (from `docs/CLAUDE-TASK.md`)

1. **Linear history?** — **Yes.** `required_linear_history: true`
   baked into both UI procedure (Step 6) and `gh` CLI body. Solo
   founder workflow benefits from a clean rebased history.
2. **Include administrators (now "Do not allow bypassing")?** —
   **Yes.** `enforce_admins: true` baked in. The founder is the
   admin; carving the founder out defeats the rule.
3. **Required PR reviews?** — **No, set to 0.** Solo founder. A
   `TODO` is captured in the matrix (`What this rule does and does
   not block`) noting that a second contributor changes this answer.
4. **Signed commits?** — **Deferred.** Not part of Phase 3.5.1.
5. **UI screenshots?** — **No.** Text-only. GitHub's settings page
   is redesigned periodically; field names in text are the most
   stable form.

## Acceptance Criteria — Self-Audit

Cross-checked against `docs/CLAUDE-TASK.md` "Acceptance Criteria":

1. **Branch Protection Setup section exists** in `ci-pipeline.md`
   with all four required sub-sections. ✓
   - Prerequisites: present (Push prerequisite, 6 items).
   - GitHub UI procedure: present (10 toggles, exact field names).
   - `gh` CLI procedure: present (full JSON body, copy-pasteable).
   - Verification: present (deliberate TS error → expected UI
     signal → cleanup).

2. **Both procedures concrete:** ✓
   - UI procedure names every screen, every toggle (matches current
     GitHub labels including the renamed "Do not allow bypassing"
     toggle), and the exact status-check string.
   - `gh` CLI procedure is copy-pasteable with explicit caveats
     about owner/repo substitution and required token scope.

3. **Verification step concrete:** ✓
   - Exact change to introduce: `const _verify: number = "..."`.
   - Exact UI signal: red ✗ next to `Type-check, build, lint` and
     a disabled merge button with the exact message text.
   - Cleanup: close PR, delete branch locally + remotely.

4. **Pre-push checklist** at top of section. ✓ (6 items.)

5. **Founder-action lines in this work log:** ✓
   - "What Claude did NOT do" section names the three deferred
     founder actions explicitly.
   - "Commands the founder will run" captures the exact CLI.
   - "GitHub URLs" lists every page.
   - The Activation record block in `ci-pipeline.md` is the fill-in
     line for the founder to complete on activation.

6. **Scope discipline:** ✓
   - No dependency changes.
   - No app code changes.
   - No workflow YAML changes.
   - No new files anywhere.
   - No Phase 3.6 or Phase 4 work started.

## Commands Run And Results

Phase 3.5.1 only edits documentation. The Phase 3.5 quality gates
were already green at the moment Phase 3.5 was accepted (100/100,
2026-05-04, Codex iteration 2). Documentation-only edits do not
invalidate those results, so the gates were not re-run a third time.

If Codex prefers a fresh confirmation run on the final repo state:

```bash
cd aeris
npm run type-check   # expected: exit 0
npm run build        # expected: exit 0, admin routes ƒ Dynamic
npm run lint:strict  # expected: exit 0, "✔ No ESLint warnings or errors"
```

`npm ci` and `npm audit --json` do not need to be re-run because the
lockfile is byte-identical to Phase 3.5.

## Known Issues

- **Activation gap.** Until the founder completes the founder-action
  steps (push, configure rule, verify), CI is technically running
  the gates but is *not* gating merges. Phase 3.5.1 documents the
  procedure; activation is the founder's next step. The Activation
  record block in `ci-pipeline.md` is intentionally blank to make
  this gap visible.

- **Status check name fragility.** The required-status-check name
  `Type-check, build, lint` comes from the `name:` field on the
  `quality-gates` job in `.github/workflows/ci.yml`. If that `name:`
  is ever changed, the Branch Protection rule will silently stop
  matching (CI runs, but the rule allows merge because no required
  context resolves). Mitigation: the workflow YAML has been frozen
  since Phase 3.5; any future change to it should automatically
  trigger a re-read of `ci-pipeline.md` Step 1 (which already
  enforces this discipline as part of the recurring checklist).

- **`gh` CLI auth scope.** The `gh api -X PUT
  /repos/.../branches/main/protection` call requires the founder's
  `gh` token to have `admin:repo` scope. Captured in the procedure;
  not a Claude action.

- **No Dependabot, no signed commits.** Both deferred — not in
  Phase 3.5.1 scope. Mention here only so Codex sees they were
  deliberately not added.

## Questions For Codex

None of these are blockers for Phase 3.5.1 acceptance:

1. **Should an "after activation" recurring check be added to
   `production-readiness.md`?** Today, that file references
   `ci-pipeline.md` (Step 5) and the Branch Protection setup is
   one-time. Once activated, the only ongoing check is "rule still
   exists, still binds to the right context name." Recommendation:
   a single line in `production-readiness.md` Step 5 — "rule binds
   to `Type-check, build, lint` and `enforce_admins: true`" — would
   close that audit loop. Want me to add it in a follow-up tiny
   task, or fold into the next phase?

2. **`@sentry/nextjs` decision (Phase 3.6).** Still open from
   Phase 3.5 questions. The Phase 3.5.1 work doesn't change the
   answer; flagging it again so it doesn't get lost.

3. **Phase 4 readiness.** With Phase 3.5.1 ready for review, the
   operational scaffolding around the accepted Phase 1-3
   deliverables is feature-complete: CI, audit triage, preflight,
   branch protection procedure, all six checklists. The next
   natural step is Phase 4 (minimal operator portal). Confirm or
   pivot.

Stopped after Phase 3.5.1. Did not start Phase 3.6 or Phase 4.
