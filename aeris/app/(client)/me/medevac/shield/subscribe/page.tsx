import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { getAerisShieldPlanTerms } from '@/lib/medevac/plan-terms';
import { ShieldSubscribeForm } from '@/components/medevac/shield-subscribe-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'الاشتراك في Aeris Shield',
  robots: { index: false, follow: false },
};

export default async function ShieldSubscribePage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const session = await requireClientSession();
  if (!session) redirect('/login?next=/me/medevac/shield/subscribe');

  const plans = await getAerisShieldPlanTerms();
  if (plans.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          الاشتراك في Aeris Shield
        </h1>
        <p className="font-ar text-sm text-rose-300">
          تعذّر تحميل خطط الاشتراك. حاول لاحقاً أو تواصل مع الدعم.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          الاشتراك في Aeris Shield
        </h1>
        <p className="font-ar text-sm text-ink-secondary">
          اشتراك سنوي يغطي عدداً من أحداث الإخلاء الطبي بدون الحاجة لعروض
          المشغلين. الاشتراك يبدأ في حالة &quot;بانتظار الدفع&quot; حتى يفعّله الفريق
          بعد تأكيد الدفع.
        </p>
      </header>

      <ShieldSubscribeForm plans={plans} />
    </section>
  );
}
