# Claude Task

## Current Phase

Phase 4.2: PWA Foundation

## Status

Iteration 3 of the draft. **Awaiting Codex review.** No
implementation yet.

Iteration history:

- **Iteration 1 (2026-05-04, 88/100, not accepted).** Codex
  flagged 3 P1s + 2 P2s: (1) Lighthouse PWA score gate is
  unreliable since Chrome deprecated the PWA category in late
  2024, (2) `/offline` was not in PRECACHE_URLS so the very-first
  offline visit would fail, (3) `^/admin/` regex didn't exclude
  bare `/admin`, (4) `sharp` can't emit `favicon.ico` so requiring
  it would force a new dependency or fragile encoder, (5)
  `theme-color` lives in `viewport` export not `metadata` in
  Next.js 14 — the spec's location was wrong, AND the manifest's
  gold didn't match the existing viewport's navy.
- **Iteration 2 (2026-05-04, 96/100, not accepted).** All five
  iteration-1 findings resolved at the section level, but Codex
  caught remaining residue: (1) several places outside the
  Acceptance Criteria still required Lighthouse PWA score ≥ 90
  (Objective #5, §8 audit, manual-verification block, Required
  Claude Output), recreating the unstable gate; (2) the new
  Installability section reused acceptance number 25 that the
  Offline Behavior section was already using, leaving two
  criteria with the same #25.
