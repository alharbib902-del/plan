import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { listOpenMedevacRequestsForOperator } from '@/lib/medevac/queries/operator-list';
import type {
  MedevacRequestRedactedRow,
  MedevacSeverity,
} from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'طلبات الإخلاء الطبي المفتوحة',
  robots: { index: false, follow: false },
};

const SEVERITY: Record<MedevacSeverity, { label: string; cls: string }> = {
  critical: {
    label: 'حرج',
    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  moderate: {
    label: 'متوسط',
    cls: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  },
  stable: {
    label: 'مستقر',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
};

function routeLabel(r: MedevacRequestRedactedRow): string {
  const dep = r.from_iata ?? r.from_location_freeform ?? '—';
  const arr = r.to_iata ?? r.to_hospital_name ?? '—';
  return `${dep} → ${arr}`;
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function OperatorMedevacQueuePage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const rows = await listOpenMedevacRequestsForOperator();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          طلبات الإخلاء الطبي المفتوحة
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          العرض هنا مُخفَّى عن بيانات المريض (الاسم والعمر) — تظهر بعد
          قبول العرض فقط. اختر طلباً لتقديم عرض.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            لا توجد طلبات مفتوحة حالياً.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="font-ar w-full text-right text-sm">
            <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
              <tr>
                <Th>رقم الطلب</Th>
                <Th>الحالة</Th>
                <Th>المستوى</Th>
                <Th>المسار</Th>
                <Th>الإنشاء</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border/60 hover:bg-navy-secondary/40"
                >
                  <Td>
                    <span dir="ltr" className="font-mono text-ink-primary">
                      {row.medevac_request_number}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        SEVERITY[row.condition_severity]?.cls ?? ''
                      }`}
                    >
                      {SEVERITY[row.condition_severity]?.label ??
                        row.condition_severity}
                    </span>
                  </Td>
                  <Td>
                    <span dir="ltr">{row.service_level}</span>
                  </Td>
                  <Td>
                    <span dir="ltr">{routeLabel(row)}</span>
                  </Td>
                  <Td>{fmtDate(row.created_at)}</Td>
                  <Td>
                    <Link
                      href={`/operator/medevac/${row.id}/offer`}
                      className="text-gold-light hover:text-gold"
                    >
                      قدّم عرضاً
                    </Link>
                  </Td>
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
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}
