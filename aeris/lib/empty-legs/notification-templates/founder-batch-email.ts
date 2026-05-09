/**
 * Phase 7 PR 2e — founder-batch alert email HTML
 * composition (Codex iteration-4 P1 #1 fix).
 *
 * Reuses the brand template from
 * `lib/notifications/lead-email.ts`: dark navy + gold +
 * Playfair `AERIS` heading + RTL Arabic.
 *
 * Pure function — accepts a summary payload, returns the
 * HTML string. Caller (`founder-batch-email.ts`) handles
 * Resend send + alert-status singleton update.
 */

export interface FounderBatchEmailInput {
  legId: string;
  legNumber: string;
  rowCount: number;
  outreachQueueUrl: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildFounderBatchEmailSubject(
  input: FounderBatchEmailInput
): string {
  return `[Aeris] ${input.rowCount} مراسلة جاهزة — ${input.legNumber}`;
}

export function buildFounderBatchEmailHtml(
  input: FounderBatchEmailInput
): string {
  const queueUrl = escapeHtml(input.outreachQueueUrl);
  const legNumber = escapeHtml(input.legNumber);

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(201,169,97,0.25);border-radius:14px;padding:28px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#E8D4A8;font-size:22px">AERIS</div>
            <h1 style="margin:18px 0 6px;font-size:20px;color:#FAFAFA">مراسلات واتساب جاهزة</h1>
            <p style="margin:0;color:#A8B2C1;font-size:14px">رقم الرحلة: <span style="color:#E8D4A8;font-family:Consolas,monospace">${legNumber}</span></p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid rgba(201,169,97,0.15);border-bottom:1px solid rgba(201,169,97,0.15);padding:8px 0;font-size:14px">
              <tr><td style="padding:6px 0;color:#A8B2C1;width:200px">عدد المراسلات</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${input.rowCount}</td></tr>
            </table>

            <p style="margin-top:18px;color:#A8B2C1;font-size:14px;line-height:1.7">افتح قائمة المراسلات لإرسال روابط واتساب الجاهزة، ثم اضغط "تم الإرسال" بعد كل مراسلة لإخراجها من القائمة.</p>

            <div style="margin-top:28px;text-align:center">
              <a href="${queueUrl}" style="display:inline-block;background:linear-gradient(180deg,#E8D4A8,#C9A961 50%,#8B7339);color:#0A1628;text-decoration:none;font-weight:500;padding:14px 26px;border-radius:8px">فتح قائمة المراسلات</a>
            </div>

            <p style="margin:22px 0 0;color:#6B7A8F;font-size:12px;text-align:center">إشعار تلقائي من نظام Aeris · لا تردّ على هذا البريد.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
