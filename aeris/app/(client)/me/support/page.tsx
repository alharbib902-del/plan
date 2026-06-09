import 'server-only';

import Link from 'next/link';
import { requireClientSession } from '@/lib/clients/auth';
import { getTicketsForClient } from '@/lib/support/queries';
import { TicketForm } from '@/components/support/ticket-form';
import { SUPPORT_STATUS_LABELS, type SupportStatus } from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

export const dynamic = 'force-dynamic';

function statusLabel(status: string): string {
  return SUPPORT_STATUS_LABELS[status as SupportStatus] ?? status;
}

export default async function SupportPage() {
  const session = await requireClientSession();
  const tickets = await getTicketsForClient(session.client_id);

  return (
    <div dir="rtl" className="space-y-8">
      <h1 className="text-2xl font-semibold text-ink-primary">{supportAr.centerTitle}</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-ink-primary">{supportAr.newTicketTitle}</h2>
        <div className="rounded-lg border border-border bg-navy-card/40 p-4">
          <TicketForm />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-ink-primary">{supportAr.myTicketsTitle}</h2>
        {tickets.length === 0 ? (
          <p className="text-ink-muted">{supportAr.noTicketsClient}</p>
        ) : (
          <ul className="space-y-3">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="rounded-lg border border-border bg-navy-card/40 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink-primary">{ticket.subject}</span>
                  <span className="text-sm text-ink-muted">{statusLabel(ticket.status)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-ink-muted">{ticket.ticket_number}</span>
                  <Link
                    href={`/me/support/${ticket.id}`}
                    className="text-sm text-gold-light hover:underline"
                  >
                    {supportAr.viewConversation}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
