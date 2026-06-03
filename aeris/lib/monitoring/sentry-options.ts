import type { ErrorEvent, EventHint } from '@sentry/nextjs';

/**
 * Aeris error monitoring (REA-01) — shared Sentry option helpers.
 *
 * Pure, framework-agnostic helpers shared by the three `Sentry.init()`
 * sites (server / edge / client). Keeping the DSN gating + PII
 * scrubbing here — instead of inline in each config — means the
 * security-critical scrubber lives in ONE unit-tested place
 * (`__tests__/sentry-options.test.ts`).
 *
 * No DSN  →  Sentry runs fully disabled: no network, no overhead.
 */

/**
 * The DSN is resolved from env only — never hard-coded. The browser
 * needs the `NEXT_PUBLIC_` copy (inlined at build time); the server can
 * use either. Absent / blank → monitoring is a no-op.
 */
export function resolveSentryDsn(): string | undefined {
  const dsn = (
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    process.env.SENTRY_DSN ??
    ''
  ).trim();
  return dsn ? dsn : undefined;
}

export function sentryEnabled(): boolean {
  return resolveSentryDsn() !== undefined;
}

export function sentryEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  );
}

/**
 * Tracing is OFF by default — this is error monitoring, and a zero
 * default keeps cost predictable. Tunable via SENTRY_TRACES_SAMPLE_RATE
 * in [0, 1]; anything missing or invalid falls back to 0.
 */
export function sentryTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
}

// --- PII scrubbing ---------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Saudi mobile, incl. space-/dash-separated groupings:
//   +9665XXXXXXXX | 009665XXXXXXXX | 05XXXXXXXX | +966 55 123 4567 | 055-123-4567
const SAUDI_PHONE_RE = /(?:\+?966|00966|0)[\s-]?5(?:[\s-]?\d){8}/g;
const REDACTED = '[redacted]';

/** Redact emails + Saudi phone numbers from a free-text string. */
export function redactPii(text: string): string {
  return text.replace(EMAIL_RE, REDACTED).replace(SAUDI_PHONE_RE, REDACTED);
}

const SENSITIVE_HEADER_RE = /^(cookie|set-cookie|authorization|x-)/i;

/**
 * Depth cap for the recursive redactor — bounds work on large events and
 * is a second guard (alongside the cycle set) against pathological nesting.
 */
const REDACT_MAX_DEPTH = 8;
// Substituted for any object/array nested past the depth cap so a deep subtree
// can never carry an un-scrubbed PII string out of the redactor.
const DEPTH_CAPPED = '[depth-capped]';

function redactDeepInner(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string') return redactPii(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value; // cycle: node is already being scrubbed
  if (depth >= REDACT_MAX_DEPTH) return DEPTH_CAPPED; // too deep: drop to safe value
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = redactDeepInner(value[i], depth + 1, seen);
    }
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    record[key] = redactDeepInner(record[key], depth + 1, seen);
  }
  return value;
}

/**
 * Recursively redact emails / phone numbers from every string nested in a
 * structured value (objects + arrays). Mutates in place and returns the
 * value, so it is safe on string fields (reassign the result) and on
 * object/array fields (mutated in place). Depth-capped + cycle-safe.
 */
export function redactDeep<T>(value: T): T {
  return redactDeepInner(value, 0, new WeakSet<object>()) as T;
}

/**
 * `beforeSend` hook: defence-in-depth PII scrubbing applied to every event
 * before it leaves the process. Combined with `sendDefaultPii: false`, this
 * strips cookies + auth headers and recursively redacts emails / phone
 * numbers from every field that can carry user data — request url / query /
 * body, user identifiers, message + logentry, extra, contexts, exception
 * values + stack-frame locals, and breadcrumb messages + data.
 */
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  // 1. Request: drop cookies + sensitive headers; scrub url / query / body.
  const req = event.request;
  if (req) {
    delete req.cookies;
    if (req.headers) {
      for (const key of Object.keys(req.headers)) {
        if (SENSITIVE_HEADER_RE.test(key)) delete req.headers[key];
      }
    }
    if (typeof req.query_string === 'string') {
      req.query_string = redactPii(req.query_string);
    } else if (req.query_string !== undefined && req.query_string !== null) {
      req.query_string = redactDeep(req.query_string);
    }
    if (typeof req.url === 'string') req.url = redactPii(req.url);
    if (req.data !== undefined && req.data !== null) {
      req.data = redactDeep(req.data);
    }
  }

  // 2. User identifiers: drop the standard PII keys outright, then deep-scrub
  //    whatever custom fields remain.
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
    redactDeep(event.user);
  }

  // 3. Free-text + structured payloads that can carry PII.
  if (typeof event.message === 'string') {
    event.message = redactPii(event.message);
  }
  if (event.logentry) {
    if (typeof event.logentry.message === 'string') {
      event.logentry.message = redactPii(event.logentry.message);
    }
    if (event.logentry.params) redactDeep(event.logentry.params);
  }
  if (event.extra) redactDeep(event.extra);
  if (event.contexts) redactDeep(event.contexts);

  // 4. Exceptions: message text + any captured stack-frame local variables.
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = redactPii(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame.vars) redactDeep(frame.vars);
    }
  }

  // 5. Breadcrumbs: message text + structured data payloads.
  for (const bc of event.breadcrumbs ?? []) {
    if (typeof bc.message === 'string') bc.message = redactPii(bc.message);
    if (bc.data) redactDeep(bc.data);
  }

  return event;
}

/**
 * Common `Sentry.init` options shared across server / edge / client.
 * Spread into each runtime's init alongside any runtime specifics.
 */
export interface CommonSentryOptions {
  dsn: string | undefined;
  enabled: boolean;
  environment: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: typeof scrubEvent;
}

export function commonSentryOptions(): CommonSentryOptions {
  return {
    dsn: resolveSentryDsn(),
    enabled: sentryEnabled(),
    environment: sentryEnvironment(),
    tracesSampleRate: sentryTracesSampleRate(),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  };
}
