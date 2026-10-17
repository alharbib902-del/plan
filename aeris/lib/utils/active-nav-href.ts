/**
 * Picks the one nav href that should be marked current for `pathname`.
 *
 * Longest-prefix wins: shells list parents next to their own children
 * (`/admin/empty-legs` + `/admin/empty-legs/operators`), and a plain
 * `startsWith` check would highlight both at once.
 */
export function resolveActiveNavHref(
  pathname: string,
  hrefs: readonly string[]
): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}
