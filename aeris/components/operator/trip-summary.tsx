import type {
  AirportRow,
  BookingAddonRow,
  TripRequestRow,
} from '@/types/database';
import type { TripPreferences } from '@/lib/validators/trip-preferences';
import { ADDONS_BY_SUBTYPE } from '@/lib/addons/catalog';
import {
  aircraftCategoryLabel,
  airportLabel,
  countryDisplayName,
  formatRiyadhDate,
  formatRiyadhDateTime,
  languageDisplayName,
  type Lang,
  t,
} from '@/lib/i18n/operator';

/**
 * Carries token-derived facts the operator needs to see, without
 * the trip summary having to know about HMAC payload shapes.
 * Phase 5.1 P2 wiring fix (iteration 2): explicit prop instead
 * of having OperatorTripSummary peek at the verifier's return.
 */
export type OperatorContext = {
  /** ISO 8601 — from verified payload's expires_at (seconds → date). */
  tokenExpiresAt: string;
  /** For client-side debugging only; not rendered. */
  tokenVersion: 1 | 2;
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-3 border-t border-border/60 py-3 sm:grid-cols-[160px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * Read-only trip summary shown to the operator. Customer name and
 * phone are intentionally NOT included — Phase 4/5 invariant:
 * client identity stays private until acceptance.
 *
 * Phase 5.1 (S1):
 *   - Departure rendered with explicit Asia/Riyadh time + label.
 *   - Link-validity row added (read from operatorContext, not
 *     the trip — the token TTL is what the operator's link will
 *     stop working at, not the trip itself).
 *   - All labels translated via the operator i18n dictionary.
 */
export function OperatorTripSummary({
  trip,
  operatorContext,
  airports,
  lang,
  /**
   * Phase 6.2 PR 2b S6: optional read-only add-ons. When
   * supplied + non-empty, the trip-summary card renders a
   * "الخدمات الإضافية" section beneath the preferences
   * section. Operator cannot mutate; mutation surfaces are
   * admin (S4) + customer (S5) only.
   *
   * Operator-relevant subset of `details` is rendered: the
   * customer-supplied note IS shown (operators need it to
   * coordinate the ground vendor); the customer's WhatsApp
   * phone is NEVER shown (privacy invariant — Phase 4/5
   * "client identity stays private" rule still applies).
   */
  addons,
}: {
  trip: TripRequestRow;
  operatorContext: OperatorContext;
  airports: AirportRow[];
  lang: Lang;
  addons?: BookingAddonRow[];
}) {
  return (
    <div
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="rounded-xl border border-border bg-navy-card/40 p-6"
    >
      <div className="font-mono text-sm text-gold-light">
        {trip.request_number}
      </div>
      <h2 className="font-ar mt-1 text-xl text-ink">{t('trip_details', lang)}</h2>

      <dl className="mt-4">
        <Row label={t('route_label', lang)}>
          <ol className="space-y-1">
            {(trip.legs ?? []).map((leg, idx) => (
              <li key={idx} className="font-ar">
                <span className="text-ink-muted">[{idx + 1}]</span>{' '}
                {airportLabel(leg.from, leg.from_freeform, lang, airports)} ←{' '}
                {airportLabel(leg.to, leg.to_freeform, lang, airports)}
                <span className="ms-2 text-xs text-ink-muted">
                  {formatRiyadhDate(leg.date, lang)}
                </span>
              </li>
            ))}
          </ol>
        </Row>
        <Row label={t('departure_label', lang)}>
          {formatRiyadhDateTime(trip.departure_date, lang)}
        </Row>
        {trip.return_date && (
          <Row label={t('return_label', lang)}>
            {formatRiyadhDateTime(trip.return_date, lang)}
          </Row>
        )}
        <Row label={t('passengers_label', lang)}>{trip.passengers_count}</Row>
        {trip.aircraft_category_preference && (
          <Row label={t('aircraft_category_requested_label', lang)}>
            {aircraftCategoryLabel(trip.aircraft_category_preference, lang)}
          </Row>
        )}
        {/* Phase 6.1 PR 2 (S4): structured customer preferences.
            Section renders iff at least one preference key
            beyond the legacy `lead_trip_type` injection is
            present. Per spec display order: halal, prayer,
            crew gender, pilot nationality, crew nationalities,
            crew languages, child seats, elderly assistance,
            medical notes. */}
        {hasDisplayablePreferences(trip.preferences) && (
          <PreferencesRows preferences={trip.preferences!} lang={lang} />
        )}
        {trip.special_requests && (
          <Row label={t('special_requests_label', lang)}>
            <span className="whitespace-pre-wrap">{trip.special_requests}</span>
          </Row>
        )}
        <Row label={t('link_valid_until_label', lang)}>
          <span className="text-ink-secondary">
            {formatRiyadhDateTime(operatorContext.tokenExpiresAt, lang)}
          </span>
        </Row>
        {/* Phase 6.2 PR 2b S6: read-only add-ons section.
            Renders only when at least one non-cancelled
            add-on exists. Cancelled rows drop OUT — the
            operator's view shows only what the trip actually
            requires for ground prep. */}
        {addons && addons.filter((a) => a.status !== 'cancelled').length > 0 && (
          <AddonsRows addons={addons} lang={lang} />
        )}
      </dl>
    </div>
  );
}

// ============================================================
// Phase 6.2 PR 2b (S6) — read-only add-ons display
// ============================================================

function AddonsRows({
  addons,
  lang,
}: {
  addons: BookingAddonRow[];
  lang: Lang;
}) {
  // Filter out cancelled rows. The remaining rows are the
  // ones the operator actually needs to prepare for.
  const visible = addons.filter((a) => a.status !== 'cancelled');

  return (
    <Row label={t('operator_addons_section_heading', lang)}>
      <ul className="space-y-1">
        {visible.map((addon) => {
          const catalogEntry = ADDONS_BY_SUBTYPE.get(addon.addon_subtype);
          const label =
            (catalogEntry &&
              (lang === 'ar'
                ? catalogEntry.label_ar
                : catalogEntry.label_en)) ??
            addon.addon_subtype;
          const note =
            addon.details &&
            typeof addon.details === 'object' &&
            'note' in addon.details &&
            typeof addon.details.note === 'string'
              ? addon.details.note
              : null;
          return (
            <li key={addon.id} className="font-ar">
              <span className="text-ink">{label}</span>
              <span className="ms-2 text-xs text-ink-muted">
                ×{addon.quantity}
              </span>
              <span className="ms-2 text-[10px] uppercase tracking-tagged text-ink-muted">
                {t(
                  `addon_status_${addon.status}` as 'addon_status_pending',
                  lang
                )}
              </span>
              {note && (
                <span className="block text-xs text-ink-muted">
                  {note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Row>
  );
}

// ============================================================
// Phase 6.1 PR 2 (S4) — preferences display
// ============================================================

/**
 * Returns true iff the trip's preferences blob contains at
 * least one key other than the legacy `lead_trip_type`
 * injection. The legacy key is always present on
 * promote-flow trips (the RPC injects it on every promote);
 * displaying a "Customer Preferences" section that contains
 * only that key would be misleading — the section should
 * appear only when the customer or admin actually
 * expressed something.
 */
function hasDisplayablePreferences(
  preferences: TripPreferences | null
): boolean {
  if (!preferences) return false;
  const keys = Object.keys(preferences).filter(
    (k) => k !== 'lead_trip_type'
  );
  return keys.length > 0;
}

function PreferencesRows({
  preferences,
  lang,
}: {
  preferences: TripPreferences;
  lang: Lang;
}) {
  // Display order matches Phase 6.1 spec iteration 4 S4
  // (halal first because it's the most operationally
  // critical signal for the operator's prep).
  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  if (preferences.halal === true) {
    rows.push({
      label: t('preferences_section_title', lang),
      value: t('pref_halal_required', lang),
    });
  } else if (preferences.halal === false) {
    rows.push({
      label: t('preferences_section_title', lang),
      value: t('pref_halal_no', lang),
    });
  }

  if (preferences.prayer_setup === true) {
    rows.push({
      label: '',
      value: t('pref_prayer_setup', lang),
    });
  } else if (preferences.prayer_setup === false) {
    rows.push({
      label: '',
      value: t('pref_prayer_setup_no', lang),
    });
  }

  if (preferences.crew_gender_preference) {
    const key =
      preferences.crew_gender_preference === 'male'
        ? 'pref_crew_gender_male'
        : preferences.crew_gender_preference === 'female'
          ? 'pref_crew_gender_female'
          : 'pref_crew_gender_no_preference';
    rows.push({ label: '', value: t(key, lang) });
  }

  if (preferences.pilot_nationality) {
    rows.push({
      label: t('pref_pilot_nationality_label', lang),
      value: countryDisplayName(preferences.pilot_nationality, lang),
    });
  }

  if (preferences.crew_nationalities && preferences.crew_nationalities.length > 0) {
    rows.push({
      label: t('pref_crew_nationalities_label', lang),
      value: preferences.crew_nationalities
        .map((c) => countryDisplayName(c, lang))
        .join('، '),
    });
  }

  if (preferences.crew_languages && preferences.crew_languages.length > 0) {
    rows.push({
      label: t('pref_crew_languages_label', lang),
      value: preferences.crew_languages
        .map((l) => languageDisplayName(l, lang))
        .join('، '),
    });
  }

  if (
    typeof preferences.child_seats === 'number' &&
    preferences.child_seats > 0
  ) {
    rows.push({
      label: t('pref_child_seats_label', lang),
      value: preferences.child_seats,
    });
  }

  if (preferences.elderly_assistance === true) {
    rows.push({ label: '', value: t('pref_elderly_assistance', lang) });
  } else if (preferences.elderly_assistance === false) {
    rows.push({ label: '', value: t('pref_elderly_assistance_no', lang) });
  }

  if (preferences.medical_notes) {
    rows.push({
      label: t('pref_medical_notes_label', lang),
      value: (
        <span className="whitespace-pre-wrap">{preferences.medical_notes}</span>
      ),
    });
  }

  // Render: first row gets the "Customer Preferences"
  // section title in its label slot; subsequent rows have
  // empty labels (visually grouped under the first label).
  // If the first matched preference happens to be one that
  // already used the title label (halal), no special-case
  // needed — the title only emits once.
  return (
    <>
      {rows.map((row, idx) => (
        <Row
          key={idx}
          label={
            idx === 0 && row.label === ''
              ? t('preferences_section_title', lang)
              : row.label
          }
        >
          {row.value}
        </Row>
      ))}
    </>
  );
}
