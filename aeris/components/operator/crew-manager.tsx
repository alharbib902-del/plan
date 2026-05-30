'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { operatorsAr } from '@/lib/i18n/operators-ar';
import { setCrewAvailability } from '@/app/actions/operators-crew';
import type { OperatorCrewRow } from '@/lib/operators/crew';
import { OperatorBanner, operatorErrorMessage } from './error-banner';
import { CrewForm } from './crew-form';

const ar = operatorsAr.portal.crew;

type Mode =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string };

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat('en-US').format(n);
  } catch {
    return String(n);
  }
}

function licenseLabel(c: OperatorCrewRow): string {
  if (!c.license_number) return ar.none;
  return c.license_expiry
    ? `${c.license_number} · ${c.license_expiry}`
    : c.license_number;
}

export function CrewManager({ crew }: { crew: OperatorCrewRow[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const afterMutation = () => {
    setMode({ kind: 'none' });
    router.refresh();
  };

  const onToggleAvailability = (c: OperatorCrewRow) => {
    setErrorCode(null);
    setBusyId(c.id);
    startTransition(async () => {
      const result = await setCrewAvailability({
        crew_id: c.id,
        is_available: !c.is_available,
      });
      setBusyId(null);
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
        <CrewForm
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
          {ar.addCrew}
        </button>
      )}

      {crew.length === 0 ? (
        <p className="font-ar rounded-xl border border-border bg-navy-card/40 p-6 text-sm text-ink-muted">
          {ar.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-navy-card/40">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-border">
                <Th>{ar.col.name}</Th>
                <Th>{ar.col.role}</Th>
                <Th>{ar.col.nationality}</Th>
                <Th>{ar.col.languages}</Th>
                <Th>{ar.col.license}</Th>
                <Th>{ar.col.extra_fee}</Th>
                <Th>{ar.col.availability}</Th>
                <Th>{ar.col.actions}</Th>
              </tr>
            </thead>
            <tbody>
              {crew.map((c) => {
                const isEditing = mode.kind === 'edit' && mode.id === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr className="border-b border-border/60 last:border-b-0">
                      <Td>{c.full_name}</Td>
                      <Td>{ar.roles[c.role]}</Td>
                      <Td>{c.nationality ?? ar.none}</Td>
                      <Td>
                        {c.languages.length > 0 ? c.languages.join('، ') : ar.none}
                      </Td>
                      <Td>
                        <span dir="ltr">{licenseLabel(c)}</span>
                      </Td>
                      <Td>{formatInt(c.extra_fee)}</Td>
                      <Td>
                        <span
                          className={`font-ar inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                            c.is_available
                              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-border bg-navy-secondary/60 text-ink-muted'
                          }`}
                        >
                          {c.is_available
                            ? ar.availability.available
                            : ar.availability.unavailable}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setMode(
                                isEditing
                                  ? { kind: 'none' }
                                  : { kind: 'edit', id: c.id }
                              )
                            }
                            className="font-ar rounded-md border border-border px-3 py-1 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light"
                          >
                            {ar.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleAvailability(c)}
                            disabled={busyId === c.id}
                            className="font-ar rounded-md border border-border px-3 py-1 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:opacity-60"
                          >
                            {busyId === c.id
                              ? ar.updating
                              : c.is_available
                                ? ar.markUnavailable
                                : ar.markAvailable}
                          </button>
                        </div>
                      </Td>
                    </tr>
                    {isEditing ? (
                      <tr>
                        <td colSpan={8} className="p-3">
                          <CrewForm
                            mode="edit"
                            initial={c}
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
