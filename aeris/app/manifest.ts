import type { MetadataRoute } from 'next';

const SHORTCUT_ICON = {
  src: '/icons/icon-192.png',
  sizes: '192x192',
  type: 'image/png',
};

/**
 * Phase 4.2 PWA manifest — served by Next.js at /manifest.webmanifest.
 *
 * Brand colors must stay in sync with `viewport.themeColor` in
 * app/layout.tsx and with the icon source SVG. theme_color is the
 * deep navy that tints the installed app's title/status bar (gold
 * tinted it too loudly); background_color is the navy splash that
 * paints during PWA launch before the first frame renders.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Pinned so the installed-app identity survives any future
    // start_url change.
    id: '/',
    name: 'Aeris — الطيران الخاص الذكي',
    short_name: 'Aeris',
    description:
      'منصة Aeris للطيران الخاص في المملكة العربية السعودية',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Not portrait-locked: tablets and the admin/operator tables need
    // landscape.
    orientation: 'any',
    background_color: '#0A1628',
    theme_color: '#050B14',
    lang: 'ar',
    dir: 'rtl',
    categories: ['travel', 'business', 'lifestyle'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'طلب رحلة',
        url: '/request',
        icons: [SHORTCUT_ICON],
      },
      {
        name: 'حجوزاتي',
        url: '/me/bookings',
        icons: [SHORTCUT_ICON],
      },
      {
        name: 'الرحلات الفارغة',
        url: '/empty-legs',
        icons: [SHORTCUT_ICON],
      },
    ],
  };
}
