import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Aeris — الفضاء يبدأ من هنا',
    template: '%s | Aeris',
  },
  description:
    'منصة Aeris الذكية للطيران الخاص — حجز رحلات، خدمات مخصصة، إخلاء طبي، وشحن متخصص في المملكة العربية السعودية',
  keywords: [
    'طيران خاص',
    'Private Aviation',
    'Charter Flight',
    'السعودية',
    'Saudi Arabia',
    'Empty Legs',
    'MedEvac',
    'Cargo',
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
  // Apple PWA + format-detection. theme-color must NOT be set here —
  // it lives in `viewport.themeColor` below per Next.js 14 conventions.
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'Aeris',
    'format-detection': 'telephone=no',
  },
  openGraph: {
    type: 'website',
    locale: 'ar_SA',
    url: 'https://aeris.sa',
    title: 'Aeris — الفضاء يبدأ من هنا',
    description: 'منصة Aeris الذكية للطيران الخاص',
    siteName: 'Aeris',
  },
  twitter: {
    card: 'summary_large_image',
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
  initialScale: 1,
  maximumScale: 5,
  // Phase 4.2: gold to match `manifest.theme_color`. This tints the
  // mobile browser address bar and the PWA install banner accent.
  themeColor: '#C9A961',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className="h-full">
      <body className="min-h-screen bg-navy text-ink antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
