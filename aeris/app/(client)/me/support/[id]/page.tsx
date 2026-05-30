import 'server-only';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireClientSession } from '@/lib/clients/auth';
import { getTicketForClient, getTicketMessages } from '@/lib/support/queries';
import { TicketThread } from '@/components/support/ticket-thread';
import { ReplyForm } from '@/components/support/reply-form';
import { replyToTicketAction } from '@/app/actions/support';
import { SUPPORT_STATUS_LABELS, type SupportStatus } from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

export const dynamic = 'force-dynamic';

function statusLabel(status: string): string {
  return SUPPORT_STATUS_LABELS[status as SupportStatus] ?? status;
}

export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireClientSession();

  const ticket = await getTicketForClient(id, session.client_id);
  if (!ticket) {
    notFound();
  }

  const messages = await getTicketMessages(ticket.id);
  const isClosed = ticket.status === 'closed';

  return (
    <div dir="rtl" className="space-y-6">
      <div>
        <Link href="/me/support" className="text-sm text-gold-dark hover:underline">
          {supportAr.backToTickets}
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy">{ticket.subject}</h1>
        <span className="text-sm text-muted">{statusLabel(ticket.status)}</span>
      </div>

      <TicketThread messages={messages} />

      {isClosed ? (
        <p className="text-muted">{supportAr.ticketClosed}</p>
      ) : (
        <div className="rounded-lg border border-secondary bg-white p-4">
          <h2 className="mb-3 text-lg font-medium text-navy">{supportAr.addReplyTitle}</h2>
          <ReplyForm ticketId={ticket.id} action={replyToTicketAction} />
        </div>
      )}
    </div>
  );
}
