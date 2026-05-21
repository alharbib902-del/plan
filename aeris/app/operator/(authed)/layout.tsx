import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { requireOperatorSession } from '@/lib/operators/auth';
import { getOperatorRowById } from '@/lib/operators/session-store';
import { OperatorPortalShell } from '@/components/operator/portal-shell';

export const dynamic = 'force-dynamic';

const PASSWORD_PAGE = '/operator/profile/password';
// Logout is a route handler at /operator/logout (POST), and the
// authed layout never wraps a route handler — but we keep the
// path in the allowlist for documentation clarity.
const LOGOUT_ROUTE = '/operator/logout';

export default async function OperatorAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.ENABLE_OPERATOR_PORTAL === 'false') notFound();

  const session = await requireOperatorSession();
  const operator = await getOperatorRowById(session.operator_id);
  if (!operator) notFound();

  // Codex round 1 PR #42 P1 #1 fix: must-change-password
  // lockdown. A welcome-token / admin-reset operator can
  // otherwise navigate to any authed page before setting a
  // permanent password — server-side redirect ensures the
  // browser is forced to the password page regardless of how
  // the URL was entered (typed, bookmarked, deep-linked).
  if (session.password_must_change) {
    const pathname = (await headers()).get('x-pathname') ?? '';
    if (pathname !== PASSWORD_PAGE && pathname !== LOGOUT_ROUTE) {
      redirect(PASSWORD_PAGE);
    }
  }

  return (
    <OperatorPortalShell companyName={operator.company_name}>
      {children}
    </OperatorPortalShell>
  );
}