- **Iteration 3 (this draft).** Both iteration-2 findings
  resolved:
  1. **All Lighthouse-score references purged**: Objective #5
     now points at the Installability requirements; §8 renamed
     "PWA installability audit (manual)" with explicit "no
     Lighthouse score required"; the Manual verification block
     replaces "DevTools → Lighthouse → score ≥ 90" with the same
     curl + DevTools checks the Acceptance Criteria use; Required
     Claude Output drops the "Lighthouse PWA score in work log"
     ask. Codex iteration-2 audit-trail row (#1 below) records
     the exact lines purged.
  2. **Acceptance criteria renumbered** so each number is unique:
     Installability stays at 22–25; Offline Behavior shifted to
     26–28; Quality Gates 29–31; Branch Protection 32–35;
     Documentation 36–39; Scope Discipline 40–45. Total now 45
     (was 44; +1 from the Installability section's 4 explicit
     numbered checks vs. iteration-1's 3 Lighthouse-derived).
     Existing cross-references (`§5c → #25`, audit-trail rows
     `#16` and `#22-25`) all still resolve correctly because
     they referenced numbers in the Service Worker / Installability
     blocks, neither of which moved.

Phase 4 (Minimal Operator Portal) was accepted by Codex at 100/100
across 4 spec iterations + 2 PR-review iterations, then merged to
`main` (commit `502de21`) and deployed to Vercel at
`https://aeris-flax.vercel.app/`. Phase 4.1 (multi-city leg editor
+ English variant) is deferred. **Phase 4.2 turns the public
surface of Aeris into an installable PWA** — homescreen install on
Android + iOS, basic offline behavior for static assets, brand
presence in install banners.

## Objective

Make `aeris.sa` (and the current Vercel preview URL) **installable
as a Progressive Web App** on Android, iOS, and desktop browsers,
with a manifest + icon set + service worker that:

1. Surfaces the install prompt automatically on Android Chrome.
2. Allows iOS Safari "Add to Home Screen" with a proper icon and
   status-bar style.
3. Caches static assets (CSS, JS, fonts, images) so the public
   pages load instantly on repeat visits and degrade gracefully
   when offline.
4. **Does NOT cache** admin (`/admin/*`) or operator
   (`/operator/*`) routes — those must always hit the network for
   fresh data and auth state.
5. **Passes the concrete installability checks** documented under
   "Installability requirements" in the Acceptance Criteria —
   manifest valid + linked, service worker activated and
   controlling `/`, rendered `<head>` carries the right
   theme-color / apple-touch-icon / manifest links, and
   `beforeinstallprompt` fires on Android Chrome. (No Lighthouse
   PWA *score* gate — Chrome deprecated that category in late
   2024 and the number is no longer reliably emitted.)

## Business Goal

A Saudi private-aviation customer searching at 10:00 PM, finding
`aeris.sa`, and tapping "Add to Home Screen" places Aeris **one
tap away** for the next time they need a flight. That single
behavior is worth more than any banner ad: it converts a
one-time visitor into a recurring app.

The PWA also signals quality. Premium private-aviation brands like
NetJets and VistaJet have polished mobile apps. A web-only Aeris
with no installable surface looks unfinished next to those. PWA
closes the visual gap without the cost (and App Store / Play Store
friction) of a native app.

This phase does **not** ship native push notifications, offline
booking, or background sync. Those become Phase 5+ once the basic
install surface is real and we have data on install rate.

## Scope

### 1. Web App Manifest (`app/manifest.ts`)

Use Next.js App Router's native manifest support — a TypeScript
file that exports a `MetadataRoute.Manifest` object. No external
plugin needed.

```typescript
// aeris/app/manifest.ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aeris — الطيران الخاص الذكي',
    short_name: 'Aeris',
    description: 'منصة Aeris للطيران الخاص في المملكة العربية السعودية',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0A1628',  // navy
    theme_color: '#C9A961',       // gold
    lang: 'ar',
    dir: 'rtl',
    categories: ['travel', 'business', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

Next.js automatically serves this at `/manifest.webmanifest` and
adds the `<link rel="manifest">` tag in the `<head>`.

### 2. Icon set

Phase 4.2 ships **placeholder icons** generated programmatically
(gold "A" wordmark on navy circle). A real designed icon is a
separate work item (see Open Questions §3).

Files to add under `aeris/public/icons/`:

| File | Size | Purpose |
|---|---|---|
| `icon-192.png` | 192×192 | Standard install (Android, desktop) |
| `icon-512.png` | 512×512 | High-res install + splash |
| `icon-maskable-192.png` | 192×192 | Android adaptive (with safe area padding) |
| `icon-maskable-512.png` | 512×512 | Android adaptive high-res |
| `apple-touch-icon.png` | 180×180 | iOS home screen |
| `favicon-32.png` | 32×32 | Browser tab |
| `favicon-16.png` | 16×16 | Browser tab small |

> **No `favicon.ico`** (Codex iteration 1, P2 fix #4). `sharp`
> doesn't emit multi-resolution ICO files, and pulling in a
> dedicated `to-ico` package contradicts the "no new dependencies"
> rule. Modern Chromium / Firefox / Safari all accept PNG favicons
> via `<link rel="icon" type="image/png">`. We rely on
> `favicon-16.png` + `favicon-32.png` + `apple-touch-icon.png`,
> which together cover every browser tab and OS shortcut surface
> Aeris will encounter.

**Generation method:** Phase 4.2 includes a one-shot Node script
`aeris/scripts/generate-pwa-icons.mjs` that uses the existing
`sharp` package (already in dependencies) to create the placeholder
icons from a single source SVG. The SVG is also added to the repo
(`aeris/public/icons/icon-source.svg`) so a designer can iterate
without touching code, and re-run the script to regenerate PNGs.
The script emits PNG only — no ICO output is attempted.

**Maskable safe area:** the maskable variants pad the wordmark to
40% of the canvas (per W3C maskable icons spec) so adaptive
launchers don't crop it.

### 3. Service Worker (hand-rolled, no plugin)

A single `aeris/public/sw.js` file. Hand-rolled rather than
`next-pwa` because:
- `next-pwa`'s App Router support has known issues in late 2025.
- Our caching needs are simple (static assets only, network-first
  for everything dynamic).
- Avoiding the package keeps `package.json` clean and
  `npm audit --json` count unchanged from the Phase 3.5 baseline.
- Hand-rolled is ~80 lines we can audit in one read.

Behavior:

```javascript
// aeris/public/sw.js (sketch — final implementation in §6)

const CACHE_VERSION = 'aeris-v1';

// PRECACHE: must include '/offline' so the offline fallback is
// guaranteed-available the very first time the user goes offline,
// even if they never visited /offline directly. cache.addAll fails
// the SW install atomically if any URL fetches fail — this is the
// behavior we want (visible failure, no silently-broken offline
// fallback). (Codex iteration 1, P1 fix #2.)
const PRECACHE_URLS = ['/', '/offline'];

// EXACT-PATH-AND-PREFIX exclusion: regex like /^\/admin\// only
// matches /admin/foo and misses /admin itself, /admin?x=1, and
// /admin#hash. We must exclude both the bare path AND its
// children to fully bypass admin/operator/api from SW
// intervention. (Codex iteration 1, P1 fix #3.)
function shouldBypassCache(pathname) {
  return (
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/operator' || pathname.startsWith('/operator/') ||
    pathname === '/api' || pathname.startsWith('/api/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // cache.addAll is atomic — any 404 / network error rejects,
      // which fails the SW install and prevents activation.
      // That's the desired behavior: a SW that can't precache the
      // offline fallback should never activate.
      cache.addAll(PRECACHE_URLS)
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GETs.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Never cache admin / operator / api (exact path or any sub-path).
  if (shouldBypassCache(url.pathname)) {
    return; // Let the browser handle it normally — no SW intervention.
  }

  // Static assets: cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/images/') ||
    /\.(woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // HTML pages: network-first, cache fallback for offline.
  // The /offline page is precached above, so the final fallback
  // (caches.match('/offline')) is always available even on the
  // very first offline visit.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) =>
            cache.put(event.request, clone)
          );
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match('/offline'))
      )
  );
});
```

The version constant `CACHE_VERSION` is bumped manually on each
deploy that changes the SW (the SW itself updates by hash; the
constant is for cache invalidation).

### 4. Service Worker registration component

A tiny client component that registers the SW on mount.

```typescript
// aeris/components/pwa/sw-register.tsx
'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // Don't crash the app if SW registration fails; log and move on.
          console.error('[pwa] service worker registration failed', err);
        });
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad);
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
```

Mounted once in `app/layout.tsx`. Returns nothing visually.

### 5. Meta tags + viewport in `app/layout.tsx`

> **theme-color belongs in `viewport`, NOT `metadata`.** Next.js
> 14 moved `themeColor` from the `metadata` export to the
> `viewport` export. The existing `app/layout.tsx` already
> exports `viewport` with `themeColor: '#0A1628'` (navy). Phase
> 4.2 **changes that value to `'#C9A961'` (gold)** so it matches
> the manifest's `theme_color`. Putting `themeColor` inside
> `metadata` is silently ignored by Next.js 14 — the gold value
> would never reach the rendered `<head>`. (Codex iteration 1,
> P2 fix #5.)

#### 5a. Update `viewport` export

Edit the existing `viewport` export in `app/layout.tsx`:

```diff
 export const viewport: Viewport = {
   width: 'device-width',
   initialScale: 1,
   maximumScale: 5,
-  themeColor: '#0A1628',
+  themeColor: '#C9A961',  // gold; matches manifest.theme_color
 };
