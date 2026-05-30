import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { listMyShieldSubscriptions } from '@/lib/medevac/queries/me-shield';
import { MedevacAuthedForm } from '@/components/medevac/medevac-authed-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'طلب إخلاء طبي جديد',
  robots: { index: false, follow: false },
};

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export default async function NewMyMedevacPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const session = await requireClientSession();
  if (!session) redirect('/login?next=/me/medevac/new');

  // Pull the client's default contact details + look up the
  // single active Shield subscription (if any) for the Shield
  // toggle.
  const loose = createAdminClient() as unknown as LooseClient;
  const { data: clientRow } = await loose
    .from('clients')
    .select('full_name, contact_phone')
    .eq('id', session.client_id)
    .maybeSingle();
  const client = (clientRow as
    | { full_name?: string | null; contact_phone?: string | null }
    | null);

  const subs = await listMyShieldSubscriptions(session.client_id);
  const activeSubscription = subs.find((s) => s.status === 'active') ?? null;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          طلب إخلاء طبي جديد
        </h1>
        <p className="font-ar text-sm text-ink-secondary">
          الحالات المتوسطة والحرجة متاحة للعملاء المسجلين. سيتم إشعار
          المشغلين الطبيين المعتمدين خلال 24 ساعة كحد أقصى.
        </p>
      </header>

      <MedevacAuthedForm
        activeSubscription={activeSubscription}
        defaultClientName={client?.full_name ?? ''}
        defaultClientPhone={client?.contact_phone ?? ''}
      />
    </section>
  );
}
