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
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