```

Visible UI effect: mobile browser address bar tint switches from
navy to gold on the public site. This is intentional — gold is
the brand accent and matches the install banner color.

#### 5b. Extend `metadata` export with PWA links

Add to the existing `metadata.icons` and `metadata.other` sections
(do NOT add a `themeColor` field at this level):

- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
- `<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">`
- `<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<meta name="apple-mobile-web-app-title" content="Aeris">`
- `<meta name="format-detection" content="telephone=no">`

Next.js automatically generates `<meta name="theme-color">` from
the `viewport.themeColor` value in 5a — do NOT also add it here.

#### 5c. Verification

After build, the rendered `<head>` of `/` must contain (verify
with `curl -s <url> | grep -i 'theme-color\|apple-touch-icon\|rel="manifest"'`):

```html
<meta name="theme-color" content="#C9A961"/>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>
<link rel="manifest" href="/manifest.webmanifest"/>
```

The `theme-color` value MUST equal the manifest's `theme_color`
exactly. Acceptance criterion #25 enforces this.

Plus mount `<ServiceWorkerRegister />` near the closing `</body>`.

### 6. Offline fallback page

A minimal `aeris/app/offline/page.tsx` that the SW falls back to
when both network and cache miss. Static, no data fetches, just
brand + a helpful Arabic message:

> "أنت غير متصل بالإنترنت. سيعود Aeris بمجرد رجوع الاتصال."

Plus a "Retry" button that calls `window.location.reload()`.

This page is precached by the SW so it's available offline.

### 7. Install prompt component (deferred decision)

Custom install prompt UI is a contested UX call:

- **Pro:** measurable install lift if surfaced thoughtfully.
- **Con:** intrusive if shown too eagerly; native browser banner is
  often enough.

