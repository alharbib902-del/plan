# Claude Task

## Current Phase

Phase 3.5.1: Branch Protection Ops

## Status

Ready for Claude implementation.

Phase 3.5 (CI + Dependency Audit) was accepted by Codex at **100/100**
on 2026-05-04 after iteration 2. Phase 3.5.1 is the operational
follow-on that activates the CI gate so it actually blocks bad merges
to `main`. Without branch protection, the CI workflow runs but green
or red is advisory only — anyone with push access could still land a
broken `main`.

This is intentionally tiny. Do not turn it into Phase 4.

## Objective

Document the exact procedure the founder runs once, after the first
push, to:

1. Confirm the **CI** workflow is discovered by GitHub.
2. Wait for at least one green CI run on `main`.
3. Enable a Branch Protection rule on `main` that requires the **CI**
   check to pass before merge.

The deliverable is documentation + verification steps. No code, no
dependencies, no app changes.

## Business Goal

Phase 3 produced operational checklists. Phase 3.5 produced a CI
workflow and an audit triage. Phase 3.5.1 makes the CI workflow
actually load-bearing — a red CI run physically prevents merge to
`main`. Until that rule is in place, every Phase 1-3 acceptance is
guarded by discipline only, not by mechanism.

## Scope

### 1. Branch Protection Setup section in `ci-pipeline.md`

Add a new **"Branch Protection Setup"** section to
`docs/checklists/ci-pipeline.md`, *after* the existing `Steps`,
`Pass criteria`, and `If it fails` sections. The new section must
cover:

- **Prerequisites** the founder must satisfy first:
  - Repo is pushed to `origin` and `main` exists on GitHub.
  - At least one CI run has completed on `main` (green or red — the
    rule needs a discoverable status check name to bind to).
- **Setup via GitHub UI** — exact navigation, exact toggles to
  enable, the exact text of the status-check name to type/select.
- **Setup via `gh` CLI** as an equivalent alternative.
- **Verification** — open a fake PR with an intentionally broken
  change (e.g., a TypeScript error), confirm GitHub blocks merge
  until CI is green. Then close/abandon that PR.
- **What the protection rule blocks** and what it does NOT block
  (merging is gated; force-push to `main` is separately disabled;
  branch deletion is separately disabled).

### 2. Pre-push checklist callout

Add a short "Push prerequisite" note near the top of the new section
that lists what must be true *before* pushing for the first time:

- Working tree is clean and on `main`.
- `pwsh aeris/scripts/preflight.ps1` passes locally.
- The current commit is the one Codex accepted (no scope creep
  amended in afterward).

### 3. Work log: founder-action recording

`docs/CLAUDE-WORK-LOG.md` must record:

- That Phase 3.5.1 itself does not perform the push or the
  GitHub-UI operation — those are explicit founder actions.
- The exact commands the founder will run.
- The exact GitHub URL the founder will visit.
- A line for the founder to fill in once branch protection is
  enabled (date, by whom, status check selected) so a future
  reviewer can audit when this was activated.

### Out of scope

- Pushing to `origin` (founder action — requires their auth, their
  judgment about the commit set).
- Configuring branch protection on the GitHub server (founder
  action — UI/API operation, not a repo file).
- Adding required reviewers (solo founder; revisit when the team
  grows).
- Adding `CODEOWNERS`, signed commits, deploy keys, environments
  with required reviewers, or Dependabot — out of scope.
- Pre-commit hooks, Husky.
- Phase 3.6 (Sentry decision) and Phase 4 (operator portal).
- Any change to `.github/workflows/ci.yml` itself — it is
  byte-locked from Phase 3.5 acceptance.
- Any change under `app/`, `components/`, `lib/`, `types/`,
  `supabase/`.
- Any dependency change.

## Files To Add / Edit

### Add

None.

### Edit

- `aeris/docs/checklists/ci-pipeline.md` — append the new
  "Branch Protection Setup" section as described in Scope §1+§2.
- `aeris/docs/CLAUDE-WORK-LOG.md` — Phase 3.5.1 entry per Scope §3.

