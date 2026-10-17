// Server-side ONLY — same rationale as matching.ts.
import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 7 PR 2e — frequency cap reader for the matching
 * engine.
 *
 * Two checks (Codex iteration-2 P1 #2 + iteration-6 P2 #2
 * fixes — reads from `empty_leg_notifications`, NOT the
 * legacy `notifications` table whose `user_id NOT NULL`
 * shape cannot key on guest `lead_inquiries`):
 *
 *   1. **24h rate cap** — count notifications sent to the
 *      same `lead_inquiry_id` in the last 24h. The matcher
 *      excludes a candidate when this count is >= the cap
 *      (default 1 — one notification per 24h per lead).
 *
 *   2. **Per-leg dedupe** — never notify the same customer
 *      twice on the same leg, even on `price_dropped`
 *      re-matching. Implemented via the unique
 *      `(lead_inquiry_id, leg_id)` index from PR 1 §13;
 *      this module exposes a fast lookup so the
 *      matcher can filter before the INSERT (the unique
 *      index is the authoritative second line of defense
 *      per Codex iteration-5 P2 #1).
 *
 * Both checks run for the matcher's WHOLE candidate set at once
 * (chunked `.in(...)` reads grouped in memory) under the admin
 * client, so the matcher sees every row regardless of RLS posture.
 */

const NOTIFICATIONS_TABLE = 'empty_leg_notifications';
const DEFAULT_CAP_PER_24H = 1;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
// Keeps each `.in(...)` URL well under gateway limits (~37 chars per
// UUID); 1000 candidates → 5 chunks per check instead of 1000 queries.
const ID_CHUNK_SIZE = 200;
// PostgREST caps a response at max-rows (Supabase default 1000); paging
// guarantees no notification row is silently dropped from the tally.
// Must not exceed max-rows: a short page is read as "last page".
const PAGE_SIZE = 1000;

export const FREQUENCY_CAP_PER_24H = DEFAULT_CAP_PER_24H;

export type RecipientKey = 'lead_inquiry_id' | 'client_id';

export type RecipientRowFilter =
  | { kind: 'sent_after'; sentAfterIso: string }
  | { kind: 'on_leg'; legId: string };

/**
 * Reads one page of `empty_leg_notifications` rows whose recipient
 * column (`key`) is in `ids` and that match `filter`, ordered by `id`,
 * returning the recipient id of each row. Injectable so the batching
 * logic is unit-testable without a DB.
 */
export type RecipientPageReader = (args: {
  key: RecipientKey;
  ids: readonly string[];
  filter: RecipientRowFilter;
  from: number;
  to: number;
}) => Promise<(string | null)[]>;

/**
 * Pure skip rule — identical to the former per-candidate gate:
 * skip when the recipient's notifications inside the 24h window are
 * `>= capPer24h`, OR it was already notified on this leg.
 */
export function selectRecipientsToSkip(args: {
  ids: readonly string[];
  recentRecipientIds: readonly (string | null)[];
  legRecipientIds: readonly (string | null)[];
  capPer24h?: number;
}): Set<string> {
  const capPer24h = args.capPer24h ?? DEFAULT_CAP_PER_24H;
  const recentCounts = new Map<string, number>();
  for (const id of args.recentRecipientIds) {
    if (id) recentCounts.set(id, (recentCounts.get(id) ?? 0) + 1);
  }
  const onLeg = new Set<string>();
  for (const id of args.legRecipientIds) {
    if (id) onLeg.add(id);
  }

  const skip = new Set<string>();
  for (const id of args.ids) {
    if ((recentCounts.get(id) ?? 0) >= capPer24h || onLeg.has(id)) {
      skip.add(id);
    }
  }
  return skip;
}

async function readAllRecipientIds(
  read: RecipientPageReader,
  key: RecipientKey,
  ids: readonly string[],
  filter: RecipientRowFilter,
  chunkSize: number,
  pageSize: number
): Promise<(string | null)[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  const perChunk = await Promise.all(
    chunks.map(async (chunk) => {
      const out: (string | null)[] = [];
      for (let from = 0; ; from += pageSize) {
        const page = await read({
          key,
          ids: chunk,
          filter,
          from,
          to: from + pageSize - 1,
        });
        out.push(...page);
        if (page.length < pageSize) break;
      }
      return out;
    })
  );
  return perChunk.flat();
}

/**
 * Batched frequency-cap + per-leg dedupe for a whole candidate set.
 * Returns the ids the matcher must EXCLUDE. Same rules as running the
 * per-candidate gate for each id, at O(ids / chunk) queries instead of
 * 2 queries per candidate.
 */
export async function collectRecipientsToSkip(
  key: RecipientKey,
  ids: readonly string[],
  legId: string,
  opts: {
    read?: RecipientPageReader;
    now?: Date;
    capPer24h?: number;
    chunkSize?: number;
    pageSize?: number;
  } = {}
): Promise<Set<string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Set();

  const read = opts.read ?? readRecipientPageFromDb;
  const nowMs = (opts.now ?? new Date()).getTime();
  const sentAfterIso = new Date(nowMs - WINDOW_24H_MS).toISOString();
  const chunkSize = opts.chunkSize ?? ID_CHUNK_SIZE;
  const pageSize = opts.pageSize ?? PAGE_SIZE;

  const [recentRecipientIds, legRecipientIds] = await Promise.all([
    readAllRecipientIds(
      read,
      key,
      unique,
      { kind: 'sent_after', sentAfterIso },
      chunkSize,
      pageSize
    ),
    readAllRecipientIds(
      read,
      key,
      unique,
      { kind: 'on_leg', legId },
      chunkSize,
      pageSize
    ),
  ]);

  return selectRecipientsToSkip({
    ids: unique,
    recentRecipientIds,
    legRecipientIds,
    capPer24h: opts.capPer24h,
  });
}

const readRecipientPageFromDb: RecipientPageReader = async ({
  key,
  ids,
  filter,
  from,
  to,
}) => {
  noStore();
  const client = createAdminClient();
  let query = client
    .from(NOTIFICATIONS_TABLE)
    .select('lead_inquiry_id, client_id')
    .in(key, [...ids]);
  query =
    filter.kind === 'on_leg'
      ? query.eq('leg_id', filter.legId)
      : query.gt('sent_at', filter.sentAfterIso);
  const { data, error } = await query
    .order('id', { ascending: true })
    .range(from, to);

  if (error) {
    console.error('[frequency-cap] batched lookup failed', error);
    throw new Error(`frequency-cap lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) =>
    key === 'lead_inquiry_id' ? row.lead_inquiry_id : row.client_id
  );
};

/**
 * Lead candidates the matcher must exclude for `legId`: over the 24h
 * cap (keyed on `lead_inquiry_id`) or already notified on this leg.
 */
export function listLeadsToSkip(
  leadInquiryIds: readonly string[],
  legId: string
): Promise<Set<string>> {
  return collectRecipientsToSkip('lead_inquiry_id', leadInquiryIds, legId);
}

/**
 * Phase 10 PR 1 — client-keyed sibling of `listLeadsToSkip`. Same 24h
 * window + 1-per-cycle default cap. Indexes from §3.2:
 * idx_empty_leg_notifications_client_24h (partial WHERE client_id IS
 * NOT NULL) + idx_empty_leg_notifications_client_leg_unique.
 */
export function listClientsToSkip(
  clientIds: readonly string[],
  legId: string
): Promise<Set<string>> {
  return collectRecipientsToSkip('client_id', clientIds, legId);
}
