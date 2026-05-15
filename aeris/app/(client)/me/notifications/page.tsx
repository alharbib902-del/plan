import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import {
  isClientOptedIn,
  type NotificationCategory,
  type NotificationChannel,
} from '@/lib/clients/notification-preferences';
import { NotificationPreferencesForm } from '@/components/clients/notification-preferences-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 — `/me/notifications` preferences page.
 *
 * Server-renders the current preferences from
 * clients.notification_preferences (JSONB) + delegates to the
 * client-component form for the toggle UI + Server Action call.
 *
 * Default policy (Decision #4): missing keys → opt-in. The
 * isClientOptedIn helper handles the missing-key fallback so
 * the page doesn't have to.
 *
 * Gated behind ENABLE_CLIENT_PORTAL (Phase 9). NOT gated behind
 * ENABLE_CLIENT_EMPTY_LEGS_PORTAL — clients should be able to
 * set marketing prefs even when the empty-legs feature is OFF.
 * (Toggling empty_legs.* prefs while the flag is off is a no-op
 * but harmless — the dispatcher won't run the client-loop until
 * the flag flips.)
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.notificationsPageTitle,
  robots: { index: false, follow: false },
};

async function loadCurrentPrefs(clientId: string): Promise<{
  empty_legs: { email: boolean; wa_link: boolean };
  marketing: boolean;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('clients')
    .select('notification_preferences')
    .eq('id', clientId)
    .maybeSingle();

  const prefs =
    (data as { notification_preferences?: Record<string, unknown> } | null)
      ?.notification_preferences ?? null;

  return {
    empty_legs: {
      email: isClientOptedIn(prefs, 'empty_legs', 'email'),
      wa_link: isClientOptedIn(prefs, 'empty_legs', 'wa_link'),
    },
    // Marketing is a single boolean (not a {email, wa_link} pair)
    // so the isClientOptedIn helper isn't a perfect fit; read
    // directly from the JSONB and default to true (opt-in).
    marketing:
      typeof (prefs as { marketing?: unknown } | null)?.marketing ===
      'boolean'
        ? Boolean((prefs as { marketing?: boolean }).marketing)
        : true,
  };
}

export default async function ClientMeNotificationsPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  const session = await requireClientSession();
  const initialPrefs = await loadCurrentPrefs(session.client_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.notificationsPageTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {clientsAr.notificationsPageSubtitle}
        </p>
      </header>
      <NotificationPreferencesForm initialPrefs={initialPrefs} />
    </section>
  );
}

// Suppress unused-import warning for the type re-export pulled
// in by the helper.
export type _ForceTypeImport = NotificationCategory | NotificationChannel;
