'use client';

import { ErrorFallback } from '@/components/errors/error-fallback';

/**
 * Operator-portal error boundary. Routes back to the operator
 * dashboard instead of the public home.
 */
export default function OperatorError({
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
      homeHref="/operator/dashboard"
      homeLabel="العودة إلى لوحة المشغّل"
    />
  );
}
