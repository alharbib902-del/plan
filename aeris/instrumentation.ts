// Next.js instrumentation hook (REA-01 error monitoring).
//
// `register()` loads the runtime-appropriate Sentry init. `onRequestError`
// is the Next.js 15+ hook that captures errors thrown in Server
// Components, Server Actions, Route Handlers (incl. the cron routes
// under app/api/cron/*), and middleware — i.e. the whole server surface.
//
// All of this is a no-op when SENTRY_DSN is unset (see commonSentryOptions).
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    // Boot-time env presence check (REA ops monitoring). Run only in the
    // Node.js runtime — that is where the server-only secrets live (the edge
    // runtime has a restricted env) and where the `'server-only'` module is
    // importable. Reports a misconfigured deploy as ONE Sentry error; it never
    // throws, so a missing var can never crash boot (features fail-closed).
    const { findMissingRequiredEnv } = await import('./lib/config/env-validation');
    const missing = findMissingRequiredEnv();
    if (missing.length > 0) {
      Sentry.captureException(
        new Error(`Missing required env vars at boot: ${missing.join(', ')}`),
        { level: 'error', tags: { boot: true, env_validation: true } }
      );
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
