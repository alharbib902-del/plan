import { z } from 'zod';

import { supportAr } from '@/lib/i18n/support-ar';

export const SUPPORT_CATEGORIES = [
  'booking',
  'payment',
  'refund',
  'complaint',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  booking: supportAr.categoryBooking,
  payment: supportAr.categoryPayment,
  refund: supportAr.categoryRefund,
  complaint: supportAr.categoryComplaint,
  other: supportAr.categoryOther,
};

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: supportAr.statusOpen,
  in_progress: supportAr.statusInProgress,
  resolved: supportAr.statusResolved,
  closed: supportAr.statusClosed,
};

export const createTicketSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES, {
    errorMap: () => ({ message: supportAr.invalidCategory }),
  }),
  subject: z.string().trim().min(3, supportAr.subjectRequired).max(200, supportAr.subjectTooLong),
  description: z
    .string()
    .trim()
    .min(5, supportAr.descRequired)
    .max(2000, supportAr.descTooLong),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const ticketReplySchema = z.object({
  ticket_id: z.string().uuid(supportAr.invalidTicketId),
  body: z.string().trim().min(1, supportAr.bodyEmpty).max(2000, supportAr.bodyTooLong),
});

export type TicketReplyInput = z.infer<typeof ticketReplySchema>;

export const ticketStatusSchema = z.object({
  ticket_id: z.string().uuid(supportAr.invalidTicketId),
  status: z.enum(SUPPORT_STATUSES, {
    errorMap: () => ({ message: supportAr.invalidStatus }),
  }),
  resolution: z
    .string()
    .trim()
    .max(2000, supportAr.resolutionTooLong)
    .optional()
    .transform((value) => value ?? ''),
});

export type TicketStatusInput = z.infer<typeof ticketStatusSchema>;
