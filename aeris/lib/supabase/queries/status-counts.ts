// No 'server-only' import on purpose: this is pure aggregation over an
// injected counter, so the tsx unit suite can import it outside Next.js.
// The Supabase queries live in the (server-only) callers.

export interface HeadCountResult {
  count: number | null;
  error: { message: string } | null;
}

export type StatusCounts<S extends string> = { total: number } & Record<
  S,
  number
>;

/**
 * Counts rows per status with one `count: 'exact', head: true` query
 * per status plus one unfiltered query for `total`, all in parallel.
 *
 * Replaces "select every row's status and tally in JS": that shipped the
 * whole table on each admin list render and was silently capped at
 * PostgREST's max-rows (1000), under-counting once a table grew past it.
 * `total` stays its own query (not the sum) so rows whose status is NULL
 * or outside `statuses` still count, exactly as before.
 *
 * Resolves `{ counts }`, or `{ error }` with the first failure.
 */
export async function countRowsByStatus<S extends string>(
  statuses: readonly S[],
  headCount: (status: S | null) => PromiseLike<HeadCountResult>
): Promise<
  | { counts: StatusCounts<S>; error: null }
  | { counts: null; error: { message: string } }
> {
  const [totalResult, ...statusResults] = await Promise.all([
    headCount(null),
    ...statuses.map((status) => headCount(status)),
  ]);

  const failure = [totalResult, ...statusResults].find((r) => r.error);
  if (failure?.error) return { counts: null, error: failure.error };

  const counts = { total: totalResult.count ?? 0 } as StatusCounts<S>;
  statuses.forEach((status, i) => {
    (counts as Record<S, number>)[status] = statusResults[i].count ?? 0;
  });
  return { counts, error: null };
}
