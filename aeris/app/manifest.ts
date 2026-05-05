import type { MetadataRoute } from 'next';

/**
 * Phase 4.2 PWA manifest — served by Next.js at /manifest.webmanifest.
 *
 * Brand colors must stay in sync with `viewport.themeColor` in
 * app/layout.tsx and with the icon source SVG. theme_color is the
 * gold accent surfaced in install banners and the mobile browser
 * address bar; background_color is the navy splash that paints
 * during PWA launch before the first frame renders.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aeris — الطيران الخاص الذكي',
    short_name: 'Aeris',
    description:
      'منصة Aeris للطيران الخاص في المملكة العربية السعودية',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0A1628',
    theme_color: '#C9A961',
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
  };
}
