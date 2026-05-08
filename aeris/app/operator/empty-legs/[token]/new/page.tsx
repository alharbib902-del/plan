import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OperatorPublishForm } from '@/components/operator/empty-legs/operator-publish-form';
import { validateOperatorEmptyLegSession } from '@/lib/operator/empty-leg-session-store';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.operatorPortalNewLeg,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

export default async function OperatorEmptyLegNewPage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL !== 'true') {
    notFound();
  }

  const session = await validateOperatorEmptyLegSession(params.token);
  if (!session.ok) {
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

  return (
    <main dir="rtl" className="min-h-screen bg-navy">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href={`/operator/empty-legs/${params.token}`}
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          ← {emptyLegsAr.back}
        </Link>
        <h1 className="font-ar mt-2 mb-6 text-2xl text-ink sm:text-3xl">
          {emptyLegsAr.operatorPortalNewLeg}
        </h1>
        <OperatorPublishForm token={params.token} />
      </div>
    </main>
  );
}
