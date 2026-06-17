/**
 * Phase 10 PR 1 — client notification preferences helper.
 *
 * Reads `clients.notification_preferences` JSONB (§3.3) +
 * answers per-(category, channel) opt-in questions.
 *
 * Default policy is PER CHANNEL: email/wa_link default opt-IN (so
 * clients who never touched /me/notifications still receive
 * empty-leg matches per Decision #4). `push` defaults opt-OUT — it
 * requires an OS permission + a registered device, so it must NEVER
 * be on by default. Explicit `false` flips a single channel off
 * without touching siblings; explicit `true` opts in. A polluted
 * non-boolean is always opt-OUT.
 *
 * Shape (forward-extensible):
 * ```jsonc
 * {
 *   "empty_legs": { "email": true, "wa_link": true },
 *   "marketing": false  // future categories add the same shape
 * }
 * ```
 *
 * Used by:
 *   - lib/empty-legs/notifications.ts → enqueueClientLegNotifications
 *     channel-selection rules (§4.2 step 3 round 4 P1 #1).
 *   - app/actions/clients-empty-legs.ts → updateMyNotificationPreferences
 *     (Server Action wraps a Zod-validated write back to the column).
 *   - components/clients/notification-preferences-form.tsx (PR 2).
 */

export type NotificationCategory = 'empty_legs' | 'marketing';
export type NotificationChannel = 'email' | 'wa_link' | 'push';

// Per-channel default opt-in policy. email/wa_link default opt-IN (legacy
// Decision #4). push defaults opt-OUT — it needs an OS permission + a
// registered device, so it must never be on by default.
const CHANNEL_DEFAULT_OPT_IN: Record<NotificationChannel, boolean> = {
  email: true,
  wa_link: true,
  push: false,
};

export function isClientOptedIn(
  prefs: Record<string, unknown> | null | undefined,
  category: NotificationCategory,
  channel: NotificationChannel
): boolean {
  const defaultOptIn = CHANNEL_DEFAULT_OPT_IN[channel];

  // Missing prefs JSONB / category / channel key → the channel's default.
  if (!prefs) return defaultOptIn;
  const cat = (prefs as Record<string, Record<string, unknown> | undefined>)[
    category
  ];
  if (!cat) return defaultOptIn;
  const value = cat[channel];
  if (value === undefined) return defaultOptIn;

  // Explicit boolean — only `true` is opt-in. Non-boolean values
  // (e.g., the JSONB column got polluted by a future buggy write)
  // are treated as opt-OUT defensively, so a malformed write never
  // sends unwanted outreach.
  return value === true;
}

/** Convenience: returns the {email, wa_link} pair for a category
 *  in one call. Used by the matching loop's channel-selection
 *  rules so `notifications.ts` can branch cleanly. */
export interface CategoryOptInState {
  email: boolean;
  wa_link: boolean;
}

export function getCategoryOptInState(
  prefs: Record<string, unknown> | null | undefined,
  category: NotificationCategory
): CategoryOptInState {
  return {
    email: isClientOptedIn(prefs, category, 'email'),
    wa_link: isClientOptedIn(prefs, category, 'wa_link'),
  };
}