**Phase 4.2 default: do NOT add a custom install banner.** Let
the browser show its own native install affordance. A custom
component `components/pwa/install-prompt.tsx` is left as a
documented Phase 4.2.1 follow-up if we want to A/B test it later.

### 8. PWA installability audit (manual)

Add a manual checklist at `aeris/docs/checklists/pwa-audit.md`
that walks the verifier through Chrome DevTools (or `curl`) on
the deployed site (or a local production build) and confirms
every concrete installability requirement from the Acceptance
Criteria. **No Lighthouse PWA category score is required —
Chrome deprecated the category in late 2024.** The checklist
runs against the same checks the Acceptance Criteria enumerate:

- **Manifest validity** — DevTools → Application → Manifest
  shows no warnings; the served `/manifest.webmanifest` parses
  as JSON and contains `name`, `short_name`, `start_url`,
  `display: 'standalone'`, plus a 192×192 AND a 512×512 PNG icon
  with `purpose: 'any'`.
- **Manifest linked in `<head>`** —
  `curl -s <url> | grep -i 'rel="manifest"'` returns a non-empty
  match.
- **Service worker activated and controlling `/`** — DevTools →
  Application → Service Workers shows the SW as "activated and
  is running" with `scope: '/'`. After a fresh reload of `/`,
  `navigator.serviceWorker.controller` is non-null in the
  console.
- **`beforeinstallprompt` fires on Android Chrome** — paste the
  one-shot listener (see Acceptance §22-25 below) into DevTools
  console BEFORE reloading `/`; the log appears within ~2
  seconds.
- **`<head>` carries the right tags** —
  `curl -s <url> | grep -E '(theme-color|apple-touch-icon)'`
  shows both lines, and `theme-color` content string-matches the
  manifest's `theme_color`.
- **Offline reload works** — DevTools → Application → Service
  Workers → "Offline" toggle ON, then reload `/`; loads from
  cache. Reload `/admin/leads` and `/operator/offer/test-token`
  also under Offline; both must NOT load from cache (correctly
  fail at network).
- **HTTPS** — page is served over HTTPS (Vercel default).

iOS Safari is verified visually only: Share → Add to Home Screen
must show the Aeris icon and the Arabic short_name on the
preview. iOS does not fire `beforeinstallprompt` and has no
DevTools-level audit equivalent.

### 9. iOS Safari quirks

iOS Safari has a quirky PWA implementation that won't be a full
PWA, but the manifest + apple-touch-icon + status-bar meta still
let users "Add to Home Screen" with a proper icon and
fullscreen-ish app shell.

**Known iOS limitations** (documented in the smoke test):
- No installability prompt — user must use Share → Add to Home Screen
- No background sync, push notifications, or periodic fetch
- 50 MB cache limit per origin
- Service worker terminated aggressively when not in use
- `display: standalone` works but has rough edges (status bar overlap)

The spec accepts these limits — they're the iOS reality, not
something Phase 4.2 can fix.

## Out of Scope (explicit)

Do not implement any of the following in Phase 4.2:

- Push notifications (web push; needs server infra + iOS
  workaround).
- Background sync.
- Periodic background fetch.
- Web Share Target API (other apps sharing INTO Aeris).
- Web Share API outgoing (sharing Aeris content TO other apps).
- Bluetooth, WebUSB, NFC, or any device API.
- Native-app wrappers (Capacitor, Electron, Tauri).
- App Store / Play Store distribution (TWA, packaged PWA).
- Offline lead submission (queue + retry on reconnect).
- Offline admin or operator surfaces.
- Custom install prompt UI (deferred to Phase 4.2.1).
- A new icon DESIGN (Phase 4.2 ships a placeholder; designer
  iterates separately).
- Splash screens for iOS (the manual `<link rel="apple-touch-startup-image">`
  approach requires ~10 device-specific PNGs — defer).
- Caching admin or operator pages.
- Caching `/api/*` routes.
- Adding `next-pwa` or any PWA framework package.
- Changing CI workflow YAML.
- Changing dependencies (no new packages).

## Files To Add / Edit

### Add

- `aeris/app/manifest.ts` — TypeScript manifest route handler.
- `aeris/app/offline/page.tsx` — offline fallback page.
- `aeris/components/pwa/sw-register.tsx` — client component to
  register the SW after page load.
- `aeris/public/sw.js` — hand-rolled service worker.
- `aeris/public/icons/icon-source.svg` — source SVG for
  placeholder icons (gold "A" on navy circle).
