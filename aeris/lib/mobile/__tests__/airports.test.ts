import { strict as assert } from 'node:assert';

import { filterAirportsForMobile } from '@/lib/mobile/airports';
import type { AirportRow } from '@/types/database';

function airport(partial: Partial<AirportRow> & { iata_code: string }): AirportRow {
  return {
    iata_code: partial.iata_code,
    icao_code: partial.icao_code ?? null,
    name: partial.name ?? `${partial.iata_code} Airport`,
    name_ar: partial.name_ar ?? null,
    city: partial.city ?? partial.iata_code,
    city_ar: partial.city_ar ?? null,
    country: partial.country ?? 'Saudi Arabia',
    country_ar: partial.country_ar ?? null,
    latitude: null,
    longitude: null,
    timezone: null,
    is_private_capable: partial.is_private_capable ?? true,
    created_at: '2026-01-01T00:00:00Z',
  };
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ok ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    failed++;
  }
}

const rows = [
  airport({ iata_code: 'JED', city: 'Jeddah', city_ar: 'جدة' }),
  airport({ iata_code: 'RUH', city: 'Riyadh', city_ar: 'الرياض' }),
  airport({ iata_code: 'DXB', city: 'Dubai', country: 'United Arab Emirates' }),
];

test('exact IATA match ranks first', () => {
  const result = filterAirportsForMobile(rows, 'ruh');
  assert.equal(result[0]?.iata_code, 'RUH');
});

test('Arabic city search matches localized fields', () => {
  const result = filterAirportsForMobile(rows, 'جدة');
  assert.deepEqual(
    result.map((r) => r.iata_code),
    ['JED']
  );
});

test('blank query returns KSA airports first', () => {
  const result = filterAirportsForMobile(rows, '', 3);
  assert.deepEqual(
    result.map((r) => r.iata_code),
    ['JED', 'RUH', 'DXB']
  );
});

test('limit is capped to the requested positive count', () => {
  const result = filterAirportsForMobile(rows, '', 1);
  assert.equal(result.length, 1);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
