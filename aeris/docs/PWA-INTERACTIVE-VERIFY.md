# PWA Interactive Verification Script

> **Purpose:** the bits of `pwa-audit.md` that must run inside Chrome
> DevTools because curl cannot drive a browser. Paste-once;
> get-results.
>
> **When to run:** before merging any PR that changes a PWA surface
> (`app/manifest.ts`, `public/sw.js`, `app/offline/**`,
> `components/pwa/**`, `app/layout.tsx`, `public/icons/**`,
> `scripts/generate-pwa-icons.mjs`).
>
> **Where to run:** the deployed Vercel preview URL OR
> `localhost:3050` running `npm run start` (NOT `npm run dev` —
> the SW only registers in production NODE_ENV).

---

## Step 0 — Open the page

Open the target URL in **Chrome** (Mobile preset in DevTools is
fine; required only for the install-prompt step).

For Phase 4.2 PR #4 the preview URL is:
**https://aeris-osos9r8to-earis-projects-620f37e5.vercel.app**

(Replace with the URL of any future PR's Vercel preview when
re-running.)

Open DevTools (`F12` or `Ctrl+Shift+I`).

---

## Step 1 — Paste the listener BEFORE reload

In the **Console** tab, paste this and press Enter:

```js
window.__aerisPromptFired = false;
window.addEventListener('beforeinstallprompt', (e) => {
  window.__aerisPromptFired = true;
  e.preventDefault();
  console.log('✓ beforeinstallprompt fired');
});
console.log('Listener installed. Now reload the page (Ctrl+R).');
```

Then **reload** the page (`Ctrl+R`). The reload re-runs the SW
registration + lets Chrome's installability heuristics fire after
DOMContentLoaded.

---

## Step 2 — After reload, paste the verification script

The reload wipes console state, so paste the listener **again**
immediately after reload (Chrome may dispatch
`beforeinstallprompt` within ~1-2 seconds of reload):

```js
window.__aerisPromptFired = false;
window.addEventListener('beforeinstallprompt', (e) => {
  window.__aerisPromptFired = true;
  e.preventDefault();
});
```

Then wait ~3 seconds. Then paste this:

```js
(async () => {
  const r = {};

  // 1. Service worker
  r.sw_controller = navigator.serviceWorker.controller?.scriptURL ?? null;
  const reg = await navigator.serviceWorker.getRegistration();
  r.sw_registered = !!reg;
  r.sw_scope = reg?.scope ?? null;
  r.sw_state = reg?.active?.state ?? null;

  // 2. Cache Storage
  try {
    r.cache_names = await caches.keys();
    const cache = await caches.open('aeris-v1');
    const keys = await cache.keys();
    r.cache_count = keys.length;
    r.offline_precached = !!(await cache.match('/offline'));
    r.root_precached = !!(await cache.match('/'));
  } catch (e) { r.cache_error = e.message; }

  // 3. Manifest
  try {
    const m = await fetch('/manifest.webmanifest').then(x => x.json());
    r.manifest_name = m.name;
    r.manifest_short = m.short_name;
    r.manifest_theme_color = m.theme_color;
    r.manifest_lang = m.lang;
    r.manifest_dir = m.dir;
    r.manifest_display = m.display;
    r.manifest_has_192_any = !!m.icons?.find(i => i.sizes === '192x192' && i.purpose === 'any');
    r.manifest_has_512_any = !!m.icons?.find(i => i.sizes === '512x512' && i.purpose === 'any');
    r.manifest_has_192_maskable = !!m.icons?.find(i => i.sizes === '192x192' && i.purpose === 'maskable');
    r.manifest_has_512_maskable = !!m.icons?.find(i => i.sizes === '512x512' && i.purpose === 'maskable');
  } catch (e) { r.manifest_error = e.message; }

  // 4. theme-color in head matches manifest
  r.head_theme_color = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
  r.theme_color_match = r.head_theme_color === r.manifest_theme_color;

  // 5. apple-touch-icon
  r.apple_touch_icon = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href');

  // 6. beforeinstallprompt
  r.beforeinstallprompt_fired = !!window.__aerisPromptFired;

  console.table(r);
  console.log('Copy the JSON below and send it back:');
  console.log(JSON.stringify(r, null, 2));
})();
```

---

## Step 3 — Copy the JSON output

The script prints a `console.table` followed by a JSON block. Copy
the JSON block (everything between `{` and `}`) and paste it back
to the founder thread.

---

## Step 4 — Offline behavior probe (manual)

1. DevTools → **Application** → **Service Workers** → tick
   **Offline**.
2. Reload `/`. Should load from cache (no network error).
3. Visit `/admin/leads`. Should fail with "no internet" — the SW
   correctly bypasses admin routes.
4. Visit `/operator/offer/test-token`. Should also fail.
5. Visit `/some-route-that-never-existed`. Should show the
   `/offline` Aeris-branded fallback.
6. Untick **Offline** when done.

Report which of the four offline probes passed / failed.

---

## Expected results

If everything is correct:

| field | expected |
|---|---|
| `sw_controller` | `https://<host>/sw.js` (non-null) |
| `sw_registered` | `true` |
| `sw_scope` | `"https://<host>/"` |
| `sw_state` | `"activated"` |
| `cache_names` | array containing `"aeris-v1"` |
| `cache_count` | ≥ 2 (`/`, `/offline`, plus any visited pages) |
| `offline_precached` | `true` |
| `root_precached` | `true` |
| `manifest_name` | `"Aeris — الطيران الخاص الذكي"` |
| `manifest_theme_color` | `"#C9A961"` |
| `manifest_lang` / `manifest_dir` | `"ar"` / `"rtl"` |
| `manifest_display` | `"standalone"` |
| `manifest_has_*` | all four `true` |
| `head_theme_color` | `"#C9A961"` |
| `theme_color_match` | `true` |
| `apple_touch_icon` | `"/icons/apple-touch-icon.png"` |
| `beforeinstallprompt_fired` | `true` (Android/Mobile preset only — `false` on desktop is acceptable) |

If any field deviates, paste the actual JSON back; do **not**
merge the PR.

---

## Why this script exists

`pwa-audit.md` lists 18 manual steps. Several can only be done
inside DevTools — `navigator.serviceWorker.controller`,
`caches.keys()`, `beforeinstallprompt`. Curl can verify the
static surface (manifest validity, head tags, icon HTTP status,
`/offline` and `/sw.js` reachable) but not these runtime checks.
This file packages the runtime checks into one paste so the
founder doesn't need to step through DevTools panels manually.
