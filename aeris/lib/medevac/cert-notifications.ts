import 'server-only';

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import { recordMedevacEmailAlertStatus } from './email-alert-status';

/**
 * Phase 12 PR 3 §6 — medical-certification email senders.
 *
 * Round 2 PR #78 P2 #3 fix — D11 explicitly contracts the
 * warning cascade emails (30/14/7/1 day) + the final
 * `medical_cert_expired_now` email. The first PR 3 cut wrote
 * audit rows only ("emails out of scope") which would have
 * left production with silently-expiring certs visible only
 * via the canary card. This module ships the missing senders
 * so the cron route fires them inline alongside the
 * warning-flag stamp + the supports_* flip.
 *
 * Two senders:
 *   - sendCertWarningEmail (operator + founder CC) — warning
 *     cascade. Caller passes the threshold + days remaining;
 *     the email body cites both so the operator sees urgency.
 *   - sendCertExpiredEmail (operator + founder CC) — fired
 *     once at the enforcement flip; references that all
 *     supports_* flags were cleared.
 *
 * Both use the SAME medevac_email_alert_status singleton as
 * dispatch notifications + SLA escalation, so a degraded
 * Resend account surfaces on the 7th canary card regardless
 * of which sender path the failure landed on.
 *
 * PII semantics: cert emails carry NO patient data (the
 * cert lives on the aircraft, not on a request), so D12
 * redaction is automatic — operator + founder are the
 * audiences and aircraft registration is the identifier.
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

interface FounderConfigRow {
  founder_notification_email: string | null;
}

type LooseSelectFounder = {
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
    const loose = createAdminClient() as unknown as LooseSelectFounder;
    const { data, error } = await loose
      .from('aeris_shield_config')
      .select('founder_notification_email')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return null;
    return (
      (data as FounderConfigRow).founder_notification_email ?? null
    );
  } catch {
    return null;
  }
}

type LooseAircraftSelect = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

interface AircraftSnapshot {
  registration: string | null;
  operator_email: string | null;
  operator_name: string | null;
}

async function getAircraftSnapshot(
  aircraftId: string
): Promise<AircraftSnapshot | null> {
  try {
    const loose = createAdminClient() as unknown as LooseAircraftSelect;
    // Load aircraft → operator_id, then operator contact_email.
    // Two reads keep the loose type small.
    const { data: aircraftData, error: aircraftError } = await loose
      .from('aircraft')
      .select('id, registration, operator_id')
      .eq('id', aircraftId)
      .maybeSingle();
    if (aircraftError || !aircraftData) return null;
    const aircraft = aircraftData as {
      id?: string;
      registration?: string | null;
      operator_id?: string | null;
    };
    if (!aircraft.operator_id) {
      return {
        registration: aircraft.registration ?? null,
        operator_email: null,
        operator_name: null,
      };
    }
    const { data: opData, error: opError } = await loose
      .from('operators')
      .select('id, company_name, contact_email')
      .eq('id', aircraft.operator_id)
      .maybeSingle();
    if (opError || !opData) {
      return {
        registration: aircraft.registration ?? null,
        operator_email: null,
        operator_name: null,
      };
    }
    const op = opData as {
      company_name?: string | null;
      contact_email?: string | null;
    };
    return {
      registration: aircraft.registration ?? null,
      operator_email: op.contact_email ?? null,
      operator_name: op.company_name ?? null,
    };
  } catch {
    return null;
  }
}

function shellHtml(opts: {
  preheader: string;
  heading: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  toneColor: string; // gold for warning, rose for expired
}): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0">${escapeHtml(opts.preheader)}</span>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid ${opts.toneColor}40;border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:${opts.toneColor};font-size:22px">AERIS · MEDEVAC CERT</div>
            <h1 style="margin:18px 0 12px;font-size:22px;color:#FAFAFA;font-weight:600">${escapeHtml(opts.heading)}</h1>
            <div style="margin-top:16px;color:#A8B2C1;font-size:15px;line-height:1.7">${opts.body}</div>
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px">
              <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;padding:14px 28px;background:${opts.toneColor};color:#0A1628;text-decoration:none;font-weight:600;border-radius:10px;font-size:15px">${escapeHtml(opts.ctaLabel)}</a>
            </td></tr></table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

interface CertWarningArgs {
  aircraft_id: string;
  threshold_days: 30 | 14 | 7 | 1;
  certification_expires_at: string;
}

export async function sendCertWarningEmail(
  args: CertWarningArgs
): Promise<{ sent: boolean }> {
  const [snapshot, founder, creds] = await Promise.all([
    getAircraftSnapshot(args.aircraft_id),
    getFounderEmail(),
    Promise.resolve(envCredentials()),
  ]);

  if (!creds) {
    await recordMedevacEmailAlertStatus({
      status: 'config_missing',
      reason: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    });
    return { sent: false };
  }

  const recipients: string[] = [];
  if (snapshot?.operator_email) recipients.push(snapshot.operator_email);
  if (founder) recipients.push(founder);
  if (recipients.length === 0) {
    console.error(
      '[medevac.cert-notifications.warning] no recipients',
      { aircraft_id: args.aircraft_id }
    );
    return { sent: false };
  }

  const regLabel = snapshot?.registration ?? args.aircraft_id.slice(0, 8);
  const expiryLabel = args.certification_expires_at.slice(0, 10);
  const ctaUrl = `${siteUrl()}/admin/medevac/medical-certifications`;
  const subject = `⚠️ شهادة طبية تنتهي خلال ${args.threshold_days} يوم — ${regLabel}`;
  const bodyHtml = `
    <p>تنبيه: الشهادة الطبية للطائرة <strong style="color:#E8D4A8">${escapeHtml(regLabel)}</strong> تنتهي خلال
       <strong>${args.threshold_days} يوم/أيام</strong>.</p>
    <ul style="padding-inline-start:18px;margin:12px 0">
      <li>تاريخ الانتهاء: <strong dir="ltr">${escapeHtml(expiryLabel)}</strong></li>
      <li>عند الانتهاء — يتم تعطيل قدرات الإخلاء الطبي للطائرة تلقائياً (supports_* → false).</li>
    </ul>
    <p>حدّث الشهادة قبل تاريخ الانتهاء لتجنّب التعطيل التلقائي.</p>`;
  const html = shellHtml({
    preheader: `شهادة طبية تنتهي خلال ${args.threshold_days} يوم — ${regLabel}`,
    heading: 'تنبيه انتهاء شهادة طبية',
    body: bodyHtml,
    ctaUrl,
    ctaLabel: 'مراجعة مصفوفة الشهادات',
    toneColor: '#E8D4A8', // gold
  });
  const text = [
    `تنبيه: شهادة طبية تنتهي خلال ${args.threshold_days} يوم.`,
    `الطائرة: ${regLabel}`,
    `تاريخ الانتهاء: ${expiryLabel}`,
    '',
    `حدّث الشهادة قبل ذلك التاريخ — وإلا تُعطَّل قدرات الإخلاء الطبي تلقائياً.`,
    '',
    `مراجعة: ${ctaUrl}`,
  ].join('\n');

  try {
    const resend = new Resend(creds.apiKey);
    const { error } = await resend.emails.send({
      from: creds.from,
      to: recipients,
      subject,
      html,
      text,
    });
    if (error) {
      console.error('[medevac.cert-notifications.warning] Resend error', error);
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
    console.error('[medevac.cert-notifications.warning] Resend threw', err);
    await recordMedevacEmailAlertStatus({
      status: 'send_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return { sent: false };
  }
}

interface CertExpiredArgs {
  aircraft_id: string;
  certification_expires_at: string;
}

export async function sendCertExpiredEmail(
  args: CertExpiredArgs
): Promise<{ sent: boolean }> {
  const [snapshot, founder, creds] = await Promise.all([
    getAircraftSnapshot(args.aircraft_id),
    getFounderEmail(),
    Promise.resolve(envCredentials()),
  ]);

  if (!creds) {
    await recordMedevacEmailAlertStatus({
      status: 'config_missing',
      reason: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    });
    return { sent: false };
  }

  const recipients: string[] = [];
  if (snapshot?.operator_email) recipients.push(snapshot.operator_email);
  if (founder) recipients.push(founder);
  if (recipients.length === 0) {
    console.error(
      '[medevac.cert-notifications.expired] no recipients',
      { aircraft_id: args.aircraft_id }
    );
    return { sent: false };
  }

  const regLabel = snapshot?.registration ?? args.aircraft_id.slice(0, 8);
  const expiryLabel = args.certification_expires_at.slice(0, 10);
  const ctaUrl = `${siteUrl()}/admin/medevac/medical-certifications`;
  const subject = `🚫 شهادة طبية منتهية — ${regLabel} عُطِّلت من توزيع الإخلاء الطبي`;
  const bodyHtml = `
    <p>الشهادة الطبية للطائرة <strong style="color:#FCA5A5">${escapeHtml(regLabel)}</strong> انتهت رسمياً.</p>
    <ul style="padding-inline-start:18px;margin:12px 0">
      <li>تاريخ الانتهاء: <strong dir="ltr">${escapeHtml(expiryLabel)}</strong></li>
      <li>قدرات الإخلاء الطبي (BMT/ALS/CCT/Repatriation) عُطِّلت تلقائياً.</li>
      <li>الطائرة <strong>لا تظهر</strong> في توزيع طلبات الإخلاء الطبي الجديدة.</li>
    </ul>
    <p>لإعادة تفعيل الطائرة: جدّد الشهادة عبر مصفوفة الشهادات، ثم أعد تفعيل القدرات المناسبة.</p>`;
  const html = shellHtml({
    preheader: `شهادة طبية منتهية — ${regLabel}`,
    heading: 'شهادة طبية منتهية',
    body: bodyHtml,
    ctaUrl,
    ctaLabel: 'تجديد الشهادة',
    toneColor: '#F43F5E', // rose
  });
  const text = [
    `شهادة طبية منتهية — ${regLabel}`,
    `تاريخ الانتهاء: ${expiryLabel}`,
    '',
    `قدرات الإخلاء الطبي عُطِّلت تلقائياً. الطائرة لا تظهر في توزيع طلبات جديدة.`,
    '',
    `تجديد: ${ctaUrl}`,
  ].join('\n');

  try {
    const resend = new Resend(creds.apiKey);
    const { error } = await resend.emails.send({
      from: creds.from,
      to: recipients,
      subject,
      html,
      text,
    });
    if (error) {
      console.error('[medevac.cert-notifications.expired] Resend error', error);
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
    console.error('[medevac.cert-notifications.expired] Resend threw', err);
    await recordMedevacEmailAlertStatus({
      status: 'send_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return { sent: false };
  }
}
