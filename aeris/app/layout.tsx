import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, Playfair_Display } from 'next/font/google';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import './globals.css';

// Self-hosted via next/font (was a render-blocking cross-origin
// @import in globals.css). IBM Plex Sans Arabic = the primary UI
// face; Playfair Display = the `font-display` wordmark. Inter was
// dropped — it had no className usage, only a dead fallback slot.
// Weights mirror real usage (every weight is a preloaded file): Plex
// has no font-light, 700 stays for <strong>; Playfair only renders
// at 400. Add a weight here before using it, or it gets faux-bolded.
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-arabic',
  display: 'swap',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-playfair-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Aeris — الفضاء يبدأ من هنا',
    template: '%s | Aeris',
  },
  description:
    'منصة Aeris الذكية للطيران الخاص في المملكة العربية السعودية — استئجار طائرة خاصة حسب الطلب، رحلات فارغة بأسعار مخفّضة، وبرنامج Aeris Privilege للمسافرين الدائمين',
  keywords: [
    'طيران خاص',
    'استئجار طائرة خاصة',
    'رحلات فارغة',
    'Private Aviation',
    'Private Jet Charter',
    'Charter Flight',
    'Empty Legs',
    'Aeris Privilege',
    'السعودية',
    'Saudi Arabia',
    'Aeris',
  ],
  authors: [{ name: 'Aeris' }],
  creator: 'Aeris',
  publisher: 'Aeris',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa'
  ),
  // PWA icons. The manifest is auto-linked by Next.js from app/manifest.ts.
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icons/favicon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  // theme-color must NOT be set here — it lives in `viewport.themeColor`.
  // `capable` renders `mobile-web-app-capable`; iOS standalone launch
  // comes from manifest `display: 'standalone'`. black-translucent puts
  // the page under the status bar — shells pad with safe-area insets.
  appleWebApp: {
    capable: true,
    title: 'Aeris',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'ar_SA',
    url: 'https://aeris.sa',
    title: 'Aeris — الفضاء يبدأ من هنا',
    description: 'منصة Aeris الذكية للطيران الخاص',
    siteName: 'Aeris',
  },
  // No OG/Twitter image exists yet, and summary_large_image needs one.
  twitter: {
    card: 'summary',
    title: 'Aeris — الفضاء يبدأ من هنا',
    description: 'منصة Aeris الذكية للطيران الخاص',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  viewportFit: 'cover',
  initialScale: 1,
  maximumScale: 5,
  // Phase 4.2: gold to match `manifest.theme_color`. This tints the
  // browser bar; now deep navy (also in the manifest) — gold was too loud.
  themeColor: '#050B14',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`h-full ${ibmPlexArabic.variable} ${playfairDisplay.variable}`}
    >
      {/* viewportFit 'cover' lets landscape iPhones draw under the
          notch; physical left/right insets (they have no logical
          equivalent) keep in-flow content clear of it. */}
      <body className="min-h-screen bg-navy pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-ink antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
