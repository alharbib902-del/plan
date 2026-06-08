import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { privilegeAr } from '@/lib/i18n/privilege-ar';
import { readClientLedgerHistory } from '@/lib/privilege/client-pii';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'سجل الاسترداد',
  robots: { index: false, follow: false },
};

function formatSar(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ريال';
}

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString('en-GB', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

export default async function MePrivilegeHistoryPage() {
  if (process.env.ENABLE_PRIVILEGE !== 'true') notFound();

  const { ledger } = await readClientLedgerHistory({ limit: 100 });

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <Link
          href="/me/privilege"
          className="font-ar text-sm text-ink-secondary hover:text-ink-primary"
        >
          ← {privilegeAr.programName}
        </Link>
        <h1 className="font-ar text-2xl text-ink-primary">سجل الاسترداد الكامل</h1>
        <p className="font-ar text-sm text-ink-secondary">
          آخر 100 معاملة على رصيد الاسترداد
        </p>
      </header>

      {ledger.length === 0 ? (
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-6">
          <p className="font-ar text-sm text-ink-secondary">
            لا توجد معاملات بعد.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-navy-card bg-navy-card/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start font-ar text-xs uppercase tracking-tagged text-ink-secondary">
                <th className="px-4 py-3 text-end">التاريخ</th>
                <th className="px-4 py-3 text-end">النوع</th>
                <th className="px-4 py-3 text-end">المبلغ</th>
                <th className="px-4 py-3 text-end">الرصيد بعد</th>
                <th className="px-4 py-3 text-end">انتهاء الصلاحية</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-navy-card font-ar text-ink-primary"
                >
                  <td className="px-4 py-3 text-end">
                    {formatDateTime(row.created_at)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {privilegeAr.ledgerEvent[row.event_type]}
                  </td>
                  <td
                    className={`px-4 py-3 text-end ${
                      Number(row.amount_sar) >= 0
                        ? 'text-emerald-300'
                        : 'text-rose-300'
                    }`}
                  >
                    {Number(row.amount_sar) >= 0 ? '+' : ''}
                    {formatSar(row.amount_sar)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {formatSar(row.balance_after_sar)}
                  </td>
                  <td className="px-4 py-3 text-end text-xs text-ink-secondary">
                    {row.cashback_expiry_at
                      ? new Date(row.cashback_expiry_at).toLocaleDateString('en-GB', {
                          timeZone: 'Asia/Riyadh',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
