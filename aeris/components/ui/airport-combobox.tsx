'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Edit3, MapPin, Search } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import type { AirportRow } from '@/types/database';

type Mode = 'iata' | 'freeform';

export interface AirportComboboxProps {
  /**
   * Form field base name. The component renders two hidden
   * inputs: `${name}_iata` and `${name}_freeform`. The server
   * validator (Phase 6.0 PR 2 S3) enforces "exactly one of"
   * the two; the component never sends both filled.
   */
  name: string;
  /**
   * Server-pre-fetched airports list. Phase 6.0 spec S2: no
   * client-side fetch — the data ships in the page bundle.
   */
  airports: AirportRow[];
  label: string;
  required?: boolean;
  placeholder?: string;
  /** Translated error string from the parent form's validator. */
  error?: string;
  defaultIata?: string | null;
  defaultFreeform?: string | null;
}

const KSA_COUNTRY = 'Saudi Arabia';

function ksaFirstSort(a: AirportRow, b: AirportRow): number {
  const aKsa = a.country === KSA_COUNTRY;
  const bKsa = b.country === KSA_COUNTRY;
  if (aKsa !== bKsa) return aKsa ? -1 : 1;
  if (a.country !== b.country) return a.country.localeCompare(b.country);
  if (a.city !== b.city) return a.city.localeCompare(b.city);
  return a.name.localeCompare(b.name);
}

