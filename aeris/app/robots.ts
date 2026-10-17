import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  // Same canonical origin + fallback as `metadataBase` in app/layout.tsx.
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://aeris.sa'
  ).replace(/\/+$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Robots rules are prefix matches, so the client portal is
        // listed as `/me$` + `/me/` — a bare `/me` would also block
        // public paths such as /medevac.
        disallow: [
          '/me$',
          '/me/',
          '/admin',
          '/operator',
          '/api/',
          '/booking/',
          '/empty-legs/*/reserved',
          '/empty-legs/opt-out/',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
