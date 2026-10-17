import { listAirports } from '@/lib/supabase/queries/airports';
import type { AirportRow } from '@/types/database';
import { ClientCharterFormClient } from './charter-form-client';

/**
 * Server wrapper: ships the same private-capable airport list the guest
 * /request form uses (no client-side fetch), so signed-in clients pick
 * airports from the shared combobox instead of typing IATA codes.
 * A failed lookup degrades to the legacy IATA text inputs rather than
 * breaking the page.
 */
export async function ClientCharterForm() {
  let airports: AirportRow[] = [];
  try {
    airports = await listAirports({ privateCapable: true });
  } catch (err) {
    console.error('[charter-form] airport list unavailable; falling back to IATA inputs', err);
  }
  return <ClientCharterFormClient airports={airports} />;
}
