import type { Metadata, Viewport } from 'next';
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
  themeColor: '#0A1628',
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
      </body>
    </html>
  );
}
