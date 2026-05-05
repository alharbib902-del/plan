# PWA Installability Audit (manual)

## Purpose

Empirically verify that the public surface of Aeris is installable
as a Progressive Web App on Android, iOS, and desktop browsers,
with manifest + icon + service worker + offline behavior all
correct on the deployed (or local production) site.

> **No Lighthouse PWA category score is required.** Chrome
> deprecated the Lighthouse PWA category in late 2024 and the
> number is no longer reliably emitted. This checklist verifies
> the underlying installability requirements directly via
> `curl` + Chrome DevTools Application panel.

## When to run

- Before every production deploy that touches `app/manifest.ts`,
  `public/sw.js`, `app/offline/page.tsx`, `components/pwa/**`,
  `app/layout.tsx`, `public/icons/**`, or
  `scripts/generate-pwa-icons.mjs`.
- Quarterly in any case (catches drift from Chrome / browser
  updates that change installability requirements).
- After any Vercel domain or HTTPS configuration change.

## Setup

You need:

- The deployed URL (e.g., `https://aeris-flax.vercel.app/`) OR a
  local production build (`npm run build && npm run start`).
- Chrome (for DevTools Application panel + `beforeinstallprompt`).
- An Android device or Chrome Mobile preset for the install probe.
- Optionally: an iOS Safari device for the manual visual check.

## Steps

### 1. Manifest validity + linkage

1. [ ] Fetch the manifest:
       ```bash
       curl -s <url>/manifest.webmanifest | head -40
       ```
       Expect: valid JSON with `name`, `short_name`, `start_url`,
       `display: 'standalone'`, `theme_color: '#C9A961'`,
       `background_color: '#0A1628'`, `lang: 'ar'`, `dir: 'rtl'`,
       and an `icons` array with **at least** a 192×192 AND a
       512×512 PNG with `purpose: 'any'`.

2. [ ] Manifest is linked from the rendered `<head>`:
       ```bash
       curl -s <url>/ | grep -i 'rel="manifest"'
       ```
       Expect: a single `<link rel="manifest" href="/manifest.webmanifest">`
       line.

3. [ ] DevTools → **Application** → **Manifest**: parses without
       warnings, shows the four declared icons, name + short_name
       in Arabic.

### 2. Theme-color + apple-touch-icon in `<head>`

4. [ ] All three PWA-related tags appear in the rendered `<head>`:
       ```bash
       curl -s <url>/ | grep -E '(theme-color|apple-touch-icon|rel="manifest")'
       ```
       Expect three lines:
       - `<meta name="theme-color" content="#C9A961"/>`
       - `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>`
       - `<link rel="manifest" href="/manifest.webmanifest"/>`

5. [ ] The `theme-color` value **string-matches** the manifest's
       `theme_color` exactly (`#C9A961`). Any mismatch is a P1 —
       address bar tint will diverge from install banner.

### 3. Service worker registered + controlling

6. [ ] DevTools → **Application** → **Service Workers**: SW
       registered at scope `/`, status `activated and is running`.

7. [ ] Reload `/`. Open DevTools console:
       ```js
       navigator.serviceWorker.controller
       ```
       Expect: a non-null `ServiceWorker` object (NOT `null`).
       If `null`, the SW registered but isn't yet controlling the
       page — reload one more time and re-check.

### 4. `beforeinstallprompt` on Android Chrome

8. [ ] In DevTools, **before** reloading, paste in the console:
       ```js
       window.addEventListener('beforeinstallprompt', (e) => {
         console.log('PWA installable', e);
       });
       ```

9. [ ] Reload `/`. Within ~2 seconds the console must log:
       ```
       PWA installable BeforeInstallPromptEvent {…}
       ```
       If nothing logs after 5 seconds, one of these is wrong:
       - HTTPS missing
       - Manifest doesn't have a 192 + 512 icon with `purpose: 'any'`
       - Service worker not active
       - Site already installed (uninstall via DevTools →
         Application → "Uninstall" first, then reload).

       > **iOS Safari does NOT fire `beforeinstallprompt`.** For
       > iOS, jump to step 12 instead.

### 5. Static asset caching

