import type { FlightRequestInput } from '@/lib/validators/trip-request';
import { whatsappLink } from '@/lib/utils/format';

const TRIP_LABEL_AR: Record<FlightRequestInput['tripType'], string> = {
  one_way: 'ذهاب فقط',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد الوجهات',
};

/**
 * Phase 6.0 PR 2 (S3): the WhatsApp message reads display
 * labels for origin / destination, not raw form fields. The
 * Server Action computes the labels from either the picked
 * IATA (looked up via getAirportByCode → "city_ar (IATA)")
 * or the freeform fallback string, and passes them in
 * alongside the validated form data.
 */
export interface FlightRequestForMessage {
  data: FlightRequestInput;
  originLabel: string;
  destinationLabel: string;
}

export function formatFlightRequestMessage(
  input: FlightRequestForMessage
): string {
  const { data, originLabel, destinationLabel } = input;
  const lines = [
    'مرحباً Aeris،',
    'أرغب بطلب رحلة خاصة بالتفاصيل التالية:',
    '',
    `• الاسم: ${data.customerName}`,
    `• الهاتف: ${data.customerPhone}`,
    `• نوع الرحلة: ${TRIP_LABEL_AR[data.tripType]}`,
    `• من: ${originLabel}`,
    `• إلى: ${destinationLabel}`,
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
  input: FlightRequestForMessage
): string {
  return whatsappLink(formatFlightRequestMessage(input));
}
