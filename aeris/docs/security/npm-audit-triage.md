# npm Audit Triage

> **Update 2026-05-21 — closure round 2 (PR after #92):** Advisories
> **#2 (`@sentry/nextjs`)**, **#3 (`@supabase/ssr`)**, **#4 (`cookie`)**,
> and **#9 (`rollup`)** are now **CLOSED via dependency removal** rather
> than upgrade:
>
> - `@sentry/nextjs` was declared but never wired into any active code
>   path; removed from `dependencies`.
> - `@supabase/ssr` was used only by `lib/supabase/{server,client}.ts`,
>   both files dead code (never imported anywhere). Both files deleted
>   alongside the dep.
>
> Phase 3.5's `npm audit fix` (PR #84) had already closed advisories
> covered by non-breaking transitive bumps (e.g. `protobufjs`,
> `cookie` via `ws`). Remaining open: **#1 (`next`)**, **#5/6/7
> (`eslint-config-next` + `@next/eslint-plugin-next` + `glob`)**, and
> **#8 (`postcss`)** — all coupled to the Next 14 → 16 major upgrade.
>
> The summary table at the bottom reflects the new state.

## Purpose

Document every advisory currently surfaced by `npm audit` against the
Aeris dependency tree, with a per-advisory decision (`upgrade now`,
`accept temporarily`, or `wait for vendor`) and a follow-up trigger.

This file is the canonical record for Phase 3.5 dependency risk. It is
re-run and re-signed at every major dependency change and at every
quarterly security pass.

## Triage metadata

- **Date of triage:** 2026-05-04
- **Command used:** `npm audit --json` (run from `aeris/`)
- **Lockfile:** `aeris/package-lock.json` (unchanged in Phase 3.5)
- **Node.js version used:** 20
- **Total dependencies:** 799 (prod 518 / dev 250 / optional 55)
- **Total advisories:** 9
- **Severity breakdown:**
  - critical: 0
  - high: 6
  - moderate: 1
  - low: 2
  - info: 0
- **Phase 3.5 outcome:** all 9 advisories triaged; **0 upgrades
  applied** (every available fix is `isSemVerMajor: true` and a major
  upgrade was explicitly out of scope for Phase 3.5). All 9 carry a
  documented rationale and follow-up trigger.

## Aeris exposure context

These factors shape the risk decisions below; revisit them whenever
the answer changes.

- **Hosting:** Vercel (managed Next.js runtime). Vercel's edge
  mitigates several Next.js advisories that primarily affect
  self-hosted deployments.
- **`next.config.js`:** `images.remotePatterns` is set (Supabase +
  Unsplash). No `rewrites` are defined. Server Actions are enabled
  with a 10 MB body limit.
- **User-supplied CSS / templating:** none. There is no surface that
  takes untrusted CSS or HTML through PostCSS at runtime.
- **`glob` CLI exposure:** zero. The repo does not invoke the `glob`
  CLI with `-c/--cmd` from any script, hook, or workflow.
- **Sentry usage at this point:** the package is a dependency but not
  wired into any active code path (no Sentry init in `app/`). Removal
  is feasible if needed, but is itself a code change deferred to a
  later phase.
- **Public-facing payloads:** the only public Server Action is the
  flight-request form, validated by Zod with strict shapes and a
  honeypot field. The admin inbox is gated by a signed cookie on the
  layout and on every mutation action.

## Per-advisory decisions

Each row below corresponds to one entry in the `npm audit --json`
`vulnerabilities` map. Severity, range, and `fixAvailable` come from
the audit output verbatim. The decision and rationale are the Phase 3.5
risk call; the follow-up trigger is what should cause this row to be
re-opened.

### 1. `next` — direct, **high**

| Field | Value |
|---|---|
| Severity | high (5 advisories combined; highest CVSS 7.5) |
| Direct? | Yes (`dependencies.next: "^14.2.0"`) |
| Path | `aeris > next` |
| Advisories | GHSA-9g9p-9gw9-jx7f (Image Optimizer DoS), GHSA-h25m-26qc-wcjf (RSC deserialization DoS), GHSA-ggv3-7p47-pfv8 (rewrite smuggling), GHSA-3x4c-7xq6-9pq8 (image cache growth), GHSA-q4gf-8mx6-v5v3 (Server Components DoS) |
| Fix available | `next@16.2.4` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | Every offered fix is a major upgrade (Next.js 14 → 16). A coordinated migration spans config (`experimental.serverActions` shape changes), the App Router runtime, and Vercel build settings — well outside Phase 3.5. The Image Optimizer DoS (GHSA-9g9p) primarily affects self-hosted deployments; Vercel's managed runtime caps and per-domain `remotePatterns` reduce real exposure. The smuggling-in-rewrites advisory (GHSA-ggv3) does not apply because `next.config.js` defines no `rewrites`. RSC DoS advisories require an attacker to drive specific request shapes against Server Components; the current public surface is one Zod-validated Server Action. |
| Follow-up trigger | (a) Next.js 14.x backport patch lands for any of the listed advisories — apply minor immediately. (b) Phase 4+ schedules a coordinated upgrade to Next.js 15 LTS; this row is closed by that upgrade. (c) New Server Components are added to a public route — re-evaluate. |

### 2. `@sentry/nextjs` — **CLOSED 2026-05-21 (removed)**

| Field | Value |
|---|---|
| Severity | (formerly high) |
| Direct? | No longer in `dependencies` — removed by PR #93 |
| Path | (no longer in tree) |
| Advisories | (closed by removal) |
| Fix available | n/a |
| **Decision** | **CLOSED — dependency removed** |
| Rationale | Phase 3.5 marked Sentry as installed-but-unused. PR #93 confirmed via grep that there was no `Sentry.init(...)` call, no `sentry.*.config.{ts,js}` file, no DSN env var, and no SDK import outside `package.json` itself. Removing the dep dropped the entire `@sentry/nextjs > rollup` and `@sentry/nextjs > next` vulnerable transitive subtrees in one step. |
| Re-evaluation trigger | A different observability vendor is selected → add it with a current major version. If Sentry is reinstated, install at v10+ directly (do NOT re-add v7). |

### 3. `@supabase/ssr` — **CLOSED 2026-05-21 (removed)**

| Field | Value |
|---|---|
| Severity | (formerly low) |
| Direct? | No longer in `dependencies` — removed by PR #93 |
| Path | (no longer in tree) |
| Advisories | (closed by removal) |
| Fix available | n/a |
| **Decision** | **CLOSED — dependency removed** |
| Rationale | `@supabase/ssr` was used only by `lib/supabase/{server,client}.ts`, both files dead code (never imported anywhere; superseded by Phase 9 cookie-based auth). PR #93 deleted both files alongside the dep. |
| Re-evaluation trigger | A future feature reintroduces Supabase Auth JWT cookies (so far Aeris uses custom cookie+bcrypt sessions and bypasses `@supabase/ssr` entirely). When re-adding, install at v0.10+ directly. |

### 4. `cookie` — **CLOSED 2026-05-21 (closes with #3)**

| Field | Value |
|---|---|
| Severity | (formerly low) |
| Direct? | No (was transitive via `@supabase/ssr`) |
| Path | (no longer in tree — `@supabase/ssr` removed by PR #93) |
| Advisories | GHSA-pxg6-pf52-xh8x (out-of-bounds chars in name/path/domain) |
| Fix available | n/a |
| **Decision** | **CLOSED — transitive parent removed** |
| Rationale | Closed automatically when `@supabase/ssr` was removed. The original Phase 3.5 risk analysis stands as historical context: the only cookie set with a non-default name was `aeris_admin`, whose name, path, and domain were all hard-coded, so the runtime exposure was always zero. |
| Re-evaluation trigger | Same as advisory #3 — if `@supabase/ssr` is reintroduced, a `cookie` version with the GHSA-pxg6 fix needs to come with it. |

### 5. `eslint-config-next` — direct, **high**

| Field | Value |
|---|---|
| Severity | high |
| Direct? | Yes (`devDependencies.eslint-config-next: "^14.2.0"`) |
| Path | `aeris > eslint-config-next > @next/eslint-plugin-next > glob` |
| Advisories | inherited from `glob` (below) |
| Fix available | `eslint-config-next@16.2.4` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | The vulnerable `glob` is bundled inside `@next/eslint-plugin-next` for ESLint plugin internals; it is **not** invoked from Aeris code, scripts, or CI workflows. The advisory (GHSA-5j98-mcp5-4vw2) requires an attacker to call `glob`'s CLI with `-c/--cmd` against an attacker-influenced glob pattern — a path Aeris does not reach. eslint-config-next 14 → 16 is a major upgrade tied to Next.js 14 → 16, so this row will close naturally when advisory #1 is resolved. |
| Follow-up trigger | (a) eslint-config-next 14.x ships a backport — apply. (b) The Next.js coordinated upgrade in #1 lands — close this row in the same PR. |

### 6. `@next/eslint-plugin-next` — transitive, **high**

| Field | Value |
|---|---|
| Severity | high |
| Direct? | No (transitive via `eslint-config-next`) |
| Path | `aeris > eslint-config-next > @next/eslint-plugin-next > glob` |
| Advisories | inherited from `glob` (below) |
| Fix available | `eslint-config-next@16.2.4` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | Same as advisory #5. Closes alongside the eslint-config-next major upgrade. |
| Follow-up trigger | Same as advisory #5. |

### 7. `glob` — transitive, **high**

| Field | Value |
|---|---|
| Severity | high (CVSS 7.5) |
| Direct? | No (transitive via `@next/eslint-plugin-next`) |
| Path | `aeris > eslint-config-next > @next/eslint-plugin-next > glob` |
| Advisories | GHSA-5j98-mcp5-4vw2 (CLI command injection via `-c/--cmd`) |
| Fix available | `eslint-config-next@16.2.4` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | The advisory is reachable **only** through `glob`'s CLI with `-c/--cmd`. Aeris does not invoke the `glob` CLI from any `package.json` script, GitHub Actions workflow, preflight script, Husky hook (none configured), or runtime code path. Static analysis confirmed: `package.json` scripts call only `next` and `tsc`; the new `.github/workflows/ci.yml` calls only `npm ci`, `npm run type-check`, `npm run build`, `npm run lint:strict`. The runtime-exposure CVSS for Aeris specifically is effectively 0 even though the advisory's nominal score is 7.5. |
| Follow-up trigger | Same as advisory #5. Also: if any new script or workflow ever calls `glob` with `-c`/`--cmd`, raise this back to "upgrade now" immediately. |

### 8. `postcss` — transitive, **moderate**

| Field | Value |
|---|---|
| Severity | moderate (CVSS 6.1) |
| Direct? | No (transitive via `next`) |
| Path | `aeris > next > postcss` |
| Advisories | GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` in CSS stringify output) |
| Fix available | `next@16.2.4` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | The advisory requires PostCSS to stringify *attacker-controlled CSS* into HTML — there is no such surface in Aeris. All Tailwind/PostCSS input is authored at build time from files in the repo; nothing user-supplied flows through PostCSS at runtime. The advisory therefore has no exploit path against Aeris today. The fix is gated behind the same Next.js 14 → 16 major upgrade as advisory #1. |
| Follow-up trigger | (a) The Next.js coordinated upgrade in #1 lands — closes this row. (b) A new feature introduces a runtime path that turns user input into PostCSS input — upgrade immediately and re-evaluate. |

### 9. `rollup` — **CLOSED 2026-05-21 (closes with #2)**

| Field | Value |
|---|---|
| Severity | (formerly high) |
| Direct? | No (was transitive via `@sentry/nextjs`) |
| Path | (no longer in tree — `@sentry/nextjs` removed by PR #93) |
| Advisories | GHSA-mw96-cpmx-2vgc (arbitrary file write via path traversal) |
| Fix available | n/a |
| **Decision** | **CLOSED — transitive parent removed** |
| Rationale | Closed automatically when `@sentry/nextjs` was removed by PR #93. The original Phase 3.5 risk analysis stands as historical context: the advisory affects `rollup` during a build, never at runtime, and both CI + Vercel build sandboxes are short-lived. |
| Re-evaluation trigger | Same as advisory #2 — if Sentry is reinstated, pin to a v10+ release that ships a rollup with the GHSA-mw96 fix. |

## Summary table

| # | Package | Severity | Direct? | Decision | Follow-up trigger |
|---|---|---|:-:|---|---|
| 1 | `next` | high | yes | wait for vendor | 14.x backport, or coordinated 14→16 LTS upgrade |
| 2 | `@sentry/nextjs` | high | yes | **CLOSED (removed 2026-05-21)** | re-evaluate if a new observability vendor is wired in |
| 3 | `@supabase/ssr` | low | yes | **CLOSED (removed 2026-05-21)** | re-add (at 0.10.x or later) if Supabase Auth JWT cookies are ever introduced |
| 4 | `cookie` | low | no | **CLOSED (via #3 removal)** | re-evaluate if @supabase/ssr is reinstated |
| 5 | `eslint-config-next` | high | yes | wait for vendor | 14.x backport, or closes with #1 |
| 6 | `@next/eslint-plugin-next` | high | no | wait for vendor | closes with #5 |
| 7 | `glob` | high | no | wait for vendor | closes with #5 (or earlier if any script ever calls `glob` CLI with `-c`) |
| 8 | `postcss` | moderate | no | wait for vendor | closes with #1 (or earlier if user input ever reaches PostCSS) |
| 9 | `rollup` | high | no | **CLOSED (via #2 removal)** | re-evaluate if Sentry is reinstated |

## Decisions not made

- **No `npm audit fix`** was run. Every offered fix is `isSemVerMajor:
  true`, and the Phase 3.5 task explicitly forbids forced major
  upgrades.
- **No `npm audit fix --force`** was run.
- **No `package.json` or `package-lock.json` change** was made in
  Phase 3.5 as part of audit triage. The lockfile is byte-identical to
  the Phase 3 baseline.

## When to re-run

- Before every quarterly security review (next: **2026-08-04**).
- Whenever any direct dependency in `package.json` is bumped.
- Whenever `npm ci` reports a new advisory count.
- Before starting Phase 4 (re-confirm the picture has not drifted).
- After any of the follow-up triggers above fires.

## How to re-run

```bash
cd aeris
npm ci
npm audit --json > /tmp/aeris-audit.json
# Compare /tmp/aeris-audit.json with the per-advisory list above.
# Update each row's "Decision" or "Follow-up trigger" as needed.
```

If the total count, severity breakdown, or any advisory's
`fixAvailable` / `isSemVerMajor` shifts, regenerate the per-advisory
sections — do not silently overwrite older rows.
