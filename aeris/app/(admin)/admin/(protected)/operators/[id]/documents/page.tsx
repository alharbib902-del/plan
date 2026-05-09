import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import {
  getOperatorById,
  listOperatorDocuments,
} from '@/lib/admin/operators/queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { DocumentUploadForm } from '@/components/admin/operators/document-upload-form';
import { DocumentList } from '@/components/admin/operators/document-list';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.adminDocumentsTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

export default async function AdminOperatorDocumentsPage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'false') {
    notFound();
  }

  const operator = await getOperatorById(params.id);
  if (!operator) notFound();

  const documents = await listOperatorDocuments(operator.id);

  return (
    <section>
      <nav className="font-ar mb-4 flex items-center gap-2 text-sm text-ink-muted">
        <Link href="/admin/operators" className="hover:text-gold-light">
          {operatorsAr.adminListTitle}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <Link
          href={`/admin/operators/${operator.id}`}
          className="hover:text-gold-light"
        >
          {operator.company_name}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span className="text-ink-secondary">{operatorsAr.adminDocumentsTitle}</span>
      </nav>

      <header className="mb-6">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.adminDocumentsTitle}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{operator.company_name}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <h2 className="font-ar mb-3 text-base font-medium text-ink-primary">
            الوثائق المرفوعة
          </h2>
          <DocumentList documents={documents} />
        </div>
        <DocumentUploadForm operatorId={operator.id} />
      </div>
    </section>
  );
}
