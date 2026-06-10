/**
 * Phase 8 PR 2c — operator-tree root layout.
 *
 * Used by both the public auth pages (/operator/signup,
 * /operator/login, /operator/forgot-password, etc.) and the
 * authed (authed) group. The (authed) layout adds the portal
 * shell (nav + cookie validation) on top of this one.
 *
 * The page modules below all `notFound()` unless
 * ENABLE_OPERATOR_PORTAL is the literal `'true'` so a deploy
 * without the flag flipped on returns 404 across the entire
 * portal tree.
 */
export default function OperatorRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
