/**
 * Format SAR currency for display.
 */
export function formatSAR(amount: number, options: { showSymbol?: boolean } = {}) {
  const { showSymbol = true } = options;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return showSymbol ? `${formatted} ريال` : formatted;
}

/**
 * Format date in Arabic (Gregorian).
 */
export function formatDateAr(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'Asia/Riyadh',
  }).format(d);
}

/**
 * Format time in Arabic 12-hour format.
 */
export function formatTimeAr(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ar-SA', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    numberingSystem: 'latn',
    timeZone: 'Asia/Riyadh',
  }).format(d);
}

/**
 * Format phone number for display (Saudi format).
 */
export function formatPhone(phone: string) {
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('966')) {
    return `+966 ${clean.slice(3, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
  }
  return phone;
}

/**
 * Normalize a phone number to E.164-style digits suitable for `wa.me/<n>`.
 *
 * - `+9665XXXXXXXX` / `9665XXXXXXXX` → `9665XXXXXXXX`
 * - `05XXXXXXXX` (Saudi local, 10 digits)  → `9665XXXXXXXX`
 * - `5XXXXXXXX`  (Saudi local, 9 digits)   → `9665XXXXXXXX`
 * - Other international inputs pass through after stripping non-digits.
 *
 * Always returns digits only. WhatsApp's `wa.me/` requires no leading `+`.
 */
export function normalizeWhatsAppPhone(phone: string): string {
  const clean = (phone ?? '').replace(/\D/g, '');
  if (clean.startsWith('966')) return clean;
  if (clean.startsWith('05') && clean.length === 10) {
    return `966${clean.slice(1)}`;
  }
  if (clean.startsWith('5') && clean.length === 9) {
    return `966${clean}`;
  }
  return clean;
}

/**
 * Generate WhatsApp link with pre-filled message.
 */
export function whatsappLink(message: string) {
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '966558048004';
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${number}?text=${encoded}`;
}

/**
 * Generate a booking/request number with prefix.
 */
export function generateRequestNumber(prefix: 'AER' | 'EL' | 'MEV' | 'CGO' | 'SHIELD' = 'AER') {
  const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
  const random = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `${prefix}-${timestamp}${random}`;
}
