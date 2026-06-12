// No 'server-only' import on purpose — same rationale as
// lib/empty-legs/notifications.ts: the tsx-based unit suites import the
// notifications module (which imports this) outside Next.js where the
// 'server-only' shim is unresolvable. The module only reads process.env;
// the server-side contract is enforced at the call sites.

/**
 * 2026-06 founder decision — empty-leg prices are hidden from clients
 * (guests AND logged-in alike): the client sees the leg + the discount
 * band, sends a reservation request, and the Aeris team sends the price
 * and booking over WhatsApp after a seriousness check.
 *
 * Fail-closed like every other flag: prices stay hidden unless the flag
 * is the literal string 'true'. Operator and admin surfaces are NOT
 * affected — they always see prices.
 */
export function clientPricingVisible(): boolean {
  return process.env.ENABLE_EMPTY_LEGS_CLIENT_PRICING === 'true';
}
