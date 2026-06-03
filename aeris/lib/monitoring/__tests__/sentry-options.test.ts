import assert from 'node:assert/strict';

import type { ErrorEvent } from '@sentry/nextjs';

import {
  commonSentryOptions,
  redactDeep,
  redactPii,
  resolveSentryDsn,
  scrubEvent,
  sentryEnabled,
  sentryEnvironment,
  sentryTracesSampleRate,
} from '../sentry-options';

/**
 * REA-01 error monitoring. The DSN gating (no DSN → fully disabled) and
 * the `beforeSend` PII scrubber are security-critical, so they are
 * exercised here rather than left to integration-only coverage.
 */

function makeEvent(partial: Partial<ErrorEvent>): ErrorEvent {
  return partial as ErrorEvent;
}

// --- DSN gating ------------------------------------------------------

delete process.env.NEXT_PUBLIC_SENTRY_DSN;
delete process.env.SENTRY_DSN;
assert.equal(resolveSentryDsn(), undefined);
assert.equal(sentryEnabled(), false);

// server-only DSN is honoured
process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
assert.equal(resolveSentryDsn(), 'https://abc@o1.ingest.sentry.io/1');
assert.equal(sentryEnabled(), true);

// NEXT_PUBLIC_ wins for the browser bundle
process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://pub@o2.ingest.sentry.io/2';
assert.equal(resolveSentryDsn(), 'https://pub@o2.ingest.sentry.io/2');

// a blank value is treated as absent
delete process.env.SENTRY_DSN;
process.env.NEXT_PUBLIC_SENTRY_DSN = '   ';
assert.equal(resolveSentryDsn(), undefined);
assert.equal(sentryEnabled(), false);
delete process.env.NEXT_PUBLIC_SENTRY_DSN;

// --- traces sample rate ---------------------------------------------

delete process.env.SENTRY_TRACES_SAMPLE_RATE;
assert.equal(sentryTracesSampleRate(), 0);
process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
assert.equal(sentryTracesSampleRate(), 0.25);
process.env.SENTRY_TRACES_SAMPLE_RATE = '2'; // out of [0,1] → 0
assert.equal(sentryTracesSampleRate(), 0);
process.env.SENTRY_TRACES_SAMPLE_RATE = 'abc'; // not a number → 0
assert.equal(sentryTracesSampleRate(), 0);
delete process.env.SENTRY_TRACES_SAMPLE_RATE;

// --- redactPii -------------------------------------------------------

assert.equal(redactPii('contact me@example.com now'), 'contact [redacted] now');
assert.equal(redactPii('call +966512345678'), 'call [redacted]');
assert.equal(redactPii('call 0512345678'), 'call [redacted]');
assert.equal(redactPii('call +966 55 123 4567'), 'call [redacted]'); // spaced
assert.equal(redactPii('call 055-123-4567'), 'call [redacted]'); // dashed
assert.equal(redactPii('booking ABC-123 ok'), 'booking ABC-123 ok'); // untouched

// --- scrubEvent ------------------------------------------------------

const event = makeEvent({
  request: {
    cookies: { session: 'secret-token' },
    headers: {
      'content-type': 'application/json',
      cookie: 'aeris_client=abc',
      authorization: 'Bearer xyz',
      'x-real-ip': '203.0.113.7',
    },
    url: 'https://aeris.sa/me?email=user@example.com',
    query_string: 'email=user@example.com',
    data: { email: 'body@example.com', note: 'call 0512345678' },
  },
  user: {
    id: 'u1',
    email: 'user@example.com',
    ip_address: '203.0.113.7',
    username: 'fulan',
    note: 'reach me@example.com',
  },
  message: 'login failed for user@example.com from 0512345678',
  logentry: { message: 'tmpl log@example.com', params: ['p@example.com'] },
  extra: {
    detail: 'extra ex@example.com',
    nested: { phone: '+966512345678' },
  },
  contexts: { custom: { field: 'ctx@example.com' } },
  exception: {
    values: [
      {
        type: 'Error',
        value: 'reach me@example.com',
        stacktrace: {
          frames: [
            { function: 'handler', vars: { local: 'frame@example.com' } },
          ],
        },
      },
    ],
  },
  breadcrumbs: [
    { message: 'notified ops@example.com', data: { who: 'crumb@example.com' } },
  ],
});

scrubEvent(event);

