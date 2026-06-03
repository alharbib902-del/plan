// Sentry browser-runtime init (REA-01). Next.js 15.3+/16 loads this
// file on the client automatically. No-op when NEXT_PUBLIC_SENTRY_DSN
// is unset.
import * as Sentry from '@sentry/nextjs';

import { commonSentryOptions } from '@/lib/monitoring/sentry-options';

Sentry.init({
  ...commonSentryOptions(),
});

// Ties client-side errors to the navigation that produced them.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
