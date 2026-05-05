'use client';

import { useEffect } from 'react';

/**
 * Phase 4.2 service worker registration.
 *
 * Mounted once near the bottom of `app/layout.tsx`. Returns no DOM.
 *
 * Behavior:
 *   - Production only. Dev mode skips registration so HMR isn't
 *     interfered with by an active SW intercepting fetches.
 *   - Registers after the page's `load` event so the SW install
 *     never blocks first paint or hydration.
 *   - Failures are swallowed (logged) — a SW that fails to register
 *     must never crash the page.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[pwa] service worker registration failed', err);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
