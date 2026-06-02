'use client';

import { ErrorFallback } from '@/components/errors/error-fallback';

/**
 * Admin (protected) error boundary. Routes back to the admin trips
 * board instead of the public home. NOTE: Next.js re-throws the
 * NEXT_REDIRECT from requireAdminSession()'s auth/MFA/rotation gates,
 * so this boundary never swallows those redirects — it only catches
 * genuine render/data errors.
 */
export default function AdminError({
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
      homeHref="/admin/trips"
      homeLabel="العودة إلى لوحة الإدارة"
    />
  );
}
