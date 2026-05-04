# CI Pipeline (GitHub Actions)

## Purpose

Verify that the GitHub Actions quality-gate workflow at
`.github/workflows/ci.yml` is configured correctly and is green for
every change merged to `main`. Failing CI must block a merge.

> **Path note.** All paths in this checklist are **relative to the
> Git repository root** (`D:/Plan`, the directory containing the
> `.git/` folder), not relative to the `aeris/` subdirectory. The
> workflow file lives at `<repo-root>/.github/workflows/ci.yml`.
> GitHub Actions only discovers workflow files under the repo root's
> `.github/workflows/`, so a file at `aeris/.github/workflows/ci.yml`
> would be silently ignored.

## When to run

- Before every production deploy (CI must be green on the commit being
  promoted — referenced from
  [`production-readiness.md`](production-readiness.md)).
- After any change to `.github/workflows/ci.yml`,
  `aeris/package.json`, `aeris/package-lock.json`,
  `aeris/.eslintrc.json`, `aeris/tsconfig.json`, or
  `aeris/next.config.js`.
- After bumping the Node.js version in the workflow.
- On demand via the GitHub Actions tab → **CI** → **Run workflow**
  (`workflow_dispatch`).

## Steps

1. [ ] **Workflow location + trigger check.** Confirm the workflow
       file is at `<repo-root>/.github/workflows/ci.yml` (not under
       `aeris/.github/...`). Quick check from the repo root:
       ```powershell
       git rev-parse --show-toplevel    # → D:/Plan
       Test-Path .github/workflows/ci.yml      # → True
       Test-Path aeris/.github                  # → False
       ```
       Then open `.github/workflows/ci.yml` and confirm the `on:`
       block lists all three triggers exactly:
       ```yaml
       on:
         pull_request:
         push:
           branches: [main]
         workflow_dispatch:
       ```
       Any other trigger (cron, release, etc.) is out of scope for
       Phase 3.5; flag it.

2. [ ] **Working directory check.** Confirm the workflow has:
       ```yaml
       defaults:
         run:
           working-directory: aeris
       ```
       Every `run:` step must execute from `aeris/`. If a step needs
       to leave that directory it must say so explicitly.

3. [ ] **Node version check.** Confirm `actions/setup-node@v4` is
       called with `node-version: 20`. Any other major version is a
       discrepancy that must be reconciled with the developer's local
       version (`node --version` should report `v20.x.y`).

4. [ ] **npm cache check.** Confirm the `setup-node` step includes:
       ```yaml
       cache: npm
       cache-dependency-path: aeris/package-lock.json
       ```
       Cache misses are fine; a missing or wrong path silently
       defeats caching and slows every run.

5. [ ] **`npm ci` check.** Confirm the install step uses `npm ci`
       (not `npm install`). `npm ci` fails if `package.json` and
       `package-lock.json` disagree — that is the desired CI behavior.

6. [ ] **Type-check check.** Confirm a `npm run type-check` step
       exists after install. Expected exit code in a passing run: `0`.

7. [ ] **Build check.** Confirm a `npm run build` step exists. The
       step must succeed without any real secret. The workflow may
       set safe public placeholders (e.g. `NEXT_PUBLIC_SITE_URL`,
       `NEXT_PUBLIC_WHATSAPP_NUMBER`) under `env:` at the job level.

8. [ ] **`lint:strict` check.** Confirm the final gate is
       `npm run lint:strict` (i.e. `next lint --max-warnings 0`).
       A warning is a failure in CI.

9. [ ] **No-secrets check.** Open the workflow file and the
       repository's GitHub Actions secret store
       (Repository → Settings → Secrets and variables → Actions).
       The workflow must not reference any secret via
       `${{ secrets.* }}` or pull from a GitHub Environment that
       exposes one. The Phase 3.5 acceptance criteria forbid:
       - `SUPABASE_SERVICE_ROLE_KEY`
       - `ADMIN_INBOX_PASSWORD`
       - `ADMIN_AUTH_SECRET`
       - `RESEND_API_KEY`
       - any third-party token (Sentry, PostHog, Mapbox auth, etc.)
       in the CI workflow. Their absence is the pass signal.

10. [ ] **No-deploy check.** Confirm the workflow does not call
        `vercel`, `gh-pages`, `aws-cli`, `firebase deploy`, or any
        equivalent. CI is for verification only in Phase 3.5;
        deployment automation is a separate, later phase.

11. [ ] **Run history.** Open the **Actions** tab on GitHub. Verify:
        - The **CI** workflow has at least one green run on the
          current `main` HEAD.
        - The most recent open PR's run is green (or, if it's red, a
          fix is in progress and merging is blocked).