// cookies dropped entirely
assert.equal(event.request?.cookies, undefined);
// sensitive headers dropped, benign header kept
assert.equal(event.request?.headers?.cookie, undefined);
assert.equal(event.request?.headers?.authorization, undefined);
assert.equal(event.request?.headers?.['x-real-ip'], undefined);
assert.equal(event.request?.headers?.['content-type'], 'application/json');
// url + query scrubbed
assert.equal(event.request?.url, 'https://aeris.sa/me?email=[redacted]');
assert.equal(event.request?.query_string, 'email=[redacted]');
// message, exception value, breadcrumb scrubbed
assert.equal(event.message, 'login failed for [redacted] from [redacted]');
assert.equal(event.exception?.values?.[0]?.value, 'reach [redacted]');
assert.equal(event.breadcrumbs?.[0]?.message, 'notified [redacted]');
// returns the same event reference
assert.equal(scrubEvent(event), event);

// request body (data) deep-scrubbed
const reqData = event.request?.data as Record<string, unknown> | undefined;
assert.equal(reqData?.email, '[redacted]');
assert.equal(reqData?.note, 'call [redacted]');

// user: standard PII keys dropped outright, non-PII id kept, custom field scrubbed
const user = event.user as Record<string, unknown> | undefined;
assert.equal(user?.email, undefined);
assert.equal(user?.ip_address, undefined);
assert.equal(user?.username, undefined);
assert.equal(user?.id, 'u1');
assert.equal(user?.note, 'reach [redacted]');

// logentry message + params
assert.equal(event.logentry?.message, 'tmpl [redacted]');
assert.equal(event.logentry?.params?.[0], '[redacted]');

// extra (incl. nested) + contexts
const extra = event.extra as Record<string, unknown> | undefined;
assert.equal(extra?.detail, 'extra [redacted]');
const extraNested = extra?.nested as Record<string, unknown> | undefined;
assert.equal(extraNested?.phone, '[redacted]');
const ctx = event.contexts?.custom as Record<string, unknown> | undefined;
assert.equal(ctx?.field, '[redacted]');

// stack-frame local variables
const frameVars = event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars as
  | Record<string, unknown>
  | undefined;
assert.equal(frameVars?.local, '[redacted]');

// breadcrumb structured data
const bcData = event.breadcrumbs?.[0]?.data as
  | Record<string, unknown>
  | undefined;
assert.equal(bcData?.who, '[redacted]');

// non-string query_string (Sentry allows object / array) is deep-scrubbed
const objQueryEvent = makeEvent({
  request: { query_string: { email: 'user@example.com' } },
});
scrubEvent(objQueryEvent);
const objQuery = objQueryEvent.request?.query_string as
  | Record<string, unknown>
  | undefined;
assert.equal(objQuery?.email, '[redacted]');

// --- redactDeep ------------------------------------------------------

// nested objects + arrays; non-strings untouched
const deep = redactDeep({
  a: 'plain',
  b: 'mail d@example.com',
  c: { d: ['x', 'phone 0512345678'], e: 42 },
});
assert.equal(deep.a, 'plain');
assert.equal(deep.b, 'mail [redacted]');
assert.equal(deep.c.d[1], 'phone [redacted]');
assert.equal(deep.c.e, 42);

// cycle-safe: a self-referential object must not hang or throw
const cyclic: Record<string, unknown> = { who: 'cyc@example.com' };
cyclic.self = cyclic;
const scrubbed = redactDeep(cyclic);
assert.equal(scrubbed.who, '[redacted]');
assert.equal(scrubbed.self, cyclic);

// depth cap: PII nested past REDACT_MAX_DEPTH (8) must not leak — the deep
// subtree is replaced with a safe placeholder, so the raw value never ships.
let nested: Record<string, unknown> = { email: 'deep@example.com' };
for (let i = 0; i < 12; i += 1) nested = { nested };
assert.equal(
  JSON.stringify(redactDeep(nested)).includes('deep@example.com'),
  false
);

// --- commonSentryOptions --------------------------------------------

delete process.env.SENTRY_DSN;
process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://k@o9.ingest.sentry.io/9';
process.env.NEXT_PUBLIC_VERCEL_ENV = 'production';
const opts = commonSentryOptions();
assert.equal(opts.enabled, true);
assert.equal(opts.dsn, 'https://k@o9.ingest.sentry.io/9');
assert.equal(opts.environment, 'production');
assert.equal(opts.sendDefaultPii, false);
assert.equal(opts.tracesSampleRate, 0);
assert.equal(opts.beforeSend, scrubEvent);
assert.equal(sentryEnvironment(), 'production');
delete process.env.NEXT_PUBLIC_SENTRY_DSN;
delete process.env.NEXT_PUBLIC_VERCEL_ENV;

console.log('sentry-options.test: all assertions passed');
