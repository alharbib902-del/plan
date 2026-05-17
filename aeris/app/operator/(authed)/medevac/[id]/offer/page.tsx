import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOpenMedevacRequestForOperator } from '@/lib/medevac/queries/operator-list';
import { OperatorOfferForm } from '@/components/medevac/operator-offer-form';
import { isUuid } from '@/lib/utils/uuid';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تقديم عرض إخلاء طبي',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

interface AircraftRow {
  id: string;
  registration: string | null;
  manufacturer: string | null;
  model: string | null;
}

interface CertRow {
  aircraft_id: string;
  supports_bmt: boolean;
  supports_als: boolean;
  supports_cct: boolean;
  supports_repatriation: boolean;
  certification_expires_at: string;
}

type LooseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order?: (
          c: string,
          o: { ascending: boolean }
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      } & Promise<{ data: unknown; error: { message?: string } | null }>;
      in: (col: string, vals: string[]) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
};

function matchesService(cert: CertRow, level: string): boolean {
  switch (level) {
    case 'BMT':
      return cert.supports_bmt;
    case 'ALS':
      return cert.supports_als;
    case 'CCT':
      return cert.supports_cct;
    case 'repatriation':
      return cert.supports_repatriation;
    default:
      return false;
  }
}

export default async function OperatorOfferPage({ params }: PageProps) {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();
  if (!isUuid(params.id)) notFound();

  const session = await requireOperatorSession();
  if (session.password_must_change) {
    notFound(); // layout already redirects; defensive
  }

  const request = await getOpenMedevacRequestForOperator(params.id);
  if (!request) notFound();

  // Pull operator's aircraft + cert rows so the form can filter
  // out aircraft that don't have a valid cert for the requested
  // service level. The §4.3 RPC enforces this anyway, but
  // pre-filtering improves UX.
  const loose = createAdminClient() as unknown as LooseAdmin;
  const aircraftResult = await loose
    .from('aircraft')
    .select('id, registration, manufacturer, model')
    .eq('operator_id', session.operator_id);
  const aircraftRows = (aircraftResult.data ?? []) as AircraftRow[];
  const aircraftIds = aircraftRows.map((a) => a.id).filter(Boolean);

  let certRows: CertRow[] = [];
  if (aircraftIds.length > 0) {
    const certResult = await loose
      .from('aircraft_medical_certifications')
      .select(
        'aircraft_id, supports_bmt, supports_als, supports_cct, supports_repatriation, certification_expires_at'
      )
      .in('aircraft_id', aircraftIds);
    certRows = (certResult.data ?? []) as CertRow[];
  }

  const now = Date.now();
  const certByAircraft = new Map<string, CertRow>(
    certRows
      .filter(
        (c) =>
          c.aircraft_id &&
          Date.parse(c.certification_expires_at) > now &&
          matchesService(c, request.service_level)
      )
      .map((c) => [c.aircraft_id, c])
  );

  const aircraftOptions = aircraftRows
    .filter((a) => certByAircraft.has(a.id))
    .map((a) => {
      const modelLabel = [a.manufacturer, a.model]
        .filter(Boolean)
        .join(' ');
      const reg = a.registration ?? a.id.slice(0, 8);
      return {
        id: a.id,
        label: modelLabel ? `${reg} (${modelLabel})` : reg,
      };
    });

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/operator/medevac"
          className="font-ar text-xs text-ink-muted hover:text-ink-secondary"
        >
          ← القائمة
        </Link>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          تقديم عرض إخلاء طبي
        </h1>
        <p dir="ltr" className="font-mono text-sm text-gold-light">
          {request.medevac_request_number}
        </p>
      </header>

      <div className="rounded-xl border border-border bg-navy-card/30 p-4">
        <h2 className="font-ar mb-2 text-sm text-ink-secondary">
          تفاصيل الطلب (بيانات المريض مُخفَّاة)
        </h2>
        <ul className="font-ar space-y-1 text-sm text-ink-primary">
          <li>
            مستوى الخدمة: <span dir="ltr">{request.service_level}</span>
          </li>
          <li>الحالة: {request.condition_severity}</li>
          <li>
            من: {request.from_location_freeform}
            {request.from_iata && (
              <span dir="ltr"> ({request.from_iata})</span>
            )}
          </li>
          <li>
            إلى: {request.to_hospital_name}
            {request.to_iata && <span dir="ltr"> ({request.to_iata})</span>}
          </li>
        </ul>
      </div>

      {aircraftOptions.length === 0 ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
          <p className="font-ar text-sm text-rose-200">
            لا يوجد لديك طائرات معتمدة طبياً للمستوى{' '}
            <span dir="ltr">{request.service_level}</span> وشهادتها سارية.
            تواصل مع الإدارة لإضافة شهادة لإحدى طائراتك.
          </p>
        </div>
      ) : (
        <OperatorOfferForm
          requestId={request.id}
          serviceLevel={request.service_level}
          aircraftOptions={aircraftOptions}
        />
      )}
    </section>
  );
}
