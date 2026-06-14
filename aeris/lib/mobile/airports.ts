import type { AirportRow } from '@/types/database';

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function airportHaystack(row: AirportRow): string[] {
  return [
    row.iata_code,
    row.icao_code,
    row.name,
    row.name_ar,
    row.city,
    row.city_ar,
    row.country,
    row.country_ar,
  ].flatMap((v) => {
    const n = norm(v);
    return n ? [n] : [];
  });
}

function scoreAirport(row: AirportRow, q: string): number {
  const iata = norm(row.iata_code);
  const icao = norm(row.icao_code);
  const city = norm(row.city);
  const cityAr = norm(row.city_ar);
  const name = norm(row.name);
  const nameAr = norm(row.name_ar);

  if (iata === q) return 100;
  if (icao === q) return 95;
  if (iata.startsWith(q)) return 90;
  if (icao.startsWith(q)) return 85;
  if (city.startsWith(q) || cityAr.startsWith(q)) return 75;
  if (name.startsWith(q) || nameAr.startsWith(q)) return 70;
  if (airportHaystack(row).some((field) => field.includes(q))) return 50;
  return 0;
}

function ksaFirst(a: AirportRow, b: AirportRow): number {
  const aKsa = a.country === 'Saudi Arabia';
  const bKsa = b.country === 'Saudi Arabia';
  if (aKsa !== bKsa) return aKsa ? -1 : 1;
  return (
    a.country.localeCompare(b.country) ||
    a.city.localeCompare(b.city) ||
    a.name.localeCompare(b.name)
  );
}

export function filterAirportsForMobile(
  rows: AirportRow[],
  query: string,
  limit = 30
): AirportRow[] {
  const q = norm(query);
  const capped = Math.max(1, Math.min(limit, 50));

  if (!q) {
    return [...rows].sort(ksaFirst).slice(0, capped);
  }

  return rows
    .map((row) => ({ row, score: scoreAirport(row, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || ksaFirst(a.row, b.row))
    .slice(0, capped)
    .map((x) => x.row);
}
