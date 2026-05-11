import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Activity, CheckCircle2 } from 'lucide-react';

import { getOperatorNotificationAlertStatus } from '@/lib/admin/operators/queries';
import {
  getCronTickHealth,
  getSignupAttemptMix,
  safeGetOperatorSignupVelocity,
  type CronTickHealth,
  type OperatorCleanupJobName,
} from '@/lib/admin/operators/canary-queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';

/**
 * Phase 8 PR 2e — admin canary readout for operator-side
 * operations.
 *
 * Single dashboard that aggregates the four operational
 * signals the founder needs to triage Phase 8 health
 * without digging into Vercel logs or Supabase tables:
 *
 *   1. Operator velocity   — status breakdown + 24h/7d
 *                            signup deltas.
 *   2. Notification health — same singleton row that
 *                            powers the operators-list
 *                            banner (email + WhatsApp).
 *   3. Signup attempt mix  — last 24h breakdown of
 *                            success / duplicate_email /
 *                            rate_limited / validation_failed
 *                            from operator_signup_attempts.
 *   4. Cron tick health    — last successful run per
 *                            cleanup cron + a stale flag
 *                            (>2x expected interval).
 *
 * The page is read-only — no Server Actions, no buttons.
 * Refresh = reload. The four signals are fetched in
 * parallel via Promise.all so first paint waits on the
 * slowest query (typically getSignupAttemptMix during a
 * peak hour).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.canary.title,
  robots: { index: false, follow: false },
};

export default async function AdminOperatorsCanaryPage() {
  if (process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'false') {
    notFound();
  }

  const [velocity, alertStatus, attemptMix, cronHealth] = await Promise.all([
    safeGetOperatorSignupVelocity(),
    getOperatorNotificationAlertStatus(),
    getSignupAttemptMix(),
    getCronTickHealth(),
  ]);

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {operatorsAr.canary.title}
          </h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            {operatorsAr.canary.subtitle}
          </p>
        </div>
        <Link
          href="/admin/operators"
          className="font-ar text-xs text-gold-light hover:underline"
        >
          ← {operatorsAr.canary.backLink}
        </Link>
      </header>

      <VelocityCard velocity={velocity} />

      <NotificationHealthCard alertStatus={alertStatus} />

      <AttemptMixCard mix={attemptMix} />

      <CronHealthCard rows={cronHealth} />
    </section>
  );
}

// ============================================================
// Velocity card
// ============================================================

function VelocityCard({
  velocity,
}: {
  velocity: Awaited<ReturnType<typeof safeGetOperatorSignupVelocity>>;
}) {
  return (
    <Card title={operatorsAr.canary.velocityTitle}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={operatorsAr.status.pending}
          value={velocity.total_pending}
        />
        <Stat
          label={operatorsAr.status.approved}
          value={velocity.total_approved}
        />
        <Stat
          label={operatorsAr.status.suspended}
          value={velocity.total_suspended}
        />
        <Stat
          label={operatorsAr.status.rejected}
          value={velocity.total_rejected}
        />
        <Stat
          label={operatorsAr.canary.signupsLast24h}
          value={velocity.signups_last_24h}
        />
        <Stat
          label={operatorsAr.canary.signupsLast7d}
          value={velocity.signups_last_7d}
        />
      </div>
    </Card>
  );
}

// ============================================================
// Notification health card
// ============================================================

function NotificationHealthCard({
  alertStatus,
}: {
  alertStatus: Awaited<ReturnType<typeof getOperatorNotificationAlertStatus>>;
}) {
  if (!alertStatus) {
    return (
      <Card title={operatorsAr.canary.notificationsTitle}>
        <p className="font-ar text-sm text-ink-muted">
          {operatorsAr.canary.notificationsUnknown}
        </p>
      </Card>
    );
  }

  return (
    <Card title={operatorsAr.canary.notificationsTitle}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChannelHealth
          label={operatorsAr.canary.emailChannel}
          status={alertStatus.status}
          lastFailureAt={alertStatus.last_failure_at}
          lastFailureReason={alertStatus.last_failure_reason}
        />
        <ChannelHealth
          label={operatorsAr.canary.whatsappChannel}
          status={alertStatus.whatsapp_status}
          lastFailureAt={alertStatus.whatsapp_last_failure_at}
          lastFailureReason={alertStatus.whatsapp_last_failure_reason}
        />
      </div>
    </Card>
  );
}

function ChannelHealth({
  label,
  status,
  lastFailureAt,
  lastFailureReason,
}: {
  label: string;
  status: string;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}) {
  const isHealthy = status === 'healthy';
  const tone: 'emerald' | 'amber' | 'rose' = isHealthy
    ? 'emerald'
    : status === 'config_missing'
      ? 'amber'
      : 'rose';

  const Icon = isHealthy ? CheckCircle2 : AlertTriangle;

  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        tone === 'emerald'
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : tone === 'amber'
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-rose-500/40 bg-rose-500/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={`h-4 w-4 ${
            tone === 'emerald'
              ? 'text-emerald-300'
              : tone === 'amber'
                ? 'text-amber-300'
                : 'text-rose-300'
          }`}
          aria-hidden
        />
        <span className="font-ar text-sm text-ink-primary">{label}</span>
        <span className="font-ar mr-auto text-xs text-ink-muted">
          {operatorsAr.canary.statusLabels[status] ?? status}
        </span>
      </div>
      {lastFailureReason ? (
        <p className="font-ar mt-2 text-xs text-ink-muted">
          {operatorsAr.canary.lastFailureLabel}{' '}
          <span dir="ltr" className="font-mono">
            {lastFailureReason}
          </span>
        </p>
      ) : null}
      {lastFailureAt ? (
        <p className="font-ar mt-1 text-xs text-ink-muted">
          {operatorsAr.canary.atLabel}{' '}
          <span dir="ltr" className="font-mono">
            {formatRelativeTime(lastFailureAt)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

// ============================================================
// Attempt mix card
// ============================================================

function AttemptMixCard({
  mix,
}: {
  mix: Awaited<ReturnType<typeof getSignupAttemptMix>>;
}) {
  return (
    <Card title={operatorsAr.canary.attemptMixTitle}>
      <p className="font-ar mb-4 text-xs text-ink-muted">
        {operatorsAr.canary.attemptMixSubtitle.replace(
          '{total}',
          String(mix.total)
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={operatorsAr.canary.attemptSuccess} value={mix.success} />
        <Stat
          label={operatorsAr.canary.attemptDuplicate}
          value={mix.duplicate_email}
        />
        <Stat
          label={operatorsAr.canary.attemptRateLimited}
          value={mix.rate_limited}
          tone={mix.rate_limited > 0 ? 'amber' : 'neutral'}
        />
        <Stat
          label={operatorsAr.canary.attemptValidationFailed}
          value={mix.validation_failed}
          tone={mix.validation_failed > 0 ? 'amber' : 'neutral'}
        />
      </div>
    </Card>
  );
}

// ============================================================
// Cron health card
// ============================================================

function CronHealthCard({ rows }: { rows: CronTickHealth[] }) {
  return (
    <Card title={operatorsAr.canary.cronTitle}>
      <p className="font-ar mb-4 text-xs text-ink-muted">
        {operatorsAr.canary.cronSubtitle}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-navy-secondary/30">
        <table className="w-full text-right">
          <thead className="border-b border-border bg-navy-secondary/40">
            <tr>
              <Th>{operatorsAr.canary.cronJobLabel}</Th>
              <Th>{operatorsAr.canary.cronLastRunLabel}</Th>
              <Th>{operatorsAr.canary.cronDeletedCountLabel}</Th>
              <Th>{operatorsAr.canary.cronStatusLabel}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <CronRow key={row.job_name} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CronRow({ row }: { row: CronTickHealth }) {
  const isHealthy = row.last_success === true && row.is_stale === false;
  const isStale = row.is_stale === true;
  const isError = row.last_success === false;
  const isUnknown = row.last_run_at === null;

  let tone: 'emerald' | 'amber' | 'rose' | 'muted';
  let label: string;
  if (isUnknown) {
    tone = 'muted';
    label = operatorsAr.canary.cronStatusUnknown;
  } else if (isError) {
    tone = 'rose';
    label = operatorsAr.canary.cronStatusError;
  } else if (isStale) {
    tone = 'amber';
    label = operatorsAr.canary.cronStatusStale;
  } else if (isHealthy) {
    tone = 'emerald';
    label = operatorsAr.canary.cronStatusHealthy;
  } else {
    tone = 'muted';
    label = operatorsAr.canary.cronStatusUnknown;
  }

  return (
    <tr className="border-t border-border/50">
      <td className="font-ar px-4 py-3 font-mono text-xs text-gold-light">
        {prettifyJobName(row.job_name)}
      </td>
      <td className="font-ar px-4 py-3 text-xs text-ink-secondary">
        {row.last_run_at
          ? formatRelativeTime(row.last_run_at)
          : operatorsAr.canary.cronNeverRan}
      </td>
      <td className="font-ar px-4 py-3 text-xs text-ink-secondary">
        {row.last_deleted_count ?? '—'}
      </td>
      <td className="px-4 py-3 text-end">
        <span
          className={`font-ar inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${
            tone === 'emerald'
              ? 'bg-emerald-500/15 text-emerald-200'
              : tone === 'amber'
                ? 'bg-amber-500/15 text-amber-200'
                : tone === 'rose'
                  ? 'bg-rose-500/15 text-rose-200'
                  : 'bg-navy-card text-ink-muted'
          }`}
        >
          {tone === 'emerald' ? (
            <CheckCircle2 className="h-3 w-3" aria-hidden />
          ) : tone === 'rose' || tone === 'amber' ? (
            <AlertTriangle className="h-3 w-3" aria-hidden />
          ) : (
            <Activity className="h-3 w-3" aria-hidden />
          )}
          {label}
        </span>
        {row.last_error_label ? (
          <p className="font-ar mt-1 text-xs text-rose-200" dir="ltr">
            <span className="font-mono">{row.last_error_label}</span>
          </p>
        ) : null}
      </td>
    </tr>
  );
}

// ============================================================
// Layout primitives
// ============================================================

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-5">
      <h2 className="font-ar mb-4 text-lg text-ink-primary">{title}</h2>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'amber';
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        tone === 'amber'
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-border bg-navy-secondary/30'
      }`}
    >
      <p className="font-ar text-xs text-ink-muted">{label}</p>
      <p
        className={`font-ar mt-1 text-2xl ${
          tone === 'amber' ? 'text-amber-200' : 'text-ink-primary'
        }`}
      >
        {value.toLocaleString('en-US')}
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-ar px-4 py-3 text-start text-xs font-medium uppercase tracking-tagged text-ink-muted">
      {children}
    </th>
  );
}

// ============================================================
// Formatters
// ============================================================

function prettifyJobName(job: OperatorCleanupJobName): string {
  // Strip the cleanup_ prefix + _ to make the table cell
  // shorter without losing identity.
  return job.replace(/^cleanup_/, '').replace(/_/g, ' ');
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  if (ms < 60_000) return operatorsAr.canary.justNow;
  const minutes = Math.floor(ms / 60_000);
  const { relativePrefix, minutesUnit, hoursUnit, daysUnit } =
    operatorsAr.canary;
  if (minutes < 60) return `${relativePrefix} ${minutes} ${minutesUnit}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${relativePrefix} ${hours} ${hoursUnit}`;
  const days = Math.floor(hours / 24);
  return `${relativePrefix} ${days} ${daysUnit}`;
}
