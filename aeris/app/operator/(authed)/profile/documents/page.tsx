import type { Metadata } from 'next';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorDocuments } from '@/lib/admin/operators/queries';
import { DocumentList } from '@/components/admin/operators/document-list';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.documents.title,
  robots: { index: false, follow: false },
};

export default async function OperatorDocumentsPage() {
  const session = await requireOperatorSession();
  const documents = await listOperatorDocuments(session.operator_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.documents.title}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {documents.length === 0
            ? operatorsAr.portal.documents.empty
            : `${documents.length} وثيقة مرفوعة`}
        </p>
      </header>

      <DocumentList documents={documents} />
    </section>
  );
}
