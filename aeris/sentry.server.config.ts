// Sentry server-runtime init (REA-01). Loaded by `instrumentation.ts`
// when NEXT_RUNTIME === 'nodejs'. No-op when SENTRY_DSN is unset.
import * as Sentry from '@sentry/nextjs';

import { commonSentryOptions } from '@/lib/monitoring/sentry-options';

Sentry.init({
  ...commonSentryOptions(),
});
