import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyLegsTable } from '@/components/admin/empty-legs/leg-row';
import { listEmptyLegsForStub } from '@/lib/admin/empty-legs/queries';
import { validateOperatorEmptyLegSession } from '@/lib/operator/empty-leg-session-store';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.operatorPortalTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

export default async function OperatorEmptyLegsListPage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL !== 'true') {
    notFound();
  }

  const session = await validateOperatorEmptyLegSession(params.token);
  if (!session.ok) {
    return <SessionInvalidNotice />;
  }

  const legs = await listEmptyLegsForStub(session.operatorStubId, 200);

  return (
    <main dir="rtl" className="min-h-screen bg-navy">
      <header className="border-b border-border bg-navy-secondary/85 backdrop-blur-luxury">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <span className="font-display text-xl tracking-[0.28em] text-gold-light">
            AERIS
          </span>
          <Link
            href={`/operator/empty-legs/${params.token}/new`}
            className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/15"
          >
            {emptyLegsAr.operatorPortalNewLeg}
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-ar mb-6 text-2xl text-ink sm:text-3xl">
          {emptyLegsAr.operatorPortalTitle}
        </h1>
        <EmptyLegsTable
          legs={legs}
          getLegHref={(leg) =>
            `/operator/empty-legs/${params.token}/${leg.id}`
          }
        />
      </section>
    </main>
  );
}

function SessionInvalidNotice() {
  return (
    <main dir="rtl" className="min-h-screen bg-navy">
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full rounded-2xl border border-red-400/40 bg-red-500/10 p-8 text-center">
          <h1 className="font-ar text-xl text-red-200">
            {emptyLegsAr.operatorPortalSessionInvalid}
          </h1>
        </div>
      </div>
    </main>
  );
}
