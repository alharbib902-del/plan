import { SiteHeaderClient } from './site-header-client';

/**
 * Server wrapper so the login entry follows the server-only
 * `ENABLE_CLIENT_PORTAL` flag (fail-closed, same gate as /login)
 * without a NEXT_PUBLIC mirror. Reads env only — never cookies — so
 * the public pages stay static-friendly.
 */
export function SiteHeader() {
  const showLogin = process.env.ENABLE_CLIENT_PORTAL === 'true';
  return <SiteHeaderClient showLogin={showLogin} />;
}
