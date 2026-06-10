import 'server-only';

/**
 * Boot-time env presence check (REA — ops monitoring).
 *
 * Surfaces a misconfigured deploy as ONE Sentry error at startup instead of
 * letting it manifest later as a per-request fail-closed surface (a token mint
 * that throws, an admin login that 500s, a cron that silently no-ops). Every
 * secret below is already enforced lazily + fail-closed at its own call site;
 * this module does NOT add a second enforcement boundary and deliberately
 * NEVER throws — it only reports, so a missing var can never crash boot.
 *
 * Scope is intentionally conservative: a name is listed ONLY when the current
 * code actually reads it and fail-closes without it. The unconditional four are
 * load-bearing in every environment. Per-feature secrets are checked ONLY when
 * their `ENABLE_*` flag is on, using the SAME gate semantics the feature itself
 * uses — fail-closed (the literal `'true'`) across the board — so a deploy with
 * a feature OFF is not flagged for that feature's secrets. Secrets with a
 * documented fallback (e.g.
 * RATE_LIMIT_FINGERPRINT_SECRET → CRON_SECRET) and the reserved-but-unread
 * OPERATOR_OTP_SECRET / *_SESSION_SECRET names are excluded by design.
 */

function isPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function flagOn(name: string, defaultOn = false): boolean {
  if (defaultOn) {
    return process.env[name] !== 'false';
  }
  // Fail-closed convention across the codebase: ONLY the literal `'true'`
  // enables a feature; any other value (unset / empty / `1` / typo) is off.
  return process.env[name] === 'true';
}

// Required in every environment regardless of feature flags.
const UNCONDITIONAL_REQUIRED: readonly string[] = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'ADMIN_AUTH_SECRET',
  'CRON_SECRET',
];

// Per-feature HMAC / gateway secrets, keyed by the flag that makes them
// load-bearing. Each listed secret is read + fail-closed at its call site only
// when its flag is `'true'`.
const FEATURE_REQUIRED: ReadonlyArray<{
  flag: string;
  vars: readonly string[];
  defaultOn?: boolean;
}> = [
  {
    // Phase 8 operator portal — page/action gates are fail-closed (enabled only
    // on the literal string 'true'), so the secrets are load-bearing only then.
    flag: 'ENABLE_OPERATOR_PORTAL',
    vars: ['OPERATOR_WELCOME_TOKEN_SECRET', 'OPERATOR_PASSWORD_RESET_TOKEN_SECRET'],
  },
  {
    // Phase 4 operator offer page + Phase 7 operator empty-leg session links.
    flag: 'ENABLE_OPERATOR_LEGACY_TOKEN',
    vars: ['OPERATOR_TOKEN_SECRET', 'EMPTY_LEGS_OPERATOR_TOKEN_SECRET'],
  },
  {
    // Phase 9 client portal — password-reset token mint.
    flag: 'ENABLE_CLIENT_PORTAL',
    vars: ['CLIENT_PASSWORD_RESET_TOKEN_SECRET'],
  },
  {
    // Phase 7 public marketplace — reservation hold + opt-out token mints.
    flag: 'ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE',
    vars: ['EMPTY_LEGS_RESERVATION_TOKEN_SECRET', 'EMPTY_LEGS_OPT_OUT_TOKEN_SECRET'],
  },
  {
    // Payments — HyperPay gateway + the customer-checkout link signing secret.
    flag: 'ENABLE_PAYMENTS',
    vars: [
      'HYPERPAY_ACCESS_TOKEN',
      'HYPERPAY_ENTITY_ID_VISA',
      'HYPERPAY_WEBHOOK_SECRET',
      'CUSTOMER_CHECKOUT_SECRET',
    ],
  },
  {
    // Privilege / MedEvac admin-PII audit fingerprint (fail-closed HMAC).
    flag: 'ENABLE_PRIVILEGE',
    vars: ['ADMIN_AUDIT_FINGERPRINT_SECRET'],
  },
  {
    flag: 'ENABLE_MEDEVAC',
    vars: ['ADMIN_AUDIT_FINGERPRINT_SECRET'],
  },
];

/**
 * Returns the names of required env vars that are missing or blank given the
 * currently-enabled feature flags. Never throws. Order is stable (unconditional
 * first, then per-feature in declaration order) and de-duplicated so a secret
 * shared by two enabled flags is reported once.
 */
export function findMissingRequiredEnv(): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();

  const consider = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    if (!isPresent(name)) missing.push(name);
  };

  for (const name of UNCONDITIONAL_REQUIRED) consider(name);
  for (const { flag, vars, defaultOn } of FEATURE_REQUIRED) {
    if (!flagOn(flag, defaultOn)) continue;
    for (const name of vars) consider(name);
  }

  return missing;
}
