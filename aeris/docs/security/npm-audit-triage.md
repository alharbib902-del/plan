# npm Audit Triage

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

### 2. `@sentry/nextjs` — direct, **high**

| Field | Value |
|---|---|
| Severity | high |
| Direct? | Yes (`dependencies.@sentry/nextjs: "^7.114.0"`) |
| Path | `aeris > @sentry/nextjs > {next, rollup}` |
| Advisories | inherited from `next` (above) and `rollup` (below) |
| Fix available | `@sentry/nextjs@10.51.0` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | Sentry 7 → 10 is a major upgrade with breaking config changes. The package is currently installed but **not wired into any active code path** (no Sentry init in `app/`, no DSN configured, no `sentry.client.config.ts`). Today the runtime exposure is effectively zero; the entry only inflates the audit count. Two cleaner moves are available, both deferred: (i) wire Sentry properly in Phase 4 alongside the operator portal observability story and upgrade to v10 then; (ii) remove the dependency entirely if a different observability vendor is chosen. |
| Follow-up trigger | (a) Sentry observability is wired into a real Aeris code path — trigger the v10 upgrade in the same PR. (b) A different observability vendor is selected — drop the dep instead. (c) Sentry releases a v7.x backport patch for the listed advisories — apply it immediately. |

### 3. `@supabase/ssr` — direct, **low**

| Field | Value |
|---|---|
| Severity | low |
| Direct? | Yes (`dependencies.@supabase/ssr: "^0.3.0"`) |
| Path | `aeris > @supabase/ssr > cookie` |
| Advisories | inherited from `cookie` (below) |
| Fix available | `@supabase/ssr@0.10.2` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | The bundled `cookie` advisory (GHSA-pxg6-pf52-xh8x) is rated low (CVSS 0) and triggers only when out-of-bounds characters are passed as a cookie *name*, *path*, or *domain*. Aeris does not pass any user-controlled value into those fields — the only cookie set with non-default name is `aeris_admin`, whose value is a server-side-signed token; its name, path, and domain are all hard-coded. A 0.3 → 0.10 jump for `@supabase/ssr` is a major upgrade with API surface changes; deferring it costs nothing here. |
| Follow-up trigger | (a) `@supabase/ssr` ships a 0.3.x patch with the cookie fix backported — apply minor. (b) A future feature introduces user-controlled cookie names/paths/domains — upgrade immediately. (c) `@supabase/ssr` 0.10.x is required for an unrelated Phase 4 feature — bundle the upgrade with that work. |

### 4. `cookie` — transitive, **low**

| Field | Value |
|---|---|
| Severity | low |
| Direct? | No (transitive via `@supabase/ssr`) |
| Path | `aeris > @supabase/ssr > cookie` |
| Advisories | GHSA-pxg6-pf52-xh8x (out-of-bounds chars in name/path/domain) |
| Fix available | `@supabase/ssr@0.10.2` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | Same as advisory #3 — the only fix path is a major bump of `@supabase/ssr`. The runtime exposure is zero given the Aeris cookie surface. |
| Follow-up trigger | Same as advisory #3. |

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

### 9. `rollup` — transitive, **high**

| Field | Value |
|---|---|
| Severity | high |
| Direct? | No (transitive via `@sentry/nextjs`) |
| Path | `aeris > @sentry/nextjs > rollup` |
| Advisories | GHSA-mw96-cpmx-2vgc (arbitrary file write via path traversal) |
| Fix available | `@sentry/nextjs@10.51.0` (`isSemVerMajor: true`) |
| **Decision** | **wait for vendor** |
| Rationale | The advisory affects `rollup` during a **build**, not at runtime. Aeris does not invoke rollup directly; the dependency exists only because `@sentry/nextjs` 7.x ships it for its bundling step. CI runs in a sandboxed GitHub Actions runner; Vercel build runs in Vercel's own sandbox. Both runners are short-lived and isolated; an arbitrary file write inside a CI job does not reach prod. The fix path is the same major Sentry upgrade as advisory #2 and is coupled to it. |
| Follow-up trigger | Same as advisory #2. |

## Summary table

| # | Package | Severity | Direct? | Decision | Follow-up trigger |
|---|---|---|:-:|---|---|
| 1 | `next` | high | yes | wait for vendor | 14.x backport, or Phase 4 coordinated 14→15 LTS upgrade |
| 2 | `@sentry/nextjs` | high | yes | wait for vendor | wire Sentry in Phase 4 (and upgrade), or drop dep |
| 3 | `@supabase/ssr` | low | yes | wait for vendor | 0.3.x backport, or unrelated Phase 4 feature requires 0.10.x |
| 4 | `cookie` | low | no | wait for vendor | closes with #3 |
| 5 | `eslint-config-next` | high | yes | wait for vendor | 14.x backport, or closes with #1 |
| 6 | `@next/eslint-plugin-next` | high | no | wait for vendor | closes with #5 |
| 7 | `glob` | high | no | wait for vendor | closes with #5 (or earlier if any script ever calls `glob` CLI with `-c`) |
| 8 | `postcss` | moderate | no | wait for vendor | closes with #1 (or earlier if user input ever reaches PostCSS) |
| 9 | `rollup` | high | no | wait for vendor | closes with #2 |

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
