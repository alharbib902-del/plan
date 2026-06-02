'use client';

import { ErrorFallback } from '@/components/errors/error-fallback';

/**
 * Root error boundary. Catches render/data errors thrown anywhere in
 * the app subtree (below the root layout). Errors in the root layout
 * itself are caught by app/global-error.tsx instead.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}
