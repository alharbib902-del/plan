'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { createAlertSchema, alertIdSchema } from '@/lib/empty-legs/alert-validators';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export type AlertActionState = {
  ok: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

const ALERTS_PATH = '/me/empty-legs/alerts';

function loose(): LooseRpcClient {
  return createAdminClient() as unknown as LooseRpcClient;
}

/** Create — stateful (useActionState in the client form). */
export async function createAlertAction(
  _prevState: AlertActionState,
  formData: FormData
): Promise<AlertActionState> {
  const session = await requireClientSession();

  const parsed = createAlertSchema.safeParse({
    origin_iata: formData.get('origin_iata'),
    destination_iata: formData.get('destination_iata'),
    max_price_sar: formData.get('max_price_sar'),
    date_from: formData.get('date_from'),
    date_to: formData.get('date_to'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: emptyLegsAr.alertActionInvalid,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const { data, error } = await loose().rpc('create_client_empty_leg_alert', {
    p_client_id: session.client_id,
    p_origin: parsed.data.origin_iata,
    p_destination: parsed.data.destination_iata,
    p_max_price: parsed.data.max_price_sar,
    p_date_from: parsed.data.date_from,
    p_date_to: parsed.data.date_to,
    p_channels: ['email'],
  });

  if (error) {
    console.error('[empty-leg-alerts] create rpc error', error);
    return { ok: false, message: emptyLegsAr.alertCreateError };
  }
  if (!data) {
    // NULL ⇒ guard failed (bad IATA / same route).
    return { ok: false, message: emptyLegsAr.alertActionInvalid };
  }

  revalidatePath(ALERTS_PATH);
  return { ok: true, message: emptyLegsAr.alertCreateSuccess };
}

/** Delete — plain action used directly in a server-component form. */
export async function deleteAlert(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const parsed = alertIdSchema.safeParse({ alert_id: formData.get('alert_id') });
  if (!parsed.success) return;

  const { error } = await loose().rpc('delete_client_empty_leg_alert', {
    p_alert_id: parsed.data.alert_id,
    p_client_id: session.client_id,
  });
  if (error) {
    console.error('[empty-leg-alerts] delete rpc error', error);
  }
  revalidatePath(ALERTS_PATH);
}

/** Toggle active — plain action; `active` is the desired next state. */
export async function toggleAlert(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const parsed = alertIdSchema.safeParse({ alert_id: formData.get('alert_id') });
  if (!parsed.success) return;
  const nextActive = formData.get('active') === 'true';

  const { error } = await loose().rpc('set_client_empty_leg_alert_active', {
    p_alert_id: parsed.data.alert_id,
    p_client_id: session.client_id,
    p_active: nextActive,
  });
  if (error) {
    console.error('[empty-leg-alerts] toggle rpc error', error);
  }
  revalidatePath(ALERTS_PATH);
}
