import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { getShieldConfig } from '@/lib/medevac/queries/admin-subscriptions';
import { ShieldConfigForm } from '@/components/admin/medevac/shield-config-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'إعدادات Aeris Shield',
  robots: { index: false, follow: false },
};

type LooseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

interface OperatorRow {
  id: string;
  company_name: string | null;
}

export default async function ShieldConfigPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const config = await getShieldConfig();

  const loose = createAdminClient() as unknown as LooseAdmin;
  const operatorsResult = await loose
    .from('operators')
    .select('id, company_name')
    .eq('signup_status', 'approved')
    .order('company_name', { ascending: true });

  const operators = (
    (operatorsResult.data ?? []) as OperatorRow[]
  ).map((op) => ({
    id: op.id,
    label: op.company_name ?? op.id.slice(0, 8),
  }));

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          إعدادات Aeris Shield
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          المشغل الافتراضي يستقبل جميع أحداث Shield المُغطَّاة (D14).
          يجب أن يكون معتمداً وله طائرة بشهادة طبية سارية مناسبة لكل
          مستوى خدمة.
        </p>
      </header>

      <ShieldConfigForm
        operators={operators}
        currentOperatorId={config?.default_operator_id ?? null}
        currentFounderEmail={config?.founder_notification_email ?? null}
      />
    </section>
  );
}