- `aeris/public/icons/icon-192.png`
- `aeris/public/icons/icon-512.png`
- `aeris/public/icons/icon-maskable-192.png`
- `aeris/public/icons/icon-maskable-512.png`
- `aeris/public/icons/apple-touch-icon.png`
- `aeris/public/icons/favicon-32.png`
- `aeris/public/icons/favicon-16.png`
  *(no `favicon.ico` — see §2 rationale)*
- `aeris/scripts/generate-pwa-icons.mjs` — Node script using
  `sharp` to regenerate icons from `icon-source.svg`. PNG output
  only.
- `aeris/docs/checklists/pwa-audit.md` — manual installability
  audit (manifest + SW + `beforeinstallprompt` + rendered-`<head>`
  + offline behavior). No Lighthouse PWA score involved.

### Edit

- `aeris/app/layout.tsx`:
  - Add the PWA-related meta tags + icon links to the existing
    `metadata` object.
  - Mount `<ServiceWorkerRegister />` near `</body>`.
  - Do not change `lang`, `dir`, or any existing layout structure.
- `aeris/package.json`:
  - Add `"generate:icons": "node scripts/generate-pwa-icons.mjs"`
    script. No new dependencies.
- `aeris/docs/checklists/README.md` — index entry for the PWA
  audit checklist.
- `aeris/docs/checklists/production-readiness.md` — add PWA audit
  as a sub-checklist (between operator-flow-smoke-test and
  resend-email-test).
- `aeris/README.md` — link the PWA audit in the production
  checklists section.

### Not edited

- `.github/workflows/ci.yml` — frozen.
- `aeris/scripts/preflight.ps1` — frozen.
- `aeris/docs/security/npm-audit-triage.md` — frozen.
- `aeris/docs/checklists/ci-pipeline.md` — frozen.
- `aeris/docs/CODEX-REVIEW.md` — Codex's file.
- `aeris/lib/`, `aeris/types/`, `aeris/supabase/migrations/` —
  no changes (PWA is purely frontend).
- All admin / operator / Phase 4 files — no changes.
- `aeris/.env.example` — no new env vars (PWA needs none).
- `aeris/types/database.ts` — no DB schema change.

## Acceptance Criteria

Phase 4.2 is acceptable only if every item below is true.

### Manifest

1. `aeris/app/manifest.ts` exists, exports default
   `MetadataRoute.Manifest`.
2. `https://<deployment>/manifest.webmanifest` (Next.js auto-serves)
   returns valid JSON matching the structure in §1.
3. `name`, `short_name`, `description` in Arabic; `lang: 'ar'`,
   `dir: 'rtl'`.
4. `theme_color` = `#C9A961` (gold). `background_color` =
   `#0A1628` (navy).
5. 4 icons listed (192/512 × any/maskable).
6. `display: 'standalone'`.

### Icons

7. All **8 icon files** exist under `aeris/public/icons/`
   (Codex iteration 3 review fix: count corrected from 9 → 8
   after `favicon.ico` was removed from scope in iteration 2):
   - `icon-source.svg` (source of truth for the generator)
   - `icon-192.png`
   - `icon-512.png`
   - `icon-maskable-192.png`
   - `icon-maskable-512.png`
   - `apple-touch-icon.png`
   - `favicon-32.png`
   - `favicon-16.png`
8. PNGs are real PNGs (not placeholders.txt or 0-byte).
9. The maskable variants have a 40% safe-area padding so adaptive
   launchers don't crop the wordmark.
10. `aeris/public/icons/icon-source.svg` exists and is the source
    of truth for `npm run generate:icons`.
11. `npm run generate:icons` regenerates all PNG icons from the
    SVG without errors.

### Service worker

12. `aeris/public/sw.js` exists and serves at `/sw.js` (Next.js
    auto-serves files in `public/`).
13. The fetch handler bypasses `^/admin/`, `^/operator/`,
    `^/api/` (verified by Chrome DevTools → Application → Service
    Workers → trigger fetch on each path; no SW intervention).
14. Static assets (`/_next/static/*`, `/icons/*`, fonts, images)
    are cached on first visit (verified in DevTools → Application →
    Cache Storage → `aeris-v1`).
15. After first visit + going offline, the homepage `/` loads from
    cache.
