import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OperatorStubForm } from '@/components/admin/empty-legs/operator-stub-form';
import {
  formatDateTimeAr,
} from '@/components/admin/empty-legs/formatters';
import { listActiveOperatorStubs } from '@/lib/admin/empty-legs/queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.adminStubsPageTitle,
  robots: { index: false, follow: false },
};

export default async function AdminOperatorStubsPage() {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const stubs = await listActiveOperatorStubs();

  return (
    <section className="space-y-6">
      <header>
        <Link
          href="/admin/empty-legs"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          ← {emptyLegsAr.back}
        </Link>
        <h1 className="font-ar mt-2 text-2xl text-ink sm:text-3xl">
          {emptyLegsAr.adminStubsPageTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {emptyLegsAr.adminStubsPageSubtitle}
        </p>
      </header>

      <section className="rounded-xl border border-border bg-navy-card/30 p-4">
        <h2 className="font-ar mb-3 text-base text-ink">
          {emptyLegsAr.adminStubsCreateTitle}
        </h2>
        <OperatorStubForm />
      </section>

      {stubs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {emptyLegsAr.adminStubsTableEmpty}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-navy-card/40">
          <table className="w-full text-right">
            <thead className="border-b border-border bg-navy-secondary/60">
              <tr>
                <Th>{emptyLegsAr.adminStubsColCompany}</Th>
                <Th>{emptyLegsAr.adminStubsColEmail}</Th>
                <Th>{emptyLegsAr.adminStubsColPhone}</Th>
                <Th>{emptyLegsAr.adminStubsColCreated}</Th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {stubs.map((stub) => (
                <tr
                  key={stub.id}
                  className="border-t border-border/60 transition-colors hover:bg-navy-secondary/40"
                >
                  <td className="font-ar px-4 py-4 text-sm text-ink">
                    {stub.company_name}
                  </td>
                  <td className="px-4 py-4 text-sm text-ink-secondary">
                    {stub.contact_email ? (
                      <span dir="ltr">{stub.contact_email}</span>
                    ) : (
                      <span className="font-ar text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-sm text-ink-secondary">
                    {stub.contact_phone ? (
                      <span dir="ltr">{stub.contact_phone}</span>
                    ) : (
                      <span className="font-ar text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="font-ar px-4 py-4 text-xs text-ink-muted">
                    {formatDateTimeAr(stub.created_at)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      href={`/admin/empty-legs/operator-sessions?stub=${stub.id}`}
                      className="font-ar inline-flex items-center gap-1 text-sm text-gold-light transition-colors hover:text-gold"
                    >
                      {emptyLegsAr.adminStubsRowMint}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
    >
      {children}
    </th>
  );
}
