import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PublishEmptyLegForm } from '@/components/admin/empty-legs/publish-form';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.pageNewTitle,
  robots: { index: false, follow: false },
};

export default function AdminEmptyLegsNewPage() {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

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
          {emptyLegsAr.formPublishTitle}
        </h1>
      </header>
      <PublishEmptyLegForm />
    </section>
  );
}