16. `/offline` is precached and shown when both network + cache
    miss.

### Layout integration

17. `<link rel="manifest" href="/manifest.webmanifest">` appears in
    the page `<head>` (Next.js auto-injects from `manifest.ts`).
18. `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
    appears in `<head>`.
19. `<meta name="theme-color" content="#C9A961">` appears in
    `<head>`.
20. `<meta name="apple-mobile-web-app-capable" content="yes">`
    appears.
21. `<ServiceWorkerRegister />` is mounted in `app/layout.tsx` near
    `</body>`. It does NOT register the SW in development mode.

### Installability requirements (concrete, verifiable)

> **Why no Lighthouse PWA score gate?** Chrome deprecated the
> Lighthouse PWA *category* in late 2024; recent Lighthouse
> versions don't emit a stable PWA category number, so a
> "Lighthouse PWA score ≥ 90" gate would be intermittent or
> unmeasurable. Phase 4.2 verifies the underlying installability
> requirements directly. (Codex iteration 1, P1 fix #1.)

22. **Manifest is valid + linked + complete.**
    - `https://<deployment>/manifest.webmanifest` returns valid
      JSON.
    - DevTools → Application → Manifest shows no warnings; every
      field parsed.
    - `<link rel="manifest" href="/manifest.webmanifest">`
      present in the rendered `<head>` (verify with
      `curl -s <url> | grep -i 'rel="manifest"'`).
    - The manifest contains `name`, `short_name`, `start_url`,
      `display: 'standalone'`, **plus a 192×192 AND a 512×512 PNG
      icon with `purpose: 'any'`** (the minimum that Chrome's
      installability check requires).
23. **Service worker is registered and controls the start URL.**
    - DevTools → Application → Service Workers shows the SW as
      "activated and is running" with `scope: '/'`.
    - On a fresh reload of `/`,
      `navigator.serviceWorker.controller` is non-null in the
      console.
24. **`beforeinstallprompt` fires on Android Chrome.** With the
    above two satisfied + HTTPS, Chrome must dispatch
    `beforeinstallprompt` on the homepage. Verify by pasting in
    DevTools console **before** reloading:
    ```js
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('PWA installable', e);
    });
    ```
    Then reload `/`. The log should appear within ~2 seconds.
    > iOS Safari does NOT fire `beforeinstallprompt`; for iOS,
    > verify "Share → Add to Home Screen" shows the Aeris icon
    > and the Arabic short_name on the install preview (manual
    > visual check, not programmatic).
25. **`<meta name="theme-color">` and `<link rel="apple-touch-icon">`
    appear in the rendered `<head>`.** Verify with:
    ```bash
    curl -s https://<deployment>/ | grep -E '(theme-color|apple-touch-icon)'
    ```
    Both lines must be present, and `theme-color` content must
    **equal** the manifest's `theme_color` value (string match).

### Offline behavior

26. Manual test in Chrome DevTools → Application → Service
    Workers → "Offline" checkbox enabled, then reload `/`:
    homepage loads from cache.
27. Same test on `/admin/leads`: page does NOT load from cache
    (correctly hits network and fails — admin must always be
    fresh).
28. Same test on `/operator/offer/test-token`: page does NOT load
    from cache.

### Quality gates

29. From `aeris/`, all four gates pass:
    - `npm ci` → exit 0.
    - `npm run type-check` → exit 0.
    - `npm run build` → exit 0; route table includes the new
      `/offline` route. `manifest.webmanifest` appears in the
      output.
    - `npm run lint:strict` → exit 0.
30. `npm audit --json` count and severity breakdown match Phase 3.5
    exactly (no new advisories — no new packages added).
31. Lockfile byte-identical to current `main` (no new deps).

### Branch protection compliance

32. Phase 4.2 work landed via a PR from
    `feature/phase-4-2-pwa-foundation`.
33. CI green on the PR before merge.
34. PR rebased onto latest `main` immediately before merge.
35. No `--force` push, no `--no-verify`.

### Documentation

36. `docs/checklists/pwa-audit.md` exists, follows the standard
    checklist shape (Purpose / When to run / Steps / Pass criteria
    / If it fails).
37. `docs/checklists/README.md` and `production-readiness.md` link
    the new audit.
38. `README.md` links the PWA audit + the icon-regeneration script.
39. Work log records the placeholder-icon decision, the chosen
    `CACHE_VERSION` value, and any non-obvious implementation
    detail.

