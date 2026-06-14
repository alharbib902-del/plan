import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  clientUpdateProfileSchema,
  notificationPreferencesSchema,
} from '@/lib/validators/clients';
import {
  mapClientProfileRow,
  type ClientProfile,
} from '@/lib/mobile/serializers/profile';
import {
  mapNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/mobile/serializers/notifications';

/**
 * Transport-neutral client-profile core (PR4 slice 4b).
 *
 * Shared by the web Server Action (cookie) and the mobile route
 * (Bearer): one implementation, no drift. `clientId` always comes
 * from the caller's validated session; every read/write is pinned
 * to `WHERE id = clientId`. Notifications + change-password cores
 * land in their own slices (4c / 4f) in this same module.
 */

export type ProfileCoreFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
}

export type { ClientProfile };

export async function runGetClientProfile(
  clientId: string
): Promise<ClientProfile | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('clients')
    .select('full_name, contact_phone, auth_email, marketing_opt_in')
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    console.error('[profile-core.getProfile] read error', error);
    throw new Error(`runGetClientProfile failed: ${error.message}`);
  }
  if (!data) return null;
  return mapClientProfileRow(
    data as {
      full_name: string | null;
      contact_phone: string | null;
      auth_email: string | null;
      marketing_opt_in: boolean | null;
    }
  );
}

export type UpdateProfileResult = { ok: true } | ProfileCoreFailure;

export async function runUpdateClientProfile(
  clientId: string,
  input: { full_name: string; phone: string; marketing_opt_in: boolean }
): Promise<UpdateProfileResult> {
  const parsed = clientUpdateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from('clients')
    .update({
      full_name: parsed.data.full_name,
      contact_phone: parsed.data.phone,
      marketing_opt_in: parsed.data.marketing_opt_in,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId);
  if (error) {
    console.error('[profile-core.updateProfile] update error', error);
    return { ok: false, error: 'update_failed' };
  }
  return { ok: true };
}

// ============================================================
// Notification preferences (read + update) — slice 4c
// ============================================================

export async function runGetNotificationPreferences(
  clientId: string
): Promise<NotificationPreferences> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('clients')
    .select('notification_preferences')
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    console.error('[profile-core.getNotifPrefs] read error', error);
    throw new Error(`runGetNotificationPreferences failed: ${error.message}`);
  }
  const prefs =
    (
      data as {
        notification_preferences?: Record<string, unknown> | null;
      } | null
    )?.notification_preferences ?? null;
  return mapNotificationPreferences(prefs);
}

export type UpdateNotifPrefsResult = { ok: true } | ProfileCoreFailure;

export async function runUpdateNotificationPreferences(
  clientId: string,
  input: { empty_legs: { email: boolean; wa_link: boolean }; marketing: boolean }
): Promise<UpdateNotifPrefsResult> {
  // Returns the web action's EXISTING wire codes (invalid_input /
  // server_error) so the web updateMyNotificationPreferences can
  // delegate here with identical error display (parity, no drift).
  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('clients')
      .update({
        notification_preferences: parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    if (error) {
      console.error('[profile-core.updateNotifPrefs] update error', error);
      return { ok: false, error: 'server_error' };
    }
  } catch (err) {
    console.error('[profile-core.updateNotifPrefs] threw', err);
    return { ok: false, error: 'server_error' };
  }
  return { ok: true };
}
