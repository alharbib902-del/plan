import { notFound } from 'next/navigation';

import { requireOperatorSession } from '@/lib/operators/auth';
import { getOperatorRowById } from '@/lib/operators/session-store';
import { OperatorPortalShell } from '@/components/operator/portal-shell';

export const dynamic = 'force-dynamic';

export default async function OperatorAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.ENABLE_OPERATOR_PORTAL === 'false') notFound();

  const session = await requireOperatorSession();
  const operator = await getOperatorRowById(session.operator_id);
  if (!operator) notFound();

  return (
    <OperatorPortalShell companyName={operator.company_name}>
      {children}
    </OperatorPortalShell>
  );
}
