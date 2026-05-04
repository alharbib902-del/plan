'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin/auth';
import {
  appendInternalNoteSchema,
  updateLeadStatusSchema,
} from '@/lib/validators/admin';
import {
  appendInternalNote as appendInternalNoteQuery,
  updateLeadStatus as updateLeadStatusQuery,
} from '@/lib/supabase/queries/leads';

export type LeadActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'failed' };

export async function updateLeadStatus(
  formData: FormData
): Promise<LeadActionResult> {
  requireAdminSession();

  const parsed = updateLeadStatusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    await updateLeadStatusQuery(parsed.data.id, parsed.data.status);
  } catch (err) {
    console.error('[leads-action] updateLeadStatus failed', err);
    return { ok: false, error: 'failed' };
  }

  revalidatePath('/admin/leads');
  revalidatePath(`/admin/leads/${parsed.data.id}`);
  return { ok: true };
}

export async function appendInternalNote(
  formData: FormData
): Promise<LeadActionResult> {
  requireAdminSession();

  const parsed = appendInternalNoteSchema.safeParse({
    id: formData.get('id'),
    note: formData.get('note'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    await appendInternalNoteQuery(parsed.data.id, parsed.data.note);
  } catch (err) {
    console.error('[leads-action] appendInternalNote failed', err);
    return { ok: false, error: 'failed' };
  }

  revalidatePath(`/admin/leads/${parsed.data.id}`);
  return { ok: true };
}