10. [ ] After loading `/` once, DevTools → Application → Cache
        Storage → expand `aeris-v1`. Expect entries for the
        precached pages (`/`, `/offline`) plus static assets
        (`/_next/static/...`, `/icons/...`, fonts, raster images)
        accumulated during the visit.

11. [ ] `/offline` is among the precached entries (not lazy-cached).
        This is critical — the offline fallback is precached at
        install so it's available the very first time the user
        loses network.

### 6. iOS visual install (manual only)

12. [ ] On iOS Safari, navigate to `<url>/`. Tap the **Share**
        sheet → **Add to Home Screen**. The preview must show:
        - The Aeris gold "A" icon (not a generic page screenshot)
        - Short name "Aeris" in Arabic context

        Confirm the icon appears on the home screen with the
        expected gold-on-navy treatment.

### 7. Offline behavior

13. [ ] DevTools → Application → Service Workers → toggle
        **Offline** ON.

14. [ ] Reload `/`. Page must load from cache (no network error).

15. [ ] In a new tab, visit `<url>/admin/leads`. Page must NOT
        load from cache — browser shows the "no internet"
        connection error. This confirms `shouldBypassCache`
        correctly excludes admin from SW intervention.

16. [ ] Same probe on `<url>/operator/offer/test-token`. Must NOT
        load from cache; same connection error. Confirms operator
        routes are likewise excluded.

17. [ ] Visit a never-visited URL like `<url>/totally-fake-route`.
        Page must show the `/offline` fallback (precached
        Aeris-branded card with WifiOff icon and Arabic copy).

### 8. HTTPS

18. [ ] The deployed URL is `https://`. Vercel handles this by
        default; if you ever see `http://` in the address bar,
        installability fails everywhere.

## Pass criteria

- Every box above is checked.
- The exact `curl` outputs in steps 1, 2, and 4 match expectations.
- `beforeinstallprompt` fires on Android Chrome within ~2 seconds.
- Offline reload of `/` succeeds; offline reload of `/admin/*`
  and `/operator/*` correctly fails.
- iOS install preview shows the gold "A" icon (manual visual).

## If it fails

- **Step 1 fails (invalid JSON):** check `app/manifest.ts` exports
  default `MetadataRoute.Manifest`. Run `npm run build` and look
  for warnings about manifest generation.

- **Step 2 fails (no `<link rel="manifest">`):** Next.js auto-injects
  this from `app/manifest.ts`. If missing, the file may not be in
  the right path or has a syntax error.

- **Step 5 mismatch (theme-color ≠ manifest):** check
  `app/layout.tsx` `viewport.themeColor` matches
  `app/manifest.ts` `theme_color`. Both must be `#C9A961` (gold).

- **Step 6/7 fails (SW not registered):** check
  `components/pwa/sw-register.tsx` is mounted in
  `app/layout.tsx`. SW registration is **production-only** —
  if you're testing in `npm run dev`, the SW is intentionally
  not registered. Use `npm run build && npm run start` instead.

- **Step 9 fails (`beforeinstallprompt` doesn't fire):** check
  manifest has 192 + 512 PNG icons with `purpose: 'any'`. Open
  DevTools → Application → Manifest → look for a red X next to
  any field. The most common cause: icon files missing or
  wrong-size PNGs. Re-run `npm run generate:icons`.

- **Step 11 fails (`/offline` not precached):** the SW
  `PRECACHE_URLS` array must include `'/offline'`. Verify in
  `public/sw.js`. The SW also fails its install if any
  precache URL returns 404 — check that the build output includes
  the `/offline` route.

- **Step 15/16 fails (admin/operator load from cache):** the
  `shouldBypassCache` function in `public/sw.js` is broken or
  not matching the path. Add `console.log` inside it and retry to
  trace the bypass logic.

- **Step 17 fails (no offline fallback for unknown routes):**
  the SW's `fetch` handler `.catch()` must return
  `caches.match('/offline')` as the final fallback. Verify the
  precache list includes `/offline` (step 11) and the catch
  branch hits it.

- **Step 9 fails on a SUBSEQUENT visit but worked the first
  time:** the install prompt isn't re-fired after the user has
  installed the app or dismissed the banner. To re-test, uninstall
  the PWA in DevTools → Application → click "Uninstall" beside
  the manifest summary, then clear cache + reload.
