import type { MetadataRoute } from 'next';

/** Same canonical origin + fallback as `metadataBase` in app/layout.tsx. */
function publicSiteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://aeris.sa';
  return raw.replace(/\/+$/, '');
}

/**
 * Indexable public pages only, each behind the same fail-closed flag as
 * its page so the sitemap never advertises a 404. /login and /signup
 * are deliberately absent: both pages ship `robots: noindex`, and a
 * sitemap must not submit URLs that ask not to be indexed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicSiteBaseUrl();
  const lastModified = new Date();

  const entries: Array<{
    path: string;
    changeFrequency: 'daily' | 'weekly' | 'monthly';
    priority: number;
  }> = [
    { path: '/', changeFrequency: 'weekly', priority: 1 },
    { path: '/request', changeFrequency: 'monthly', priority: 0.9 },
  ];
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE === 'true') {
    entries.push({ path: '/empty-legs', changeFrequency: 'daily', priority: 0.8 });
  }
  if (process.env.ENABLE_PRIVILEGE === 'true') {
    entries.push({ path: '/privilege', changeFrequency: 'monthly', priority: 0.6 });
  }

  return entries.map((entry) => ({
    url: entry.path === '/' ? base : `${base}${entry.path}`,
    lastModified,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