function searchHaystack(a: AirportRow): string {
  return [
    a.iata_code,
    a.icao_code ?? '',
    a.name,
    a.name_ar ?? '',
    a.city,
    a.city_ar ?? '',
    a.country,
    a.country_ar ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

function displayLabel(a: AirportRow): string {
  // "city_ar (IATA)" — the visible chip after selection.
  return `${a.city_ar ?? a.city} (${a.iata_code})`;
}

export function AirportCombobox({
  name,
  airports,
  label,
  required,
  placeholder = 'اختر مطاراً أو ابحث…',
  error,
  defaultIata,
  defaultFreeform,
}: AirportComboboxProps) {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const freeformRef = useRef<HTMLInputElement>(null);

  const initialFreeform = defaultFreeform ?? '';
  const initialIata = defaultIata ?? null;
  const initialMode: Mode =
    initialFreeform.length > 0 && !initialIata ? 'freeform' : 'iata';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [selectedIata, setSelectedIata] = useState<string | null>(initialIata);
  const [freeformValue, setFreeformValue] = useState<string>(initialFreeform);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => [...airports].sort(ksaFirstSort), [airports]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((a) => searchHaystack(a).includes(q));
  }, [sorted, search]);

  const selected = useMemo(
    () =>
      selectedIata
        ? airports.find((a) => a.iata_code === selectedIata) ?? null
        : null,
    [airports, selectedIata]
  );

  // Group filtered airports by country (display only).
  const grouped = useMemo(() => {
    const groups: { country: string; items: AirportRow[] }[] = [];
    let last: { country: string; items: AirportRow[] } | null = null;
    for (const a of filtered) {
      if (!last || last.country !== a.country) {
        last = { country: a.country_ar ?? a.country, items: [a] };
        groups.push(last);
      } else {
        last.items.push(a);
      }
    }
    return groups;
  }, [filtered]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (!containerRef.current?.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus the search input when opening; focus the freeform
  // input when switching to freeform mode.
  useEffect(() => {
    if (open && mode === 'iata') {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, mode]);
  useEffect(() => {
    if (mode === 'freeform') {
      requestAnimationFrame(() => freeformRef.current?.focus());
    }
  }, [mode]);

  const onPickAirport = (a: AirportRow) => {
    setSelectedIata(a.iata_code);
    setFreeformValue('');
    setMode('iata');
    setOpen(false);
    setSearch('');
  };

  const onSwitchToFreeform = () => {
    setSelectedIata(null);
    setMode('freeform');
    setOpen(false);
  };

  const onSwitchBackToPicker = () => {
    setMode('iata');
    setFreeformValue('');
    setOpen(true);
  };

  return (
    <div className="block">
      <label
        htmlFor={inputId}
        className="font-ar mb-2 block text-sm text-ink"
      >
        {label}
        {required && <span className="text-gold"> *</span>}
      </label>

      {/* Hidden inputs are the form's source of truth. The
          server validator enforces "exactly one of". */}
      <input type="hidden" name={`${name}_iata`} value={selectedIata ?? ''} />
      <input
        type="hidden"
        name={`${name}_freeform`}
        value={mode === 'freeform' ? freeformValue.trim() : ''}
      />

      <div ref={containerRef} className="relative">
        {mode === 'iata' ? (
          <button
            id={inputId}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={cn(
              'font-ar flex w-full items-center justify-between gap-3 rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink transition-colors',
              'hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40',
              error && 'border-red-400/60'
            )}
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              <MapPin className="h-4 w-4 shrink-0 text-gold/70" aria-hidden />
              <span className="truncate">
                {selected ? (
                  displayLabel(selected)
                ) : (
                  <span className="text-ink-muted/70">{placeholder}</span>
                )}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-ink-muted transition-transform',
                open && 'rotate-180'
              )}
              aria-hidden
            />
          </button>
        ) : (
          <div
            className={cn(
              'flex items-stretch gap-2 rounded-md border border-border bg-navy-secondary/60 px-2 py-1 transition-colors',
              'focus-within:border-gold focus-within:ring-1 focus-within:ring-gold/40',
              error && 'border-red-400/60'
            )}
          >
            <Edit3
              className="my-auto h-4 w-4 shrink-0 text-gold/70"
              aria-hidden
            />
            <input
              id={inputId}
              ref={freeformRef}
              type="text"
              value={freeformValue}
              onChange={(e) => setFreeformValue(e.target.value)}
              maxLength={120}
              placeholder="مطار/مدينة غير مدرج (مثال: العُلا — مطار خاص)"
              aria-invalid={Boolean(error) || undefined}
              className="font-ar block w-full bg-transparent px-2 py-2 text-base text-ink placeholder:text-ink-muted/70 focus:outline-none"
            />
            <button
              type="button"
              onClick={onSwitchBackToPicker}
              className="font-ar shrink-0 rounded-md border border-gold/30 bg-gold/5 px-2 text-xs text-gold-light hover:border-gold hover:bg-gold/15"
            >
              ↺
              <span className="sr-only">عودة لقائمة المطارات</span>
            </button>
          </div>
        )}

        {/* Plain button menu, not an ARIA listbox: options are real
            <button>s reachable by Tab; a listbox role without arrow-key +
            aria-activedescendant support would mislead screen readers. */}
        {open && mode === 'iata' && (
          <div
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-hidden rounded-md border border-border bg-navy-card/95 shadow-luxury backdrop-blur"
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو المدينة أو الكود…"
                className="font-ar block w-full bg-transparent text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none"
              />
            </div>

            <div className="max-h-60 overflow-y-auto py-1">
              {grouped.length === 0 && (
                <p className="font-ar px-4 py-6 text-center text-xs text-ink-muted">
                  لا نتائج. جرّب اسم المدينة بالعربي، أو اضغط &quot;اكتب يدوياً&quot;.
                </p>
              )}
              {grouped.map((group) => (
                <div key={group.country}>
                  <p className="font-ar px-3 pb-1 pt-2 text-[10px] uppercase tracking-tagged text-ink-muted">
                    {group.country}
                  </p>
                  <ul>
                    {group.items.map((a) => {
                      const isSelected = a.iata_code === selectedIata;
                      return (
                        <li key={a.iata_code}>
                          <button
                            type="button"
                            onClick={() => onPickAirport(a)}
                            aria-current={isSelected || undefined}
                            className={cn(
                              'font-ar flex w-full items-baseline justify-between gap-3 px-3 py-2 text-start text-sm text-ink transition-colors hover:bg-gold/10',
                              isSelected && 'bg-gold/10 text-gold-light'
                            )}
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium">
                                {a.city_ar ?? a.city}
                              </span>
                              <span className="text-ink-muted">
                                {' '}
                                — {a.name_ar ?? a.name}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-xs text-gold-light">
                              {a.iata_code}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="border-t border-border/60">
              <button
                type="button"
                onClick={onSwitchToFreeform}
                className="font-ar flex w-full items-center justify-between gap-3 px-3 py-2.5 text-sm text-gold-light transition-colors hover:bg-gold/10"
              >
                <span className="flex items-center gap-2">
                  <Edit3 className="h-4 w-4" aria-hidden />
                  أخرى — اكتب يدوياً
                </span>
                <span className="text-xs text-ink-muted">للمطارات غير المدرجة</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p
          id={`${inputId}-error`}
          className="font-ar mt-1.5 text-xs text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
