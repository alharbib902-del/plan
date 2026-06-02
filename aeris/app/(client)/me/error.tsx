'use client';

import { ErrorFallback } from '@/components/errors/error-fallback';

/**
 * Client-portal (/me) error boundary. Keeps a failing authed page
 * inside the brand and offers a route back into the account area
 * rather than the public home.
 */
export default function MeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      homeHref="/me"
      homeLabel="العودة إلى حسابي"
    />
  );
}
