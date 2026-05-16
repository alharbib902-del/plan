import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { medevacAr } from '@/lib/i18n/medevac-ar';
import {
  CertMatrixEditor,
  type AircraftWithCert,
} from '@/components/admin/medevac/cert-matrix-editor';
import type { AircraftMedicalCertificationRow } from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — admin /admin/medevac/medical-certifications.
 *
 * Per-aircraft medical capability + cert expiry matrix. Mirrors
 * the Phase 11 cargo aircraft-capabilities admin page shape:
 * lists ALL aircraft + their current cert row (left-join in
 * memory); founder toggles per-cert flags + expiry inline via
 * the CertMatrixEditor client component which calls
 * upsertMedicalCertification Server Action.
 *
 * The DB trigger enforce_aircraft_medical_certifications_trigger
 * applies the structural rules (future-only expiry, no flag
 * re-enable on expired cert, at-least-one supports_* true
 * except for the PR 3 cron expiry-flip path).
 *
 * Gated behind ENABLE_MEDEVAC env flag.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: medevacAr.certMatrixTitle,
  robots: { index: false, follow: false },
};

// Loose-typed reader (Phase 9 PR 1 convention #15) — aircraft +
// operators tables exist in DB but aren't registered in the
// hand-maintained types/database.ts. Mirrors the cargo
// aircraft-capabilities page pattern (file:
// app/(admin)/admin/(protected)/cargo/aircraft-capabilities/page.tsx).
type LooseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
      in: (
        col: string,
        vals: string[]
      ) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
};

async function loadAircraftWithCerts(): Promise<AircraftWithCert[]> {
  noStore();
  const admin = createAdminClient() as unknown as LooseAdmin;

  const { data: aircraftData, error: aircraftError } = await admin
    .from('aircraft')
    .select('id, registration, manufacturer, model, category, operator_id')
    .order('registration', { ascending: true });

  if (aircraftError) {
    console.error('[medevac.cert-matrix] aircraft read failed', aircraftError);
    throw new Error(
      `loadAircraftWithCerts aircraft failed: ${aircraftError.message}`
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

  const [opsResult, certsResult] = await Promise.all([
    operatorIds.length > 0
      ? admin.from('operators').select('id, company_name').in('id', operatorIds)
      : Promise.resolve({ data: [], error: null }),
    aircraftIds.length > 0
      ? admin
          .from('aircraft_medical_certifications')
          .select('*')
          .in('aircraft_id', aircraftIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (opsResult.error) {
    console.error(
      '[medevac.cert-matrix] operators read failed',
      opsResult.error
    );
  }
  if (certsResult.error) {
    console.error('[medevac.cert-matrix] certs read failed', certsResult.error);
  }

  const opNameById = new Map<string, string>();
  for (const op of (opsResult.data ?? []) as {
    id?: string;
    company_name?: string;
  }[]) {
    if (op.id && op.company_name) opNameById.set(op.id, op.company_name);
  }

  const certByAircraft = new Map<string, AircraftMedicalCertificationRow>();
  for (const c of (certsResult.data ?? []) as AircraftMedicalCertificationRow[]) {
    if (c.aircraft_id) certByAircraft.set(c.aircraft_id, c);
  }

  const out: AircraftWithCert[] = [];
  for (const a of aircraft) {
    if (!a.id) continue;
    const reg = a.registration ?? '—';
    const modelLabel = [a.manufacturer, a.model].filter(Boolean).join(' ');
    out.push({
      aircraft_id: a.id,
      aircraft_label: modelLabel ? `${reg} (${modelLabel})` : reg,
      operator_label: a.operator_id
        ? opNameById.get(a.operator_id) ?? '—'
        : '—',
      cert: certByAircraft.get(a.id) ?? null,
    });
  }
  return out;
}

export default async function AdminMedevacCertMatrixPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const rows = await loadAircraftWithCerts();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {medevacAr.certMatrixTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {medevacAr.certMatrixSubtitle}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            لا توجد طائرات مسجلة. أضف الطائرات أولاً من إدارة المشغلين.
          </p>
        </div>
      ) : (
        <CertMatrixEditor rows={rows} />
      )}
    </section>
  );
}
