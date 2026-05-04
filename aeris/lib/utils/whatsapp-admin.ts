import type { LeadInquiryRow } from '@/types/database';
import { normalizeWhatsAppPhone } from '@/lib/utils/format';

const TRIP_LABEL_AR: Record<LeadInquiryRow['trip_type'], string> = {
  one_way: 'ذهاب فقط',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد الوجهات',
};

/**
 * Build a WhatsApp deep link to message THIS LEAD'S customer phone
 * (not the Aeris number) with a pre-filled team-side opening message.
 */
export function buildLeadWhatsAppLink(lead: LeadInquiryRow): string {
  const phone = normalizeWhatsAppPhone(lead.customer_phone);
  const lines = [
    `مرحباً ${lead.customer_name}،`,
    `نتواصل معك من فريق Aeris بخصوص طلب الرحلة ${lead.request_number}.`,
    '',
    `• نوع الرحلة: ${TRIP_LABEL_AR[lead.trip_type]}`,
    `• من ${lead.origin} إلى ${lead.destination}`,
    `• المغادرة: ${lead.departure_date}`,
  ];
  if (lead.return_date) {
    lines.push(`• العودة: ${lead.return_date}`);
  }
  lines.push(`• عدد الركاب: ${lead.passengers}`);
  lines.push('', 'هل التفاصيل صحيحة؟');

  const text = encodeURIComponent(lines.join('\n'));
  return `https://wa.me/${phone}?text=${text}`;
}
