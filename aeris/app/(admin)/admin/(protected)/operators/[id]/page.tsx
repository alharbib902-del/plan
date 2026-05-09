import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { getOperatorById } from '@/lib/admin/operators/queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { OperatorStatusBadge } from '@/components/admin/operators/status-badge';
import { OperatorDetailPending } from '@/components/admin/operators/operator-detail-pending';
import { OperatorDetailApproved } from '@/components/admin/operators/operator-detail-approved';
import { OperatorDetailSuspended } from '@/components/admin/operators/operator-detail-suspended';
import { OperatorDetailRejected } from '@/components/admin/operators/operator-detail-rejected';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.adminDetailTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default async function AdminOperatorDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'false') {
    notFound();
  }

  const operator = await getOperatorById(params.id);
  if (!operator) notFound();

  return (
    <section>
      {/* Breadcrumb */}
      <nav className="font-ar mb-4 flex items-center gap-2 text-sm text-ink-muted">
        <Link href="/admin/operators" className="hover:text-gold-light">
          {operatorsAr.adminListTitle}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span className="text-ink-secondary">{operator.company_name}</span>
      </nav>

      {/* Header */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {operator.company_name}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            <span dir="ltr">{operator.auth_email}</span>
          </p>
        </div>
        <OperatorStatusBadge status={operator.signup_status} />
      </header>

      {/* Identity card */}
      <section className="mb-6 grid gap-3 rounded-xl border border-border bg-navy-card/40 p-5 md:grid-cols-3">
        <div>
          <p className="font-ar text-xs text-ink-muted">{operatorsAr.fields.contact_email}</p>
          <p dir="ltr" className="text-sm text-ink-primary">{operator.contact_email}</p>
        </div>
        <div>
          <p className="font-ar text-xs text-ink-muted">{operatorsAr.fields.contact_phone}</p>
          <p dir="ltr" className="text-sm text-ink-primary">{operator.contact_phone}</p>
        </div>
        <div>
          <p className="font-ar text-xs text-ink-muted">{operatorsAr.fields.created_at}</p>
          <p className="font-ar text-sm text-ink-primary">{formatDate(operator.created_at)}</p>
        </div>
        <div>
          <p className="font-ar text-xs text-ink-muted">{operatorsAr.fields.last_login_at}</p>
          <p className="font-ar text-sm text-ink-primary">{formatDate(operator.last_login_at)}</p>
        </div>
        {operator.approved_at ? (
          <div>
            <p className="font-ar text-xs text-ink-muted">{operatorsAr.fields.approved_at}</p>
            <p className="font-ar text-sm text-ink-primary">{formatDate(operator.approved_at)}</p>
          </div>
        ) : null}
        {operator.commercial_registration ? (
          <div>
            <p className="font-ar text-xs text-ink-muted">{operatorsAr.fields.commercial_registration}</p>
            <p className="font-ar text-sm text-ink-primary">{operator.commercial_registration}</p>
          </div>
        ) : null}
      </section>

      {/* Status-specific actions */}
      {operator.signup_status === 'pending' ? (
        <OperatorDetailPending operator={operator} />
      ) : operator.signup_status === 'approved' ? (
        <OperatorDetailApproved operator={operator} />
      ) : operator.signup_status === 'suspended' ? (
        <OperatorDetailSuspended operator={operator} />
      ) : (
        <OperatorDetailRejected operator={operator} />
      )}
    </section>
  );
}
