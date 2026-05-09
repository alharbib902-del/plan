import { operatorsAr } from '@/lib/i18n/operators-ar';
import type { OperatorRow } from '@/types/database';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Phase 8 PR 2b — rejected-state detail panel.
 *
 * The rejected state is terminal in this PR: there is no
 * "re-open as pending" button. The spec mentions one as a
 * future admin override, but Phase 8 ships the rejection as
 * final to keep the audit trail clean. A real admin override
 * would need an audit-log entry + a confirm dialog; we'll
 * ship that in Phase 8.1 if needed.
 */
export function OperatorDetailRejected({ operator }: { operator: OperatorRow }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-500/40 bg-zinc-500/5 p-5">
        <h3 className="font-ar mb-3 text-base font-medium text-zinc-100">
          {operatorsAr.fields.rejection_reason}
        </h3>
        <p className="font-ar mb-3 whitespace-pre-wrap text-sm text-zinc-100/90">
          {operator.rejection_reason ?? '—'}
        </p>
        <p className="font-ar text-xs text-zinc-100/70">
          {operatorsAr.fields.rejected_at}: {formatDate(operator.rejected_at)}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-navy-card/40 p-5">
        <p className="font-ar text-sm text-ink-muted">
          الحساب في حالة نهائية. لا يمكن استخدامه لتسجيل الدخول، ولا تتوفّر إجراءات إدارية إضافية.
          إن أراد المشغّل التقديم مجدداً يجب استخدام بريد آخر.
        </p>
      </section>
    </div>
  );
}
