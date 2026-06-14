import { NextResponse } from 'next/server';

import { requireClientBearer } from '@/lib/mobile/auth';
import { filterAirportsForMobile } from '@/lib/mobile/airports';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeAirportForMobile } from '@/lib/mobile/serializers/charter';
import { listAirports } from '@/lib/supabase/queries/airports';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseLimit(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : 30;
}

function parsePrivateCapable(
  value: string | null
): boolean | undefined {
  if (value === 'all') return undefined;
  if (value === 'false') return false;
  return true;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = parseLimit(url.searchParams.get('limit'));
  const privateCapable = parsePrivateCapable(
    url.searchParams.get('private_capable')
  );

  let rows: Awaited<ReturnType<typeof listAirports>>;
  try {
    rows = await listAirports(
      privateCapable === undefined ? {} : { privateCapable }
    );
  } catch (err) {
    console.error('[mobile.airports.search] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }
  const airports = filterAirportsForMobile(rows, q, limit).map(
    serializeAirportForMobile
  );

  return withCors(req, mobileOk({ airports }));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
