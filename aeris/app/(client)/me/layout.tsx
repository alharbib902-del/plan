import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ClientShell } from '@/components/clients/client-shell';
import { requireClientSession } from '@/lib/clients/auth';

/**
 * Phase 9 PR 1 — protected layout for `/me/*`.
 *
 * `requireClientSession()` redirects to `/login` if there is
 * no valid session cookie, so every child page below this
 * layout is auth-gated by default. The session context is
 * passed to ClientShell for the header `fullName` display.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ClientAuthedLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (process.env.ENABLE_CLIENT_PORTAL === 'false') notFound();
  const session = await requireClientSession();
  return <ClientShell fullName={session.full_name}>{children}</ClientShell>;
}