### Scope discipline

40. No new dependencies added.
41. No CI workflow YAML change.
42. No changes to `lib/`, `types/`, `supabase/migrations/`.
43. No changes to admin or operator pages, components, or Server
    Actions.
44. No push notification, background sync, or other deferred
    feature.
45. No custom install prompt UI.

## Commands That Must Pass

After implementation, run from `aeris/`:

```bash
npm ci
npm run type-check
npm run build
npm run lint:strict
npm run generate:icons   # regenerate icons from SVG (idempotent)
```

The last command is verification that the icon-generation script
works end-to-end; it should produce identical PNGs (modulo
deterministic encoder output).

Manual verification in browser (deployed Vercel URL). **No
Lighthouse score is required** — the checks below are the
authoritative installability gate per Codex iteration 1+2:

```
1. Open https://aeris-flax.vercel.app/ in Chrome (Mobile preset
   in DevTools).
2. Verify rendered <head>:
     curl -s https://aeris-flax.vercel.app/ \
       | grep -E '(theme-color|apple-touch-icon|rel="manifest")'
   All three lines must be present, and the theme-color value
   must equal the manifest's theme_color value exactly.
3. DevTools → Application → Manifest → no warnings, shape
   matches §1; manifest contains 192×192 AND 512×512 PNG icons
   with purpose: 'any'.
4. DevTools → Application → Service Workers → SW is "activated
   and is running" with scope = "/". On a fresh reload of /,
   `navigator.serviceWorker.controller` is non-null.
5. Paste in DevTools console BEFORE reloading:
     window.addEventListener('beforeinstallprompt',
       (e) => console.log('PWA installable', e));
   Then reload /. The log must appear within ~2 seconds (Android
   Chrome only — iOS Safari does not fire this event).
6. DevTools → Application → Cache Storage → confirm "aeris-v1"
   has entries after a / visit, and that "/offline" is among
   the precached responses.
7. DevTools → Application → Service Workers → "Offline" toggle ON.
8. Reload / → loads from cache.
9. Reload /admin/leads → fails (network unreachable, no SW
   intervention) — confirms admin is correctly excluded by
   shouldBypassCache.
10. Reload /operator/offer/test-token → also fails for the same
    reason — operator routes are likewise excluded.
```

## Open Questions Before Implementation

Codex iteration 1 should answer these before approval:

1. **Hand-rolled SW vs `next-pwa`?**
   Recommendation: hand-rolled. Avoids package surface, simpler
   audit, App Router-friendly. ~80 lines of code.

2. **Placeholder icon design.**
   Recommendation: gold uppercase "A" centered on navy circle, with
   the same Playfair Display weight as the wordmark. Generated by
   the script from `icon-source.svg` to keep iteration cheap. A
   real designed icon is a separate work item; placeholder unblocks
   the install surface today.

3. **Maskable safe-area padding.**
   Recommendation: 40% (W3C spec recommends 20% minimum, 40% is
   conservative and matches what most adaptive launchers crop to).

4. **Should admin/operator routes be installable too?**
   Recommendation: no separate manifest, no scope changes. The
   manifest's `scope: '/'` covers them, but the SW excludes them
   from caching, so they install correctly but always need network.
   This matches the operator-flow design (token-validated, must
   hit DB) and the admin-cookie design (cookie auth must hit
   server every request).

5. **iOS splash screens (`apple-touch-startup-image`)?**
   Recommendation: defer. Requires ~10 device-specific PNGs and
   media-query-matched `<link>` tags. Not in Phase 4.2 scope; iOS
   shows a basic white splash without them, which is acceptable
   for the first install pass.

6. **Theme color split: light vs dark?**
   Recommendation: single `#C9A961` (gold) for both. Adding
   `<meta name="theme-color" media="(prefers-color-scheme: dark)">`
   is doable but Aeris's design is already dark by default —
   the gold reads well in both modes.

