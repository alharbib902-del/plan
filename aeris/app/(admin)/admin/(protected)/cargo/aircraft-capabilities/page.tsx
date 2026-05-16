import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { cargoAr } from '@/lib/i18n/cargo-ar';
import { CapabilitiesEditor } from '@/components/admin/cargo/capabilities-editor';
import type { CargoAircraftCapabilityRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 — admin cargo aircraft capability matrix.
 *
 * The §3.5 cargo_aircraft_capabilities table maps each
 * `aircraft_id` to per-cargo-type boolean flags. The §4.3
 * submit_cargo_offer RPC uses this to filter which operators
 * can quote which cargo types.
 *
 * This page lists ALL aircraft (with operator name from JOIN)
 * + an existing capability row (if any). Founder toggles per-
 * type flags inline; on save, the CapabilitiesEditor client
 * component upserts via the admin Server Action.
 *
 * PR 1 ships the page + editor; PR 3 may extend with bulk
 * import + auto-population from operator-self-declared
 * aircraft profiles.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.capabilitiesPageTitle,
  robots: { index: false, follow: false },
};

interface AircraftWithCaps {
  aircraft_id: string;
  aircraft_label: string;
  operator_label: string;
  capability: CargoAircraftCapabilityRow | null;
}

// Loose-typed cast: the aircraft table exists in the DB schema
// (Phase 1 initial_schema.sql) but isn't registered in the
// hand-maintained types/database.ts Tables map. Mirror Phase 8
// PR 2e #48 + Phase 9 PR 1 convention #1 looseClient pattern
// for table reads in admin server components.
//
// We use an `any`-like loose shape (typed as `unknown` then
// asserted) because typing the full PostgrestQueryBuilder
// chain manually would duplicate the supabase-js type surface.
// The narrowing back to typed shapes happens at the data
// destructure step (RawAircraft + downstream maps).
type LooseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean }) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
      in: (col: string, vals: string[]) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
};

async function loadAircraftWithCapabilities(): Promise<AircraftWithCaps[]> {
  noStore();
  const admin = createAdminClient() as unknown as LooseAdmin;

  // Pull all aircraft + their operator_id; join in memory to
  // capability rows (left join shape — keep aircraft without
  // capability rows visible so founder can seed them).
  // Hotfix (post-Phase 11 activation): the aircraft table from
  // initial_schema.sql doesn't have a `type` column — the actual
  // columns are `manufacturer`, `model`, `category`. Selecting
  // `type` made this page throw 500 on first admin visit.
  const { data: aircraftData, error: aircraftError } = await admin
    .from('aircraft')
    .select('id, registration, manufacturer, model, category, operator_id')
    .order('registration', { ascending: true });

  if (aircraftError) {
    console.error('[cargo.capabilities] aircraft read failed', aircraftError);
    throw new Error(
      `loadAircraftWithCapabilities aircraft failed: ${aircraftError.message}`
    );
  }

  interface RawAircraft {
    id?: string;
    registration?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    category?: string | null;
    operator_id?: string | null;
  }
  const aircraft = (aircraftData ?? []) as RawAircraft[];
  if (aircraft.length === 0) return [];

  const operatorIds: string[] = [];
  for (const a of aircraft) {
    if (a.operator_id) operatorIds.push(a.operator_id);
  }
  const aircraftIds: string[] = [];
  for (const a of aircraft) {
    if (a.id) aircraftIds.push(a.id);
  }

  const [opsResult, capsResult] = await Promise.all([
    operatorIds.length > 0
      ? admin
          .from('operators')
          .select('id, company_name')
          .in('id', operatorIds)
      : Promise.resolve({ data: [], error: null }),
    aircraftIds.length > 0
      ? admin
          .from('cargo_aircraft_capabilities')
          .select('*')
          .in('aircraft_id', aircraftIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (opsResult.error) {
    console.error('[cargo.capabilities] operators read failed', opsResult.error);
  }
  if (capsResult.error) {
    console.error('[cargo.capabilities] caps read failed', capsResult.error);
  }

  const opNameById = new Map<string, string>();
  for (const op of (opsResult.data ?? []) as {
    id?: string;
    company_name?: string;
  }[]) {
    if (op.id && op.company_name) opNameById.set(op.id, op.company_name);
  }

  const capByAircraft = new Map<string, CargoAircraftCapabilityRow>();
  for (const c of (capsResult.data ?? []) as CargoAircraftCapabilityRow[]) {
    if (c.aircraft_id) capByAircraft.set(c.aircraft_id, c);
  }

  const out: AircraftWithCaps[] = [];
  for (const a of aircraft) {
    if (!a.id) continue;
    const reg = a.registration ?? '—';
    // Hotfix: build a friendly label from manufacturer + model
    // (e.g. "HZ-XXX (Boeing 747)") instead of the non-existent
    // `type` column.
    const modelLabel = [a.manufacturer, a.model].filter(Boolean).join(' ');
    out.push({
      aircraft_id: a.id,
      aircraft_label: modelLabel ? `${reg} (${modelLabel})` : reg,
      operator_label: a.operator_id
        ? opNameById.get(a.operator_id) ?? '—'
        : '—',
      capability: capByAircraft.get(a.id) ?? null,
    });
  }
  return out;
}

export default async function AdminCargoCapabilitiesPage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();

  const rows = await loadAircraftWithCapabilities();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {cargoAr.capabilitiesPageTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {cargoAr.capabilitiesPageSubtitle}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {cargoAr.capabilitiesEmpty}
          </p>
        </div>
      ) : (
        <CapabilitiesEditor rows={rows} />
      )}
    </section>
  );
}