12. [ ] **Manual dispatch smoke test (optional but recommended).**
        Actions → CI → **Run workflow** on `main` → confirm a fresh
        run completes green within ~3-6 minutes.

## Pass criteria

- Every box above is checked.
- The workflow file matches the structure in steps 1-10 verbatim
  (only `env:` placeholder values may differ).
- CI is currently green on `main`.
- No real secret is configured for, or referenced by, the CI
  workflow.
- A failing CI run blocks the affected PR (branch protection rule
  enforces "require status checks to pass" with the **CI** check
  selected — set in Repository → Settings → Branches if not already).

## If it fails

- **Step 1-10 fails (configuration drift):** open
  `.github/workflows/ci.yml` and reconcile against this checklist.
  Commit the fix on a feature branch, open a PR, wait for CI to
  re-run from the corrected file, and merge only after green.

- **Step 9 fails (a real secret is referenced):** treat as a
  potential leak. Rotate the secret immediately, remove the
  reference from the workflow, and check the run logs (Actions →
  CI → the affected run → log) for any line that may have echoed
  the value. Open an incident note in deploy notes.

- **Step 11 is red on `main`:** stop new merges to `main`. Open the
  failing run, identify which gate failed (`type-check`, `build`,
  `lint:strict`), reproduce locally with `pwsh
  aeris/scripts/preflight.ps1`, fix, and push a corrective commit.
  Production deploys are blocked until `main` is green again.

- **Step 11 is red on the open PR only:** the PR author fixes
  locally (preflight script reproduces CI exactly), pushes, and
  re-requests review. Do not merge a red PR by overriding branch
  protection.

- **Step 12 dispatch fails but recent PR runs are green:** likely a
  flaky transient (network, npm registry, GitHub-side). Re-run the
  job once; if it fails twice in a row, treat it as a real failure
  and follow the steps above.

## Branch Protection Setup

> **Run this once.** The Branch Protection rule on `main` is what
> turns CI from advisory ("the badge is red, please don't merge")
> into mechanical ("GitHub will not let you merge"). Until the rule
> is enabled, every Phase 1-3 acceptance is guarded by discipline
> only, not by mechanism.

### Push prerequisite (before the rule can be configured)

The rule binds to a status-check **name**, and that name only
appears in GitHub's settings dropdown after the workflow has run
at least once. So the order matters:

1. [ ] Working tree is clean and on `main`
       (`git status` → "nothing to commit, working tree clean").
2. [ ] `pwsh aeris/scripts/preflight.ps1` passes locally.
3. [ ] The current `HEAD` matches the commit Codex accepted — no
       last-minute amendments.
4. [ ] Push: `git push origin main`. (First push after the Aeris
       project landed; subsequent feature work goes through PRs.)
5. [ ] Open `https://github.com/<owner>/<repo>/actions` and watch
       the **CI** workflow run. Wait for it to complete (green or
       red — green is required to *merge*, but the rule itself can
       be configured against either outcome).
6. [ ] If the run is red, fix locally, push, repeat. Do not
       configure branch protection against a red workflow — the
       status-check name still resolves, but you'd be locking in a
       broken main.

### Setup via GitHub UI

Once the first CI run has completed (Push prerequisite step 5):

1. [ ] Open `https://github.com/<owner>/<repo>/settings/branches`.
2. [ ] Under **Branch protection rules**, click **Add rule**.
3. [ ] **Branch name pattern:** `main`.
4. [ ] Enable **Require a pull request before merging**.
       - Sub-option **Require approvals**: leave at `0` (solo
         founder — revisit when a second contributor joins; until
         then, a self-merge after green CI is acceptable).
       - Sub-option **Dismiss stale pull request approvals when
         new commits are pushed**: leave default.
5. [ ] Enable **Require status checks to pass before merging**.
       - Sub-option **Require branches to be up to date before
         merging**: enable. (Forces the PR branch to be rebased
         onto the latest `main` before CI is the rule's authority,
         which prevents a stale-branch merge that quietly bypasses
         a fix on `main`.)
       - In the **status checks** search box, type
         `Type-check, build, lint` and select the entry that
         appears (this is the job name from
         `.github/workflows/ci.yml`). If nothing appears in the
         dropdown, the first CI run has not completed yet — go
         back to the Push prerequisite.
6. [ ] Enable **Require linear history**.
7. [ ] Enable **Do not allow bypassing the above settings**
       (this is the new GitHub label for what used to be called
       "Include administrators"). The founder is the admin; the
       whole point of the rule is to prevent the founder from
       accidentally landing a broken commit, so the founder must
       not be carved out.
