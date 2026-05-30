import 'server-only';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin/auth';
import { getTicketById, getTicketMessages } from '@/lib/support/queries';
import { TicketThread } from '@/components/support/ticket-thread';
import { ReplyForm } from '@/components/support/reply-form';
import { StatusForm } from '@/components/support/status-form';
import { adminReplyToTicketAction } from '@/app/actions/support';
import {
  SUPPORT_CATEGORY_LABELS,
  type SupportCategory,
} from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

export const dynamic = 'force-dynamic';

function categoryLabel(category: string): string {
  return SUPPORT_CATEGORY_LABELS[category as SupportCategory] ?? category;
}

export default async function AdminSupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  requireAdminSession();
  const { id } = await params;

  const ticket = await getTicketById(id);
  if (!ticket) {
    notFound();
  }

  const messages = await getTicketMessages(ticket.id);

  return (
    <div dir="rtl" className="space-y-6">
      <div>
        <Link href="/admin/support" className="text-sm text-gold-dark hover:underline">
          {supportAr.backToTickets}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-navy">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-muted">
            {ticket.ticket_number} · {categoryLabel(ticket.category)}
          </p>
        </div>
        <div className="rounded-lg border border-secondary bg-white p-3">
          <StatusForm
            ticketId={ticket.id}
            currentStatus={ticket.status}
            currentResolution={ticket.resolution}
          />
        </div>
      </div>

      <TicketThread messages={messages} />

      <div className="rounded-lg border border-secondary bg-white p-4">
        <h2 className="mb-3 text-lg font-medium text-navy">{supportAr.adminReplyTitle}</h2>
        <ReplyForm ticketId={ticket.id} action={adminReplyToTicketAction} />
      </div>
    </div>
  );
}
