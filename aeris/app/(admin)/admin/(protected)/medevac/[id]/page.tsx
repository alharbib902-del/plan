import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { readAdminMedevacRequestDetail } from '@/lib/medevac/admin-pii';
import { medevacAr } from '@/lib/i18n/medevac-ar';
import { ManualDispatchButton } from '@/components/admin/medevac/manual-dispatch-button';
import type {
  MedevacSeverity,
  MedevacRequestStatus,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — admin /admin/medevac/[id] detail.
 *
 * THE ONLY PII surface in the admin tier per D8 (Round 10
 * P1 #1). Loads exclusively via readAdminMedevacRequestDetail,
 * which calls the §4.10 SECURITY DEFINER RPC. The RPC writes
 * the `admin_pii_read` audit row first, then SELECTs the PII
 * row — both atomic. If the audit insert fails (e.g.
 * AdminPiiEnvError when ADMIN_AUDIT_FINGERPRINT_SECRET is
 * missing), the helper throws and the page surfaces a
 * generic error rather than rendering data unaudited.
 *
 * Gated behind ENABLE_MEDEVAC env flag. Route-param UUID
 * guard (isUuid) lives inside the helper — bad UUIDs return
 * null → notFound() here.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: medevacAr.adminDetailTitle,
  robots: { index: false, follow: false },
};

const SEVERITY_LABELS: Record<MedevacSeverity, string> = {
  stable: medevacAr.severityStable,
  moderate: medevacAr.severityModerate,
  critical: medevacAr.severityCritical,
};

const STATUS_LABELS: Record<MedevacRequestStatus, string> = {
  pending: 'بانتظار العروض',
  offers_received: 'عروض مستلمة',
  accepted: 'مقبول',
  covered: 'مغطى (Shield)',
  cancelled: 'ملغي',
  expired: 'منتهي',
};

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function fmtSAR(value: string | null): string {
  if (value === null || value === undefined) return '—';
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

interface PageProps {
  params: { id: string };
}

export default async function AdminMedevacDetailPage({
  params,
}: PageProps) {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const detail = await readAdminMedevacRequestDetail(params.id);
  if (!detail) notFound();

  const r = detail.request;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin/medevac"
          className="font-ar text-xs text-ink-muted hover:text-ink-secondary"
        >
          ← {medevacAr.adminQueueTitle}
        </Link>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {medevacAr.adminDetailTitle}
        </h1>
        <p
          dir="ltr"
          className="font-mono text-sm text-gold-light"
        >
          {r.medevac_request_number}
        </p>
      </header>

      <p
        role="note"
        className="font-ar rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs leading-7 text-rose-200"
      >
        {medevacAr.adminDetailPiiNotice}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="هوية المريض">
          <Row label="اسم المريض" value={r.patient_name_snapshot} />
          <Row
            label="العمر (سنوات)"
            value={r.patient_age_snapshot?.toString() ?? '—'}
          />
        </Card>

        <Card title="جهة الاتصال">
          <Row label="الاسم" value={r.contact_name_snapshot} />
          <Row
            label="الهاتف"
            value={<span dir="ltr">{r.contact_phone_snapshot}</span>}
          />
          <Row
            label="البريد"
            value={
              r.contact_email_snapshot ? (
                <span dir="ltr">{r.contact_email_snapshot}</span>
              ) : (
                '—'
              )
            }
          />
        </Card>

        <Card title="التقييم الطبي">
          <Row
            label="درجة الحالة"
            value={SEVERITY_LABELS[r.condition_severity]}
          />
          <Row
            label="مستوى الخدمة"
            value={<span dir="ltr">{r.service_level}</span>}
          />
        </Card>

        <Card title="المسار">
          <Row label="مكان الانطلاق" value={r.from_location_freeform} />
          <Row
            label="رمز مطار الانطلاق"
            value={r.from_iata ? <span dir="ltr">{r.from_iata}</span> : '—'}
          />
          <Row label="المستشفى" value={r.to_hospital_name} />
          <Row
            label="عنوان المستشفى"
            value={r.to_hospital_freeform_address ?? '—'}
          />
          <Row
            label="هاتف المستشفى"
            value={
              r.to_hospital_contact_phone ? (
                <span dir="ltr">{r.to_hospital_contact_phone}</span>
              ) : (
                '—'
              )
            }
          />
          <Row
            label="رمز مطار الوصول"
            value={r.to_iata ? <span dir="ltr">{r.to_iata}</span> : '—'}
          />
        </Card>

        <Card title="التأمين">
          <Row
            label="شركة التأمين"
            value={r.insurance_provider_snapshot ?? '—'}
          />
          <Row
            label="مرجع المطالبة"
            value={
              r.insurance_claim_ref ? (
                <span dir="ltr">{r.insurance_claim_ref}</span>
              ) : (
                '—'
              )
            }
          />
        </Card>

        <Card title="الحالة والتسعير">
          <Row
            label="حالة الطلب"
            value={STATUS_LABELS[r.status] ?? r.status}
          />
          <Row
            label="القيمة التقديرية (ريال)"
            value={<span dir="ltr">{fmtSAR(r.estimated_value_sar)}</span>}
          />
          <Row
            label="مغطى عبر اشتراك"
            value={r.is_covered ? 'نعم' : 'لا'}
          />
          <Row
            label="تاريخ الإنشاء"
            value={fmtDateTime(r.created_at)}
          />
          <Row
            label="تاريخ الإرسال للموزعين"
            value={fmtDateTime(r.dispatched_at)}
          />
        </Card>
      </div>

      {/* Phase 12 PR 3 §6.2 — manual dispatch button.
          Inserts a 'manual_redispatch' outbox row that the
          5-min dispatch-drain cron picks up. Available on
          both open + closed requests so admin can re-fan-out
          if the original dispatch generated no offers.
          Covered J5 rows aren't actionable (the §3.10 trigger
          + distribution.ts both short-circuit on
          `is_covered=true`), so the button stays hidden for
          those. */}
      {!r.is_covered && (
        <div className="rounded-xl border border-border bg-navy-card/30 p-5">
          <h2 className="font-ar mb-3 text-sm text-ink-secondary">
            إعادة توزيع يدوي
          </h2>
          <p className="font-ar mb-3 text-xs text-ink-muted">
            ينشئ حدث dispatch جديد في الـ outbox. يلتقطه cron
            dispatch-drain خلال 5 دقائق ويعيد إرسال العروض للمشغلين
            المعتمدين الجدد (أو نفس المشغلين بعد انقضاء نافذة
            الـ recently_dispatched).
          </p>
          <ManualDispatchButton requestId={r.id} />
        </div>
      )}

      <footer
        className="font-ar rounded-xl border border-border bg-navy-card/30 p-4 text-xs text-ink-muted"
        dir="ltr"
      >
        audit_logged_at: {detail.audit_logged_at}
      </footer>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/30 p-5">
      <h2 className="font-ar mb-3 text-sm text-ink-secondary">{title}</h2>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-ar text-ink-muted">{label}</dt>
      <dd className="font-ar text-ink-primary">{value}</dd>
    </div>
  );
}
