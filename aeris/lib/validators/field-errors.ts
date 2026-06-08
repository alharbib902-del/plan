/**
 * Shared Zod issue → field-error map helper.
 *
 * Server Actions surface validation failures as a flat
 * `Record<string, string>` keyed by the dotted Zod issue path
 * (e.g. `pax.adults`). This collapses a Zod issue list into that
 * shape, dropping path-less (root) issues. Previously copy-pasted
 * verbatim across ~20 action modules; centralised here so the
 * single implementation stays in lock-step.
 */
export function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
}
