import 'server-only';

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import { recordMedevacEmailAlertStatus } from './email-alert-status';
import type {
  MedevacRequestRedactedRow,
  MedevacSeverity,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 3 — founder SLA escalation alert.
 *
 * Sent by the /api/cron/medevac/sla-escalation route when a
 * pending/offers_received medevac request blows its severity
 * SLA budget (critical=1h, moderate=4h, stable=24h per §3.6).
 * Per-request throttle: medevac_requests.sla_escalated_at
 * gets stamped atomically by the route's conditional UPDATE
 * BEFORE this helper sends; this helper assumes the row was
 * successfully claimed for escalation.
 *
 * PII redacted per D12: MEV-XXXX + service_level +
 * condition_severity + route + dispatched_at age — NO
 * patient_name / age / contact.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function envCredentials(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

type LooseSelect = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: number
      ) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

async function getFounderEmail(): Promise<string | null> {
  try {
    const loose = createAdminClient() as unknown as LooseSelect;
    const { data, error } = await loose
      .from('aeris_shield_config')
      .select('founder_notification_email')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { founder_notification_email?: string | null };
    return row.founder_notification_email ?? null;
  } catch {
    return null;
  }
}

const SEVERITY_AR: Record<MedevacSeverity, string> = {
  stable: 'مستقر',
  moderate: 'متوسط',
  critical: 'حرج',
};

interface EscalationArgs {
  medevac_request: MedevacRequestRedactedRow;
  dispatched_at: string;
  sla_minutes: number;
}

function routeLabel(req: MedevacRequestRedactedRow): string {
  const dep = req.from_iata ?? req.from_location_freeform ?? '—';
  const arr = req.to_iata ?? req.to_hospital_name ?? '—';
  return `${dep} → ${arr}`;
}

export async function sendFounderSlaEscalationEmail(
  args: EscalationArgs
): Promise<{ sent: boolean }> {
  const founderEmail = await getFounderEmail();
  if (!founderEmail) {
    console.error('[medevac.sla-escalation] no founder email configured');
    return { sent: false };
  }
  const creds = envCredentials();
  if (!creds) {
    await recordMedevacEmailAlertStatus({
      status: 'config_missing',
      reason: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    });
    return { sent: false };
  }

  const req = args.medevac_request;
  const severity = SEVERITY_AR[req.condition_severity] ?? req.condition_severity;
  const adminUrl = `${siteUrl()}/admin/medevac/${req.id}`;
  const subject = `⚠️ SLA انقضى — ${severity} | ${req.medevac_request_number}`;

  const bodyHtml = `
    <p>طلب إخلاء طبي تجاوز نافذة الـ SLA بدون عرض من المشغلين:</p>
    <ul style="padding-inline-start:18px;margin:12px 0">
      <li>المرجع: <strong style="color:#FCA5A5">${escapeHtml(req.medevac_request_number)}</strong></li>
      <li>الحالة: <strong>${escapeHtml(severity)}</strong></li>
      <li>مستوى الخدمة: <strong>${escapeHtml(req.service_level)}</strong></li>
      <li>المسار: <strong>${escapeHtml(routeLabel(req))}</strong></li>
      <li>نافذة الـ SLA: <strong>${args.sla_minutes} دقيقة</strong></li>
      <li>أُرسل للموزعين عند: <strong>${escapeHtml(args.dispatched_at)}</strong></li>
    </ul>
    <p>راجع الطلب وفعّل التصعيد اليدوي إذا لزم الأمر:</p>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(244,63,94,0.4);border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#FCA5A5;font-size:22px">AERIS · SLA BREACH</div>
            <h1 style="margin:18px 0 12px;font-size:22px;color:#FAFAFA;font-weight:600">طلب إخلاء طبي تجاوز نافذة الـ SLA</h1>
            <div style="margin-top:16px;color:#A8B2C1;font-size:15px;line-height:1.7">${bodyHtml}</div>
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px">
              <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:14px 28px;background:#F43F5E;color:#FFFFFF;text-decoration:none;font-weight:600;border-radius:10px;font-size:15px">مراجعة الطلب في لوحة الإدارة</a>
            </td></tr></table>
            <p style="margin:32px 0 0;color:#6B7A8F;font-size:12px;text-align:center">
              بيانات المريض غير مدرجة في هذا التنبيه — مدعومة عبر صفحة الإدارة (admin_pii_read audit).
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `SLA انقضى — ${severity} | ${req.medevac_request_number}`,
    `المسار: ${routeLabel(req)}`,
    `مستوى الخدمة: ${req.service_level}`,
    `نافذة الـ SLA: ${args.sla_minutes} دقيقة`,
    `أُرسل للموزعين عند: ${args.dispatched_at}`,
    '',
    `مراجعة: ${adminUrl}`,
    '',
    'بيانات المريض غير مدرجة في التنبيه (D12 PII redaction).',
  ].join('\n');

  try {
    const resend = new Resend(creds.apiKey);
    const { error } = await resend.emails.send({
      from: creds.from,
      to: founderEmail,
      subject,
      html,
      text,
    });
    if (error) {
      console.error('[medevac.sla-escalation] Resend error', error);
      await recordMedevacEmailAlertStatus({
        status: 'send_failed',
        reason:
          typeof error === 'string'
            ? error
            : JSON.stringify(error).slice(0, 200),
      });
      return { sent: false };
    }
    await recordMedevacEmailAlertStatus({ status: 'healthy' });
    return { sent: true };
  } catch (err) {
    console.error('[medevac.sla-escalation] Resend threw', err);
    await recordMedevacEmailAlertStatus({
      status: 'send_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return { sent: false };
  }
}
