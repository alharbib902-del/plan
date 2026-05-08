import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OptOutConfirmButton } from '@/components/public/empty-legs/opt-out-confirm-button';
import { verifyOptOutToken } from '@/lib/empty-legs/opt-out-token';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.publicOptOutTitle,
};

interface PageProps {
  params: { token: string };
}

export default function PublicEmptyLegsOptOutPage({ params }: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true') {
    notFound();
  }

  // Layer-1 HMAC verification at render time. The user
  // sees an immediate error if the URL is malformed or
  // the signature has been tampered with — no DB write
  // happens until they click confirm. The confirm
  // Server Action re-verifies before updating
  // lead_inquiries (defense in depth).
  const verified = verifyOptOutToken(params.token);

  return (
    <section className="mx-auto max-w-md px-4 pb-16 pt-28 sm:px-6">
      <h1 className="font-ar text-3xl text-ink sm:text-4xl">
        {emptyLegsAr.publicOptOutTitle}
      </h1>

      {verified.valid ? (
        <>
          <p className="font-ar mt-2 text-base text-ink-secondary">
            {emptyLegsAr.publicOptOutHint}
          </p>
          <div className="mt-6">
            <OptOutConfirmButton token={params.token} />
          </div>
        </>
      ) : (
        <p
          role="alert"
          className="font-ar mt-6 rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {emptyLegsAr.publicOptOutInvalid}
        </p>
      )}
    </section>
  );
}
