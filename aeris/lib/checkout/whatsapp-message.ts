/**
 * Phase 6.2 PR 2c: customer WhatsApp confirm-booking message
 * builder.
 *
 * Pure function — given the booking-shape data (post-snapshot
 * extraction), the active add-ons (caller filters cancelled
 * out), and the personal review URL, returns the multi-line
 * Arabic message body the customer's WhatsApp will prefill
 * when they click "أكّد الحجز عبر واتساب" on the checkout-
 * prep page.
 *
 * Shape decisions (from PR 2c spec):
 *   - Greeting: "السلام عليكم ورحمة الله،"
 *   - Self-introduction: "أنا {name}، أؤكّد حجزي مع Aeris."
 *     - When `customer_name_snapshot` is NULL or whitespace-
 *       only (guest mode), drops the name clause and keeps
 *       "أؤكّد حجزي مع Aeris." alone.
 *   - Trip details: bullet list of booking_number, route,
 *     departure (+ optional return), passengers count
 *     (omitted when NULL).
 *   - Add-ons section: bullet list per active row, omitted
 *     entirely when zero active.
 *   - Totals: compact single-line "الإجمالي: X ريال" when
 *     no active addons; full breakdown (base + addons +
 *     grand total) otherwise.
 *   - Review URL: explicit "رابط مراجعة الحجز:" line with
 *     the personal token URL on its own line so WhatsApp
 *     auto-linkifies cleanly.
 *   - Closing: "أرجو إفادتي بخطوات إكمال الدفع." +
 *     "وشكراً لكم."
 *
 * Arabic-only by design: customer checkout-prep is locked to
 * `lang='ar'` (see `app/(checkout)/booking/[token]/checkout-
 * prep/page.tsx`). If we ever ship an English customer
 * surface, fork this into a `(input, lang)` signature and
 * route the strings through the operator i18n table.
 *
 * The function does NOT URL-encode — the caller wraps the
 * result with `encodeURIComponent` when assembling the wa.me
 * URL. Keeping the encoding split means the unit tests can
 * assert against readable Arabic strings.
 */

export interface WhatsappConfirmActiveAddon {
  /** Resolved from the catalog entry's `label_ar` by caller. */
  labelAr: string;
  /** Final per-row quantity (post per_passenger derivation). */
  quantity: number;
  /** Final price for this row (= quantity × unit_price). */
  totalPrice: number;
}

export interface WhatsappConfirmMessageInput {
  /**
   * From `bookings.customer_name_snapshot`. NULL or
   * whitespace-only → guest mode (name clause dropped).
   */
  customerName: string | null;
  /** From `bookings.booking_number`. Always populated. */
  bookingNumber: string;
  /**
   * Pre-formatted route string, e.g. "جدة ← الرياض". Caller
   * builds via `formatRouteEndpoint(...) + ' ← ' + ...`.
   */
  routeFormatted: string;
  /**
   * Pre-formatted departure datetime in Asia/Riyadh, e.g.
   * "10 مايو 2026، 03:00". The "(بتوقيت الرياض)" suffix is
   * appended by this builder; do NOT include it here.
   */
  departureFormatted: string;
  /**
   * Same shape as `departureFormatted`. NULL when the
   * booking has no return leg.
   */
  returnFormatted: string | null;
  /**
   * From `bookings.passengers_count_snapshot`. NULL → line
   * omitted (legacy bookings).
   */
  passengersCount: number | null;
  /** Base trip price in SAR (numeric). */
  baseAmount: number;
  /** Active add-ons subtotal in SAR. */
  addonsAmount: number;
  /** Grand total in SAR (= base + addons). */
  totalAmount: number;
  /**
   * Already filtered to non-cancelled rows by the caller.
   * Order is preserved in the rendered output.
   */
  activeAddons: ReadonlyArray<WhatsappConfirmActiveAddon>;
  /**
   * Full URL the customer can use to re-open the checkout-
   * prep view from WhatsApp later. Caller builds:
   *   `${siteUrl}/booking/${token}/checkout-prep`
   * with `siteUrl` resolved from
   * `process.env.NEXT_PUBLIC_SITE_URL` (with a fallback).
   */
  reviewUrl: string;
}

export function buildWhatsappConfirmMessage(
  input: WhatsappConfirmMessageInput
): string {
  const lines: string[] = [];

  // Greeting + self-introduction.
  lines.push('السلام عليكم ورحمة الله،');
  lines.push('');
  const trimmedName =
    typeof input.customerName === 'string' ? input.customerName.trim() : '';
  if (trimmedName.length > 0) {
    lines.push(`أنا ${trimmedName}، أؤكّد حجزي مع Aeris.`);
  } else {
    // Guest-mode fallback — drop the name clause, keep the
    // confirmation intent.
    lines.push('أؤكّد حجزي مع Aeris.');
  }
  lines.push('');

  // Trip details block.
  lines.push('تفاصيل الرحلة:');
  lines.push(`• رقم الحجز: ${input.bookingNumber}`);
  lines.push(`• المسار: ${input.routeFormatted}`);
  lines.push(
    `• المغادرة: ${input.departureFormatted} (بتوقيت الرياض)`
  );
  if (input.returnFormatted !== null) {
    lines.push(
      `• العودة: ${input.returnFormatted} (بتوقيت الرياض)`
    );
  }
  if (typeof input.passengersCount === 'number') {
    lines.push(`• عدد الركاب: ${input.passengersCount}`);
  }
  lines.push('');

  // Add-ons block — omitted entirely when empty.
  if (input.activeAddons.length > 0) {
    lines.push('الخدمات الإضافية:');
    for (const addon of input.activeAddons) {
      lines.push(
        `• ${addon.labelAr} (×${addon.quantity}) — ${addon.totalPrice.toLocaleString('en-US')} ريال`
      );
    }
    lines.push('');
  }

  // Totals block.
  // Compact single-line when no addons; full breakdown otherwise.
  if (input.activeAddons.length === 0) {
    lines.push(
      `الإجمالي: ${input.totalAmount.toLocaleString('en-US')} ريال`
    );
  } else {
    lines.push('الإجمالي:');
    lines.push(
      `• أجرة الرحلة: ${input.baseAmount.toLocaleString('en-US')} ريال`
    );
    lines.push(
      `• الخدمات الإضافية: ${input.addonsAmount.toLocaleString('en-US')} ريال`
    );
    lines.push(
      `• الإجمالي النهائي: ${input.totalAmount.toLocaleString('en-US')} ريال`
    );
  }
  lines.push('');

  // Personal review URL on its own line so WhatsApp auto-
  // linkifies cleanly. The accompanying label keeps the
  // bare URL from looking dropped-in.
  lines.push('رابط مراجعة الحجز:');
  lines.push(input.reviewUrl);
  lines.push('');

  // Closing.
  lines.push('أرجو إفادتي بخطوات إكمال الدفع.');
  lines.push('وشكراً لكم.');

  return lines.join('\n');
}
