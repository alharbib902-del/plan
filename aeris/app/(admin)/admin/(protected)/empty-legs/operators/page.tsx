import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OperatorStubForm } from '@/components/admin/empty-legs/operator-stub-form';
import {
  formatDateTimeAr,
} from '@/components/admin/empty-legs/formatters';
import { listActiveOperatorStubs } from '@/lib/admin/empty-legs/queries';
import { getOperatorById } from '@/lib/admin/operators/queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.adminStubsPageTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  // Codex round 3 PR #41 P2 fix: when admin enters this page
  // from the approved-operator detail CTA we receive the
  // target operator id via `?convert_target=<id>`. We surface
  // a banner naming the operator + propagate the param onto
  // each stub's Convert link so the convert page lands with
  // the target pre-selected.
  searchParams?: Promise<{ convert_target?: string }>;
}

export default async function AdminOperatorStubsPage({
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const convertTargetId =
    ((await searchParams) ?? {}).convert_target ?? null;
  const convertTargetOperator =
    convertTargetId && process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'true'
      ? await getOperatorById(convertTargetId)
      : null;
  const convertModeEnabled =
    process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'true';

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

      {convertTargetId && convertModeEnabled ? (
        <div className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3">
          <p className="font-ar text-sm text-gold-light">
            {convertTargetOperator
              ? operatorsAr.conversion.convertModeBanner(
                  convertTargetOperator.company_name
                )
              : operatorsAr.conversion.convertModeBannerNoName}
          </p>
        </div>
      ) : null}

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
        <div className="overflow-x-auto rounded-xl border border-border bg-navy-card/40">
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
                  <td className="px-4 py-4 text-end">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Link
                        href={`/admin/empty-legs/operator-sessions?stub=${stub.id}`}
                        className="font-ar inline-flex items-center gap-1 text-sm text-gold-light transition-colors hover:text-gold"
                      >
                        {emptyLegsAr.adminStubsRowMint}
                      </Link>
                      {convertModeEnabled ? (
                        <Link
                          href={
                            convertTargetId
                              ? `/admin/empty-legs/operators/${stub.id}/convert?convert_target=${convertTargetId}`
                              : `/admin/empty-legs/operators/${stub.id}/convert`
                          }
                          className="font-ar inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-3 py-1 text-xs text-gold-light transition-colors hover:bg-gold/20"
                        >
                          {operatorsAr.conversion.rowConvertLink}
                        </Link>
                      ) : null}
                    </div>
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
