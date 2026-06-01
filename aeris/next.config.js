/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async headers() {
    // Baseline CSP — closes XSS amplification paths (frame
    // embedding, object/Flash, arbitrary <base>) without
    // breaking Next.js hydration, Mapbox, PostHog, Sentry, or
    // Supabase. The `unsafe-inline` + `unsafe-eval` carve-outs
    // are required by Next.js's runtime + posthog-js + mapbox-gl.
    // Tightening to a nonce-based CSP is tracked as follow-up
    // work; getting CSP present at all is the immediate gain.
    // HyperPay COPYandPAY (Phase payments PR #120) loads paymentWidgets.js and
    // 3DS / redirect frames from *.oppwa.com. Only widen the CSP when payments
    // are actually enabled, so the surface stays closed while the flag is off.
    const paymentsOn = process.env.ENABLE_PAYMENTS === 'true';
    const oppwa = 'https://*.oppwa.com';
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'" +
        (paymentsOn ? ` ${oppwa}` : ''),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https: wss:",
      "worker-src 'self' blob:",
      ...(paymentsOn ? [`frame-src 'self' ${oppwa}`] : []),
      "frame-ancestors 'none'",
      "form-action 'self'" + (paymentsOn ? ` ${oppwa}` : ''),
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          // HSTS — Vercel forces HTTPS already; this signals to
          // browsers to refuse HTTP for 2 years across subdomains
          // and request preload-list inclusion.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Baseline CSP — see comment above the policy build.
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