7. **Service worker update strategy.**
   Recommendation: `skipWaiting()` + `clients.claim()` so the new
   SW takes over on next page load (no nag for the user to "click
   to update"). Acceptable because Aeris isn't a real-time app
   where mid-session SW swap could break state.

8. **Should the offline page link back to a `/admin/login`?**
   Recommendation: no. The offline page is for public visitors. An
   admin without network can't do anything useful anyway — log them
   in offline = false security signal. Keep `/offline` brand-only.

### Codex iteration 1 — findings (resolved in iteration 2)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Lighthouse PWA score gate (≥ 90) is unreliable — Chrome deprecated the PWA category in late 2024 | "Installability requirements" replaces it: manifest validity + SW activation + `beforeinstallprompt` on Android Chrome + rendered-`<head>` checks via curl. Acceptance #22-25 enforce. |
| 2 | `/offline` was not in PRECACHE_URLS — first offline visit would silently fall through to network failure | Added `/offline` to PRECACHE_URLS. `cache.addAll` is atomic — SW install fails loudly if the offline fallback can't be cached. Acceptance #16. |
| 3 | `^/admin/` regex matched only sub-paths, not bare `/admin` | Replaced regex array with `shouldBypassCache(pathname)` that checks `pathname === '/admin' || pathname.startsWith('/admin/')` for each of admin / operator / api. SW sketch in §3 updated. |
| 4 | `sharp` can't emit `favicon.ico` — requirement would force a new dependency or fragile binary encoder | Dropped `favicon.ico` from scope. PNG favicons (16/32 + apple-touch-icon) cover all modern browsers. Rationale documented in §2. |
| 5 | `theme-color` lives in `viewport` export not `metadata` in Next.js 14, AND existing viewport had navy while manifest had gold (silent mismatch) | §5 split: 5a updates `viewport.themeColor` from navy to gold (matches manifest); 5b adds PWA links to `metadata` but explicitly forbids adding `themeColor` there; 5c specifies `curl` verification that rendered `<head>` matches manifest exactly. Acceptance #25 enforces string-match. |

### Codex iteration 2 — findings (resolved in iteration 3)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Iteration 2 fixed the Acceptance Criteria block but left Lighthouse PWA score ≥ 90 in four other places: Objective #5, §8 "Lighthouse PWA audit", the Manual verification block in "Commands That Must Pass", and Required Claude Output — recreating the same unreliable gate the iteration was supposed to remove | All four locations purged. Objective #5 now points at the Installability requirements; §8 renamed "PWA installability audit (manual)" with explicit "no Lighthouse score required"; manual-verification step `DevTools → Lighthouse → score ≥ 90` replaced with `curl` checks + `beforeinstallprompt` listener + DevTools state checks; Required Claude Output drops "Lighthouse PWA score in work log" and replaces with "manual-verification step results (pass/fail per numbered step + curl output for steps 2 and 6)". |
| 2 | Acceptance criterion #25 was used twice (once for theme-color/apple-touch-icon in `<head>`, once for the first offline-behavior check) — bookkeeping risk for future audits | Offline Behavior renumbered 25→26, 26→27, 27→28; Quality Gates 28→29, 29→30, 30→31; Branch Protection 31→32, 32→33, 33→34, 34→35; Documentation 35→36, 36→37, 37→38, 38→39; Scope Discipline 39→40, 40→41, 41→42, 42→43, 43→44, 44→45. Installability stays at 22-25 (no shift). All cross-references (§5c→#25, audit-trail rows #16 and #22-25) point at numbers that did not move. Total criteria now 45 (was 44 in iteration 1 / 44 in iteration 2). |

## Required Claude Output

Once Codex approves this iteration, Claude will:

- Implement everything above (and only that).
- Run all four quality-gate commands plus `npm run generate:icons`
  and report results.
- Run the **Manual verification** block from "Commands That Must
  Pass" against `localhost:3000` (production build) — every
  numbered step (1–10), recording the actual `curl` output and
  the DevTools state observed. The deployed-Vercel audit is a
  separate founder action post-merge and is not part of Claude's
  implementation deliverable. **No Lighthouse PWA category score
  is required or reported.**
- Update `docs/CLAUDE-WORK-LOG.md` with: summary, files added /
  edited, exact command output, the icon-generation script
  output, the manual-verification step results (pass/fail per
  numbered step + the `curl` output for steps 2 and 6),
  branch + PR URL, CI run URL, known issues, and questions for
  the next Codex review.
- Stop. Will not start Phase 4.2.1 (custom install prompt,
  designed icon), Phase 4.1 (multi-city editor), Phase 5
  (operator marketplace), or Phase 3.6 (Sentry decision) without
  a separate task.