### Not edited

- `.github/workflows/ci.yml` — frozen.
- `aeris/package.json`, `aeris/package-lock.json` — no dependency
  changes.
- `aeris/scripts/preflight.ps1` — frozen from Phase 3.5.
- `aeris/docs/security/npm-audit-triage.md` — frozen from Phase 3.5.
- Other checklist files (`README.md`, `production-readiness.md`,
  `admin-inbox-smoke-test.md`, etc.) — no changes needed; the new
  setup section is purely additive inside `ci-pipeline.md`.

## Acceptance Criteria

Phase 3.5.1 is acceptable only if:

1. **Branch Protection Setup section exists** in `ci-pipeline.md`
   with all four required sub-sections: Prerequisites, GitHub UI
   procedure, `gh` CLI procedure, and Verification.
2. **Both procedures are concrete:**
   - UI procedure names every screen, every toggle, and the exact
     text of the status check to type/select.
   - `gh` CLI procedure provides a copy-pasteable invocation that
     enables the equivalent rule.
3. **Verification step is concrete:**
   - The exact change to introduce in a fake PR (e.g., a one-line
     TypeScript error or a `console.log` that trips `lint:strict`).
   - The exact UI signal to look for ("Merge button is disabled and
     reads 'Required statuses must pass before merging.'").
   - The cleanup step (close PR, delete branch).
4. **Pre-push checklist** is included near the top of the section.
5. **Founder-action lines exist in `CLAUDE-WORK-LOG.md`** — the work
   log explicitly states what Claude did NOT do (push,
   server-side rule), what the founder must do, and leaves a fill-in
   line for the founder to record activation.
6. **Scope discipline:**
   - No dependency changes.
   - No app code changes.
   - No workflow YAML changes.
   - No new files under `app/`, `components/`, `lib/`, `types/`,
     or `supabase/`.
   - No Phase 4 work.

## Commands That Must Pass

This phase changes only documentation. The same Phase 3.5 quality
gates must continue to pass; no new ones are introduced:

```bash
cd aeris
npm run type-check
npm run build
npm run lint:strict
```

`npm ci` and `npm audit --json` do not need to be re-run for
documentation-only changes; if they are run anyway they must produce
the same result as Phase 3.5 (the lockfile is unchanged).

## Open Questions Before Implementation

1. **Should the rule require linear history?**
   Recommendation: yes (`required_linear_history: true`). Phase 3.5.1
   targets a solo founder workflow; rebases keep history clean and a
   merge commit on a feature branch adds no information that's not
   already in the PR.

2. **Should the rule include administrators?**
   Recommendation: yes (`enforce_admins: true`). The founder is the
   admin. The whole point of the rule is to prevent the founder from
   accidentally landing a broken commit; carving the founder out
   defeats it.

3. **Should the rule require pull request reviews?**
   Recommendation: no — solo founder. Document that this changes the
   moment a second human contributor joins; revisit then.

4. **Should the rule require signed commits?**
   Recommendation: defer. Setting up commit signing across the
   founder's machines is a separate, larger task; the audit/branch
   protection work doesn't depend on it.

5. **Branch protection rule template — UI screenshots?**
   Recommendation: text only. Screenshots rot fast as GitHub
   redesigns the settings page; the field names in text are stable.

## Required Claude Output

After implementation, update:

- `docs/CLAUDE-WORK-LOG.md`

The work log must include:

- Summary of what changed (documentation only).
- Files edited (just the two listed above).
- Confirmation that no code, no dependency, no workflow YAML, no
  source under `app/`/`components/`/`lib/`/`types/`/`supabase/` was
  touched.
- The exact commands the founder will run (push, gh CLI), so
  Codex iteration N+1 has them on hand.
- The exact GitHub URLs the founder will visit.
- A founder-fill line (date, recorded-by, selected status check
  name) that confirms branch protection was activated.
- Decisions taken on the Open Questions above (or a note that they
  were left unanswered for Codex).
- Any known issues.
- Questions for Codex.

Stop after Phase 3.5.1. Do not start Phase 3.6 or Phase 4.
