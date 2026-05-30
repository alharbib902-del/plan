import { z } from 'zod';

const iata = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'رمز المطار يجب أن يكون 3 أحرف (IATA)'));

export const createAlertSchema = z
  .object({
    origin_iata: iata,
    destination_iata: iata,
    max_price_sar: z
      .union([z.literal(''), z.coerce.number().positive('السعر يجب أن يكون أكبر من صفر')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    date_from: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    date_to: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
  })
  .refine((d) => d.origin_iata !== d.destination_iata, {
    message: 'مطار المغادرة والوصول يجب أن يختلفا',
    path: ['destination_iata'],
  })
  .refine((d) => !d.date_from || !d.date_to || d.date_from <= d.date_to, {
    message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
    path: ['date_to'],
  });

export type CreateAlertInput = z.infer<typeof createAlertSchema>;

export const alertIdSchema = z.object({
  alert_id: z.string().uuid('معرّف التنبيه غير صالح'),
});
