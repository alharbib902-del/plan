import 'server-only';

import { unstable_cache, unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AirportRow } from '@/types/database';

// Phase 6.0 PR 2: isIataFormat lives in lib/utils/iata.ts so
// the operator-portal client surface can import it without
// pulling `server-only` along. Re-exported here for back-compat
// with any code that already imports it from this module
// (acceptance #6's Server Action validation chain still uses
// the same name).
export { isIataFormat } from '@/lib/utils/iata';

const TABLE = 'airports';

/** Tag for `revalidateTag` should the reference table ever be edited. */
export const AIRPORTS_CACHE_TAG = 'airports';

export interface ListAirportsOptions {
  /**
   * Filter to airports where `is_private_capable = <value>`.
   * Phase 6.0 keeps this column as the only filter knob per
   * Resolved decision #3 (no new active/phase/priority
   * columns added in 6.0).
   */
  privateCapable?: boolean;
  /**
   * Filter to a single ISO country name (e.g. 'Saudi
   * Arabia'). Useful for the picker's "KSA group" rendering
   * if the implementer wants to fetch the two groups
   * separately, though Phase 6.0 PR 2 is expected to fetch
   * once and group client-side.
   */
  country?: string;
}

// Data-cached for a day: the table is seed-only reference data (no app
// writer), yet it was re-read on every /request, checkout-prep and
// operator page render. Errors throw and are therefore never cached.
const readAirportsCached = unstable_cache(
  async (
    privateCapable: boolean | null,
    country: string | null
  ): Promise<AirportRow[]> => {
    const client = createAdminClient();

    let query = client
      .from(TABLE)
      .select(
        'iata_code, icao_code, name, name_ar, city, city_ar, country, country_ar, latitude, longitude, timezone, is_private_capable, created_at'
      );
    if (privateCapable !== null) {
      query = query.eq('is_private_capable', privateCapable);
    }
    if (country !== null) {
      query = query.eq('country', country);
    }

    const { data, error } = await query
      .order('country', { ascending: true })
      .order('city', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[airports] listAirports failed', error);
      throw new Error(`listAirports failed: ${error.message}`);
    }
    return (data ?? []) as AirportRow[];
  },
  ['airports:list:v1'],
  { revalidate: 86400, tags: [AIRPORTS_CACHE_TAG] }
);

/**
 * Read every airport in the reference table, ordered by
 * country (ASC) then city (ASC) then name (ASC) — a stable
 * order so the PR 2 picker's grouped view is deterministic
 * across renders.
 *
 * RLS on `airports` is public-read since the initial
 * schema, so the admin client is overkill for this call.
 * It's used here for consistency with every other
 * server-only query module in the project (and to keep the
 * import surface uniform — every helper module reaches for
 * `createAdminClient`).
 */
export async function listAirports(
  options: ListAirportsOptions = {}
): Promise<AirportRow[]> {
  return readAirportsCached(
    options.privateCapable ?? null,
    options.country ?? null
  );
}

/**
 * Single-row IATA lookup. Returns the airport row when
 * present, or `null` when the code is not in the table.
 *
 * Use this when you want to read the bilingual name / city
 * for a known code without raising on absence (e.g. the
 * operator-portal display helper rendering the IATA's
 * label).
 */
export async function getAirportByCode(
  iata: string
): Promise<AirportRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select(
      'iata_code, icao_code, name, name_ar, city, city_ar, country, country_ar, latitude, longitude, timezone, is_private_capable, created_at'
    )
    .eq('iata_code', iata)
    .maybeSingle();

  if (error) {
    console.error('[airports] getAirportByCode failed', error);
    throw new Error(`getAirportByCode failed: ${error.message}`);
  }
  return (data as AirportRow | null) ?? null;
}

/**
 * Async assertion: throws when the IATA code is not in the
 * airports table. Used by Server Actions to reject crafted
 * / replay payloads with codes like `'ZZZ'` (acceptance #6
 * in the Phase 6.0 spec).
 *
 * Pairs with `isIataFormat` as a sync pre-filter:
 *
 *   if (!isIataFormat(input)) reject('origin_iata_format');
 *   await assertKnownAirport(input);  // throws if unknown
 *
 * The two-step keeps the cheap rejection cheap and the
 * expensive rejection precise.
 */
export async function assertKnownAirport(iata: string): Promise<AirportRow> {
  const row = await getAirportByCode(iata);
  if (!row) {
    throw new Error(`assertKnownAirport: unknown airport code "${iata}"`);
  }
  return row;
}
