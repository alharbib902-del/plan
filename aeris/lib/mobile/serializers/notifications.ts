import { getCategoryOptInState } from '@/lib/clients/notification-preferences';

/**
 * Pure notification-preferences shape + mapper (NO 'server-only' — so
 * the tsx unit suite can import it, like the other mobile serializers).
 *
 * Normalises the raw `clients.notification_preferences` JSONB into the
 * strict client-facing shape, applying the default policy: a missing
 * category/channel/marketing key is opt-IN (Decision #4, mirrored from
 * lib/clients/notification-preferences.ts). A non-boolean / polluted
 * value is treated as opt-OUT defensively — for BOTH the empty_legs
 * channels (via getCategoryOptInState) AND marketing — so a corrupted
 * JSONB write never silently keeps a higher-risk consent on.
 */
export interface NotificationPreferences {
  empty_legs: { email: boolean; wa_link: boolean };
  marketing: boolean;
}

export function mapNotificationPreferences(
  prefs: Record<string, unknown> | null | undefined
): NotificationPreferences {
  const marketing = prefs
    ? (prefs as Record<string, unknown>).marketing
    : undefined;
  return {
    empty_legs: getCategoryOptInState(prefs, 'empty_legs'),
    // Opt-in only when absent (Decision #4) or explicitly `true`; an
    // explicit `false` OR any polluted non-boolean value → opt-OUT
    // (defensive, mirrors the empty_legs channel policy).
    marketing: marketing === undefined || marketing === true,
  };
}
