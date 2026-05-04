import type { FlightRequestInput } from '@/lib/validators/trip-request';
import { whatsappLink } from '@/lib/utils/format';

const TRIP_LABEL_AR: Record<FlightRequestInput['tripType'], string> = {
  one_way: 'ذهاب فقط',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد الوجهات',
};

export function formatFlightRequestMessage(data: FlightRequestInput): string {
  const lines = [
    'مرحباً Aeris،',
    'أرغب بطلب رحلة خاصة بالتفاصيل التالية:',
    '',
    `• الاسم: ${data.customerName}`,
    `• الهاتف: ${data.customerPhone}`,
    `• نوع الرحلة: ${TRIP_LABEL_AR[data.tripType]}`,
    `• من: ${data.origin}`,
    `• إلى: ${data.destination}`,
    `• تاريخ المغادرة: ${data.departureDate}`,
  ];

  if (data.returnDate) {
    lines.push(`• تاريخ العودة: ${data.returnDate}`);
  }

  lines.push(`• عدد الركاب: ${data.passengers}`);

  if (data.notes && data.notes.length > 0) {
    lines.push('', 'ملاحظات:', data.notes);
  }

  lines.push('', 'شكراً لكم.');
  return lines.join('\n');
}

export function buildFlightRequestWhatsAppLink(
  data: FlightRequestInput
): string {
  return whatsappLink(formatFlightRequestMessage(data));
}
