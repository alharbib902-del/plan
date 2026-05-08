import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SessionMintForm } from '@/components/admin/empty-legs/session-mint-form';
import { listActiveOperatorStubs } from '@/lib/admin/empty-legs/queries';
import { resolveSiteUrl } from '@/lib/checkout/site-url';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.adminSessionsPageTitle,
  robots: { index: false, follow: false },
};

export default async function AdminOperatorSessionsPage() {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const stubs = await listActiveOperatorStubs();
  const siteUrl = resolveSiteUrl();

  return (
    <section className="space-y-6">
      <header>
        <Link
          href="/admin/empty-legs/operators"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          ← {emptyLegsAr.back}
        </Link>
        <h1 className="font-ar mt-2 text-2xl text-ink sm:text-3xl">
          {emptyLegsAr.adminSessionsPageTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {emptyLegsAr.adminSessionsPageSubtitle}
        </p>
      </header>

      <SessionMintForm stubs={stubs} siteUrl={siteUrl} />
    </section>
  );
}
