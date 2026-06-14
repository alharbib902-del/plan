import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';

/**
 * Centralised, fail-closed feature-flag reads for the client
 * mobile API surface.
 *
 * Mirrors the codebase convention exactly: a feature is ON only
 * when its env var is the literal string `'true'` — unset /
 * empty / `1` / typo all read as OFF (`flagOn`). This module is
 * NOT `server-only` (it reads `process.env` only) so the
 * structural unit test can import it under tsx.
 *
 * `mobileCapabilityFlags()` is what `GET /api/v1/mobile/config`
 * returns: the deployed flag state + price visibility + the
 * minimum supported app version, so a published app can adapt
 * to flag flips in Vercel WITHOUT a store release (and prompt a
 * force-update when it is older than the floor).
 */
export function flagOn(name: string): boolean {
  return process.env[name] === 'true';
}

const DEFAULT_MIN_SUPPORTED_VERSION = '1.0.0';

export interface MobileCapabilityFlags {
  client_portal: boolean;
  privilege: boolean;
  payments: boolean;
  client_empty_legs_portal: boolean;
  empty_legs_client_pricing: boolean;
}

export interface MobileConfig {
  flags: MobileCapabilityFlags;
  /** Convenience mirror of the empty-legs pricing flag for the UI. */
  pricing_visible: boolean;
  /** Apps older than this should hard-prompt a store update. */
  min_supported_version: string;
}

export function mobileCapabilityFlags(): MobileCapabilityFlags {
  return {
    client_portal: flagOn('ENABLE_CLIENT_PORTAL'),
    privilege: flagOn('ENABLE_PRIVILEGE'),
    payments: flagOn('ENABLE_PAYMENTS'),
    client_empty_legs_portal: flagOn('ENABLE_CLIENT_EMPTY_LEGS_PORTAL'),
    empty_legs_client_pricing: flagOn('ENABLE_EMPTY_LEGS_CLIENT_PRICING'),
  };
}

export function mobileConfig(): MobileConfig {
  return {
    flags: mobileCapabilityFlags(),
    // Reuse the SAME authority the web emails/UI use so the app
    // can never disagree with the server on price visibility.
    pricing_visible: clientPricingVisible(),
    min_supported_version:
      process.env.MOBILE_MIN_SUPPORTED_VERSION?.trim() ||
      DEFAULT_MIN_SUPPORTED_VERSION,
  };
}
