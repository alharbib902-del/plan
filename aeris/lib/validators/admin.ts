import { z } from 'zod';

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'quoted',
  'converted',
  'closed',
] as const;

export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const adminLoginSchema = z.object({
  password: z
    .string({ required_error: 'password_required' })
    .min(1, 'password_required'),
});

export const updateLeadStatusSchema = z.object({
  id: z.string().uuid('lead_id_invalid'),
  status: z.enum(LEAD_STATUSES, {
    required_error: 'status_required',
    invalid_type_error: 'status_invalid',
  }),
});

export const appendInternalNoteSchema = z.object({
  id: z.string().uuid('lead_id_invalid'),
  note: z
    .string({ required_error: 'note_required' })
    .trim()
    .min(1, 'note_required')
    .max(2000, 'note_too_long'),
});

export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
export type AppendInternalNoteInput = z.infer<typeof appendInternalNoteSchema>;
