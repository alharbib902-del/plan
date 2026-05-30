'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { requireAdminSession } from '@/lib/admin/auth';
import {
  createTicketSchema,
  ticketReplySchema,
  ticketStatusSchema,
} from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

export type SupportActionState = {
  ok: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

// ---------------------------------------------------------------------------
// Client actions (guarded by requireClientSession — redirects to /login).
// Identity (client_id) and author role are derived server-side, never trusted
// from the form.
// ---------------------------------------------------------------------------

export async function createSupportTicketAction(
  _prevState: SupportActionState,
  formData: FormData
): Promise<SupportActionState> {
  const session = await requireClientSession();

  const parsed = createTicketSchema.safeParse({
    category: formData.get('category'),
    subject: formData.get('subject'),
    description: formData.get('description'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: supportAr.actionInvalid,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const looseClient = createAdminClient() as unknown as LooseRpcClient;
  const { error } = await looseClient.rpc('create_support_ticket', {
    p_client_id: session.client_id,
    p_category: parsed.data.category,
    p_subject: parsed.data.subject,
    p_description: parsed.data.description,
    p_booking_id: null,
  });

  if (error) {
    console.error('[support] create_support_ticket rpc error', error);
    return { ok: false, message: supportAr.createError };
  }

  revalidatePath('/me/support');
  return { ok: true, message: supportAr.createSuccess };
}

export async function replyToTicketAction(
  _prevState: SupportActionState,
  formData: FormData
): Promise<SupportActionState> {
  const session = await requireClientSession();

  const parsed = ticketReplySchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: supportAr.actionInvalid,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const looseClient = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await looseClient.rpc('add_support_ticket_message', {
    p_ticket_id: parsed.data.ticket_id,
    p_author_role: 'client',
    p_author_id: session.client_id,
    p_body: parsed.data.body,
  });

  if (error) {
    console.error('[support] add_support_ticket_message (client) rpc error', error);
    return { ok: false, message: supportAr.replyError };
  }

  // NULL ⇒ ticket missing or not owned by this client.
  if (!data) {
    return { ok: false, message: supportAr.replyCannot };
  }

  revalidatePath(`/me/support/${parsed.data.ticket_id}`);
  revalidatePath('/me/support');
  return { ok: true, message: supportAr.replySuccess };
}

// ---------------------------------------------------------------------------
// Admin actions (requireAdminSession redirects to /admin/login on failure).
// Author role is hardcoded 'support'; author_id stays NULL for now (the thread
// renders admin/support messages as "support" — admin_accounts linkage is a
// later enhancement).
// ---------------------------------------------------------------------------

export async function adminReplyToTicketAction(
  _prevState: SupportActionState,
  formData: FormData
): Promise<SupportActionState> {
  await requireAdminSession();

  const parsed = ticketReplySchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: supportAr.actionInvalid,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const looseClient = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await looseClient.rpc('add_support_ticket_message', {
    p_ticket_id: parsed.data.ticket_id,
    p_author_role: 'support',
    p_author_id: null,
    p_body: parsed.data.body,
  });

  if (error || !data) {
    console.error('[support] add_support_ticket_message (admin) rpc error', error);
    return { ok: false, message: supportAr.replyError };
  }

  revalidatePath(`/admin/support/${parsed.data.ticket_id}`);
  revalidatePath('/admin/support');
  return { ok: true, message: supportAr.adminReplySuccess };
}

export async function updateTicketStatusAction(
  _prevState: SupportActionState,
  formData: FormData
): Promise<SupportActionState> {
  await requireAdminSession();

  const parsed = ticketStatusSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    status: formData.get('status'),
    resolution: formData.get('resolution'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: supportAr.actionInvalid,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const looseClient = createAdminClient() as unknown as LooseRpcClient;
  const { error } = await looseClient.rpc('admin_update_support_ticket', {
    p_ticket_id: parsed.data.ticket_id,
    p_status: parsed.data.status,
    p_resolution: parsed.data.resolution || null,
  });

  if (error) {
    console.error('[support] admin_update_support_ticket rpc error', error);
    return { ok: false, message: supportAr.statusUpdateError };
  }

  revalidatePath(`/admin/support/${parsed.data.ticket_id}`);
  revalidatePath('/admin/support');
  return { ok: true, message: supportAr.statusUpdateSuccess };
}
