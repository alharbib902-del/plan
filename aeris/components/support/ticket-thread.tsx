import type { SupportTicketMessageRow } from '@/lib/support/queries';
import { supportAr } from '@/lib/i18n/support-ar';

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      timeZone: 'Asia/Riyadh',
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function TicketThread({ messages }: { messages: SupportTicketMessageRow[] }) {
  if (messages.length === 0) {
    return <p className="text-muted">{supportAr.noMessages}</p>;
  }

  return (
    <ul className="space-y-3" dir="rtl">
      {messages.map((message) => {
        const isStaff = message.author_role === 'admin' || message.author_role === 'support';
        return (
          <li
            key={message.id}
            className={
              isStaff
                ? 'rounded-lg border border-gold/40 bg-gold-light/20 p-4'
                : 'rounded-lg border border-secondary bg-white p-4'
            }
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-navy">
                {isStaff ? supportAr.staffName : supportAr.clientName}
              </span>
              <span className="text-xs text-muted">{formatDateTime(message.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-navy">{message.body}</p>
          </li>
        );
      })}
    </ul>
  );
}
