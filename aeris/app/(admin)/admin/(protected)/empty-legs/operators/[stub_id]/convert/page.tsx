import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import {
  getStubById,
  listApprovedOperators,
  listLegsForStub,
} from '@/lib/admin/operators/queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { StubConvertForm } from '@/components/admin/operators/stub-convert-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.adminConvertTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { stub_id: string };
  searchParams?: { convert_target?: string };
}

export default async function AdminConvertStubPage({
  params,
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'false') {
    notFound();
  }

  const stub = await getStubById(params.stub_id);
  if (!stub) notFound();

  // If admin entered from /admin/operators/<id> with the
  // ?convert_target=<id> hint, pre-select the dropdown.
  const initialOperatorId = searchParams?.convert_target ?? null;

  const [candidateOperators, legsPreview] = await Promise.all([
    listApprovedOperators(),
    listLegsForStub(stub.id),
  ]);

  const isAlreadyArchived = stub.status === 'archived';

  return (
    <section>
      <nav className="font-ar mb-4 flex items-center gap-2 text-sm text-ink-muted">
        <Link href="/admin/empty-legs/operators" className="hover:text-gold-light">
          سجلّات المشغّلين
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span className="text-ink-secondary">{operatorsAr.adminConvertTitle}</span>
      </nav>

      <header className="mb-6">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.adminConvertTitle}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{stub.company_name}</p>
      </header>

      {isAlreadyArchived ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
          <p className="font-ar text-sm text-amber-100">
            {operatorsAr.errors.stub_already_archived}
          </p>
        </div>
      ) : (
        <StubConvertForm
          stub={stub}
          candidateOperators={candidateOperators}
          legsPreview={legsPreview}
          initialOperatorId={initialOperatorId}
        />
      )}
    </section>
  );
}
