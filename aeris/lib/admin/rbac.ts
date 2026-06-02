import type { AdminUserRole } from '@/lib/admin/users/queries';

/**
 * Admin least-privilege policy (SEC-01).
 *
 * Roles permitted to perform SENSITIVE write actions — financial,
 * operator-lifecycle, booking-creating, config, and money-affecting
 * dispatch. The `support` role is intentionally EXCLUDED: it is a
 * front-line role limited to support tickets and lead triage
 * (status + internal notes), never operator/booking/financial work.
 *
 * Pass ADMIN_WRITE_ROLES to `requireAdminSession({ roles })` on every
 * sensitive admin Server Action. Read pages and self-account actions
 * (password/MFA) stay open to all admin roles (no `roles` arg).
 *
 * NOTE: this is type-only at runtime (no server-only import) so it is
 * trivially unit-testable; the actual gate + redirect lives in
 * requireAdminSession (lib/admin/auth.ts).
 */
export const ADMIN_WRITE_ROLES: readonly AdminUserRole[] = ['owner', 'admin'];

/** Pure membership check — unit-testable without cookies/redirects. */
export function adminRoleAllowed(
  role: AdminUserRole,
  allowed: readonly AdminUserRole[]
): boolean {
  return allowed.includes(role);
}
