import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';

import { OperatorListFilters } from '@/components/admin/operators/list-filters';
import { OperatorRow } from '@/components/admin/operators/operator-row';
import {
  countOperatorsByStatus,
  getOperatorNotificationAlertStatus,
  listOperators,
  OPERATOR_SIGNUP_STATUSES,
  type OperatorListFilter,
} from '@/lib/admin/operators/queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.adminListTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams?: { filter?: string };
}

function parseFilter(raw: string | undefined): OperatorListFilter {
  if (!raw) return 'all';
  const lowered = raw.toLowerCase();
  if (lowered === 'all') return 'all';
  if ((OPERATOR_SIGNUP_STATUSES as readonly string[]).includes(lowered)) {
    return lowered as OperatorListFilter;
  }
  return 'all';
}

export default async function AdminOperatorsPage({ searchParams }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL_ADMIN !== 'true') {
    notFound();
  }

  const filter = parseFilter(searchParams?.filter);
  const [operators, counts, alertStatus] = await Promise.all([
    listOperators({ filter, limit: 200 }),
    countOperatorsByStatus(),
    getOperatorNotificationAlertStatus(),
  ]);

  const isFiltered = filter !== 'all';
  const emptyMessage = isFiltered
    ? operatorsAr.adminListEmptyForFilter
    : operatorsAr.adminListEmpty;

  // Codex round 4 PR #42 P2 fix: surface the notification
  // alert singleton (recordEmailAlertStatus writes to it from
  // operatorRequestPasswordReset and the admin Server Actions
  // in operators.ts). Only renders when status <> 'healthy'.
  //
  // Phase 8.1: a second banner surfaces WhatsApp (wasender)
  // health independently so the founder can tell which channel
  // degraded. The two banners can both fire at once
  // (email + WhatsApp both broken) and stack vertically.
  const degradedEmail: 'config_missing' | 'send_failed' | null =
    alertStatus && alertStatus.status !== 'healthy'
      ? (alertStatus.status as 'config_missing' | 'send_failed')
      : null;
  const degradedWhatsapp:
    | 'config_missing'
    | 'send_failed'
    | 'rate_limited'
    | null =
    alertStatus && alertStatus.whatsapp_status !== 'healthy'
      ? (alertStatus.whatsapp_status as
          | 'config_missing'
          | 'send_failed'
          | 'rate_limited')
      : null;

  return (
    <section>
      <div className="mb-6">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.adminListTitle}
        </h1>
      </div>

      {degradedEmail && alertStatus ? (
        <NotificationChannelBanner
          channel="email"
          severity={degradedEmail}
          copy={operatorsAr.alertBanner[degradedEmail]}
          lastFailureLabel={operatorsAr.alertBanner.lastFailureLabel}
          lastFailureReason={alertStatus.last_failure_reason}
        />
      ) : null}

      {degradedWhatsapp && alertStatus ? (
        <NotificationChannelBanner
          channel="whatsapp"
          severity={degradedWhatsapp}
          copy={operatorsAr.alertBanner.whatsapp[degradedWhatsapp]}
          lastFailureLabel={operatorsAr.alertBanner.lastFailureLabel}
          lastFailureReason={alertStatus.whatsapp_last_failure_reason}
        />
      ) : null}

      <div className="mb-6">
        <OperatorListFilters active={filter} counts={counts} />
      </div>

      {operators.length === 0 ? (
        <div className="rounded-xl border border-border bg-navy-card/40 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {operators.map((op) => (
            <OperatorRow key={op.id} operator={op} />
          ))}
        </div>
      )}
    </section>
  );
}

interface NotificationChannelBannerProps {
  channel: 'email' | 'whatsapp';
  severity: 'config_missing' | 'send_failed' | 'rate_limited';
  copy: string;
  lastFailureLabel: string;
  lastFailureReason: string | null;
}

function NotificationChannelBanner({
  channel,
  severity,
  copy,
  lastFailureLabel,
  lastFailureReason,
}: NotificationChannelBannerProps) {
  // 'config_missing' is operator-action-needed (amber); the
  // other failures are infra-incident severity (rose).
  const tone: 'amber' | 'rose' =
    severity === 'config_missing' ? 'amber' : 'rose';
  return (
    <div
      data-channel={channel}
      className={`mb-3 flex items-start gap-3 rounded-xl border px-4 py-3 ${
        tone === 'amber'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
          : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
      }`}
    >
      <AlertTriangle
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
          tone === 'amber' ? 'text-amber-300' : 'text-rose-300'
        }`}
        aria-hidden
      />
      <div className="font-ar text-sm">
        <p>{copy}</p>
        {lastFailureReason ? (
          <p className="mt-1 text-xs opacity-80">
            {lastFailureLabel}{' '}
            <span dir="ltr" className="font-mono">
              {lastFailureReason}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
