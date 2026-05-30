'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { operatorsAr } from '@/lib/i18n/operators-ar';
import { retireAircraft } from '@/app/actions/operators-fleet';
import type {
  OperatorAircraftRow,
  OperatorAircraftStatus,
} from '@/lib/operators/fleet';
import { OperatorBanner, operatorErrorMessage } from './error-banner';
import { AircraftForm } from './aircraft-form';

const ar = operatorsAr.portal.fleet;

type Mode =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string };

const STATUS_TONE: Record<OperatorAircraftStatus, string> = {
  active: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  maintenance: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  retired: 'border-border bg-navy-secondary/60 text-ink-muted',
};

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat('en-US').format(n);
  } catch {
    return String(n);
  }
}

function capabilities(a: OperatorAircraftRow): string {
  const parts: string[] = [];
  if (a.is_cargo_capable) parts.push(ar.capCargo);
  if (a.is_medevac_capable) parts.push(ar.capMedevac);
  return parts.length > 0 ? parts.join('، ') : ar.capNone;
}

export function FleetManager({
  aircraft,
}: {
  aircraft: OperatorAircraftRow[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [confirmRetireId, setConfirmRetireId] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const afterMutation = () => {
    setMode({ kind: 'none' });
    router.refresh();
  };

  const onRetire = (id: string) => {
    // First click arms the confirm; second click (same row) executes.
    if (confirmRetireId !== id) {
      setConfirmRetireId(id);
      return;
    }
    setErrorCode(null);
    setRetiringId(id);
    startTransition(async () => {
      const result = await retireAircraft({ aircraft_id: id });
      setRetiringId(null);
      setConfirmRetireId(null);
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {errorCode ? (
        <OperatorBanner kind="error">
          {operatorErrorMessage(errorCode)}
        </OperatorBanner>
      ) : null}

      {mode.kind === 'create' ? (
        <AircraftForm
          mode="create"
          onSuccess={afterMutation}
          onCancel={() => setMode({ kind: 'none' })}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setErrorCode(null);
            setMode({ kind: 'create' });
          }}
          className="font-ar rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25"
        >
          {ar.addAircraft}
        </button>
      )}

      {aircraft.length === 0 ? (
        <p className="font-ar rounded-xl border border-border bg-navy-card/40 p-6 text-sm text-ink-muted">
          {ar.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-navy-card/40">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-border">
                <Th>{ar.col.registration}</Th>
                <Th>{ar.col.model}</Th>
                <Th>{ar.col.category}</Th>
                <Th>{ar.col.pax}</Th>
                <Th>{ar.col.rate}</Th>
                <Th>{ar.col.capabilities}</Th>
                <Th>{ar.col.status}</Th>
                <Th>{ar.col.actions}</Th>
              </tr>
            </thead>
            <tbody>
              {aircraft.map((a) => {
                const isEditing = mode.kind === 'edit' && mode.id === a.id;
                const isRetired = a.status === 'retired';
                return (
                  <Fragment key={a.id}>
                    <tr className="border-b border-border/60 last:border-b-0">
                      <Td>
                        <span dir="ltr">{a.registration}</span>
                      </Td>
                      <Td>
                        {a.manufacturer} {a.model}
                      </Td>
                      <Td>{ar.categories[a.category]}</Td>
                      <Td>{formatInt(a.max_passengers)}</Td>
                      <Td>{formatInt(a.base_hourly_rate)}</Td>
                      <Td>{capabilities(a)}</Td>
                      <Td>
                        <span
                          className={`font-ar inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[a.status]}`}
                        >
                          {ar.statuses[a.status]}
                        </span>
                      </Td>
                      <Td>
                        {isRetired ? (
                          <span className="font-ar text-xs text-ink-muted">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setMode(
                                  isEditing
                                    ? { kind: 'none' }
                                    : { kind: 'edit', id: a.id }
                                )
                              }
                              className="font-ar rounded-md border border-border px-3 py-1 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light"
                            >
                              {ar.edit}
                            </button>
                            <button
                              type="button"
                              onClick={() => onRetire(a.id)}
                              disabled={retiringId === a.id}
                              className="font-ar rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
                            >
                              {retiringId === a.id
                                ? ar.retiring
                                : confirmRetireId === a.id
                                  ? ar.retireConfirm
                                  : ar.retire}
                            </button>
                          </div>
                        )}
                      </Td>
                    </tr>
                    {isEditing ? (
                      <tr>
                        <td colSpan={8} className="p-3">
                          <AircraftForm
                            mode="edit"
                            initial={a}
                            onSuccess={afterMutation}
                            onCancel={() => setMode({ kind: 'none' })}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="font-ar p-3 text-xs font-normal text-ink-muted">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="font-ar p-3 text-sm text-ink-primary">{children}</td>;
}