8. [ ] **Allow force pushes**: leave **disabled**.
9. [ ] **Allow deletions**: leave **disabled**.
10. [ ] Click **Create** (or **Save changes** if editing).

### Setup via `gh` CLI (equivalent)

If the founder prefers the CLI to the UI, the equivalent rule is:

```bash
# From any directory; gh resolves the current repo from cwd or
# from an explicit -R owner/repo flag.
gh api -X PUT \
  "repos/{owner}/{repo}/branches/main/protection" \
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

Notes:

- Replace `{owner}/{repo}` if `gh` does not auto-resolve.
- `contexts` must contain the **exact** name of the job as it
  appears in the GitHub Actions UI. If the workflow's job `name:`
  is changed, this string must change too.
- `gh` requires authentication (`gh auth login`); the token must
  have the `admin:repo` scope to write branch protection rules.

### Verification

This step proves the rule actually blocks bad merges. Run it once,
right after creating the rule.

1. [ ] Create a branch: `git checkout -b verify/protection-rule`.
2. [ ] Introduce a deliberate failure that one of the gates will
       catch. Easiest: a one-line TypeScript error in any `.tsx`
       file, e.g. add this at the top of any unused component
       file:
       ```ts
       const _verify: number = "this should be a number, not a string";
       ```
       (`type-check` will fail; the build will likely also fail.)
3. [ ] Commit and push:
       ```
       git add .
       git commit -m "verify: intentionally break type-check"
       git push -u origin verify/protection-rule
       ```
4. [ ] Open a PR from `verify/protection-rule` → `main` on GitHub.
5. [ ] Wait for the **CI** workflow to fail. The PR page must show:
       - A red ✗ next to "Type-check, build, lint".
       - The merge button **disabled** with text along the lines
         of "Required statuses must pass before merging" or
         "Merging is blocked".
6. [ ] **Cleanup (mandatory — do not leave the broken branch
       around):**
       - Close the PR without merging.
       - `git checkout main`.
       - `git branch -D verify/protection-rule`.
       - `git push origin --delete verify/protection-rule`.

### What this rule does and does not block

| Action | Blocked by this rule? |
|---|:-:|
| Merging a PR while CI is red | Yes |
| Merging a PR whose branch is stale relative to `main` | Yes (because `strict: true`) |
| Force-pushing to `main` | Yes (`allow_force_pushes: false`) |
| Deleting `main` | Yes (`allow_deletions: false`) |
| Pushing directly to `main` (bypassing PR) | Yes (because of "Require a PR before merging") |
| The founder bypassing their own rule | Yes (`enforce_admins: true`) |
| A second human contributor merging without review | **No** — `required_approving_review_count: 0`. Revisit when the team grows. |
| A new workflow file introducing its own broken job | **No** — only the `Type-check, build, lint` context is required; new check contexts must be added to the rule's `contexts` list explicitly. |
| Merging despite a failing `npm audit` | **No** — `npm audit` is not currently a CI gate. See `docs/security/npm-audit-triage.md`. |

### Activation record

> **Founder fills this in once the rule is live.** A future Codex or
> auditor reads this to confirm when CI became load-bearing.

```
Activated on:        2026-05-04
Activated by:        alharbib902-del  (founder, via gh CLI)
Status check name:   Type-check, build, lint
Setup method:        [ ] GitHub UI    [x] gh CLI
Verification PR URL: https://github.com/alharbib902-del/plan/pull/1  (closed without merging)
```

#### Empirical evidence captured at activation

- **Verification PR**: [#1](https://github.com/alharbib902-del/plan/pull/1)
  — `verify: Phase 3.5.1 protection-rule check (DO NOT MERGE)`,
  closed without merging.
- **Failing CI run**:
  https://github.com/alharbib902-del/plan/actions/runs/25302544403
  — job `Type-check, build, lint` exited with `conclusion: FAILURE`
  on the `Type-check` step (`Type 'string' is not assignable to
  type 'number'.`, exit code 2). Build and Lint steps were skipped.
- **GitHub `gh pr view --json mergeStateStatus`** at the moment CI
  reported failure: `"BLOCKED"`. The PR's `mergeable` field showed
  `"MERGEABLE"` (the merge could mechanically apply), but
  `mergeStateStatus = BLOCKED` is GitHub's signal that the required
  status check is gating the merge button. This is the empirical
  proof that branch protection blocks merge on red CI.
- **Cleanup confirmed**: branch `verify/protection-rule` deleted
  from both `origin` and the local repo (`git branch -a` shows only
  `main` and `remotes/origin/main`). The throwaway file
  `aeris/lib/_verify-protection-rule.ts` no longer exists in the
  working tree.
