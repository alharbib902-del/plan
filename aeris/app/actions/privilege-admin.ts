'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminSession } from '@/lib/admin/auth';
import { forceAdminClientPrivilegeTier } from '@/lib/privilege/admin-pii';
import { isUuid } from '@/lib/utils/uuid';
import type { AdminForceTierResult } from '@/lib/privilege/types';

/**
 * Phase 13 PR 1 — Admin Server Actions for /admin/clients/[id]/privilege.
 *
 * Currently exposes only `forceTierChangeAction`. PR 2 will add
 * `adjustCashbackAction` for the manual_cashback_adjustment flow.
 */

const ForceTierInputSchema = z.object({
  client_id: z.string().refine(isUuid, {
    message: 'client_id must be a valid UUID',
  }),
  new_tier: z.enum(['silver', 'gold', 'platinum', 'diamond']),
  reason: z
    .string()
    .trim()
    .min(10, 'Reason must be at least 10 characters')
    .max(500, 'Reason must be at most 500 characters'),
  lock_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'lock_until must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export type ForceTierActionResult =
  | { ok: true; result: AdminForceTierResult }
  | { ok: false; error: string };

export async function forceTierChangeAction(input: {
  client_id: string;
  new_tier: string;
  reason: string;
  lock_until: string | null;
}): Promise<ForceTierActionResult> {
  // Admin session guard. Throws/redirects if cookie invalid.
  requireAdminSession();

  const parsed = ForceTierInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'invalid_input',
    };
  }

  const result = await forceAdminClientPrivilegeTier({
    client_id: parsed.data.client_id,
    new_tier: parsed.data.new_tier,
    reason: parsed.data.reason,
    lock_until: parsed.data.lock_until ?? null,
  });

  revalidatePath(`/admin/clients/${parsed.data.client_id}/privilege`);
  revalidatePath('/admin/clients');

  return { ok: true, result };
}
