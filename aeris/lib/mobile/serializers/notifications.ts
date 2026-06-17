import {
  getCategoryOptInState,
  isClientOptedIn,
} from '@/lib/clients/notification-preferences';

/**
 * Pure notification-preferences shape + mapper (NO 'server-only' — so
 * the tsx unit suite can import it, like the other mobile serializers).
 *
 * Normalises the raw `clients.notification_preferences` JSONB into the
 * strict client-facing shape, applying the PER-CHANNEL default policy:
 * email/wa_link + marketing default opt-IN (Decision #4); `push` defaults
 * opt-OUT (it needs an OS permission + a registered device — never on by
 * default). A non-boolean / polluted value is treated as opt-OUT defensively
 * for every channel + marketing, so a corrupted JSONB write never silently
 * keeps a higher-risk consent on. `push` is OPTIONAL on the wire (PR2
 * backward-compat): old apps that PATCH without it stay valid; GET always
 * returns the full shape.
 */
export interface NotificationPreferences {
  empty_legs: { email: boolean; wa_link: boolean; push: boolean };
  marketing: boolean;
}

export function mapNotificationPreferences(
  prefs: Record<string, unknown> | null | undefined
): NotificationPreferences {
  const marketing = prefs
    ? (prefs as Record<string, unknown>).marketing
    : undefined;
  return {
    empty_legs: {
      ...getCategoryOptInState(prefs, 'empty_legs'),
      // push defaults opt-OUT via the per-channel default helper.
      push: isClientOptedIn(prefs, 'empty_legs', 'push'),
    },
    // Opt-in only when absent (Decision #4) or explicitly `true`; an
    // explicit `false` OR any polluted non-boolean value → opt-OUT
    // (defensive, mirrors the empty_legs channel policy).
    marketing: marketing === undefined || marketing === true,
  };
}
