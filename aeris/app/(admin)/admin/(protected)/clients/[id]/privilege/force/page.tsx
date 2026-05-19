import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ForceTierForm } from '@/components/admin/privilege/force-tier-form';
import { privilegeAr } from '@/lib/i18n/privilege-ar';
import { readAdminClientPrivilegeDetail } from '@/lib/privilege/admin-pii';

/**
 * Phase 13 PR 1 — /admin/clients/[id]/privilege/force.
 *
 * Loads current tier (audited) so the form can highlight the
 * current selection + warn on no-op force.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: privilegeAr.adminForceTitle,
  robots: { index: false, follow: false },
};

export default async function AdminPrivilegeForcePage({
  params,
}: {
  params: { id: string };
}) {
  if (process.env.ENABLE_PRIVILEGE !== 'true') notFound();

  const detail = await readAdminClientPrivilegeDetail(params.id);
  if (!detail) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="font-ar text-2xl text-ink-primary">
          {privilegeAr.forceFormHeader}
        </h1>
        <p className="font-ar text-sm text-ink-secondary">
          {privilegeAr.forceFormDescription}
        </p>
        <p className="font-ar text-xs text-ink-secondary">
          العميل: <strong>{detail.client.full_name}</strong> ·{' '}
          المستوى الحالي: <strong>{privilegeAr.tier[detail.client.privilege_tier]}</strong>
        </p>
      </header>

      <ForceTierForm
        clientId={detail.client.id}
        currentTier={detail.client.privilege_tier}
      />
    </main>
  );
}
