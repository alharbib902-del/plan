import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TierBadge } from '@/components/privilege/tier-badge';
import { privilegeAr } from '@/lib/i18n/privilege-ar';
import { readAdminClientPrivilegeDetail } from '@/lib/privilege/admin-pii';

/**
 * Phase 13 PR 1 — /admin/clients/[id]/privilege detail page.
 *
 * D17 audited admin surface. Calls readAdminClientPrivilegeDetail
 * which writes the audit_logs row BEFORE the SELECT.
 *
 * Gated behind ENABLE_PRIVILEGE env flag (D20). isUuid guard
 * lives in the helper.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: privilegeAr.adminDetailTitle,
  robots: { index: false, follow: false },
};

function formatSar(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ريال';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
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

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return value;
  }
}

export default async function AdminClientPrivilegePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.ENABLE_PRIVILEGE !== 'true') notFound();

  const { id } = await params;
  const detail = await readAdminClientPrivilegeDetail(id);
  if (!detail) notFound();

  const { client, recent_ledger, recent_change_log } = detail;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <Link
          href="/admin/clients"
          className="font-ar text-sm text-ink-secondary hover:text-ink-primary"
        >
          ← قائمة العملاء
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-ar text-2xl text-ink-primary">
              {privilegeAr.adminDetailTitle}
            </h1>
            <p className="font-ar text-sm text-ink-secondary">
              {client.full_name} ·{' '}
              <span dir="ltr">{client.auth_email}</span> ·{' '}
              <span dir="ltr">{client.contact_phone}</span>
            </p>
          </div>
          <Link
            href={`/admin/clients/${client.id}/privilege/force`}
            className="font-ar rounded-full border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold hover:bg-gold/20"
          >
            {privilegeAr.adminForceTitle}
          </Link>
        </div>
      </header>

      {/* Top-line state */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionCurrentTier}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <TierBadge tier={client.privilege_tier} size="lg" />
            <span className="font-ar text-xs text-ink-secondary">
              {privilegeAr.fieldAssignedAt}: {formatDate(client.privilege_tier_assigned_at)}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionBalance}
          </p>
          <p className="font-ar mt-3 text-2xl text-gold">
            {formatSar(client.cashback_balance_sar)}
          </p>
        </div>
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionSpendWindow}
          </p>
          <p className="font-ar mt-3 text-2xl text-ink-primary">
            {formatSar(client.privilege_tier_qualified_spend_12m_sar)}
          </p>
        </div>
      </section>

      {/* Lock + grace + 2FA */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionLock}
          </p>
          <p className="font-ar mt-3 text-sm text-ink-primary">
            {client.tier_locked_until
              ? `${privilegeAr.fieldLockedUntil}: ${formatDateOnly(client.tier_locked_until)}`
              : privilegeAr.fieldNoLock}
          </p>
        </div>
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionGrace}
          </p>
          <p className="font-ar mt-3 text-sm text-ink-primary">
            {client.privilege_below_threshold_since
              ? `${privilegeAr.fieldBelowSince}: ${formatDate(client.privilege_below_threshold_since)}`
              : privilegeAr.fieldNoGrace}
          </p>
        </div>
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionTwoFactor}
          </p>
          <p className="font-ar mt-3 text-sm text-ink-primary">
            {client.two_factor_enabled
              ? privilegeAr.fieldEnabled
              : privilegeAr.fieldDisabled}
          </p>
        </div>
      </section>

      {/* Recent ledger */}
      <section className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
        <h2 className="font-ar mb-4 text-lg text-ink-primary">
          {privilegeAr.sectionRecentLedger}
        </h2>
        {recent_ledger.length === 0 ? (
          <p className="font-ar text-sm text-ink-secondary">
            لا توجد معاملات بعد.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start font-ar text-xs uppercase tracking-tagged text-ink-secondary">
                  <th className="py-2 ps-2 text-end">التاريخ</th>
                  <th className="py-2 text-end">النوع</th>
                  <th className="py-2 text-end">المبلغ</th>
                  <th className="py-2 text-end">الرصيد بعد</th>
                  <th className="py-2 pe-2 text-end">الحجز</th>
                </tr>
              </thead>
              <tbody>
                {recent_ledger.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-navy-card font-ar text-ink-primary"
                  >
                    <td className="py-2 ps-2 text-end">{formatDate(row.created_at)}</td>
                    <td className="py-2 text-end">
                      {privilegeAr.ledgerEvent[row.event_type]}
                    </td>
                    <td className="py-2 text-end">{formatSar(row.amount_sar)}</td>
                    <td className="py-2 text-end">{formatSar(row.balance_after_sar)}</td>
                    <td className="py-2 pe-2 text-end" dir="ltr">
                      {row.booking_id ? row.booking_id.slice(0, 8) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent tier changes */}
      <section className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
        <h2 className="font-ar mb-4 text-lg text-ink-primary">
          {privilegeAr.sectionRecentChanges}
        </h2>
        {recent_change_log.length === 0 ? (
          <p className="font-ar text-sm text-ink-secondary">
            لا توجد تغييرات بعد.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start font-ar text-xs uppercase tracking-tagged text-ink-secondary">
                  <th className="py-2 ps-2 text-end">التاريخ</th>
                  <th className="py-2 text-end">من</th>
                  <th className="py-2 text-end">إلى</th>
                  <th className="py-2 text-end">السبب</th>
                  <th className="py-2 pe-2 text-end">الإنفاق المؤهَّل</th>
                </tr>
              </thead>
              <tbody>
                {recent_change_log.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-navy-card font-ar text-ink-primary"
                  >
                    <td className="py-2 ps-2 text-end">{formatDate(row.created_at)}</td>
                    <td className="py-2 text-end">
                      <TierBadge tier={row.from_tier} size="sm" />
                    </td>
                    <td className="py-2 text-end">
                      <TierBadge tier={row.to_tier} size="sm" />
                    </td>
                    <td className="py-2 text-end">
                      {privilegeAr.changeReason[row.reason]}
                    </td>
                    <td className="py-2 pe-2 text-end">
                      {formatSar(row.qualified_spend_12m_sar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
