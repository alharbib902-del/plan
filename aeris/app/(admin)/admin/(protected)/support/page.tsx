import 'server-only';

import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin/auth';
import { getAllTickets } from '@/lib/support/queries';
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_CATEGORY_LABELS,
  type SupportStatus,
  type SupportCategory,
} from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

export const dynamic = 'force-dynamic';

function statusLabel(status: string): string {
  return SUPPORT_STATUS_LABELS[status as SupportStatus] ?? status;
}

function categoryLabel(category: string): string {
  return SUPPORT_CATEGORY_LABELS[category as SupportCategory] ?? category;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-SA', {
      timeZone: 'Asia/Riyadh',
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default async function AdminSupportPage() {
  await requireAdminSession();

  const tickets = await getAllTickets();

  return (
    <div dir="rtl" className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink">{supportAr.adminTicketsTitle}</h1>
      {tickets.length === 0 ? (
        <p className="text-ink-secondary">{supportAr.noTicketsAdmin}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-right text-ink-muted">
                <th className="p-2">{supportAr.thNumber}</th>
                <th className="p-2">{supportAr.thSubject}</th>
                <th className="p-2">{supportAr.thCategory}</th>
                <th className="p-2">{supportAr.thStatus}</th>
                <th className="p-2">{supportAr.thUpdated}</th>
                <th className="p-2"><span className="sr-only">{supportAr.thActions}</span></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b border-border">
                  <td className="p-2 text-ink">{ticket.ticket_number}</td>
                  <td className="p-2 text-ink">{ticket.subject}</td>
                  <td className="p-2 text-ink">{categoryLabel(ticket.category)}</td>
                  <td className="p-2 text-ink">{statusLabel(ticket.status)}</td>
                  <td className="p-2 text-ink-secondary">{formatDate(ticket.updated_at)}</td>
                  <td className="p-2">
                    <Link
                      href={`/admin/support/${ticket.id}`}
                      className="text-gold-light hover:underline"
                    >
                      {supportAr.openAction}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
