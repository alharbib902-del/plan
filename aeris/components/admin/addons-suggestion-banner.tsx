import type { TripPreferences } from '@/lib/validators/trip-preferences';
import { ADDONS_CATALOG } from '@/lib/addons/catalog';
import { t } from '@/lib/i18n/operator';

/**
 * Phase 6.2 PR 2b: preferences-driven suggestion banner.
 *
 * Reads `trip_requests.preferences` (Phase 6.1 JSONB) and
 * surfaces every catalog entry whose `suggested_for` array
 * matches at least one set preference. Non-blocking — the
 * admin can still attach any addon regardless of the banner.
 *
 * Mapping (per spec S1):
 *   - preferences.halal === true              → entries tagged `halal`
 *   - preferences.prayer_setup === true       → entries tagged `prayer_setup`
 *   - preferences.elderly_assistance === true → entries tagged `elderly_assistance`
 *   - preferences.child_seats > 0             → entries tagged `child_seats`
 *   - preferences.medical_notes set + non-empty → entries tagged `medical_notes`
 *   - preferences.crew_languages.length > 0   → entries tagged `crew_languages`
 *   - preferences.crew_nationalities.length > 0 → entries tagged `crew_nationalities`
 *   - preferences.pilot_nationality set       → entries tagged `pilot_nationality`
 *
 * If no preference triggers a suggestion, the banner does
 * not render.
 */
export function AddonsSuggestionBanner({
  preferences,
}: {
  preferences: TripPreferences;
}) {
  const triggers = collectTriggers(preferences);
  if (triggers.size === 0) return null;

  const suggested = ADDONS_CATALOG.filter((entry) =>
    entry.suggested_for.some((key) => triggers.has(key))
  );
  if (suggested.length === 0) return null;

  return (
    <div className="rounded-xl border border-gold/40 bg-gold/5 p-5">
      <h3 className="font-ar text-sm font-medium text-gold-light">
        {t('admin_addons_suggestions_heading', 'ar')}
      </h3>
      <ul className="font-ar mt-3 space-y-2 text-sm text-ink">
        {suggested.map((entry) => (
          <li key={entry.subtype} className="flex items-start gap-3">
            <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-gold" />
            <div>
              <div className="text-ink">{entry.label_ar}</div>
              <div className="text-xs text-ink-muted">
                {entry.description_ar}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function collectTriggers(prefs: TripPreferences): Set<string> {
  const triggers = new Set<string>();
  if (prefs.halal === true) triggers.add('halal');
  if (prefs.prayer_setup === true) triggers.add('prayer_setup');
  if (prefs.elderly_assistance === true) triggers.add('elderly_assistance');
  if (typeof prefs.child_seats === 'number' && prefs.child_seats > 0) {
    triggers.add('child_seats');
  }
  if (typeof prefs.medical_notes === 'string' && prefs.medical_notes.length > 0) {
    triggers.add('medical_notes');
  }
  if (prefs.crew_languages && prefs.crew_languages.length > 0) {
    triggers.add('crew_languages');
  }
  if (prefs.crew_nationalities && prefs.crew_nationalities.length > 0) {
    triggers.add('crew_nationalities');
  }
  if (prefs.pilot_nationality) triggers.add('pilot_nationality');
  return triggers;
}
