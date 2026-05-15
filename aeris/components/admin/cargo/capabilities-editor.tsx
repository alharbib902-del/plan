'use client';

import { useState, useTransition } from 'react';

import { cargoAr } from '@/lib/i18n/cargo-ar';
import { upsertCargoAircraftCapability } from '@/app/actions/cargo-admin';
import type { CargoAircraftCapabilityRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 — admin cargo capability matrix editor.
 *
 * Renders one row per aircraft with 4 toggles (one per cargo
 * type). Save fires the upsertCargoAircraftCapability Server
 * Action; on success, server-side revalidatePath refreshes the
 * page so the new state surfaces.
 *
 * Per-row state is local; saving one row doesn't affect others.
 * Min-validation: at least one toggle must be on (mirrors DB
 * cargo_aircraft_capabilities_at_least_one_check).
 */

interface AircraftWithCaps {
  aircraft_id: string;
  aircraft_label: string;
  operator_label: string;
  capability: CargoAircraftCapabilityRow | null;
}

interface CapabilitiesEditorProps {
  rows: AircraftWithCaps[];
}

export function CapabilitiesEditor({ rows }: CapabilitiesEditorProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="font-ar w-full text-right text-sm">
        <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
          <tr>
            <Th>{cargoAr.capabilitiesTableAircraft}</Th>
            <Th>{cargoAr.capabilitiesTableOperator}</Th>
            <Th>{cargoAr.capabilitiesTableHorse}</Th>
            <Th>{cargoAr.capabilitiesTableCar}</Th>
            <Th>{cargoAr.capabilitiesTableValuables}</Th>
            <Th>{cargoAr.capabilitiesTableOther}</Th>
            <Th>{cargoAr.capabilitiesTableUpdate}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CapabilityRow key={row.aircraft_id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapabilityRow({ row }: { row: AircraftWithCaps }) {
  const [horse, setHorse] = useState(row.capability?.supports_horse ?? false);
  const [car, setCar] = useState(row.capability?.supports_luxury_car ?? false);
  const [valuables, setValuables] = useState(
    row.capability?.supports_valuables ?? false
  );
  const [other, setOther] = useState(row.capability?.supports_other ?? false);
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSave = () => {
    setErrorCode(null);
    setSavedAt(null);
    startTransition(async () => {
      const result = await upsertCargoAircraftCapability({
        aircraft_id: row.aircraft_id,
        supports_horse: horse,
        supports_luxury_car: car,
        supports_valuables: valuables,
        supports_other: other,
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setSavedAt(Date.now());
    });
  };

  return (
    <tr className="border-t border-border/60">
      <Td>
        <span dir="ltr" className="text-ink-primary">
          {row.aircraft_label}
        </span>
      </Td>
      <Td>{row.operator_label}</Td>
      <CheckCell value={horse} onChange={setHorse} />
      <CheckCell value={car} onChange={setCar} />
      <CheckCell value={valuables} onChange={setValuables} />
      <CheckCell value={other} onChange={setOther} />
      <Td>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className="font-ar inline-flex items-center justify-center rounded-md border border-gold/50 bg-gold/15 px-3 py-1 text-xs text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
          >
            {isPending ? '…' : cargoAr.capabilitiesTableUpdate}
          </button>
          {savedAt ? (
            <span className="font-ar text-xs text-emerald-300">
              ✓ {cargoAr.capabilitiesSeedSuccess}
            </span>
          ) : null}
          {errorCode ? (
            <span className="font-ar text-xs text-rose-300" role="alert">
              {capabilityErrorMessage(errorCode)}
            </span>
          ) : null}
        </div>
      </Td>
    </tr>
  );
}

function CheckCell({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Td>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-border bg-navy-secondary text-gold accent-gold focus:ring-2 focus:ring-gold/40"
      />
    </Td>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}

function capabilityErrorMessage(code: string): string {
  const map: Record<string, string> = {
    flag_disabled: cargoAr.errors.flag_disabled,
    aircraft_id_required: 'معرّف الطائرة مفقود.',
    at_least_one_required: 'حدد فئة واحدة على الأقل.',
    server_error: cargoAr.errors.server_error,
  };
  return map[code] ?? cargoAr.errors.server_error;
}
